import { translate } from "../i18n.js";
import { type ActionKind, colorInput, type Language, parseConnectionLink } from "../validation.js";

type Message = { v: 1; sessionId: string; requestId: string; type: string; payload: Record<string, unknown> };
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
async function dispatch(): Promise<void> {
	const request = requests[0];
	if (!request) return;
	latestRequestId = request.message.requestId;
	latestRequestType = request.message.type;
	await client.send("sendToPlugin", request.message);
}
async function send(type: string, payload: Record<string, unknown> = {}, drafts: Drafts = {}): Promise<void> {
	const requestId = crypto.randomUUID();
	requests.push({ message: { v: 1, sessionId, requestId, type, payload }, drafts });
	if (requests.length === 1) await dispatch();
}
client.sendToPropertyInspector.subscribe((event) => {
	const reply = event.payload;
	if (
		!isObject(reply) ||
		reply.v !== 1 ||
		reply.type !== "result" ||
		reply.sessionId !== sessionId ||
		typeof reply.requestId !== "string" ||
		reply.requestId !== latestRequestId ||
		typeof reply.complete !== "boolean" ||
		typeof reply.ok !== "boolean"
	)
		return;
	const completing = reply.complete && requests[0]?.message.requestId === reply.requestId;
	if (completing && (latestRequestType?.endsWith(".save") || latestRequestType === "connection.import")) {
		const save = latestRequestType === "connection.import" ? "connection.save" : latestRequestType!;
		if (reply.ok === false)
			saveErrors.set(save, typeof reply.messageKey === "string" ? reply.messageKey : "validation");
		else saveErrors.delete(save);
	}
	const snapshot = reply.snapshot;
	if (!isObject(snapshot)) return;
	if (snapshot.language === "en" || snapshot.language === "ru") language = snapshot.language;
	localize();
	if (["on", "off", "color", "brightness", "preset"].includes(String(snapshot.actionKind)))
		actionKind = snapshot.actionKind as ActionKind;
	const configurable = actionKind === "color" || actionKind === "brightness" || actionKind === "preset";
	element("assignment-controls").hidden = !configurable;
	for (const kind of ["color", "brightness", "preset"]) element(`${kind}-controls`).hidden = actionKind !== kind;
	if (actionKind) text("action-name", actionKind);
	const assignment = isObject(snapshot.assignment) ? snapshot.assignment : {};
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
	if (isObject(snapshot.connection)) {
		input("port").value = reconcile("port", String(snapshot.connection.port));
		text("connection-summary", snapshot.connection.hasToken === true ? "hasToken" : "noToken");
	}
	const check = isObject(snapshot.check) ? snapshot.check : {};
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
			snapshot.settingsValid === true && isObject(snapshot.connection) && snapshot.connection.configured === true
				? "ready"
				: "unconfigured",
		);
	if (completing) {
		requests.shift();
		void dispatch();
	}
});
element("import").addEventListener("click", () => {
	const url = input("import-url").value;
	input("import-url").value = "";
	const drafts: Drafts = {};
	try {
		drafts.port = { value: String(parseConnectionLink(url).port), draft: input("port").value };
	} catch {
		/* The plugin returns the validation error without changing the draft. */
	}
	void send("connection.import", { url }, drafts);
});
element("save").addEventListener("click", () => {
	const replacementToken = input("replacement-token").value;
	input("replacement-token").value = "";
	void send(
		"connection.save",
		{ port: Number(input("port").value), replacementToken },
		{
			port: { value: String(Number(input("port").value)), draft: input("port").value },
		},
	);
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
	void client.send("sendToPlugin", {
		v: 1,
		sessionId,
		requestId: crypto.randomUUID(),
		type: "inspector.close",
		payload: {},
	});
});
localize();
void send("inspector.get");
