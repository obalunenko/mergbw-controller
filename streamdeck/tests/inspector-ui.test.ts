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
	let nextTimer = 0;
	const timers = new Map<number, () => void>();
	let listener: (event: { payload: unknown }) => void;
	runInNewContext(code, {
		exports: {},
		require: (name: string) => {
			if (name === "../i18n.js") return i18n;
			assert.equal(name, "../validation.js");
			return validation;
		},
		crypto: { randomUUID },
		setTimeout: (callback: () => void) => {
			const id = ++nextTimer;
			timers.set(id, callback);
			return id;
		},
		clearTimeout: (id: number) => timers.delete(id),
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
		listener({ payload: { ...message, v: 2, type: "result", complete: true, ok: true, snapshot, ...extra } });
	};
	return {
		get,
		sent,
		reply,
		expire: () => {
			for (const callback of [...timers.values()]) callback();
			timers.clear();
		},
	};
}
const connection = { port: 18765, configured: true, hasToken: true };
function snapshot(actionKind: string, assignment: Record<string, unknown>) {
	return {
		actionKind,
		assignment: { schemaVersion: 1, ...assignment },
		connection,
		configuration: { ...connection, generation: "a".repeat(32), identity: "AA:BB:CC:DD:EE:FF" },
		controller: { state: "ready", physical_state_verified: false },
		language: "en",
		settingsValid: true,
	};
}

test("transition fields preserve invalid drafts and validate one-to-sixty seconds before saving", () => {
	const ui = inspector();
	const saved = snapshot("transition", {
		fromRGB: "FF5000",
		fromPercent: 100,
		toRGB: "FF5000",
		toPercent: 0,
		durationSeconds: 30,
	});
	ui.reply(saved);
	assert.equal(ui.get("transition-controls").hidden, false);
	assert.equal(ui.get("color-controls").hidden, true);
	for (const invalid of ["0", "61", "1.5", ""]) {
		ui.get("transition-seconds").value = invalid;
		ui.get("assignment-save").fire("click");
		assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
		ui.reply(saved);
		assert.equal(ui.get("transition-seconds").value, invalid);
	}
	ui.get("transition-from-rgb").value = "#ff5000";
	ui.get("transition-to-rgb").value = "123abc";
	ui.get("transition-seconds").value = "60";
	ui.get("assignment-save").fire("click");
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({
			settings: {
				schemaVersion: 1,
				fromRGB: "FF5000",
				fromPercent: 100,
				toRGB: "123ABC",
				toPercent: 0,
				durationSeconds: 60,
			},
		}),
	);
});

test("transition status buttons use read-only refresh and the displayed current cancellation ID", () => {
	const ui = inspector();
	const saved = snapshot("on", {});
	ui.reply(saved);
	assert.equal(ui.get("transition-cancel").disabled, true);
	ui.get("transition-refresh").fire("click");
	assert.equal(ui.sent.at(-1)!.type, "transition.status");
	const transition = {
		id: "a".repeat(32),
		state: "running",
		elapsedMs: 500,
		durationMs: 1000,
		physical_state_verified: false,
	};
	ui.reply({ ...saved, transition });
	assert.match(ui.get("transition-status").textContent, /running/);
	assert.match(ui.get("transition-status").textContent, /unverified/);
	assert.equal(ui.get("transition-cancel").disabled, false);
	ui.get("transition-cancel").fire("click");
	assert.equal(ui.sent.at(-1)!.type, "transition.cancel");
	assert.equal(JSON.stringify(ui.sent.at(-1)!.payload), JSON.stringify({ id: transition.id }));
	ui.reply({ ...saved, transition: { ...transition, state: "cancelled" } });
	assert.equal(ui.get("transition-cancel").disabled, true);
	const count = ui.sent.length;
	ui.get("transition-cancel").fire("click");
	assert.equal(ui.sent.length, count);
});

test("RGB and manual identity drafts survive operation, language and unrelated settings publications", () => {
	const ui = inspector();
	const saved = snapshot("color", { rgb: "FF5000" });
	ui.reply(saved);
	ui.get("rgb").value = "00FF00";
	ui.get("rgb").fire("change");
	ui.get("identity").value = "11:22:33:44:55:66";
	for (const status of ["pending", "sent", "unknown"]) {
		ui.reply({ ...saved, language: "ru", operation: { status } });
		assert.equal(ui.get("rgb").value, "00FF00");
		assert.equal(ui.get("color-picker").value, "#00FF00");
		assert.equal(ui.get("identity").value, "11:22:33:44:55:66");
		assert.equal(ui.get("operation").textContent, i18n.translate("ru", status));
	}
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, rgb: "00FF00" } }),
	);
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.get("identity").value, "11:22:33:44:55:66");
	ui.get("prepare").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.prepareManual");
	assert.equal(ui.sent.at(-1)?.payload.identity, "11:22:33:44:55:66");
	assert.equal(ui.get("identity").value, "");
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
	ui.get("identity").value = "11:22:33:44:55:66";
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.get("rgb").value, "0000FF");
	assert.equal(ui.get("identity").value, "11:22:33:44:55:66");
	ui.reply({ ...snapshot("color", { rgb: "00FF00" }), connection: { ...connection, port: 18767 } });
	assert.equal(ui.get("identity").value, "11:22:33:44:55:66");
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
	assert.equal(replacement.get("identity").value, "");
});

