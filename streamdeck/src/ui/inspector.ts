import { translate } from "../i18n.js";
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
	send: (event: string, payload: Message) => Promise<void>;
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
let transitionId: string | undefined;
let generation: string | null = null;
let writesAllowed = true;
let applyTimeout: ReturnType<typeof setTimeout> | undefined;
let proposal: { transactionId: string; expectedGeneration: string | null; requiresConfirmation: boolean } | undefined;
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
function localize(): void {
	document.documentElement.lang = language;
	for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]")))
		node.textContent = translate(language, node.dataset.i18n!);
	input("language").value = language;
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
			["configuration.apply", "configuration.prepareManual", "configuration.prepareImport"].includes(
				requests[index]!.message.type,
			)
		)
			requests.splice(index, 1);
	writesAllowed = false;
	proposal = undefined;
	element("proposal").hidden = true;
	for (const id of ["prepare", "apply", "confirm"]) element(id).toggleAttribute("disabled", true);
	text("save-outcome", "commit_unknown");
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
	if (snapshot.language === "en" || snapshot.language === "ru") language = snapshot.language;
	localize();
	if (["on", "off", "color", "brightness", "preset", "transition"].includes(String(snapshot.actionKind)))
		actionKind = snapshot.actionKind as ActionKind;
	const configurable =
		actionKind === "color" || actionKind === "brightness" || actionKind === "preset" || actionKind === "transition";
	element("assignment-controls").hidden = !configurable;
	for (const kind of ["color", "brightness", "preset", "transition"])
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
	if (actionKind === "preset") {
		const presetId = reconcile("preset-select", typeof assignment.presetId === "string" ? assignment.presetId : "");
		const catalog = isObject(snapshot.catalog) ? snapshot.catalog : {};
		catalogAvailable = catalog.status === "available";
		const entries = Array.isArray(catalog.entries) ? catalog.entries.filter(isObject) : [];
		const labels = new Map<string, number>();
		for (const entry of entries)
			if (typeof entry.label === "string") labels.set(entry.label, (labels.get(entry.label) ?? 0) + 1);
		const options: HTMLOptionElement[] = [];
		for (const entry of entries) {
			if (typeof entry.id !== "string" || typeof entry.label !== "string") continue;
			const option = document.createElement("option");
			option.value = entry.id;
			option.textContent = labels.get(entry.label)! > 1 ? `${entry.label} (${entry.id})` : entry.label;
			options.push(option);
		}
		const missing = !options.some((option) => option.value === presetId);
		if (missing) {
			const retained = document.createElement("option");
			retained.value = presetId;
			retained.textContent = presetId
				? `${translate(language, catalogAvailable ? "presetMissing" : "catalogUnchecked")} (${presetId})`
				: translate(language, "presetMissing");
			retained.disabled = true;
			options.unshift(retained);
		}
		select("preset-select").replaceChildren(...options);
		select("preset-select").value = presetId;
		select("preset-select").disabled = !catalogAvailable;
		text(
			"catalog-status",
			catalog.status === "loading"
				? "pending"
				: !catalogAvailable
					? "catalogUnchecked"
					: missing || options.length === 0
						? "presetMissing"
						: "available",
		);
		element("assignment-save").toggleAttribute(
			"disabled",
			!catalogAvailable || !options.some((option) => option.value === presetId && !option.disabled),
		);
	} else element("assignment-save").removeAttribute("disabled");
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
		generation = typeof configuration.generation === "string" ? configuration.generation : null;
		text("connection-summary", configuration.configured === true ? "configured" : "unconfigured");
	}
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
		element("proposal-summary").textContent =
			`${lamp} · ${translate(language, "port")}: ${port} · ${translate(language, "presetCount")}: ${count} · ${translate(language, preview.hasToken === true ? "hasToken" : "noToken")}`;
	}
	const diff = isObject(snapshot.proposal) && isObject(snapshot.proposal.diff) ? snapshot.proposal.diff : {};
	element("proposal-diff").textContent = Object.entries(diff)
		.filter(([, changed]) => changed === true)
		.map(([key]) => translate(language, `diff_${key}`))
		.join(" · ");
	element("proposal").hidden = !proposal;
	element("apply").hidden = !proposal || proposal.requiresConfirmation;
	element("confirm").hidden = !proposal?.requiresConfirmation;
	element("interruption-warning").hidden = !proposal?.requiresConfirmation;
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
	}
	if (isObject(snapshot.controller)) {
		text(
			"controller-state",
			typeof snapshot.controller.errorCategory === "string"
				? snapshot.controller.errorCategory
				: String(snapshot.controller.state),
		);
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
		void dispatch();
	}
});
element("prepare").addEventListener("click", () => {
	if (!writesAllowed) return;
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
	});
element("cancel").addEventListener("click", () => {
	if (proposal) void send("configuration.cancel", { transactionId: proposal.transactionId });
	proposal = undefined;
	input("identity").value = "";
	input("settings-file").value = "";
	input("presets-file").value = "";
	element("proposal").hidden = true;
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
	} catch {
		text("message", "validation");
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
	element("assignment-save").toggleAttribute(
		"disabled",
		!catalogAvailable || select("preset-select").selectedOptions[0]?.disabled !== false,
	);
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
	void send("presets.refresh");
});
element("assignment-save").addEventListener("click", () => {
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
			void send("assignment.save", { settings }, drafts);
			return;
		} else return;
		const field = actionKind === "color" ? "rgb" : actionKind === "brightness" ? "percent" : "preset-select";
		void send(
			"assignment.save",
			{ settings },
			{
				[field]: { value: String(settings.rgb ?? settings.percent ?? settings.presetId), draft: input(field).value },
			},
		);
	} catch {
		text("message", "validation");
	}
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
