import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as i18n from "../src/i18n.js";
import * as presetEffects from "../src/preset-effects.js";
import * as scenes from "../src/scenes.js";
import * as validation from "../src/validation.js";

// Run the actual inspector entry point with DOM and SDPI facades, without SDK startup.
class Element {
	public textContent = "";
	public hidden = false;
	public disabled = false;
	public dataset: Record<string, string> = {};
	public children: Element[] = [];
	public validity = { valid: true };
	public checked = false;
	public label = "";
	public style: Record<string, string> = {};
	private currentValue = "";
	private readonly listeners = new Map<string, (() => void)[]>();
	constructor(private readonly isSelect = false) {}
	public get value(): string {
		return this.currentValue;
	}
	public set value(value: string) {
		this.currentValue = this.isSelect && !this.options.some((child) => child.value === value) ? "" : value;
	}
	public get valueAsNumber(): number {
		return this.value === "" ? NaN : Number(this.value);
	}
	public get selectedOptions(): Element[] {
		return this.options.filter((child) => child.value === this.value);
	}
	public get options(): Element[] {
		return this.children.flatMap((child) => (child.children.length ? child.children : [child]));
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
		if (this.disabled) return;
		for (const listener of this.listeners.get(event) ?? []) listener();
	}
	public click(): void {
		this.fire("click");
	}
}
type Message = { sessionId: string; requestId: string; type: string; payload: Record<string, unknown> };
const code = ts.transpileModule(readFileSync("src/ui/inspector.ts", "utf8"), {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function inspector(autoSummary = true) {
	const html = readFileSync("com.obalunenko.mergbw.sdPlugin/ui/index.html", "utf8");
	const elements = new Map(
		Array.from(html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g), ([markup, tag, id]) => {
			const element = new Element(tag === "select");
			element.hidden = /\bhidden\b/.test(markup!);
			element.disabled = /\bdisabled\b/.test(markup!);
			element.checked = /\bchecked\b/.test(markup!);
			element.value = markup!.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
			return [id!, element] as const;
		}),
	);
	const get = (id: string): Element => {
		assert.ok(elements.has(id), `Element ${id} exists in the inspector HTML`);
		return elements.get(id)!;
	};
	const sent: Message[] = [];
	const opened: unknown[] = [];
	const summaries: Message[] = [];
	let active: Message;
	let lastSnapshot: Record<string, unknown> = {};
	let nextTimer = 0;
	const timers = new Map<number, () => void>();
	let listener: (event: { payload: unknown }) => void;
	runInNewContext(code, {
		exports: {},
		require: (name: string) => {
			if (name === "../i18n.js") return i18n;
			if (name === "../preset-effects.js") return presetEffects;
			if (name === "../scenes.js") return scenes;
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
				assert.ok(["option", "optgroup"].includes(tag));
				return new Element();
			},
		},
		window: {
			addEventListener: () => {},
			SDPIComponents: {
				streamDeckClient: {
					send: async (event: string, message: Message) => {
						if (event === "openUrl") return void opened.push(structuredClone(message));
						assert.equal(event, "sendToPlugin");
						active = message;
						if (
							autoSummary &&
							message.type === "configuration.presetRead" &&
							!get("view-main").hidden &&
							get("view-editor").hidden
						) {
							summaries.push(structuredClone(message));
							listener({
								payload: {
									...message,
									v: 2,
									type: "result",
									complete: true,
									ok: true,
									snapshot: {
										...lastSnapshot,
										presetDefinition: {
											generation: message.payload.expectedGeneration,
											id: message.payload.id,
											preset: { label: "Summary", rgb: [255, 80, 0], brightness: 60 },
										},
									},
								},
							});
							return;
						}
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
		lastSnapshot = snapshot;
		const message = active;
		listener({ payload: { ...message, v: 2, type: "result", complete: true, ok: true, snapshot, ...extra } });
	};
	return {
		get,
		sent,
		opened,
		summaries,
		reply,
		save: () => {
			const field = (
				{ color: "rgb", brightness: "percent", preset: "preset-select", transition: "transition-seconds" } as Record<
					string,
					string
				>
			)[String(lastSnapshot.actionKind)];
			assert.ok(field);
			get(field).fire("change");
		},
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

function editorSnapshot(generation = "a".repeat(32)) {
	return {
		...snapshot("preset", { presetId: "colors" }),
		configuration: { ...connection, generation, identity: "AA:BB:CC:DD:EE:FF", presetCount: 1 },
		activeStateKnown: true,
		catalog: { status: "available", entries: [{ id: "colors", label: "Colors" }] },
		presetPage: { generation, entries: [{ id: "colors", label: "Colors", labelTruncated: false }], nextCursor: null },
	};
}

test("one grouped preset picker autosaves selection and keeps library and setup outside key settings", () => {
	const ui = inspector();
	const initial = {
		...editorSnapshot(),
		assignment: { schemaVersion: 1, presetId: "sunset" },
		catalog: {
			status: "available",
			entries: [
				{ id: "sunset", label: "Sunset", builtIn: true },
				{ id: "mine", label: "My animation", builtIn: false },
			],
		},
	};
	ui.reply(initial);
	assert.equal(ui.get("view-main").hidden, false);
	assert.equal(ui.get("view-setup").hidden, true);
	assert.equal(ui.get("view-library").hidden, true);
	assert.deepEqual(
		ui.get("preset-select").children.map((group) => group.label),
		[i18n.en.preloadedPresets, i18n.en.customPresets],
	);
	assert.deepEqual(
		ui.get("preset-select").options.map((option) => option.value),
		["sunset", "mine"],
	);
	assert.equal(ui.get("preset-copy").hidden, false);
	ui.get("preset-select").value = "mine";
	ui.get("preset-select").fire("change");
	assert.equal(ui.get("preset-copy").hidden, true);
	assert.equal(ui.get("preset-edit").hidden, false);
	assert.equal(ui.sent.at(-1)?.type, "assignment.save");
	assert.equal((ui.sent.at(-1)?.payload.settings as { presetId: string }).presetId, "mine");
	ui.reply({ ...initial, assignment: { schemaVersion: 1, presetId: "mine" } });
	ui.get("library-open").fire("click");
	assert.equal(ui.get("view-library").hidden, false);
	assert.equal(ui.sent.at(-1)?.type, "configuration.presetList");
	ui.reply(initial);
	ui.get("back").fire("click");
	assert.equal(ui.get("view-main").hidden, false);
	ui.get("setup-open").fire("click");
	assert.equal(ui.get("view-setup").hidden, false);
});

test("an empty catalog keeps assignment unset and creates nothing automatically", () => {
	const ui = inspector();
	ui.reply({
		...editorSnapshot(),
		assignment: { schemaVersion: 1, presetId: "" },
		catalog: { status: "available", entries: [] },
	});
	assert.equal(ui.get("preset-select").disabled, true);
	assert.equal(ui.get("preset-copy").disabled, true);
	assert.equal(ui.get("catalog-status").textContent, i18n.en.noPresets);
	assert.equal(ui.sent.length, 1);
});

test("customizing preloaded settings captures a new personal preset without changing the original", () => {
	const ui = inspector();
	const initial = {
		...editorSnapshot(),
		assignment: { schemaVersion: 1, presetId: "sunset" },
		catalog: { status: "available", entries: [{ id: "sunset", label: "Sunset", builtIn: true }] },
	};
	ui.reply(initial);
	ui.get("preset-copy").fire("click");
	assert.equal(ui.sent.at(-1)!.type, "configuration.presetRead");
	assert.equal(ui.sent.at(-1)!.payload.id, "sunset");
	ui.reply({
		...initial,
		presetDefinition: {
			generation: "a".repeat(32),
			id: "sunset",
			preset: { label: "Sunset", rgb: [255, 80, 0], brightness: 60 },
		},
	});
	assert.equal(ui.get("view-editor").hidden, false);
	assert.equal(ui.get("view-library").hidden, true);
	assert.match(ui.get("editor-id").value, /^p_[a-f0-9]{32}$/);
	assert.equal(ui.get("editor-name").value, "Sunset (copy)");
	ui.get("editor-review").fire("click");
	const review = ui.sent.at(-1)!;
	assert.equal(review.type, "configuration.preparePreset");
	assert.equal(review.payload.operation, "create");
	assert.notEqual(review.payload.id, "sunset");
	assert.equal(
		ui.sent.some((message) => message.type === "configuration.apply"),
		false,
	);
});

test("preset editor creates an ordered palette, captures review and reopens saved definitions without resetting drafts", () => {
	const ui = inspector(),
		initial = editorSnapshot();
	ui.reply(initial);
	ui.get("editor-new").fire("click");
	const stableId = ui.get("editor-id").value;
	assert.match(stableId, /^p_[a-f0-9]{32}$/);
	ui.get("editor-name").value = "My colors";
	ui.get("editor-kind").value = "palette";
	ui.get("editor-kind").fire("change");
	assert.equal(ui.get("editor-id").value, stableId);
	assert.equal(ui.get("editor-palette-controls").hidden, false);
	assert.equal(ui.get("editor-rgb-controls").hidden, true);
	ui.get("palette-add").fire("click");
	ui.get("palette-select").value = "2";
	ui.get("palette-select").fire("change");
	ui.get("palette-up").fire("click");
	ui.get("palette-select").value = "0";
	ui.get("palette-down").fire("click");
	ui.get("palette-color").value = "#00ff00";
	ui.get("palette-color").fire("input");
	ui.get("palette-add").fire("click");
	ui.get("palette-remove").fire("click");
	ui.get("editor-review").fire("click");
	const review = ui.sent.at(-1)!;
	assert.equal(review.type, "configuration.preparePreset");
	assert.equal(review.payload.id, stableId);
	assert.equal(review.payload.operation, "create");
	const preset = review.payload.preset as presetEffects.PresetDefinition;
	assert.deepEqual(preset.rgb, [255, 80, 0]);
	assert.deepEqual(preset.effect, {
		kind: "palette",
		loop: true,
		colors: [
			[0, 255, 0],
			[0, 80, 255],
		],
		transitionMs: 2000,
	});
	const proposal = {
		transactionId: "c".repeat(32),
		expectedGeneration: "a".repeat(32),
		requiresConfirmation: true,
		identity: "AA:BB:CC:DD:EE:FF",
		port: 18765,
		presetCount: 2,
		hasToken: true,
		diff: { presets: true },
	};
	ui.reply({ ...initial, proposal });
	assert.equal(ui.get("interruption-warning").hidden, false);
	assert.ok(ui.get("proposal-summary").textContent.includes("My colors"));
	ui.get("editor-name").value = "Dirty local draft";
	ui.reply(
		{
			...initial,
			proposal,
			effect: {
				id: "d".repeat(32),
				presetId: "colors",
				kind: "palette",
				state: "running",
				elapsedMs: 500,
				durationMs: null,
				physical_state_verified: false,
			},
		},
		{ complete: false },
	);
	assert.equal(ui.get("editor-name").value, "Dirty local draft");
	assert.equal(ui.get("editor-id").value, stableId);
	ui.get("confirm").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.apply");
	const next = editorSnapshot("b".repeat(32));
	ui.reply({ ...next, saveOutcome: { status: "applied", activeStateKnown: true } });
	assert.equal(ui.get("preset-editor").hidden, true);
	assert.equal(ui.sent.at(-1)?.type, "presets.refresh");
	ui.reply(next);
	// This synthetic response omits the created ID, so no assignment is made.
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
	ui.get("editor-edit").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "configuration.presetRead");
	ui.reply({ ...next, presetDefinition: { generation: "b".repeat(32), id: "colors", preset } });
	assert.equal(ui.get("editor-name").value, "My colors");
	assert.equal(ui.get("editor-id").value, "colors");
	ui.get("editor-name").value = "Renamed";
	ui.get("editor-review").fire("click");
	assert.equal(ui.sent.at(-1)?.payload.operation, "update");
	assert.equal(ui.sent.at(-1)?.payload.id, "colors");
	assert.equal((ui.sent.at(-1)?.payload.preset as presetEffects.PresetDefinition).label, "Renamed");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save" || message.type === "command").length, 0);
});

test("preset editor bounds palette size, validates mode fields and preserves stale drafts", () => {
	const ui = inspector(),
		initial = editorSnapshot();
	ui.reply(initial);
	ui.get("editor-new").fire("click");
	ui.get("editor-name").value = "Bounded palette";
	ui.get("editor-kind").value = "palette";
	ui.get("editor-kind").fire("change");
	for (let i = 0; i < 20; i++) ui.get("palette-add").fire("click");
	assert.equal(ui.get("palette-select").children.length, 16);
	for (let i = 0; i < 20; i++) ui.get("palette-remove").fire("click");
	assert.equal(ui.get("palette-select").children.length, 2);
	const sent = ui.sent.length;
	ui.get("editor-transition").value = "0.499";
	ui.get("editor-review").fire("click");
	assert.equal(ui.sent.length, sent);
	assert.equal(ui.get("editor-error").textContent, i18n.en.validation);
	ui.reply(editorSnapshot("b".repeat(32)), { complete: false });
	assert.equal(ui.get("editor-name").value, "Bounded palette");
	assert.equal(ui.get("editor-review").disabled, true);
	assert.equal(ui.get("editor-error").textContent, i18n.en.editorDraftStale);
	ui.get("editor-kind").value = "strobe";
	ui.get("editor-kind").fire("change");
	ui.get("editor-review").fire("click");
	assert.equal(ui.sent.length, sent, "changing type cannot bypass a stale draft generation");
});

for (const kind of presetEffects.presetKinds)
	test(`preset editor configures ${kind} without playback`, () => {
		const ui = inspector(),
			initial = editorSnapshot();
		ui.reply({ ...initial, language: "ru" });
		ui.get("editor-new").fire("click");
		ui.get("editor-name").value = `Preset ${kind}`;
		ui.get("editor-kind").value = kind;
		ui.get("editor-kind").fire("change");
		if (kind === "candle" || kind === "lightning") {
			ui.get("editor-loop").checked = false;
			ui.get("editor-loop").fire("change");
			assert.equal(ui.get("editor-duration-controls").hidden, false);
			ui.get("editor-duration").value = "5";
		}
		ui.get("editor-review").fire("click");
		const message = ui.sent.at(-1)!;
		assert.equal(message.type, "configuration.preparePreset");
		const preset = presetEffects.presetDefinition(message.payload.preset);
		assert.equal(preset.effect?.kind ?? "static", kind);
		if (kind === "candle" || kind === "lightning")
			assert.equal(
				(preset.effect?.kind === "candle" || preset.effect?.kind === "lightning") && preset.effect.durationMs,
				5000,
			);
		assert.equal(
			ui.sent.filter((message) => message.type === "effect.cancel" || message.type === "assignment.save").length,
			0,
		);
		assert.equal(ui.get("editor-kind").selectedOptions[0]?.textContent, i18n.translate("ru", `kind.${kind}`));
	});

test("preset editor shows lightning fields, round-trips a draft and rejects invalid pause and background", () => {
	const ui = inspector(),
		initial = editorSnapshot();
	ui.reply(initial);
	ui.get("editor-new").fire("click");
	ui.get("editor-name").value = "Storm";
	ui.get("editor-kind").value = "lightning";
	ui.get("editor-kind").fire("change");
	for (const type of ["palette", "strobe", "breathing", "candle", "lightning"])
		assert.equal(ui.get(`editor-${type}-controls`).hidden, type !== "lightning");
	assert.equal(ui.get("editor-duration-controls").hidden, true);
	assert.equal(ui.get("editor-rgb-controls").hidden, false);
	ui.get("editor-loop").checked = false;
	ui.get("editor-loop").fire("change");
	assert.equal(ui.get("editor-duration-controls").hidden, false);
	ui.get("editor-loop").checked = true;
	ui.get("editor-loop").fire("change");
	ui.get("editor-review").fire("click");
	const created = ui.sent.at(-1)!.payload.preset as presetEffects.PresetDefinition;
	assert.deepEqual(created.effect, {
		kind: "lightning",
		loop: true,
		backgroundRgb: [26, 42, 108],
		backgroundBrightness: 15,
		minPauseMs: 2000,
		maxPauseMs: 15000,
		maxFlashes: 3,
	});
	const edit = inspector();
	const preset: presetEffects.PresetDefinition = {
		label: "Short storm",
		rgb: [232, 240, 255],
		brightness: 90,
		effect: {
			kind: "lightning",
			loop: false,
			backgroundRgb: [1, 2, 3],
			backgroundBrightness: 0,
			minPauseMs: 750,
			maxPauseMs: 1250,
			maxFlashes: 5,
			durationMs: 60000,
		},
	};
	edit.reply(initial);
	edit.get("editor-edit").fire("click");
	edit.reply({ ...initial, presetDefinition: { generation: "a".repeat(32), id: "colors", preset } });
	assert.equal(edit.get("editor-kind").value, "lightning");
	assert.equal(edit.get("editor-background-rgb").value, "010203");
	assert.equal(edit.get("editor-duration-controls").hidden, false);
	const sent = edit.sent.length;
	edit.get("editor-min-pause").value = "2";
	edit.get("editor-review").fire("click");
	assert.equal(edit.sent.length, sent);
	assert.equal(edit.get("editor-error").textContent, i18n.en.pauseOrder);
	edit.get("editor-min-pause").value = "0.75";
	edit.get("editor-background-brightness").value = "90";
	edit.get("editor-review").fire("click");
	assert.equal(edit.sent.length, sent);
	assert.equal(edit.get("editor-error").textContent, i18n.en.backgroundBelowFlash);
	edit.get("editor-background-brightness").value = "0";
	edit.get("editor-review").fire("click");
	assert.equal(edit.sent.at(-1)?.type, "configuration.preparePreset");
	assert.deepEqual(edit.sent.at(-1)?.payload.preset, preset);
});

test("preset deletion is reviewed and effect controls use the exact visible run", () => {
	const ui = inspector(),
		initial = editorSnapshot();
	ui.reply(initial);
	ui.get("editor-delete").fire("click");
	assert.deepEqual(ui.sent.at(-1)?.payload, { expectedGeneration: "a".repeat(32), operation: "delete", id: "colors" });
	ui.reply({
		...initial,
		proposal: {
			transactionId: "c".repeat(32),
			expectedGeneration: "a".repeat(32),
			requiresConfirmation: true,
			identity: "AA:BB:CC:DD:EE:FF",
			port: 18765,
			presetCount: 1,
			hasToken: true,
			diff: { presets: true },
		},
	});
	assert.ok(ui.get("proposal-summary").textContent.includes("Delete: Colors (colors)"));
	assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 0);
	const effect = {
		id: "d".repeat(32),
		presetId: "colors",
		kind: "candle",
		state: "running",
		elapsedMs: 1000,
		durationMs: null,
		physical_state_verified: false,
	};
	ui.reply({ ...initial, effect }, { complete: false });
	assert.equal(ui.get("effect-cancel").disabled, false);
	assert.ok(!ui.get("effect-status").textContent.includes("null"));
	ui.get("effect-cancel").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "effect.cancel");
	assert.deepEqual(ui.sent.at(-1)?.payload, { id: effect.id });
});

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
		ui.save();
		assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
		ui.reply(saved);
		assert.equal(ui.get("transition-seconds").value, invalid);
	}
	ui.get("transition-from-rgb").value = "#ff5000";
	ui.get("transition-to-rgb").value = "123abc";
	ui.get("transition-seconds").value = "60";
	ui.save();
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

test("brightness draft and slider survive publications and a change saves the draft once", () => {
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
	ui.save();
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, percent: 75 } }),
	);
});