test("manual Prepare clears its identity without discarding unrelated assignment drafts", () => {
	const ui = inspector();
	const saved = snapshot("brightness", { percent: 25 });
	ui.reply(saved);
	ui.get("percent").value = "75";
	ui.get("identity").value = "aa:bb:cc:dd:ee:ff";
	ui.get("prepare").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.prepareManual");
	assert.equal(ui.sent.at(-1)?.payload.identity, "AA:BB:CC:DD:EE:FF");
	assert.equal(ui.get("identity").value, "");
	ui.reply(saved);
	assert.equal(ui.get("percent").value, "75");
	ui.get("percent").value = "101";
	ui.get("percent").validity.valid = false;
	ui.get("assignment-save").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
});

test("overlapping assignment saves retain newer drafts through intermediate publications", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.get("assignment-save").fire("click");
	ui.get("rgb").value = "0000FF";
	ui.get("assignment-save").fire("click");
	ui.get("rgb").value = "ABCDEF";
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	ui.reply(snapshot("color", { rgb: "00FF00" }), { complete: false });
	assert.equal(ui.get("rgb").value, "ABCDEF");
	ui.reply(snapshot("color", { rgb: "00FF00" }));
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 2);
	assert.equal((ui.sent.at(-1)?.payload.settings as { rgb: string }).rgb, "0000FF");
	ui.reply(snapshot("color", { rgb: "0000FF" }));
	assert.equal(ui.get("rgb").value, "ABCDEF");
	ui.reply(snapshot("color", { rgb: "123456" }));
	assert.equal(ui.get("rgb").value, "123456");
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
	for (const save of ["assignment-save"]) {
		const ui = inspector();
		const saved = snapshot("color", { rgb: "FF5000" });
		ui.reply(saved);
		ui.get("rgb").value = "00FF00";
		ui.get("identity").value = "11:22:33:44:55:66";
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
		assert.equal(ui.get("identity").value, "11:22:33:44:55:66");
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

test("manual UI validates identity, previews Apply or Confirm and offers read-only unknown-save checking", () => {
	const ui = inspector();
	const saved = snapshot("on", {});
	ui.reply(saved);
	ui.get("identity").value = "bad";
	ui.get("prepare").fire("click");
	assert.equal(ui.sent.length, 1);
	assert.equal(ui.get("identity-error").textContent, i18n.translate("en", "invalid_identity"));
	ui.get("identity").value = "AA:BB:CC:DD:EE:FF";
	ui.get("prepare").fire("click");
	const proposal = {
		transactionId: "b".repeat(32),
		expectedGeneration: "a".repeat(32),
		identity: "AA:BB:CC:DD:EE:FF",
		port: 18765,
		presetCount: 3,
		hasToken: true,
		requiresConfirmation: true,
	};
	ui.reply({ ...saved, proposal });
	assert.equal(ui.get("confirm").hidden, false);
	assert.equal(ui.get("apply").hidden, true);
	ui.get("confirm").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.apply");
	assert.equal(ui.sent.at(-1)?.payload.confirmed, true);
	ui.reply({ ...saved, saveOutcome: { status: "commit_unknown", activeStateKnown: false } });
	assert.equal(ui.get("prepare").disabled, true);
	assert.equal(ui.get("save-outcome").textContent, i18n.translate("en", "commit_unknown"));
	ui.get("configuration-check").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.check");
});
test("manual UI cancel discards proposal and HTML has no token/link/path or automatic identity persistence", () => {
	const html = readFileSync("com.obalunenko.mergbw.sdPlugin/ui/index.html", "utf8");
	assert.doesNotMatch(html, /replacement-token|import-url|setting=|global=/);
	assert.match(html, /id="identity"/);
	assert.match(html, /id="setup-method"/);
	const ui = inspector();
	const saved = snapshot("off", {});
	ui.reply({
		...saved,
		proposal: {
			transactionId: "b".repeat(32),
			expectedGeneration: null,
			identity: "AA:BB:CC:DD:EE:FF",
			port: 18765,
			presetCount: 3,
			hasToken: true,
			requiresConfirmation: false,
		},
	});
	assert.equal(ui.get("apply").hidden, false);
	ui.get("cancel").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.cancel");
	assert.equal(ui.get("proposal").hidden, true);
});

test("file selection is transient, review/cancel clears it and readonly recovery never resends apply", () => {
	const html = readFileSync("com.obalunenko.mergbw.sdPlugin/ui/index.html", "utf8");
	assert.match(html, /<sdpi-file id="settings-file" accept=".json"/);
	assert.match(html, /<sdpi-file id="presets-file" accept=".json"/);
	assert.doesNotMatch(html, /setting=|global=/);
	const ui = inspector(),
		saved = snapshot("off", {});
	ui.reply(saved);
	const option = new Element();
	option.value = "import";
	ui.get("setup-method").replaceChildren(option);
	ui.get("setup-method").value = "import";
	ui.get("setup-method").fire("change");
	ui.get("settings-file").value = "/synthetic/private/settings.json";
	ui.get("presets-file").value = "/synthetic/private/presets.json";
	ui.get("prepare").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.prepareImport");
	assert.equal(ui.get("settings-file").value, "");
	assert.equal(ui.get("presets-file").value, "");
	const proposal = {
		transactionId: "b".repeat(32),
		expectedGeneration: "a".repeat(32),
		identity: "11:22:33:44:55:66",
		port: 23456,
		presetCount: 1,
		hasToken: true,
		requiresConfirmation: true,
		diff: { identity: true, port: true, secret: true, presets: true },
	};
	ui.reply({ ...saved, proposal });
	assert.equal(ui.get("confirm").hidden, false);
	assert.ok(ui.get("proposal-diff").textContent.includes(i18n.translate("en", "diff_secret")));
	ui.get("confirm").fire("click");
	ui.get("confirm").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 1);
	ui.reply({ ...saved, saveOutcome: { status: "commit_unknown", activeStateKnown: false } });
	ui.get("prepare").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "configuration.prepareImport").length, 1);
	ui.get("configuration-check").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.check");
	ui.reply({
		...saved,
		saveOutcome: { status: "applied", activeStateKnown: true },
		controller: { state: "failed", errorCategory: "spawn_failed" },
	});
	assert.equal(ui.get("save-outcome").textContent, i18n.translate("en", "applied"));
	assert.equal(ui.get("controller-state").textContent, i18n.translate("en", "spawn_failed"));
	assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 1);
	ui.get("settings-file").value = "/synthetic/again.json";
	ui.get("cancel").fire("click");
	assert.equal(ui.get("settings-file").value, "");
});
test("migration and whole-file guidance is bilingual and never suggests legacy links include identity", () => {
	for (const language of ["en", "ru"] as const) {
		const ui = inspector();
		ui.reply({
			...snapshot("preset", { presetId: "custom_missing" }),
			language,
			migration: "legacy",
			catalog: { status: "available", entries: [{ id: "other", label: "Other" }] },
		});
		assert.equal(ui.get("migration-guidance").textContent, i18n.translate(language, "legacyIdentityRequired"));
		assert.equal(ui.get("preset-select").value, "custom_missing");
		assert.equal(ui.get("assignment-save").disabled, true);
		assert.equal(ui.sent.length, 1);
	}
});

