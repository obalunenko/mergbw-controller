import { format, translate } from "../i18n.js";
import {
	defaultPreset,
	effectSnapshot,
	presetDefinition,
	type PresetDefinition,
	type PresetKind,
	presetKinds,
} from "../preset-effects.js";
import { RAW_SCENE_IDS, sceneHex, SCENES } from "../scenes.js";
import {
	type ActionKind,
	colorInput,
	identity,
	type Language,
	selectedPath,
	assignment as validateAssignment,
} from "../validation.js";

type Message = { v: 2; sessionId: string; requestId: string; type: string; payload: Record<string, unknown> };
type Drafts = Record<string, { value: string; draft: string }>;
type SDPIClient = {
	send: (event: string, payload: Message | { url: string }) => Promise<void>;
	sendToPropertyInspector: { subscribe: (listener: (event: { payload: unknown }) => void) => void };
};
declare global {
	interface Window {
		SDPIComponents: { streamDeckClient: SDPIClient };
	}
}
const sessionId = crypto.randomUUID();
let latestRequestId: string | undefined;
let latestRequestType: string | undefined;
let language: Language = "en";
let actionKind: ActionKind | undefined;
let catalogAvailable = false;
let presetEntries: Record<string, unknown>[] = [];
let presetCatalogStatus = "idle";
let copyDefinition = false;
let readingSummary = false;
let summaryKey = "";
let summary: PresetDefinition | undefined;
let assignAfterCreate: { id: string; generation: string | null; previousId: string } | undefined;
let reviewedPreset: { id: string; operation: "create" | "delete" | "update"; preset?: PresetDefinition } | undefined;
type View = "diagnostics" | "editor" | "library" | "main" | "review" | "setup";
let view: View | undefined;
let configured = false;
let assignmentStatusKey = "autoSave";
let transitionId: string | undefined;
let effectId: string | undefined;
let editorGeneration: string | null = null;
let editorOperation: "create" | "update" = "create";
let editorOpen = false;
let awaitingDefinition: string | undefined;
let editorNext: string | null = null;
let editorPageKey = "";
let editorCatalogGeneration: string | null = null;
let editorReview: string | undefined;
let paletteColors: string[] = [];
let generation: string | null = null;
let writesAllowed = true;
let applyTimeout: ReturnType<typeof setTimeout> | undefined;
let proposal: { transactionId: string; expectedGeneration: string | null; requiresConfirmation: boolean } | undefined;
let updateTag: string | undefined;
let laterTag: string | undefined;
let releaseUrl = "";
const PLUGIN_DIR = "~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.obalunenko.mergbw.sdPlugin";
const RELEASE_PAGE = "https://github.com/obalunenko/mergbw-controller/";
const UPDATE_STATUS: Record<string, string> = {
	checking: "updateChecking",
	up_to_date: "updateUpToDate",
	available: "updateAvailable",
	dismissed: "updateDismissed",
	downloading: "updateDownloading",
	handed: "updateHanded",
};
const persisted = new Map<string, string>();
const requests: { message: Message; drafts: Drafts }[] = [];
const saveErrors = new Map<string, string>();
const client = window.SDPIComponents.streamDeckClient;
const element = (id: string): HTMLElement => document.getElementById(id)!;
const input = (id: string): HTMLInputElement => element(id) as HTMLInputElement;
const select = (id: string): HTMLSelectElement => element(id) as HTMLSelectElement;
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
// Status publications reuse saved values. Only a changed setting replaces its draft.
function reconcile(id: string, value: string): string {
	let draft = input(id).value;
	const pending = requests.map((request) => request.drafts[id]).filter((save) => save !== undefined);
	const save = pending.find((save) => save.value === value);
	if (save) {
		if (draft === save.draft) draft = value;
	} else if (pending.length === 0 && persisted.get(id) !== value) draft = value;
	persisted.set(id, value);
	return draft;
}
function text(id: string, key: string): void {
	element(id).textContent = translate(language, key);
}
function showView(next: View): void {
	view = next;
	for (const name of ["main", "library", "editor", "setup", "review", "diagnostics"])
		element(`view-${name}`).hidden = name !== next;
	element("back").hidden = next === "main";
	text("back", next === "review" ? "backToParameters" : next === "editor" ? "cancel" : "backToKey");
}
// Release data is untrusted: every value is rendered with textContent only.
function renderUpdate(raw: unknown, completing: boolean): void {
	const update = isObject(raw) && typeof raw.installed === "string" && typeof raw.state === "string" ? raw : undefined;
	element("update-settings").hidden = !update;
	const state = update ? String(update.state) : "";
	const latest = typeof update?.latest === "string" ? update.latest : undefined;
	const values = {
		latest: (latest ?? "").replace(/^v/, ""),
		installed: String(update?.installed ?? "").replace(/^v/, ""),
	};
	const installable = update?.installable === true;
	const category = typeof update?.errorCategory === "string" ? `update_${update.errorCategory}` : undefined;
	const url =
		typeof update?.releaseUrl === "string" && update.releaseUrl.startsWith(RELEASE_PAGE) ? update.releaseUrl : "";
	const notes = typeof update?.notes === "string" ? update.notes.slice(0, 2000) : "";
	const banner =
		!!latest &&
		(["available", "downloading", "handed"].includes(state) || (state === "failed" && installable && !!category));
	updateTag = installable && ["available", "dismissed", "handed"].includes(state) ? latest : undefined;
	laterTag = banner && state !== "downloading" ? latest : undefined;
	element("update-banner").hidden = !banner;
	const bannerKey = state === "failed" ? "updateAvailable" : (UPDATE_STATUS[state] ?? "updateAvailable");
	element("update-banner-text").textContent = banner ? format(language, bannerKey, values) : "";
	element("update-banner-error").textContent =
		banner && state === "failed" && category ? translate(language, category) : "";
	element("update-notes").textContent = banner ? notes : "";
	element("update-notes-details").hidden = !banner || !notes;
	releaseUrl = url;
	element("update-release-url").hidden = !banner || !url;
	element("update-install").hidden = !banner || !updateTag;
	element("update-later").hidden = !laterTag;
	const installing = requests.some(
		(request, index) => !(completing && index === 0) && request.message.type === "update.install",
	);
	element("update-install").toggleAttribute("disabled", installing);
	element("update-setup-install").hidden = state !== "dismissed" || !updateTag;
	element("update-setup-install").toggleAttribute("disabled", installing);
	if (!update) return;
	input("update-auto-check").checked = update.autoCheck !== false;
	const key = state === "failed" ? (category ?? "updateIdle") : (UPDATE_STATUS[state] ?? "updateIdle");
	element("update-status").textContent = [
		format(language, key, values),
		...(category && state !== "failed" ? [translate(language, category)] : []),
	].join(" ");
	const checked = typeof update.lastCheckedAt === "string" ? new Date(update.lastCheckedAt) : undefined;
	element("update-last-check").textContent =
		checked && !Number.isNaN(checked.getTime())
			? format(language, "updateLastCheck", { time: checked.toLocaleString(language) })
			: "";
	element("update-setup-release").hidden = !url || banner;
	const checking = requests.some(
		(request, index) => !(completing && index === 0) && request.message.type === "update.check",
	);
	element("update-check").toggleAttribute("disabled", checking || state === "checking" || state === "downloading");
}
function editorLabels(): void {
	text("editor-title", editorOperation === "create" ? "createPreset" : "editorEdit");
	text("editor-scope", editorOperation === "create" ? "newPresetScope" : "sharedPresetScope");
	text("editor-review", editorOperation === "create" ? "createAndAssign" : "applyPresetChanges");
	text("editor-brightness-label", select("editor-kind").value === "breathing" ? "peakBrightness" : "brightness");
}
function localize(): void {
	document.documentElement.lang = language;
	for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]")))
		node.textContent = translate(language, node.dataset.i18n!);
	input("language").value = language;
	const kind = select("editor-kind").value || "static";
	select("editor-kind").replaceChildren(
		...presetKinds.map((kind) => option(kind, translate(language, `kind.${kind}`))),
	);
	select("editor-kind").value = kind;
	editorLabels();
	text("assignment-status", assignmentStatusKey);
	if (view) showView(view);
}
function option(value: string, label: string): HTMLOptionElement {
	const result = document.createElement("option");
	result.value = value;
	result.textContent = label;
	return result;
}
function renderSceneChoices(selected: string): void {
	const catalog = document.createElement("optgroup");
	catalog.label = translate(language, "scene");
	catalog.replaceChildren(...SCENES.map((scene) => option(scene.slug, scene.label)));
	const raw = document.createElement("optgroup");
	raw.label = translate(language, "sceneRawIds");
	raw.replaceChildren(...RAW_SCENE_IDS.map((id) => option(sceneHex(id), `ID ${sceneHex(id)}`)));
	select("scene-select").replaceChildren(catalog, raw);
	select("scene-select").value = selected;
}
function renderPresetChoices(selected: string): void {
	const counts = new Map<string, number>();
	for (const entry of presetEntries) counts.set(String(entry.label), (counts.get(String(entry.label)) ?? 0) + 1);
	const groups = [true, false]
		.map((builtIn) => {
			const group = document.createElement("optgroup");
			group.label = translate(language, builtIn ? "preloadedPresets" : "customPresets");
			group.replaceChildren(
				...presetEntries
					.filter((entry) => (entry.builtIn === true) === builtIn)
					.map((entry) =>
						option(
							String(entry.id),
							counts.get(String(entry.label))! > 1
								? `${String(entry.label)} (${String(entry.id)})`
								: String(entry.label),
						),
					),
			);
			return group;
		})
		.filter((group) => group.children.length > 0);
	const missing = !presetEntries.some((entry) => entry.id === selected);
	const placeholder = option(
		selected,
		selected
			? `${translate(language, catalogAvailable ? "presetMissing" : "catalogUnchecked")} (${selected})`
			: translate(language, "preset"),
	);
	placeholder.disabled = true;
	select("preset-select").replaceChildren(...(missing ? [placeholder] : []), ...groups);
	select("preset-select").value = selected;
	select("preset-select").disabled = !catalogAvailable || presetEntries.length === 0;
	const entry = presetEntries.find((entry) => entry.id === selected);
	element("preset-copy").hidden = !entry || entry.builtIn !== true;
	element("preset-edit").hidden = !entry || entry.builtIn === true;
	for (const id of ["preset-copy", "preset-edit"])
		element(id).toggleAttribute("disabled", !catalogAvailable || !entry || !generation || !writesAllowed);
	text(
		"catalog-status",
		presetCatalogStatus === "loading"
			? "pending"
			: !catalogAvailable
				? "catalogUnchecked"
				: missing && selected
					? "presetMissing"
					: presetEntries.length === 0
						? "noPresets"
						: "",
	);
	if (catalogAvailable && entry) element("catalog-status").textContent = "";
	element("preset-summary").hidden = !entry || !catalogAvailable;
	element("preset-label").textContent = entry ? String(entry.label) : "";
	text("preset-origin", entry?.builtIn === true ? "preloadedPresets" : "customPresets");
	const key = `${generation}:${selected}`;
	if (summaryKey !== key) {
		summary = undefined;
		element("preset-swatch").hidden = true;
		element("preset-description").textContent = "";
	}
	if (
		view === "main" &&
		entry &&
		catalogAvailable &&
		generation &&
		summaryKey !== key &&
		!editorOpen &&
		!awaitingDefinition
	) {
		summaryKey = key;
		readingSummary = true;
		awaitingDefinition = selected;
		void send("configuration.presetRead", { expectedGeneration: generation, id: selected });
	}
	if (summary && summaryKey === key) renderSummary(summary);
}
function renderSummary(preset: PresetDefinition): void {
	element("preset-swatch").hidden = false;
	element("preset-swatch").style.backgroundColor = `#${rgbHex(preset.rgb)}`;
	element("preset-description").textContent =
		`${translate(language, `kind.${preset.effect?.kind ?? "static"}`)} · ${preset.brightness}%`;
}
function rgbHex(rgb: number[]): string {
	return rgb
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}
function rgbValue(value: string): number[] {
	return colorInput(value)
		.match(/../g)!
		.map((channel) => parseInt(channel, 16));
}
function renderPalette(position = Number(select("palette-select").value) || 0): void {
	position = Math.max(0, Math.min(position, paletteColors.length - 1));
	select("palette-select").replaceChildren(
		...paletteColors.map((color, index) => option(String(index), `${index + 1}. #${color}`)),
	);
	select("palette-select").value = String(position);
	input("palette-color").value = `#${paletteColors[position] ?? "FF5000"}`;
	element("palette-add").toggleAttribute("disabled", paletteColors.length >= 16);
	element("palette-remove").toggleAttribute("disabled", paletteColors.length <= 2);
	element("palette-up").toggleAttribute("disabled", position === 0);
	element("palette-down").toggleAttribute("disabled", position >= paletteColors.length - 1);
}
function editorFields(): void {
	const kind = select("editor-kind").value;
	for (const type of ["palette", "strobe", "breathing", "candle", "lightning"])
		element(`editor-${type}-controls`).hidden = kind !== type;
	element("editor-rgb-controls").hidden = kind === "palette";
	element("editor-loop-controls").hidden = kind === "static";
	element("editor-duration-controls").hidden =
		(kind !== "candle" && kind !== "lightning") || input("editor-loop").checked;
	element("editor-once-help").hidden = input("editor-loop").checked;
	editorLabels();
}
function loadDraft(preset: PresetDefinition, id: string, operation: "create" | "update"): void {
	editorOpen = true;
	editorOperation = operation;
	editorGeneration = generation;
	input("editor-id").value = id;
	input("editor-name").value = preset.label;
	input("editor-rgb").value = rgbHex(preset.rgb);
	input("editor-color").value = `#${rgbHex(preset.rgb)}`;
	input("editor-brightness").value = String(preset.brightness);
	input("editor-brightness-slider").value = String(preset.brightness);
	select("editor-kind").value = preset.effect?.kind ?? "static";
	input("editor-loop").checked = preset.effect?.loop ?? true;
	const e = preset.effect;
	paletteColors = [preset.rgb, ...(e?.kind === "palette" ? e.colors : [[0, 80, 255]])].map(rgbHex);
	input("editor-transition").value = String(e?.kind === "palette" ? e.transitionMs / 1000 : 2);
	input("editor-on").value = String(e?.kind === "strobe" ? e.onMs / 1000 : 0.5);
	input("editor-off").value = String(e?.kind === "strobe" ? e.offMs / 1000 : 0.5);
	input("editor-min").value = String(e?.kind === "breathing" ? e.minBrightness : 5);
	input("editor-cycle").value = String(e?.kind === "breathing" ? e.cycleMs / 1000 : 4);
	input("editor-depth").value = String(e?.kind === "candle" ? e.depth : 35);
	input("editor-flicker").value = String(e?.kind === "candle" ? e.flickerMs / 1000 : 0.5);
	input("editor-duration").value = String(
		e?.kind === "candle" || e?.kind === "lightning" ? (e.durationMs ?? 30000) / 1000 : 30,
	);
	const background = rgbHex(e?.kind === "lightning" ? e.backgroundRgb : [26, 42, 108]);
	input("editor-background-rgb").value = background;
	input("editor-background-color").value = `#${background}`;
	input("editor-background-brightness").value = String(e?.kind === "lightning" ? e.backgroundBrightness : 15);
	input("editor-min-pause").value = String(e?.kind === "lightning" ? e.minPauseMs / 1000 : 2);
	input("editor-max-pause").value = String(e?.kind === "lightning" ? e.maxPauseMs / 1000 : 15);
	input("editor-max-flashes").value = String(e?.kind === "lightning" ? e.maxFlashes : 3);
	element("preset-editor").hidden = false;
	element("editor-review").toggleAttribute(
		"disabled",
		!writesAllowed || !generation || generation !== editorGeneration,
	);
	element("editor-error").textContent = "";
	renderPalette(0);
	editorFields();
	showView("editor");
}
function milliseconds(id: string): number {
	const value = input(id).valueAsNumber * 1000;
	const rounded = Math.round(value);
	if (!Number.isSafeInteger(rounded) || Math.abs(value - rounded) > 0.0000001) throw new Error("invalidPresetTiming");
	return rounded;
}
function readDraft(): PresetDefinition {
	const kind = select("editor-kind").value as PresetKind;
	const preset: PresetDefinition = {
		label: input("editor-name").value,
		rgb: kind === "palette" ? rgbValue(paletteColors[0] ?? "") : rgbValue(input("editor-rgb").value),
		brightness: input("editor-brightness").valueAsNumber,
	};
	const loop = input("editor-loop").checked;
	switch (kind) {
		case "palette":
			preset.effect = {
				kind,
				loop,
				colors: paletteColors.slice(1).map(rgbValue),
				transitionMs: milliseconds("editor-transition"),
			};
			break;
		case "strobe":
			preset.effect = { kind, loop, onMs: milliseconds("editor-on"), offMs: milliseconds("editor-off") };
			break;
		case "breathing":
			preset.effect = {
				kind,
				loop,
				minBrightness: input("editor-min").valueAsNumber,
				cycleMs: milliseconds("editor-cycle"),
			};
			break;
		case "candle":
			preset.effect = {
				kind,
				loop,
				depth: input("editor-depth").valueAsNumber,
				flickerMs: milliseconds("editor-flicker"),
				...(loop ? {} : { durationMs: milliseconds("editor-duration") }),
			};
			break;
		case "lightning":
			preset.effect = {
				kind,
				loop,
				backgroundRgb: rgbValue(input("editor-background-rgb").value),
				backgroundBrightness: input("editor-background-brightness").valueAsNumber,
				minPauseMs: milliseconds("editor-min-pause"),
				maxPauseMs: milliseconds("editor-max-pause"),
				maxFlashes: input("editor-max-flashes").valueAsNumber,
				...(loop ? {} : { durationMs: milliseconds("editor-duration") }),
			};
			break;
	}
	return presetDefinition(preset);
}
function lostApply(requestId: string): void {
	if (requests[0]?.message.requestId !== requestId) return;
	if (applyTimeout !== undefined) clearTimeout(applyTimeout);
	applyTimeout = undefined;
	requests.shift();
	// A missing confirmation is checked read-only. Never resend the write or
	// dispatch an already queued replacement while authoritative state is unknown.
	for (let index = requests.length - 1; index >= 0; index--)
		if (
			[
				"configuration.apply",
				"configuration.prepareManual",
				"configuration.prepareImport",
				"configuration.preparePreset",
			].includes(requests[index]!.message.type)
		)
			requests.splice(index, 1);
	writesAllowed = false;
	assignAfterCreate = undefined;
	reviewedPreset = undefined;
	proposal = undefined;
	element("proposal").hidden = true;
	for (const id of ["prepare", "apply", "confirm"]) element(id).toggleAttribute("disabled", true);
	for (const id of ["editor-new", "editor-edit", "editor-delete", "editor-review"])
		element(id).toggleAttribute("disabled", true);
	text("save-outcome", "commit_unknown");
	element("configuration-check").hidden = false;
	element("back").removeAttribute("disabled");
	element("cancel").removeAttribute("disabled");
	showView(editorOpen ? "editor" : "setup");
	void dispatch();
}
async function dispatch(): Promise<void> {
	const request = requests[0];
	if (!request) return;
	latestRequestId = request.message.requestId;
	latestRequestType = request.message.type;
	if (request.message.type === "configuration.apply")
		applyTimeout = setTimeout(() => lostApply(request.message.requestId), 45000);
	try {
		await client.send("sendToPlugin", request.message);
	} catch (error) {
		if (request.message.type === "configuration.apply") lostApply(request.message.requestId);
		else throw error;
	}
}
async function send(type: string, payload: Record<string, unknown> = {}, drafts: Drafts = {}): Promise<void> {
	if (type === "controller.restart" && requests.some((request) => request.message.type === type)) return;
	if (type.startsWith("configuration.prepare") || type === "configuration.apply") {
		if (
			requests.some(
				(request) =>
					request.message.type.startsWith("configuration.prepare") || request.message.type === "configuration.apply",
			)
		)
			return;
		for (const id of ["back", "editor-discard", "editor-review", "prepare"])
			element(id).toggleAttribute("disabled", true);
	}
	const requestId = crypto.randomUUID();
	requests.push({ message: { v: 2, sessionId, requestId, type, payload }, drafts });
	if (requests.length === 1) await dispatch();
}
client.sendToPropertyInspector.subscribe((event) => {
	const reply = event.payload;
	if (
		!isObject(reply) ||
		reply.v !== 2 ||
		reply.type !== "result" ||
		reply.sessionId !== sessionId ||
		typeof reply.requestId !== "string" ||
		reply.requestId !== latestRequestId ||
		typeof reply.complete !== "boolean" ||
		typeof reply.ok !== "boolean"
	)
		return;
	const completing = reply.complete && requests[0]?.message.requestId === reply.requestId;
	if (completing && latestRequestType?.endsWith(".save")) {
		const save = latestRequestType!;
		if (reply.ok === false)
			saveErrors.set(save, typeof reply.messageKey === "string" ? reply.messageKey : "validation");
		else saveErrors.delete(save);
	}
	const snapshot = reply.snapshot;
	if (!isObject(snapshot)) return;
	if (isObject(snapshot.configuration)) {
		generation = typeof snapshot.configuration.generation === "string" ? snapshot.configuration.generation : null;
		configured = snapshot.configuration.configured === true;
	}
	if (!view) showView(configured ? "main" : "setup");
	if (snapshot.language === "en" || snapshot.language === "ru") language = snapshot.language;
	localize();
	if (["on", "off", "color", "brightness", "preset", "scene", "transition"].includes(String(snapshot.actionKind)))
		actionKind = snapshot.actionKind as ActionKind;
	const configurable =
		actionKind === "color" ||
		actionKind === "brightness" ||
		actionKind === "preset" ||
		actionKind === "scene" ||
		actionKind === "transition";
	element("assignment-controls").hidden = !configurable;
	element("power-action").hidden = configurable;
	if (actionKind) text("power-action", actionKind);
	for (const kind of ["color", "brightness", "preset", "scene", "transition"])
		element(`${kind}-controls`).hidden = actionKind !== kind;
	if (actionKind) text("action-name", actionKind);
	const assignment = isObject(snapshot.assignment) ? snapshot.assignment : {};
	for (const [field, value] of Object.entries({
		"transition-from-rgb": assignment.fromRGB,
		"transition-from-percent": assignment.fromPercent,
		"transition-to-rgb": assignment.toRGB,
		"transition-to-percent": assignment.toPercent,
		"transition-seconds": assignment.durationSeconds,
	})) {
		if (typeof value === "string" || typeof value === "number") input(field).value = reconcile(field, String(value));
	}
	if (typeof assignment.rgb === "string") {
		input("rgb").value = reconcile("rgb", assignment.rgb);
		try {
			input("color-picker").value = `#${colorInput(input("rgb").value)}`;
		} catch {
			/* Keep invalid draft text available for correction. */
		}
	}
	if (typeof assignment.percent === "number") {
		input("percent").value = reconcile("percent", String(assignment.percent));
		if (input("percent").validity.valid && input("percent").value !== "")
			input("percent-slider").value = input("percent").value;
	}
	if (actionKind === "scene") {
		const assigned = typeof assignment.sceneId === "string" ? assignment.sceneId : "";
		renderSceneChoices(reconcile("scene-select", assigned));
	}
	if (actionKind === "preset") {
		const assigned = typeof assignment.presetId === "string" ? assignment.presetId : "";
		const selected = reconcile("preset-select", assigned);
		const catalog = isObject(snapshot.catalog) ? snapshot.catalog : {};
		catalogAvailable = catalog.status === "available";
		presetCatalogStatus = String(catalog.status ?? "idle");
		const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
		presetEntries = entries
			.filter(isObject)
			.filter((entry) => typeof entry.id === "string" && typeof entry.label === "string");
		renderPresetChoices(selected);
	}
	text(
		"migration-guidance",
		snapshot.migration === "legacy"
			? "legacyIdentityRequired"
			: snapshot.migration === "invalid"
				? "invalidMigration"
				: "importHelp",
	);
	if (isObject(snapshot.configuration)) {
		const configuration = snapshot.configuration;
		text("connection-summary", configuration.configured === true ? "configured" : "unconfigured");
	}
	if (isObject(snapshot.presetPage) && snapshot.presetPage.generation === generation) {
		editorCatalogGeneration = generation;
		const page = snapshot.presetPage;
		const key = JSON.stringify(page);
		if (key !== editorPageKey) {
			editorPageKey = key;
			const selected = select("editor-select").value;
			const entries = Array.isArray(page.entries)
				? page.entries.filter(isObject).filter((entry) => entry.builtIn !== true)
				: [];
			select("editor-select").replaceChildren(
				...entries
					.filter((entry) => typeof entry.id === "string" && typeof entry.label === "string")
					.map((entry) =>
						option(String(entry.id), `${String(entry.label)} (${String(entry.id)})${entry.labelTruncated ? "…" : ""}`),
					),
			);
			if (entries.some((entry) => entry.id === selected)) select("editor-select").value = selected;
			editorNext = typeof page.nextCursor === "string" ? page.nextCursor : null;
			text("library-status", entries.length === 0 ? "customPresetsEmpty" : "");
		}
	}
	if (
		completing &&
		latestRequestType === "configuration.presetRead" &&
		typeof awaitingDefinition === "string" &&
		isObject(snapshot.presetDefinition) &&
		snapshot.presetDefinition.id === awaitingDefinition &&
		snapshot.presetDefinition.generation === generation
	) {
		try {
			const preset = presetDefinition(snapshot.presetDefinition.preset, false);
			if (readingSummary) {
				summary = preset;
			} else if (copyDefinition) {
				preset.label += translate(language, "presetCopySuffix");
				loadDraft(preset, `p_${crypto.randomUUID().replaceAll("-", "")}`, "create");
			} else loadDraft(preset, awaitingDefinition, "update");
			copyDefinition = false;
			awaitingDefinition = undefined;
		} catch {
			if (!readingSummary) text("editor-error", "invalid_configuration");
		}
		readingSummary = false;
		awaitingDefinition = undefined;
		if (actionKind === "preset") renderPresetChoices(select("preset-select").value);
	} else if (completing && latestRequestType === "configuration.presetRead") {
		readingSummary = false;
		awaitingDefinition = undefined;
	}
	if (typeof snapshot.presetEditorError === "string") text("editor-error", snapshot.presetEditorError);
	if (editorOpen && editorGeneration !== generation) text("editor-error", "editorDraftStale");
	proposal = undefined;
	if (
		isObject(snapshot.proposal) &&
		typeof snapshot.proposal.transactionId === "string" &&
		(snapshot.proposal.expectedGeneration === null || typeof snapshot.proposal.expectedGeneration === "string")
	) {
		const preview = snapshot.proposal;
		proposal = {
			transactionId: preview.transactionId as string,
			expectedGeneration: preview.expectedGeneration as string | null,
			requiresConfirmation: preview.requiresConfirmation === true,
		};
		const previous =
			isObject(snapshot.configuration) && snapshot.configuration.configured === true
				? snapshot.configuration
				: undefined;
		const lamp =
			previous?.identity !== undefined && previous.identity !== preview.identity
				? `${String(previous.identity)} → ${String(preview.identity)}`
				: String(preview.identity);
		const port =
			previous?.port !== undefined && previous.port !== preview.port
				? `${String(previous.port)} → ${String(preview.port)}`
				: String(preview.port);
		const count =
			previous?.presetCount !== undefined && previous.presetCount !== preview.presetCount
				? `${String(previous.presetCount)} → ${String(preview.presetCount)}`
				: String(preview.presetCount);
		element("proposal-summary").textContent = editorReview
			? editorReview
			: `${lamp} · ${translate(language, "port")}: ${port} · ${translate(language, "presetCount")}: ${count} · ${translate(language, preview.hasToken === true ? "hasToken" : "noToken")}`;
		if (proposal && completing && latestRequestType?.startsWith("configuration.prepare")) showView("review");
	}
	const diff = isObject(snapshot.proposal) && isObject(snapshot.proposal.diff) ? snapshot.proposal.diff : {};
	if (editorReview) {
		const scopes = { create: "newPresetScope", delete: "presetDeleteWarning", update: "sharedPresetScope" };
		text("proposal-diff", scopes[reviewedPreset?.operation ?? "update"]);
	} else {
		element("proposal-diff").textContent = Object.entries(diff)
			.filter(([, changed]) => changed === true)
			.map(([key]) => translate(language, "diff_" + key))
			.join(" · ");
	}
	element("proposal").hidden = !proposal;
	element("apply").hidden = !proposal || proposal.requiresConfirmation;
	element("confirm").hidden = !proposal?.requiresConfirmation;
	element("interruption-warning").hidden = !proposal?.requiresConfirmation;
	if (reviewedPreset && reviewedPreset.operation !== "delete") {
		const key = reviewedPreset.operation === "create" ? "createAndAssignConfirm" : "applyPresetConfirm";
		text("apply", key);
		text("confirm", key);
	}
	if (
		completing &&
		latestRequestType === "configuration.check" &&
		reply.ok === true &&
		snapshot.activeStateKnown === true
	) {
		writesAllowed = true;
		for (const id of ["prepare", "apply", "confirm"]) element(id).removeAttribute("disabled");
	}
	if (isObject(snapshot.saveOutcome)) {
		text("save-outcome", String(snapshot.saveOutcome.status));
		writesAllowed = snapshot.saveOutcome.activeStateKnown === true;
		element("prepare").toggleAttribute("disabled", !writesAllowed);
		for (const id of ["apply", "confirm"]) element(id).toggleAttribute("disabled", !writesAllowed);
		element("configuration-check").hidden = snapshot.saveOutcome.activeStateKnown === true;
	}
	if (isObject(snapshot.controller)) {
		element("controller-state").textContent = format(
			language,
			typeof snapshot.controller.errorCategory === "string"
				? snapshot.controller.errorCategory
				: String(snapshot.controller.state),
			{ plugin: PLUGIN_DIR },
		);
	}
	const blocked = isObject(snapshot.controller) && snapshot.controller.errorCategory === "launch_blocked";
	element("launch-blocked").hidden = !blocked;
	element("launch-blocked").textContent = blocked ? format(language, "launch_blocked", { plugin: PLUGIN_DIR }) : "";
	renderUpdate(snapshot.update, completing);
	const canEdit = writesAllowed && snapshot.activeStateKnown !== false && !!generation;
	element("preset-copy").toggleAttribute(
		"disabled",
		!canEdit ||
			!catalogAvailable ||
			readingSummary ||
			!presetEntries.some((entry) => entry.id === select("preset-select").value && entry.builtIn === true),
	);
	for (const id of ["editor-new", "editor-load", "preset-new", "library-open"])
		element(id).toggleAttribute("disabled", !canEdit);
	element("preset-edit").toggleAttribute(
		"disabled",
		!canEdit ||
			readingSummary ||
			!catalogAvailable ||
			!presetEntries.some((entry) => entry.id === select("preset-select").value && entry.builtIn !== true),
	);
	for (const id of ["editor-edit", "editor-delete"])
		element(id).toggleAttribute(
			"disabled",
			!canEdit || readingSummary || editorCatalogGeneration !== generation || !select("editor-select").value,
		);
	element("editor-next").toggleAttribute("disabled", !canEdit || editorCatalogGeneration !== generation || !editorNext);
	const configurationPending = requests.some(
		(request, index) =>
			!(completing && index === 0) &&
			(request.message.type.startsWith("configuration.prepare") || request.message.type === "configuration.apply"),
	);
	element("editor-review").toggleAttribute(
		"disabled",
		!canEdit || editorGeneration !== generation || configurationPending,
	);
	for (const id of ["back", "editor-discard", "cancel"]) element(id).toggleAttribute("disabled", configurationPending);
	element("prepare").toggleAttribute("disabled", !writesAllowed || configurationPending);
	effectId = undefined;
	if (effectSnapshot(snapshot.effect)) {
		const effect = snapshot.effect;
		element("effect-status").textContent =
			`${translate(language, `kind.${effect.kind}`)} · ${translate(language, `transition.${effect.state}`)} · ${effect.elapsedMs}${effect.durationMs === null ? "" : ` / ${effect.durationMs}`} ms · ${translate(language, "transitionUnverified")}`;
		if (effect.state === "running" || effect.state === "cancelling") effectId = effect.id;
	} else
		text(
			"effect-status",
			typeof snapshot.effectError === "string"
				? snapshot.effectError
				: snapshot.effect === null
					? "effectNone"
					: "effectUnchecked",
		);
	element("effect-refresh").toggleAttribute("disabled", snapshot.effectPending === true);
	element("effect-cancel").toggleAttribute("disabled", snapshot.effectPending === true || !effectId);
	element("active-effect").hidden = !effectId;
	element("active-effect-status").textContent = element("effect-status").textContent;
	element("active-effect-cancel").toggleAttribute("disabled", snapshot.effectPending === true || !effectId);
	if (
		completing &&
		latestRequestType === "configuration.apply" &&
		reply.ok &&
		isObject(snapshot.saveOutcome) &&
		(snapshot.saveOutcome.status === "applied" || snapshot.saveOutcome.status === "unchanged") &&
		editorReview
	) {
		if (reviewedPreset?.operation === "create")
			assignAfterCreate = { id: reviewedPreset.id, generation, previousId: persisted.get("preset-select") ?? "" };
		const deleted = reviewedPreset?.operation === "delete";
		editorOpen = false;
		element("preset-editor").hidden = true;
		editorReview = undefined;
		awaitingDefinition = undefined;
		reviewedPreset = undefined;
		showView(deleted ? "library" : "main");
		if (deleted) void send("configuration.presetList", { expectedGeneration: generation });
		else if (assignAfterCreate) text("save-outcome", "presetCreated");
		void send("presets.refresh");
	} else if (completing && latestRequestType === "configuration.apply") {
		if (
			reply.ok &&
			isObject(snapshot.saveOutcome) &&
			["applied", "unchanged"].includes(String(snapshot.saveOutcome.status))
		)
			showView("main");
		else if (editorOpen) showView("editor");
		else showView("setup");
	}
	if (completing && latestRequestType === "configuration.apply") {
		element("back").removeAttribute("disabled");
		element("cancel").removeAttribute("disabled");
	}
	if (completing && latestRequestType === "presets.refresh" && assignAfterCreate) {
		const target = assignAfterCreate;
		assignAfterCreate = undefined;
		if (
			reply.ok &&
			catalogAvailable &&
			target.generation === generation &&
			target.previousId === (persisted.get("preset-select") ?? "") &&
			presetEntries.some((entry) => entry.id === target.id)
		) {
			renderPresetChoices(target.id);
			saveAssignment();
		} else text("save-outcome", "presetCreated");
	}
	transitionId = undefined;
	if (
		isObject(snapshot.transition) &&
		typeof snapshot.transition.id === "string" &&
		/^[0-9a-f]{32}$/.test(snapshot.transition.id)
	) {
		const value = snapshot.transition;
		const state = String(value.state);
		element("transition-status").textContent =
			`${translate(language, `transition.${state}`)} · ${String(value.elapsedMs)} / ${String(value.durationMs)} ms · ${translate(language, "transitionUnverified")}`;
		if (state === "running" || state === "cancelling") transitionId = value.id as string;
	} else
		text(
			"transition-status",
			snapshot.transitionError
				? String(snapshot.transitionError)
				: snapshot.transition === null
					? "transitionNone"
					: "transitionUnchecked",
		);
	element("transition-refresh").toggleAttribute("disabled", snapshot.transitionPending === true);
	element("transition-cancel").toggleAttribute("disabled", snapshot.transitionPending === true || !transitionId);
	const restarting =
		requests.some((request) => request.message.type === "controller.restart") &&
		!(completing && latestRequestType === "controller.restart");
	element("restart").toggleAttribute("disabled", restarting);
	const check = isObject(snapshot.check) ? { ...snapshot.check } : {};
	if (
		isObject(snapshot.controller) &&
		["unknown", "connected", "disconnected"].includes(String(snapshot.controller.bluetooth))
	)
		check.bluetooth = snapshot.controller.bluetooth;
	for (const key of ["service", "authorization", "bluetooth"])
		text(`${key}-status`, typeof check[key] === "string" && check[key] !== "unknown" ? check[key] : "statusUnknown");
	if (saveErrors.size > 0)
		element("message").textContent = [...new Set(saveErrors.values())].map((key) => translate(language, key)).join(" ");
	else if (reply.ok === false) text("message", typeof reply.messageKey === "string" ? reply.messageKey : "validation");
	else if (typeof check.messageKey === "string") text("message", check.messageKey);
	else element("message").textContent = "";
	if (saveErrors.has("assignment.save")) text("assignment-error", saveErrors.get("assignment.save")!);
	if (isObject(snapshot.operation)) {
		const status = snapshot.operation.status;
		const category = snapshot.operation.errorCategory;
		element("operation").textContent =
			translate(
				language,
				status === "unknown"
					? "unknown"
					: status === "rejected"
						? "error"
						: typeof status === "string"
							? status
							: "ready",
			) +
			(typeof category === "string"
				? ` ${translate(language, category === "preset" ? "presetMissing" : category)}`
				: "");
	} else if (typeof snapshot.explanation === "string") {
		element("operation").textContent =
			`${translate(language, "error")} ${translate(language, snapshot.explanation === "preset" ? "presetMissing" : snapshot.explanation)}`;
	} else
		text(
			"operation",
			isObject(snapshot.controller) && snapshot.controller.state !== "ready"
				? String(snapshot.controller.state)
				: snapshot.settingsValid === true && isObject(snapshot.connection) && snapshot.connection.configured === true
					? "ready"
					: "unconfigured",
		);
	if (completing) {
		if (applyTimeout !== undefined) clearTimeout(applyTimeout);
		applyTimeout = undefined;
		requests.shift();
		if (latestRequestType === "assignment.save") {
			assignmentStatusKey = reply.ok ? "assigned" : "autoSave";
			text("assignment-status", assignmentStatusKey);
			if (reply.ok) element("save-outcome").textContent = "";
		}
		if (requests.some((request) => request.message.type === "assignment.save")) {
			assignmentStatusKey = "savingAssignment";
			text("assignment-status", assignmentStatusKey);
		}
		void dispatch();
	}
});
element("prepare").addEventListener("click", () => {
	if (!writesAllowed) return;
	editorReview = undefined;
	try {
		if (input("setup-method").value === "import") {
			const settingsPath = selectedPath(input("settings-file").value);
			const presetsPath = input("presets-file").value ? selectedPath(input("presets-file").value) : undefined;
			input("settings-file").value = "";
			input("presets-file").value = "";
			void send("configuration.prepareImport", {
				settingsPath,
				...(presetsPath ? { presetsPath } : {}),
				expectedGeneration: generation,
			});
			return;
		}
		const value = identity(input("identity").value);
		input("identity").value = "";
		element("identity-error").textContent = "";
		void send("configuration.prepareManual", { identity: value, expectedGeneration: generation });
	} catch {
		text("identity-error", input("setup-method").value === "import" ? "import_file" : "invalid_identity");
		input("settings-file").value = "";
		input("presets-file").value = "";
	}
});
for (const button of ["apply", "confirm"])
	element(button).addEventListener("click", () => {
		if (!proposal || !writesAllowed) return;
		void send("configuration.apply", {
			transactionId: proposal.transactionId,
			expectedGeneration: proposal.expectedGeneration,
			confirmed: button === "confirm",
		});
		proposal = undefined;
		element("proposal").hidden = true;
		element("back").toggleAttribute("disabled", true);
		element("cancel").toggleAttribute("disabled", true);
	});