test("scene select lists catalog scenes then raw IDs and saves the canonical selection", () => {
	const ui = inspector();
	const saved = snapshot("scene", { sceneId: "disco" });
	ui.reply(saved);
	assert.equal(ui.get("scene-controls").hidden, false);
	assert.equal(ui.get("assignment-controls").hidden, false);
	const select = ui.get("scene-select");
	assert.equal(select.value, "disco");
	const [catalog, raw] = select.children;
	assert.equal(catalog!.children.length, 20);
	assert.equal(catalog!.children.find((option) => option.value === "rgbfade")!.textContent, "RGB Fade");
	assert.deepEqual(
		raw!.children.slice(0, 3).map((option) => [option.value, option.textContent]),
		[
			["80", "ID 80"],
			["81", "ID 81"],
			["82", "ID 82"],
		],
	);
	assert.equal(raw!.children.length, 20);
	select.value = "8A";
	select.fire("change");
	ui.reply({ ...saved, operation: { status: "pending" } });
	assert.equal(select.value, "8A");
	assert.equal(
		JSON.stringify(ui.sent.filter((message) => message.type === "assignment.save").at(-1)!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, sceneId: "8A" } }),
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
	assert.equal(ui.get("preset-select").selectedOptions[0]?.disabled, true);
	ui.save();
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	ui.reply({
		...saved,
		operation: { status: "sent" },
		catalog: { status: "available", entries: entries.map((entry) => ({ ...entry, label: "Renamed" })) },
	});
	assert.equal(ui.get("preset-select").value, "reading");
	assert.equal(ui.get("preset-select").selectedOptions[0]!.textContent, "Renamed (reading)");
	assert.equal(ui.get("preset-select").selectedOptions[0]?.disabled, false);
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
	assert.equal(
		JSON.stringify(ui.sent.find((message) => message.type === "assignment.save")!.payload),
		JSON.stringify({ settings: { schemaVersion: 1, presetId: "reading" } }),
	);
	ui.reply({ ...saved, catalog: { status: "available", entries: entries.slice(0, 1) } });
	assert.equal(ui.get("preset-select").value, "reading");
	assert.equal(ui.get("preset-select").selectedOptions[0]?.disabled, true);
	ui.save();
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
});

