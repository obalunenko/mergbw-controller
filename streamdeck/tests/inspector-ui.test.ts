import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as i18n from "../src/i18n.js";
import * as validation from "../src/validation.js";

// Run the actual inspector entry point with DOM and SDPI facades, without SDK startup.
class Element {
	public textContent = "";
	public hidden = false;
	public disabled = false;
	public dataset: Record<string, string> = {};
	public children: Element[] = [];
	public validity = { valid: true };
	private currentValue = "";
	private readonly listeners = new Map<string, (() => void)[]>();
	constructor(private readonly isSelect = false) {}
	public get value(): string {
		return this.currentValue;
	}
	public set value(value: string) {
		this.currentValue = this.isSelect && !this.children.some((child) => child.value === value) ? "" : value;
	}
	public get valueAsNumber(): number {
		return this.value === "" ? NaN : Number(this.value);
	}
	public get selectedOptions(): Element[] {
		return this.children.filter((child) => child.value === this.value);
	}
	public replaceChildren(...children: Element[]): void {
		this.children = children;
		this.value = children[0]?.value ?? "";
	}
	public toggleAttribute(name: string, enabled: boolean): void {
		assert.equal(name, "disabled");
		this.disabled = enabled;
	}
	public removeAttribute(name: string): void {
		this.toggleAttribute(name, false);
	}
	public addEventListener(event: string, listener: () => void): void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}
	public fire(event: string): void {
		for (const listener of this.listeners.get(event) ?? []) listener();
	}
}
type Message = { sessionId: string; requestId: string; type: string; payload: Record<string, unknown> };
const code = ts.transpileModule(readFileSync("src/ui/inspector.ts", "utf8"), {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function inspector() {
	const html = readFileSync("com.obalunenko.mergbw.sdPlugin/ui/index.html", "utf8");
	const elements = new Map(
		Array.from(html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g), ([, tag, id]) => [
			id!,
			new Element(tag === "select"),
		]),
	);
	const get = (id: string): Element => {
		assert.ok(elements.has(id), `Element ${id} exists in the inspector HTML`);
		return elements.get(id)!;
	};
	const sent: Message[] = [];
	let listener: (event: { payload: unknown }) => void;
	runInNewContext(code, {
		exports: {},
		require: (name: string) => {
			if (name === "../i18n.js") return i18n;
			assert.equal(name, "../validation.js");
			return validation;
		},
		crypto: { randomUUID },
		document: {
			getElementById: get,
			querySelectorAll: () => [],
			documentElement: { lang: "en" },
			createElement: (tag: string) => {
				assert.equal(tag, "option");
				return new Element();
			},
		},
		window: {
			addEventListener: () => {},
			SDPIComponents: {
				streamDeckClient: {
					send: async (event: string, message: Message) => {
						assert.equal(event, "sendToPlugin");
						sent.push(structuredClone(message));
					},
					sendToPropertyInspector: {
						subscribe: (callback: typeof listener) => {
							listener = callback;
						},
					},
				},
			},
		},
	});
	const reply = (snapshot: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
		const message = sent.at(-1)!;
		listener({ payload: { ...message, v: 1, type: "result", complete: true, ok: true, snapshot, ...extra } });
	};
	return { get, sent, reply };
}
const connection = { port: 18765, configured: true, hasToken: true };
function snapshot(actionKind: string, assignment: Record<string, unknown>) {
	return {
		actionKind,
		assignment: { schemaVersion: 1, ...assignment },
		connection,
		language: "en",
		settingsValid: true,
	};
}

test("RGB and port drafts survive operation, language and unrelated settings publications", () => {
	const ui = inspector();
	const saved = snapshot("color", { rgb: "FF5000" });
	ui.reply(saved);
	ui.get("rgb").value = "00FF00";
	ui.get("rgb").fire("change");
	ui.get("port").value = "18766";
	for (const status of ["pending", "sent", "unknown"]) {
		ui.reply({ ...saved, language: "ru", operation: { status } });
		assert.equal(ui.get("rgb").value, "00FF00");
		assert.equal(ui.get("color-picker").value, "#00FF00");
		assert.equal(ui.get("port").value, "18766");
		assert.equal(ui.get("operation").textContent, i18n.translate("ru", status));
	}
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, rgb: "00FF00" } }),
	);
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.get("port").value, "18766");
	ui.get("save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "connection.save").length, 1);
	assert.equal(ui.sent.at(-1)!.payload.port, 18766);
});

test("brightness draft and slider survive publications and Save sends the draft once", () => {
	const ui = inspector();
	const saved = snapshot("brightness", { percent: 25 });
	ui.reply(saved);
	ui.get("percent-slider").value = "75";
	ui.get("percent-slider").fire("input");
	for (const status of ["pending", "sent"]) {
		ui.reply({ ...saved, operation: { status }, catalog: { status: "loading", entries: [] } });
		assert.equal(ui.get("percent").value, "75");
		assert.equal(ui.get("percent-slider").value, "75");
	}
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, percent: 75 } }),
	);
});