element("cancel").addEventListener("click", () => {
	if (proposal) void send("configuration.cancel", { transactionId: proposal.transactionId });
	proposal = undefined;
	input("identity").value = "";
	input("settings-file").value = "";
	input("presets-file").value = "";
	element("proposal").hidden = true;
	showView(editorReview ? (editorOpen ? "editor" : "library") : "setup");
	editorReview = undefined;
	reviewedPreset = undefined;
});
element("setup-method").addEventListener("change", () => {
	const importing = input("setup-method").value === "import";
	element("manual-controls").hidden = importing;
	element("import-controls").hidden = !importing;
	input("settings-file").value = "";
	input("presets-file").value = "";
});
element("configuration-check").addEventListener("click", () => {
	void send("configuration.check");
});
element("check").addEventListener("click", () => {
	void send("connection.check");
});
element("language").addEventListener("change", () => {
	void send("language.save", { language: input("language").value });
});
element("color-picker").addEventListener("input", () => {
	input("rgb").value = input("color-picker").value.slice(1).toUpperCase();
});
element("rgb").addEventListener("change", () => {
	try {
		const rgb = colorInput(input("rgb").value);
		input("rgb").value = rgb;
		input("color-picker").value = `#${rgb}`;
		saveAssignment();
	} catch {
		text("assignment-error", "validation");
	}
});
element("percent-slider").addEventListener("input", () => {
	input("percent").value = input("percent-slider").value;
});
element("percent").addEventListener("input", () => {
	if (input("percent").validity.valid && input("percent").value !== "")
		input("percent-slider").value = input("percent").value;
});
element("preset-select").addEventListener("change", () => {
	// A newer explicit choice wins over the pending create-and-assign follow-up.
	assignAfterCreate = undefined;
	const selected = select("preset-select").value;
	renderPresetChoices(selected);
	saveAssignment();
});
element("transition-refresh").addEventListener("click", () => {
	void send("transition.status");
});
element("transition-cancel").addEventListener("click", () => {
	if (transitionId) void send("transition.cancel", { id: transitionId });
});
element("restart").addEventListener("click", () => {
	element("restart").toggleAttribute("disabled", true);
	void send("controller.restart", { expectedGeneration: generation });
});
element("refresh").addEventListener("click", () => {
	summaryKey = "";
	void send("presets.refresh");
});
element("preset-copy").addEventListener("click", () => {
	const id = select("preset-select").value;
	if (
		!writesAllowed ||
		!generation ||
		!catalogAvailable ||
		readingSummary ||
		!presetEntries.some((entry) => entry.id === id && entry.builtIn === true)
	)
		return;
	awaitingDefinition = id;
	copyDefinition = true;
	showView("editor");
	void send("configuration.presetRead", { expectedGeneration: generation, id });
});
element("editor-load").addEventListener("click", () => {
	if (generation) void send("configuration.presetList", { expectedGeneration: generation });
});
element("editor-next").addEventListener("click", () => {
	if (generation && editorNext)
		void send("configuration.presetList", { expectedGeneration: generation, cursor: editorNext });
});
element("editor-select").addEventListener("change", () => {
	for (const id of ["editor-edit", "editor-delete"])
		element(id).toggleAttribute(
			"disabled",
			!writesAllowed || readingSummary || editorCatalogGeneration !== generation || !select("editor-select").value,
		);
});
function newPreset(): void {
	if (!writesAllowed || !generation) return;
	loadDraft(defaultPreset(), `p_${crypto.randomUUID().replaceAll("-", "")}`, "create");
}
element("editor-new").addEventListener("click", newPreset);
element("preset-new").addEventListener("click", newPreset);
element("preset-edit").addEventListener("click", () => {
	const id = select("preset-select").value;
	if (
		!writesAllowed ||
		!generation ||
		readingSummary ||
		!catalogAvailable ||
		!presetEntries.some((entry) => entry.id === id && entry.builtIn !== true)
	)
		return;
	copyDefinition = false;
	awaitingDefinition = id;
	showView("editor");
	void send("configuration.presetRead", { expectedGeneration: generation, id });
});
element("editor-edit").addEventListener("click", () => {
	if (
		writesAllowed &&
		generation &&
		!readingSummary &&
		editorCatalogGeneration === generation &&
		select("editor-select").value
	) {
		awaitingDefinition = select("editor-select").value;
		copyDefinition = false;
		showView("editor");
		void send("configuration.presetRead", { expectedGeneration: generation, id: awaitingDefinition });
	}
});
element("editor-kind").addEventListener("change", () => {
	// Keep every field and the palette draft when switching effect types.
	// Hidden fields are only read when their effect is selected.
	editorFields();
});
element("editor-loop").addEventListener("change", editorFields);
element("palette-select").addEventListener("change", () => renderPalette());
element("palette-color").addEventListener("input", () => {
	paletteColors[Number(select("palette-select").value)] = colorInput(input("palette-color").value);
	renderPalette();
});
element("palette-add").addEventListener("click", () => {
	if (paletteColors.length < 16) {
		paletteColors.push("FF5000");
		renderPalette(paletteColors.length - 1);
	}
});
element("palette-remove").addEventListener("click", () => {
	if (paletteColors.length > 2) {
		const index = Number(select("palette-select").value);
		paletteColors.splice(index, 1);
		renderPalette(index);
	}
});
for (const [id, direction] of [
	["palette-up", -1],
	["palette-down", 1],
] as const)
	element(id).addEventListener("click", () => {
		const index = Number(select("palette-select").value),
			next = index + direction;
		if (next >= 0 && next < paletteColors.length) {
			[paletteColors[index], paletteColors[next]] = [paletteColors[next]!, paletteColors[index]!];
			renderPalette(next);
		}
	});