test("a lost PI confirmation unblocks read-only checking without replaying or queuing another write", () => {
	const ui = inspector(),
		saved = snapshot("on", {});
	ui.reply(saved);
	ui.reply({
		...saved,
		proposal: {
			transactionId: "b".repeat(32),
			expectedGeneration: "a".repeat(32),
			identity: "11:22:33:44:55:66",
			port: 23456,
			presetCount: 1,
			hasToken: true,
			requiresConfirmation: true,
		},
	});
	ui.get("confirm").fire("click");
	ui.expire();
	assert.equal(ui.get("save-outcome").textContent, i18n.translate("en", "commit_unknown"));
	assert.equal(ui.get("prepare").disabled, true);
	ui.get("configuration-check").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.check");
	ui.reply({ ...saved, activeStateKnown: true, saveOutcome: { status: "not_applied", activeStateKnown: true } });
	assert.equal(ui.get("prepare").disabled, false);
	assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 1);
});

test("panel restart coalesces repeated clicks and keeps readiness, Bluetooth and save outcome separate", () => {
	const ui = inspector(),
		saved = snapshot("on", {});
	ui.reply({
		...saved,
		controller: { state: "failed", errorCategory: "host_unavailable", bluetooth: "unknown" },
		saveOutcome: { status: "commit_unknown", activeStateKnown: false },
		check: { service: "available", authorization: "verified", bluetooth: "connected" },
	});
	assert.equal(ui.get("bluetooth-status").textContent, i18n.translate("en", "statusUnknown"));
	assert.equal(ui.get("save-outcome").textContent, i18n.translate("en", "commit_unknown"));
	ui.get("restart").fire("click");
	ui.get("restart").fire("click");
	ui.get("restart").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "controller.restart").length, 1);
	assert.equal(JSON.stringify(ui.sent.at(-1)!.payload), JSON.stringify({ expectedGeneration: "a".repeat(32) }));
	assert.equal(ui.get("restart").disabled, true);
	ui.reply(
		{
			...saved,
			controller: { state: "cleanup_blocked", errorCategory: "instance_busy", bluetooth: "unknown" },
			saveOutcome: { status: "applied", activeStateKnown: true },
		},
		{ ok: false, messageKey: "instance_busy" },
	);
	assert.equal(ui.get("restart").disabled, false);
	assert.equal(ui.get("controller-state").textContent, i18n.translate("en", "instance_busy"));
	assert.equal(ui.get("save-outcome").textContent, i18n.translate("en", "applied"));
	assert.equal(
		ui.sent.some((message) => message.type === "configuration.apply"),
		false,
	);
});