test("save acknowledgements retain newer edits and explicit setting changes reconcile only their fields", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.save();
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
	ui.save();
	assert.equal(ui.sent.length, 1);
	ui.get("rgb").value = "00FF00";
	ui.save();
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
	ui.save();
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
});

test("overlapping assignment saves retain newer drafts through intermediate publications", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.save();
	ui.get("rgb").value = "0000FF";
	ui.save();
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

test("a failed queued save preserves later edits and each changed value is submitted once", () => {
	const ui = inspector();
	ui.reply(snapshot("color", { rgb: "FF5000" }));
	ui.get("rgb").value = "00FF00";
	ui.save();
	ui.get("rgb").value = "0000FF";
	ui.save();
	ui.get("rgb").value = "ABCDEF";
	ui.reply(snapshot("color", { rgb: "FF5000" }), { ok: false, messageKey: "storage" });
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 2);
	ui.reply(snapshot("color", { rgb: "0000FF" }));
	assert.equal(ui.get("rgb").value, "ABCDEF");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 2);
});

test("save errors remain visible through queued language, check and refresh requests until that save recovers", () => {
	{
		const ui = inspector();
		const saved = snapshot("color", { rgb: "FF5000" });
		ui.reply(saved);
		ui.get("rgb").value = "00FF00";
		ui.get("identity").value = "11:22:33:44:55:66";
		ui.save();
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
		ui.save();
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
		assert.equal(ui.get("preset-select").selectedOptions[0]?.disabled, true);
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

test("creating a preset assigns its captured ID only after known commit and a current catalog refresh", () => {
	const ui = inspector();
	const initial = editorSnapshot();
	ui.reply(initial);
	ui.get("preset-new").fire("click");
	ui.get("editor-name").value = "My evening";
	ui.get("editor-rgb").value = "123ABC";
	ui.get("editor-brightness").value = "43";
	ui.get("editor-kind").value = "breathing";
	ui.get("editor-kind").fire("change");
	ui.get("editor-cycle").value = "2.375";
	ui.get("editor-review").fire("click");
	const prepared = ui.sent.at(-1)!;
	assert.equal(prepared.type, "configuration.preparePreset");
	const id = prepared.payload.id as string;
	const definition = prepared.payload.preset as presetEffects.PresetDefinition;
	assert.deepEqual(definition.rgb, [18, 58, 188]);
	assert.equal(definition.brightness, 43);
	assert.equal(definition.effect?.kind, "breathing");
	assert.equal(definition.effect?.kind === "breathing" && definition.effect.cycleMs, 2375);
	ui.reply({
		...initial,
		proposal: {
			transactionId: "c".repeat(32),
			expectedGeneration: "a".repeat(32),
			requiresConfirmation: true,
			identity: "AA:BB:CC:DD:EE:FF",
			port: 18765,
			presetCount: 2,
			hasToken: true,
		},
	});
	assert.equal(ui.get("view-review").hidden, false);
	assert.equal(ui.get("view-setup").hidden, true);
	assert.equal(ui.get("confirm").textContent, i18n.en.createAndAssignConfirm);
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
	ui.get("confirm").fire("click");
	assert.equal(ui.get("back").disabled, true);
	const next = {
		...editorSnapshot("b".repeat(32)),
		catalog: {
			status: "available",
			entries: [
				{ id: "colors", label: "Colors" },
				{ id, label: "My evening" },
			],
		},
	};
	ui.reply({ ...next, saveOutcome: { status: "applied", activeStateKnown: true } });
	assert.equal(ui.sent.at(-1)?.type, "presets.refresh");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
	ui.reply(next);
	const assignment = ui.sent.find((message) => message.type === "assignment.save");
	assert.ok(assignment);
	assert.equal((assignment.payload.settings as { presetId: string }).presetId, id);
	ui.reply({ ...next, assignment: { schemaVersion: 1, presetId: id } });
	assert.equal(ui.get("preset-select").value, id);
	assert.equal(ui.get("assignment-status").textContent, i18n.en.assigned);
	assert.equal(ui.get("view-main").hidden, false);
	assert.equal(
		ui.sent.some((message) => message.type === "command"),
		false,
	);
});

test("unknown preset commit keeps the draft, offers read-only recovery and never assigns or replays", () => {
	const ui = inspector();
	const initial = editorSnapshot();
	ui.reply(initial);
	ui.get("preset-new").fire("click");
	ui.get("editor-name").value = "Keep this draft";
	ui.get("editor-review").fire("click");
	const id = ui.sent.at(-1)!.payload.id as string;
	ui.reply({
		...initial,
		proposal: {
			transactionId: "c".repeat(32),
			expectedGeneration: "a".repeat(32),
			requiresConfirmation: true,
			identity: "AA:BB:CC:DD:EE:FF",
			port: 18765,
			presetCount: 2,
			hasToken: true,
		},
	});
	ui.get("confirm").fire("click");
	ui.expire();
	assert.equal(ui.get("configuration-check").hidden, false);
	assert.equal(ui.get("view-editor").hidden, false);
	assert.equal(ui.get("editor-name").value, "Keep this draft");
	assert.equal(ui.get("editor-review").disabled, true);
	ui.get("configuration-check").fire("click");
	const next = {
		...editorSnapshot("b".repeat(32)),
		activeStateKnown: true,
		catalog: { status: "available", entries: [{ id, label: "Keep this draft" }] },
		saveOutcome: { status: "applied", activeStateKnown: true },
	};
	ui.reply(next);
	ui.get("refresh").fire("click");
	ui.reply(next);
	assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 1);
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 0);
	assert.equal(ui.get("editor-name").value, "Keep this draft");
});

test("delayed descriptions follow selection without opening an editor or reverting a pending assignment", () => {
	const ui = inspector(false);
	const initial = {
		...editorSnapshot(),
		catalog: {
			status: "available",
			entries: [
				{ id: "colors", label: "Colors" },
				{ id: "other", label: "Other" },
			],
		},
	};
	ui.reply(initial);
	assert.equal(ui.sent.at(-1)?.type, "configuration.presetRead");
	assert.equal(ui.sent.at(-1)?.payload.id, "colors");
	ui.get("preset-select").value = "other";
	ui.get("preset-select").fire("change");
	ui.reply({
		...initial,
		presetDefinition: {
			generation: "a".repeat(32),
			id: "colors",
			preset: { label: "Colors", rgb: [255, 0, 0], brightness: 90 },
		},
	});
	assert.equal(ui.get("preset-select").value, "other");
	assert.equal(ui.get("view-editor").hidden, true);
	assert.equal(ui.sent.at(-1)?.type, "assignment.save");
	ui.reply({ ...initial, assignment: { schemaVersion: 1, presetId: "other" } });
	assert.equal(ui.sent.at(-1)?.type, "configuration.presetRead");
	assert.equal(ui.sent.at(-1)?.payload.id, "other");
	ui.reply({
		...initial,
		assignment: { schemaVersion: 1, presetId: "other" },
		presetDefinition: {
			generation: "a".repeat(32),
			id: "other",
			preset: { label: "Other", rgb: [0, 0, 255], brightness: 23 },
		},
	});
	assert.equal(ui.get("preset-description").textContent, i18n.en["kind.static"] + " · 23%");
	assert.equal(ui.get("preset-swatch").style.backgroundColor, "#0000FF");
	assert.equal(ui.sent.filter((message) => message.type === "assignment.save").length, 1);
});

test("switching effect kinds preserves color, brightness, exact timing, repeat and ordered palette drafts", () => {
	const ui = inspector();
	ui.reply(editorSnapshot());
	ui.get("preset-new").fire("click");
	ui.get("editor-name").value = "Keep parameters";
	ui.get("editor-rgb").value = "12AB34";
	ui.get("editor-brightness").value = "37";
	ui.get("editor-cycle").value = "3.125";
	ui.get("editor-loop").checked = false;
	ui.get("editor-kind").value = "palette";
	ui.get("editor-kind").fire("change");
	ui.get("palette-select").value = "0";
	ui.get("palette-color").value = "#aabbcc";
	ui.get("palette-color").fire("input");
	for (const kind of ["strobe", "candle", "static", "palette", "breathing"]) {
		ui.get("editor-kind").value = kind;
		ui.get("editor-kind").fire("change");
	}
	assert.equal(ui.get("editor-rgb").value, "12AB34");
	assert.equal(ui.get("editor-brightness").value, "37");
	assert.equal(ui.get("editor-loop").checked, false);
	assert.ok(ui.get("palette-select").options[0]?.textContent.includes("AABBCC"));
	ui.get("editor-review").fire("click");
	const definition = ui.sent.at(-1)?.payload.preset as presetEffects.PresetDefinition;
	assert.equal(definition.effect?.kind === "breathing" && definition.effect.cycleMs, 3125);
	assert.equal(definition.effect?.loop, false);
});

for (const outcome of ["failed-refresh", "new-generation", "new-assignment", "explicit-choice"]) {
	test(`create-and-assign preserves a newer choice or an unverified catalog: ${outcome}`, () => {
		const ui = inspector();
		const initial = editorSnapshot();
		ui.reply(initial);
		ui.get("preset-new").fire("click");
		ui.get("editor-name").value = "Created preset";
		ui.get("editor-review").fire("click");
		const id = ui.sent.at(-1)!.payload.id as string;
		ui.reply({
			...initial,
			proposal: {
				transactionId: "c".repeat(32),
				expectedGeneration: "a".repeat(32),
				requiresConfirmation: true,
				identity: "AA:BB:CC:DD:EE:FF",
				port: 18765,
				presetCount: 2,
				hasToken: true,
			},
		});
		ui.get("confirm").fire("click");
		const next = {
			...editorSnapshot("b".repeat(32)),
			catalog: {
				status: "available",
				entries: [
					{ id: "colors", label: "Colors" },
					{ id, label: "Created preset" },
					{ id: "other", label: "Other" },
				],
			},
		};
		ui.reply({ ...next, saveOutcome: { status: "applied", activeStateKnown: true } });
		assert.equal(ui.sent.at(-1)?.type, "presets.refresh");
		if (outcome === "explicit-choice") {
			ui.get("preset-select").value = "other";
			ui.get("preset-select").fire("change");
		}
		const refreshed = {
			...next,
			...(outcome === "new-generation" ? { configuration: { ...next.configuration, generation: "d".repeat(32) } } : {}),
			...(outcome === "new-assignment" ? { assignment: { schemaVersion: 1, presetId: "other" } } : {}),
		};
		ui.reply(refreshed, outcome === "failed-refresh" ? { ok: false, messageKey: "service" } : {});
		const assignments = ui.sent.filter((message) => message.type === "assignment.save");
		assert.equal(
			assignments.some((message) => (message.payload.settings as { presetId: string }).presetId === id),
			false,
		);
		assert.equal(ui.sent.filter((message) => message.type === "configuration.apply").length, 1);
	});
}

const offer = {
	state: "available",
	installed: "v1.2.0",
	latest: "v1.3.0",
	autoCheck: true,
	installable: true,
	notes: '<img src=x onerror="alert(1)"> <a href="javascript:alert(2)">link</a>',
	releaseUrl: "https://github.com/obalunenko/mergbw-controller/releases/tag/v1.3.0",
	lastCheckedAt: "2026-10-25T10:00:00.000Z",
};
test("update banner shows available, downloading, handed and install failures with inert notes", () => {
	const ui = inspector();
	ui.reply({ ...snapshot("off", {}) });
	assert.equal(ui.get("update-banner").hidden, true);
	assert.equal(ui.get("update-settings").hidden, true);
	ui.reply({ ...snapshot("off", {}), update: offer });
	assert.equal(ui.get("update-banner").hidden, false);
	assert.equal(
		ui.get("update-banner-text").textContent,
		i18n.format("en", "updateAvailable", { latest: "1.3.0", installed: "1.2.0" }),
	);
	assert.equal(ui.get("update-notes").textContent, offer.notes);
	assert.deepEqual(ui.get("update-notes").children, []);
	assert.equal(ui.get("update-notes-details").hidden, false);
	assert.equal(ui.get("update-release-url").hidden, false);
	ui.get("update-release-url").fire("click");
	assert.deepEqual(ui.opened, [{ url: offer.releaseUrl }]);
	assert.equal(ui.get("update-install").hidden, false);
	assert.equal(ui.get("update-later").hidden, false);
	ui.get("update-install").fire("click");
	ui.get("update-install").fire("click");
	assert.deepEqual(ui.sent.at(-1), { ...ui.sent.at(-1)!, type: "update.install", payload: { tag: "v1.3.0" } });
	assert.equal(ui.sent.filter((message) => message.type === "update.install").length, 1);
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "downloading" } });
	assert.equal(ui.get("update-banner").hidden, false);
	assert.equal(ui.get("update-banner-text").textContent, i18n.en.updateDownloading);
	assert.equal(ui.get("update-install").hidden, true);
	assert.equal(ui.get("update-later").hidden, true);
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "handed" } });
	assert.equal(ui.get("update-banner-text").textContent, i18n.en.updateHanded);
	assert.equal(ui.get("update-install").hidden, false, "a cancelled prompt can be reopened");
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "failed", errorCategory: "checksum" } });
	assert.equal(ui.get("update-banner").hidden, false);
	assert.equal(ui.get("update-banner-error").textContent, i18n.en.update_checksum);
	assert.equal(ui.get("update-install").hidden, true);
	assert.equal(ui.get("update-release-url").hidden, false, "a failed install still links the release page");
	ui.get("update-later").fire("click");
	assert.equal(ui.sent.at(-1)?.type, "update.dismiss");
	assert.deepEqual(ui.sent.at(-1)?.payload, { tag: "v1.3.0" });
	for (const update of [
		{ ...offer, state: "dismissed" },
		{ ...offer, state: "up_to_date", installable: false, errorCategory: "no_asset" },
		{ state: "failed", installed: "v1.2.0", autoCheck: true, errorCategory: "network" },
		{ ...offer, releaseUrl: "https://evil.example/", state: "checking" },
	]) {
		ui.reply({ ...snapshot("off", {}), update });
		assert.equal(ui.get("update-banner").hidden, true, update.state);
		assert.equal(ui.get("update-notes").textContent, "");
	}
	const hostile = inspector();
	hostile.reply({ ...snapshot("off", {}), update: { ...offer, releaseUrl: "https://evil.example/x" } });
	assert.equal(hostile.get("update-release-url").hidden, true);
	hostile.get("update-release-url").fire("click");
	assert.deepEqual(hostile.opened, []);
});