element("editor-review").addEventListener("click", () => {
	if (!writesAllowed || !generation || generation !== editorGeneration) return;
	try {
		if (!input("editor-name").value.trim() || [...input("editor-name").value].length > 128)
			throw new Error("invalidPresetName");
		if (
			select("editor-kind").value === "breathing" &&
			input("editor-min").valueAsNumber >= input("editor-brightness").valueAsNumber
		)
			throw new Error("minimumBelowPeak");
		if (select("editor-kind").value === "lightning") {
			if (input("editor-min-pause").valueAsNumber > input("editor-max-pause").valueAsNumber)
				throw new Error("pauseOrder");
			if (input("editor-background-brightness").valueAsNumber >= input("editor-brightness").valueAsNumber)
				throw new Error("backgroundBelowFlash");
		}
		const preset = readDraft(),
			id = input("editor-id").value;
		reviewedPreset = { id, operation: editorOperation, preset };
		editorReview = `${preset.label} · ${translate(language, `kind.${preset.effect?.kind ?? "static"}`)} · ${preset.brightness}%`;
		element("editor-error").textContent = "";
		void send("configuration.preparePreset", {
			expectedGeneration: editorGeneration,
			operation: editorOperation,
			id,
			preset,
		});
	} catch (error) {
		text(
			"editor-error",
			error instanceof Error &&
				["invalidPresetName", "minimumBelowPeak", "pauseOrder", "backgroundBelowFlash", "invalidPresetTiming"].includes(
					error.message,
				)
				? error.message
				: "validation",
		);
	}
});
element("editor-delete").addEventListener("click", () => {
	const id = select("editor-select").value;
	if (!writesAllowed || !generation || editorCatalogGeneration !== generation || !id) return;
	reviewedPreset = { id, operation: "delete" };
	editorReview = `${translate(language, "editorDelete")}: ${select("editor-select").selectedOptions[0]?.textContent ?? id}`;
	void send("configuration.preparePreset", { expectedGeneration: generation, operation: "delete", id });
});
element("editor-discard").addEventListener("click", () => {
	editorOpen = false;
	awaitingDefinition = undefined;
	element("preset-editor").hidden = true;
	element("editor-error").textContent = "";
	if (proposal && editorReview) void send("configuration.cancel", { transactionId: proposal.transactionId });
	editorReview = undefined;
	reviewedPreset = undefined;
	showView("main");
});
element("effect-refresh").addEventListener("click", () => {
	void send("effect.status");
});
element("effect-cancel").addEventListener("click", () => {
	if (effectId) void send("effect.cancel", { id: effectId });
});
function saveAssignment(): void {
	try {
		let settings: Record<string, unknown>;
		if (actionKind === "color") settings = { schemaVersion: 1, rgb: colorInput(input("rgb").value) };
		else if (actionKind === "brightness") {
			const percent = input("percent").valueAsNumber;
			if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("validation");
			settings = { schemaVersion: 1, percent };
		} else if (actionKind === "preset") {
			const presetId = select("preset-select").value;
			if (!catalogAvailable || !presetId || select("preset-select").selectedOptions[0]?.disabled !== false)
				throw new Error("validation");
			settings = { schemaVersion: 1, presetId };
		} else if (actionKind === "scene") {
			settings = validateAssignment("scene", { schemaVersion: 1, sceneId: select("scene-select").value });
			queueAssignment(settings, {
				"scene-select": { value: String(settings.sceneId), draft: select("scene-select").value },
			});
			return;
		} else if (actionKind === "transition") {
			settings = validateAssignment("transition", {
				schemaVersion: 1,
				fromRGB: colorInput(input("transition-from-rgb").value),
				fromPercent: input("transition-from-percent").valueAsNumber,
				toRGB: colorInput(input("transition-to-rgb").value),
				toPercent: input("transition-to-percent").valueAsNumber,
				durationSeconds: input("transition-seconds").valueAsNumber,
			});
			const fields = {
				"transition-from-rgb": settings.fromRGB,
				"transition-from-percent": settings.fromPercent,
				"transition-to-rgb": settings.toRGB,
				"transition-to-percent": settings.toPercent,
				"transition-seconds": settings.durationSeconds,
			};
			const drafts = Object.fromEntries(
				Object.entries(fields).map(([id, value]) => [id, { value: String(value), draft: input(id).value }]),
			);
			queueAssignment(settings, drafts);
			return;
		} else return;
		const field = actionKind === "color" ? "rgb" : actionKind === "brightness" ? "percent" : "preset-select";
		queueAssignment(settings, {
			[field]: { value: String(settings.rgb ?? settings.percent ?? settings.presetId), draft: input(field).value },
		});
	} catch {
		text("assignment-error", "validation");
	}
}
function queueAssignment(settings: Record<string, unknown>, drafts: Drafts): void {
	element("assignment-error").textContent = "";
	const pending = requests.filter((request) => request.message.type === "assignment.save");
	const same = (request: (typeof requests)[number]): boolean =>
		JSON.stringify(request.message.payload.settings) === JSON.stringify(settings);
	if (pending.length > 0 && same(pending[pending.length - 1]!)) return;
	if (
		pending.length === 0 &&
		!saveErrors.has("assignment.save") &&
		Object.entries(drafts).every(([id, draft]) => persisted.get(id) === draft.value)
	)
		return;
	assignmentStatusKey = "savingAssignment";
	text("assignment-status", assignmentStatusKey);
	void send("assignment.save", { settings }, drafts);
}
element("scene-select").addEventListener("change", saveAssignment);
element("color-picker").addEventListener("change", () => {
	input("rgb").value = input("color-picker").value.slice(1).toUpperCase();
	saveAssignment();
});
for (const id of [
	"percent-slider",
	"percent",
	"transition-from-percent",
	"transition-to-percent",
	"transition-seconds",
])
	element(id).addEventListener("change", saveAssignment);