test("preset draft survives catalog refresh and rename, while deleted or unchecked drafts cannot save", () => {
	const ui = inspector();
	const saved = snapshot("preset", { presetId: "sunset" });
	const entries = [
		{ id: "sunset", label: "Sunset" },
		{ id: "reading", label: "Reading" },
	];
	ui.reply({ ...saved, catalog: { status: "available", entries } });
	assert.equal(ui.get("preset-select").value, "sunset");
	ui.get("preset-select").value = "reading";
	ui.get("preset-select").fire("change");
	ui.reply({ ...saved, operation: { status: "pending" }, catalog: { status: "loading", entries: [] } });
	assert.equal(ui.get("preset-select").value, "reading");
	assert.equal(ui.get("assignment-save").disabled, true);
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.length, 1);
	ui.reply({
		...saved,
		operation: { status: "sent" },
		catalog: { status: "available", entries: entries.map((entry) => ({ ...entry, label: "Renamed" })) },
	});
	assert.equal(ui.get("preset-select").value, "reading");
	assert.equal(ui.get("preset-select").selectedOptions[0]!.textContent, "Renamed (reading)");
	assert.equal(ui.get("assignment-save").disabled, false);
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, presetId: "reading" } }),
	);
	ui.reply({ ...saved, catalog: { status: "available", entries: entries.slice(0, 1) } });
	assert.equal(ui.get("preset-select").value, "reading");
	assert.equal(ui.get("assignment-save").disabled, true);
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
});

test("save acknowledgements retain newer edits and explicit setting changes reconcile only their fields", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.get("assignment-save").fire("click");
	ui.get("rgb").value = "0000FF";
	ui.get("port").value = "18766";
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.get("rgb").value, "0000FF");
	assert.equal(ui.get("port").value, "18766");
	ui.reply({ ...snapshot("color", { rgb: "00FF00" }), connection: { ...connection, port: 18767 } });
	assert.equal(ui.get("port").value, "18767");
	assert.equal(ui.get("rgb").value, "0000FF");
	ui.reply({ ...snapshot("color", { rgb: "ABCDEF" }), connection: { ...connection, port: 18767 } });
	assert.equal(ui.get("rgb").value, "ABCDEF");
});

test("invalid drafts and failed saves remain editable; a replacement session starts from saved settings", () => {
	const ui = inspector();
	const saved = snapshot("color", { rgb: "FF5000" });
	ui.reply(saved);
	ui.get("rgb").value = "broken";
	ui.reply({ ...saved, operation: { status: "pending" } });
	assert.equal(ui.get("rgb").value, "broken");
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.length, 1);
	ui.get("rgb").value = "00FF00";
	ui.get("assignment-save").fire("click");
	ui.reply(saved, { ok: false, messageKey: "storage" });
	assert.equal(ui.get("rgb").value, "00FF00");
	assert.equal(ui.get("message").textContent, i18n.translate("en", "storage"));
	ui.get("rgb").value = "ABCDEF";
	ui.reply(snapshot("color", { rgb: "0000FF" }), { sessionId: "old-session" });
	assert.equal(ui.get("rgb").value, "ABCDEF");
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.get("rgb").value, "00FF00");
	const replacement = inspector();
	replacement.reply(saved);
	assert.equal(replacement.get("rgb").value, "FF5000");
	assert.equal(replacement.get("port").value, "18765");
});

test("explicit import restores its port without discarding unrelated assignment drafts", () => {
	const ui = inspector();
	const saved = snapshot("brightness", { percent: 25 });
	ui.reply(saved);
	ui.get("percent").value = "75";
	ui.get("port").value = "18766";
	ui.get("import-url").value = "http://127.0.0.1:18765/mock_access_token_1234567890123456/on";
	ui.get("import").fire("click");
	assert.equal(ui.get("import-url").value, "");
	ui.reply(saved);
	assert.equal(ui.get("port").value, "18765");
	assert.equal(ui.get("percent").value, "75");
	ui.get("percent").value = "101";
	ui.get("percent").validity.valid = false;
	ui.reply({ ...saved, operation: { status: "sent" } });
	ui.get("assignment-save").fire("click");
	assert.equal(ui.get("percent").value, "101");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
});