test("the updates row toggles automatic checks, runs Check now and shows the last check", () => {
	for (const language of ["en", "ru"] as const) {
		const ui = inspector();
		const base = { ...snapshot("off", {}), language };
		const current = { state: "up_to_date", installed: "v1.3.0", latest: "v1.3.0", autoCheck: true };
		ui.reply({ ...base, update: current });
		ui.get("setup-open").fire("click");
		assert.equal(ui.sent.at(-1)?.type, "update.status");
		ui.reply({ ...base, update: { ...current, lastCheckedAt: "2026-10-25T10:00:00.000Z" } });
		assert.equal(ui.get("update-settings").hidden, false);
		assert.equal(ui.get("update-status").textContent, i18n.format(language, "updateUpToDate", { installed: "1.3.0" }));
		assert.ok(
			ui.get("update-last-check").textContent.startsWith(i18n.format(language, "updateLastCheck", { time: "" })),
		);
		assert.equal(ui.get("update-auto-check").checked, true);
		ui.get("update-auto-check").checked = false;
		ui.get("update-auto-check").fire("change");
		assert.equal(ui.sent.at(-1)?.type, "update.autoCheck");
		assert.deepEqual(ui.sent.at(-1)?.payload, { autoCheck: false });
		ui.reply({ ...base, update: { ...current, autoCheck: false } });
		assert.equal(ui.get("update-auto-check").checked, false);
		ui.get("update-check").fire("click");
		ui.get("update-check").fire("click");
		assert.equal(ui.sent.filter((message) => message.type === "update.check").length, 1);
		assert.equal(ui.get("update-check").disabled, true);
		ui.reply({ ...base, update: { ...current, autoCheck: false, state: "checking" } }, { complete: false });
		assert.equal(ui.get("update-status").textContent, i18n.translate(language, "updateChecking"));
		assert.equal(ui.get("update-check").disabled, true);
		ui.reply({
			...base,
			update: { state: "failed", installed: "v1.3.0", autoCheck: false, errorCategory: "rate_limited" },
		});
		assert.equal(ui.get("update-status").textContent, i18n.translate(language, "update_rate_limited"));
		assert.equal(ui.get("update-check").disabled, false);
		assert.equal(ui.get("update-banner").hidden, true);
		ui.reply({
			...base,
			update: {
				...current,
				latest: "v1.4.0",
				installable: false,
				errorCategory: "no_asset",
				releaseUrl: "https://github.com/obalunenko/mergbw-controller/releases/tag/v1.4.0",
			},
		});
		assert.ok(ui.get("update-status").textContent.endsWith(i18n.translate(language, "update_no_asset")));
		assert.equal(ui.get("update-setup-release").hidden, false);
		ui.get("update-setup-release").fire("click");
		assert.deepEqual(ui.opened.at(-1), {
			url: "https://github.com/obalunenko/mergbw-controller/releases/tag/v1.4.0",
		});
		assert.equal(ui.get("update-setup-install").hidden, true, "no installer, no Install");
		assert.equal(ui.get("update-banner").hidden, true);
	}
});