for (const end of ["from", "to"]) {
	element(`transition-${end}-color`).addEventListener("input", () => {
		input(`transition-${end}-rgb`).value = input(`transition-${end}-color`).value.slice(1).toUpperCase();
	});
	element(`transition-${end}-color`).addEventListener("change", () => {
		input(`transition-${end}-rgb`).value = input(`transition-${end}-color`).value.slice(1).toUpperCase();
		saveAssignment();
	});
	element(`transition-${end}-rgb`).addEventListener("change", () => {
		try {
			input(`transition-${end}-color`).value = `#${colorInput(input(`transition-${end}-rgb`).value)}`;
			saveAssignment();
		} catch {
			text("assignment-error", "validation");
		}
	});
}
for (const [picker, hex] of [
	["editor-color", "editor-rgb"],
	["editor-background-color", "editor-background-rgb"],
] as const) {
	element(picker).addEventListener("input", () => {
		input(hex).value = input(picker).value.slice(1).toUpperCase();
	});
	element(hex).addEventListener("change", () => {
		try {
			input(picker).value = `#${colorInput(input(hex).value)}`;
			element("editor-error").textContent = "";
		} catch {
			text("editor-error", "validation");
		}
	});
}
element("editor-brightness-slider").addEventListener("input", () => {
	input("editor-brightness").value = input("editor-brightness-slider").value;
});
element("editor-brightness").addEventListener("input", () => {
	if (input("editor-brightness").validity.valid && input("editor-brightness").value !== "")
		input("editor-brightness-slider").value = input("editor-brightness").value;
});
element("setup-open").addEventListener("click", () => {
	showView("setup");
	void send("update.status");
});
function install(button: string): void {
	if (!updateTag || requests.some((request) => request.message.type === "update.install")) return;
	element(button).toggleAttribute("disabled", true);
	void send("update.install", { tag: updateTag });
}
element("update-install").addEventListener("click", () => install("update-install"));
element("update-setup-install").addEventListener("click", () => install("update-setup-install"));
// Stream Deck opens the validated release page in the default browser.
for (const id of ["update-release-url", "update-setup-release"])
	element(id).addEventListener("click", () => {
		if (releaseUrl) void client.send("openUrl", { url: releaseUrl });
	});