test("overlapping assignment and port saves retain newer drafts through intermediate publications", () => {
	for (const field of ["rgb", "port"]) {
		const ui = inspector();
		const saved = snapshot("color", { rgb: "FF5000" });
		ui.reply(saved);
		const values = field === "rgb" ? ["00FF00", "0000FF", "ABCDEF"] : ["18766", "18767", "18768"];
		const button = field === "rgb" ? "assignment-save" : "save";
		const type = field === "rgb" ? "assignment.save" : "connection.save";
		const updated = (value: string) =>
			field === "rgb"
				? snapshot("color", { rgb: value })
				: { ...saved, connection: { ...connection, port: Number(value) } };
		ui.get(field).value = values[0]!;
		ui.get(button).fire("click");
		ui.get(field).value = values[1]!;
		ui.get(button).fire("click");
		ui.get(field).value = values[2]!;
		assert.equal(ui.sent.filter((message) => message.type === type).length, 1);
		ui.reply(updated(values[0]!), { complete: false });
		assert.equal(ui.get(field).value, values[2]);
		assert.equal(ui.sent.filter((message) => message.type === type).length, 1);
		ui.reply(updated(values[0]!));
		assert.equal(ui.sent.filter((message) => message.type === type).length, 2);
		const payload = ui.sent.at(-1)!.payload;
		assert.equal(field === "rgb" ? (payload.settings as { rgb: string }).rgb : String(payload.port), values[1]);
		ui.reply(updated(values[1]!), { complete: false });
		ui.reply(updated(values[1]!));
		assert.equal(ui.get(field).value, values[2]);
		// Once saves finish, an explicit external change still reconciles the field.
		ui.reply(updated(field === "rgb" ? "123456" : "18769"));
		assert.equal(ui.get(field).value, field === "rgb" ? "123456" : "18769");
	}
});

test("a failed queued save preserves later edits and each explicit Save is submitted once", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.get("assignment-save").fire("click");
	ui.get("rgb").value = "0000FF";
	ui.get("assignment-save").fire("click");
	ui.get("rgb").value = "ABCDEF";
	ui.reply(snapshot("color", { rgb: "FF5000" }), { ok: false, messageKey: "storage" });
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 2);
	ui.reply(snapshot("color", { rgb: "0000FF" }));
	assert.equal(ui.get("rgb").value, "ABCDEF");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 2);
});

test("save errors remain visible through queued language, check and refresh requests until that save recovers", () => {
	for (const save of ["assignment-save", "save"]) {
		const ui = inspector();
		const saved = snapshot("color", { rgb: "FF5000" });
		ui.reply(saved);
		ui.get("rgb").value = "00FF00";
		ui.get("port").value = "18766";
		ui.get(save).fire("click");
		ui.get("language").value = "ru";
		ui.get("language").fire("change");
		ui.get("check").fire("click");
		ui.get("refresh").fire("click");
		assert.equal(ui.sent.length, 2);
		ui.reply(saved, { ok: false, messageKey: "storage" });
		assert.equal(ui.get("message").textContent, i18n.translate("en", "storage"));
		assert.equal(ui.sent.at(-1)?.type, "language.save");
		ui.reply({ ...saved, language: "ru" });
		assert.equal(ui.get("message").textContent, i18n.translate("ru", "storage"));
		assert.equal(ui.sent.at(-1)?.type, "connection.check");
		ui.reply({ ...saved, language: "ru" }, { complete: false });
		assert.equal(ui.sent.at(-1)?.type, "connection.check");
		ui.reply({ ...saved, language: "ru" });
		assert.equal(ui.sent.at(-1)?.type, "presets.refresh");
		ui.reply({ ...saved, language: "ru" });
		assert.equal(ui.get("message").textContent, i18n.translate("ru", "storage"));
		assert.equal(ui.get("rgb").value, "00FF00");
		assert.equal(ui.get("port").value, "18766");
		ui.get(save).fire("click");
		ui.reply({ ...snapshot("color", { rgb: "00FF00" }), language: "ru", connection: { ...connection, port: 18766 } });
		assert.equal(ui.get("message").textContent, "");
	}
});

test("read-only timeout guidance is bilingual while command timeouts retain possible late effects", () => {
	for (const language of ["en", "ru"] as const) {
		for (const button of ["check", "refresh"]) {
			const ui = inspector();
			const saved = { ...snapshot("preset", { presetId: "sunset" }), language };
			ui.reply(saved);
			ui.get(button).fire("click");
			ui.reply({
				...saved,
				check: { service: "available", authorization: "unknown", bluetooth: "disconnected", messageKey: "readTimeout" },
			});
			assert.equal(ui.get("message").textContent, i18n.translate(language, "readTimeout"));
			assert.doesNotMatch(ui.get("message").textContent, /late effect|поздн/i);
			assert.equal(ui.get("service-status").textContent, i18n.translate(language, "available"));
			assert.equal(ui.get("bluetooth-status").textContent, i18n.translate(language, "disconnected"));
			assert.equal(ui.get("preset-select").value, "sunset");
			assert.equal(ui.sent.length, 2);
			ui.reply({ ...saved, operation: { status: "unknown", errorCategory: "timeout" } }, { complete: false });
			assert.equal(
				ui.get("operation").textContent,
				`${i18n.translate(language, "unknown")} ${i18n.translate(language, "timeout")}`,
			);
			assert.match(ui.get("operation").textContent, /late effect|поздн/i);
		}
	}
});