test("a dismissed offer stays installable from the updates row", () => {
	const ui = inspector();
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "dismissed" } });
	assert.equal(ui.get("update-banner").hidden, true);
	assert.equal(ui.get("update-status").textContent, i18n.format("en", "updateDismissed", { latest: "1.3.0" }));
	assert.equal(ui.get("update-setup-release").hidden, false);
	assert.equal(ui.get("update-setup-install").hidden, false);
	ui.get("update-setup-install").fire("click");
	ui.get("update-setup-install").fire("click");
	assert.equal(ui.sent.filter((message) => message.type === "update.install").length, 1);
	assert.deepEqual(ui.sent.at(-1)?.payload, { tag: "v1.3.0" });
	assert.equal(ui.get("update-setup-install").disabled, true);
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "downloading" } });
	assert.equal(ui.get("update-setup-install").hidden, true);
	ui.reply({ ...snapshot("off", {}), update: { ...offer, state: "dismissed", installable: false } });
	assert.equal(ui.get("update-setup-install").hidden, true);
});

test("a quarantined controller launch shows the exact xattr help", () => {
	const plugin = "~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.obalunenko.mergbw.sdPlugin";
	for (const language of ["en", "ru"] as const) {
		const ui = inspector();
		ui.reply({ ...snapshot("off", {}), language, controller: { state: "failed", errorCategory: "launch_blocked" } });
		const help = i18n.format(language, "launch_blocked", { plugin });
		assert.equal(ui.get("launch-blocked").hidden, false);
		assert.equal(ui.get("launch-blocked").textContent, help);
		assert.ok(help.includes(`xattr -dr com.apple.quarantine "${plugin}"`));
		assert.equal(ui.get("controller-state").textContent, help);
		ui.reply({ ...snapshot("off", {}), language });
		assert.equal(ui.get("launch-blocked").hidden, true);
	}
});