element("update-later").addEventListener("click", () => {
	if (laterTag) void send("update.dismiss", { tag: laterTag });
});
element("update-check").addEventListener("click", () => {
	if (requests.some((request) => request.message.type === "update.check")) return;
	element("update-check").toggleAttribute("disabled", true);
	void send("update.check");
});
element("update-auto-check").addEventListener("change", () => {
	void send("update.autoCheck", { autoCheck: input("update-auto-check").checked });
});
element("diagnostics-open").addEventListener("click", () => showView("diagnostics"));
element("library-open").addEventListener("click", () => {
	showView("library");
	if (generation) void send("configuration.presetList", { expectedGeneration: generation });
});
element("active-effect-cancel").addEventListener("click", () => {
	if (effectId) void send("effect.cancel", { id: effectId });
});
element("back").addEventListener("click", () => {
	if (view === "review") {
		element("cancel").click();
		return;
	}
	if (view === "editor") {
		element("editor-discard").click();
		return;
	}
	showView("main");
});
window.addEventListener("pagehide", () => {
	requests.length = 0;
	if (applyTimeout !== undefined) clearTimeout(applyTimeout);
	void client.send("sendToPlugin", {
		v: 2,
		sessionId,
		requestId: crypto.randomUUID(),
		type: "inspector.close",
		payload: {},
	});
});
localize();
void send("inspector.get");
