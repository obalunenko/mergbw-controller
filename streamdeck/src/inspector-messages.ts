import { BridgeClient, type PresetEntry } from "./bridge-client.js";
import { type Diagnostics, type ErrorCategory, requestId } from "./diagnostics.js";
import { type OperationStore, operationSummary, type OperationSummary } from "./operation-store.js";
import type { Settings } from "./settings.js";
import { assignment, type Assignment, type Language, object, parseConnectionLink } from "./validation.js";

export const messageTypes = [
	"inspector.get",
	"connection.import",
	"connection.save",
	"connection.check",
	"presets.refresh",
	"assignment.save",
	"language.save",
	"inspector.close",
] as const;
export type MessageType = (typeof messageTypes)[number];
export type InspectorMessage = {
	v: 1;
	sessionId: string;
	requestId: string;
	type: MessageType;
	payload: Record<string, unknown>;
};
const keys: Record<MessageType, string[]> = {
	"inspector.get": [],
	"connection.import": ["url"],
	"connection.save": ["port", "replacementToken"],
	"connection.check": [],
	"presets.refresh": [],
	"assignment.save": ["settings"],
	"language.save": ["language"],
	"inspector.close": [],
};
export function parseMessage(context: string, raw: unknown): InspectorMessage {
	if (
		!context ||
		context.length > 256 ||
		!object(raw) ||
		raw.v !== 1 ||
		typeof raw.type !== "string" ||
		!messageTypes.includes(raw.type as MessageType)
	)
		throw new Error("validation");
	if (
		typeof raw.sessionId !== "string" ||
		!/^[A-Za-z0-9_-]{1,80}$/.test(raw.sessionId) ||
		typeof raw.requestId !== "string" ||
		!/^[A-Za-z0-9_-]{1,80}$/.test(raw.requestId)
	)
		throw new Error("validation");
	if (
		!object(raw.payload) ||
		Object.keys(raw).some((k) => !["v", "sessionId", "requestId", "type", "payload"].includes(k))
	)
		throw new Error("validation");
	const type = raw.type as MessageType;
	if (Object.keys(raw.payload).some((k) => !keys[type].includes(k))) throw new Error("validation");
	return { v: 1, sessionId: raw.sessionId, requestId: raw.requestId, type, payload: raw.payload };
}
export type ConnectionSummary = { configured: boolean; port: number; hasToken: boolean };
export type InspectorSnapshot = {
	connection: ConnectionSummary;
	language: Language;
	check?: ConnectionCheck;
	catalog?: CatalogSnapshot;
	assignment?: Assignment;
	settingsValid: boolean;
	explanation?: ErrorCategory;
	actionKind?: import("./validation.js").ActionKind;
	operation?: OperationSummary;
};
export function safeSnapshot(context: string, settings: Settings, operations: OperationStore): InspectorSnapshot {
	let connection: ConnectionSummary = { configured: false, port: 18765, hasToken: false };
	try {
		const active = settings.getConnection();
		if (active) connection = { configured: true, port: active.port, hasToken: true };
	} catch {
		/* Invalid saved data is presented as unconfigured. */
	}
	const snapshot: InspectorSnapshot = {
		connection,
		language: settings.getLanguage(),
		settingsValid: false,
		actionKind: settings.kind(context),
	};
	try {
		snapshot.assignment = settings.getAction(context);
		snapshot.settingsValid = true;
	} catch {
		/* Preserve corrupt settings until an explicit save. */
	}
	const operation = operations.get(context);
	if (
		operation &&
		(operation.status === "pending" ||
			(operation.settingsRevision === settings.revision(context) &&
				operation.connectionRevision === settings.connectionRevision))
	)
		snapshot.operation = operationSummary(operation);
	return snapshot;
}

export type ConnectionCheck = {
	service: "available" | "incompatible" | "unavailable" | "unknown";
	authorization: "denied" | "unknown" | "verified";
	bluetooth: "connected" | "disconnected" | "unknown";
	catalog: "available" | "error" | "unknown" | "unsupported";
	checkedAt?: number;
	messageKey?: string;
	requestId?: string;
};
export type CatalogSnapshot = {
	connectionRevision: number;
	status: "available" | "idle" | "loading" | "unauthorized" | "unavailable";
	entries: PresetEntry[];
	refreshedAt?: number;
	requestGeneration: number;
};
export function presetOptions(entries: PresetEntry[]): PresetEntry[] {
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
	return entries.map(({ id, label }) => ({ id, label: counts.get(label)! > 1 ? `${label} (${id})` : label }));
}
export type InspectorReply = {
	v: 1;
	sessionId: string;
	requestId: string;
	type: "result";
	complete: boolean;
	ok: boolean;
	messageKey?: string;
	snapshot?: InspectorSnapshot;
};
const emptyCheck = (): ConnectionCheck => ({
	service: "unknown",
	authorization: "unknown",
	bluetooth: "unknown",
	catalog: "unknown",
});

export class InspectorController {
	private readonly sessions = new Map<string, InspectorMessage>();
	private readonly sessionTokens = new Map<string, object>();
	private refreshContext?: string;
	private generation = 0;
	private revision: number;
	public check: ConnectionCheck = emptyCheck();
	public catalog: CatalogSnapshot;
	private readonly unsubscribers: (() => void)[];
	private readonly explanations = new Map<
		string,
		{ category?: ErrorCategory; operation?: OperationSummary; assignment: number; connection: number }
	>();
	private readonly catalogListeners = new Set<() => void>();
	constructor(
		private readonly settings: Settings,
		private readonly operations: OperationStore,
		private readonly client: BridgeClient,
		private readonly send: (reply: InspectorReply, context: string) => Promise<void> | void,
		private readonly diagnostics?: Diagnostics,
	) {
		this.revision = settings.connectionRevision;
		this.catalog = { connectionRevision: this.revision, status: "idle", entries: [], requestGeneration: 0 };
		this.unsubscribers = [
			settings.subscribe(() => {
				for (const [context, explanation] of this.explanations) {
					if (
						explanation.assignment !== settings.revision(context) ||
						explanation.connection !== settings.connectionRevision
					)
						this.explanations.delete(context);
				}
				if (settings.connectionRevision !== this.revision) {
					this.revision = settings.connectionRevision;
					this.generation++;
					this.check = emptyCheck();
					this.catalog = {
						connectionRevision: this.revision,
						status: "idle",
						entries: [],
						requestGeneration: this.generation,
					};
				}
				this.publish();
			}),
			operations.subscribe((record) => {
				if (record.status === "pending") this.explanations.delete(record.context);
				else if (
					(record.status === "rejected" || record.status === "unknown") &&
					record.settingsRevision === settings.revision(record.context) &&
					record.connectionRevision === settings.connectionRevision
				)
					this.explanations.set(record.context, {
						operation: operationSummary(record),
						assignment: record.settingsRevision,
						connection: record.connectionRevision,
					});
				this.publish();
			}),
		];
	}
	public dispose(): void {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		for (const context of this.sessions.keys()) this.close(context);
		this.catalogListeners.clear();
	}
	public close(context: string): void {
		this.sessions.delete(context);
		this.sessionTokens.delete(context);
		if (this.refreshContext === context && this.catalog.status === "loading") {
			this.generation++;
			this.catalog = {
				connectionRevision: this.revision,
				status: "idle",
				entries: [],
				requestGeneration: this.generation,
			};
			this.publish();
		}
	}
	public subscribeCatalog(listener: () => void): () => void {
		this.catalogListeners.add(listener);
		return () => this.catalogListeners.delete(listener);
	}
	public presetAvailable(id: string): boolean {
		return (
			this.isSafePresetId(id) &&
			(this.catalog.status !== "available" || this.catalog.entries.some((entry) => entry.id === id))
		);
	}
	public isSafePresetId(id: string): boolean {
		return this.settings.isSafePresetId(id) && !this.diagnostics?.hasSecret(id);
	}
	public explain(context: string, category?: ErrorCategory): void {
		if (category)
			this.explanations.set(context, {
				category,
				assignment: this.settings.revision(context),
				connection: this.settings.connectionRevision,
			});
		else this.explanations.delete(context);
		this.publish();
	}
	public snapshot(context: string): InspectorSnapshot {
		const explanation = this.explanations.get(context);
		const snapshot: InspectorSnapshot = {
			...safeSnapshot(context, this.settings, this.operations),
			check: { ...this.check },
			catalog: structuredClone(this.catalog),
		};
		if (explanation?.category) {
			snapshot.explanation = explanation.category;
			delete snapshot.operation;
		} else if (explanation?.operation) snapshot.operation = { ...explanation.operation };
		let secret: string | undefined;
		try {
			secret = this.settings.getConnection()?.accessToken;
		} catch {
			/* Invalid settings remain inspectable. */
		}
		const safeId = (id: unknown): string | undefined =>
			this.diagnostics ? this.diagnostics.id(id) : requestId(id, secret ? [secret] : []);
		if (snapshot.operation) snapshot.operation.requestId = safeId(snapshot.operation.requestId);
		if (snapshot.check) snapshot.check.requestId = safeId(snapshot.check.requestId);
		if (snapshot.assignment?.presetId && !this.isSafePresetId(snapshot.assignment.presetId)) {
			delete snapshot.assignment;
			snapshot.settingsValid = false;
		}
		if (snapshot.catalog?.entries.some((entry) => !this.isSafePresetId(entry.id)))
			snapshot.catalog = { ...snapshot.catalog, status: "unavailable", entries: [] };
		if (snapshot.catalog)
			snapshot.catalog.entries = snapshot.catalog.entries.map((entry) => ({
				...entry,
				label: this.diagnostics?.text(entry.label) ?? entry.label,
			}));
		return snapshot;
	}
	public async receive(context: string, raw: unknown): Promise<void> {
		let message: InspectorMessage;
		try {
			message = parseMessage(context, raw);
		} catch {
			return;
		}
		if (message.type === "inspector.get") {
			if (this.sessions.get(context)?.sessionId !== message.sessionId) {
				this.close(context);
				this.sessionTokens.set(context, {});
			}
			this.sessions.set(context, message);
		} else if (this.sessions.get(context)?.sessionId !== message.sessionId) return;
		else this.sessions.set(context, message);
		if (message.type === "inspector.close") {
			this.close(context);
			return;
		}
		const sessionToken = this.sessionTokens.get(context);
		try {
			switch (message.type) {
				case "connection.import":
					await this.settings.importConnection(parseConnectionLink(message.payload.url));
					break;
				case "connection.save":
					await this.settings.saveConnection(message.payload.port, message.payload.replacementToken);
					break;
				case "language.save":
					await this.settings.saveLanguage(message.payload.language);
					break;
				case "inspector.get":
					if (this.settings.kind(context) === "preset" && this.settings.getConnection())
						await this.refresh(false, context, message);
					break;
				case "assignment.save": {
					const kind = this.settings.kind(context);
					if (!kind) throw new Error("validation");
					const next = assignment(kind, message.payload.settings);
					if (kind === "preset" && next.presetId) {
						let previous: string | undefined;
						try {
							previous = this.settings.getAction(context).presetId;
						} catch {
							/* Explicit save can recover corrupt assignments. */
						}
						if (
							!this.presetAvailable(next.presetId) ||
							(this.catalog.status !== "available" && previous !== next.presetId)
						)
							throw new Error("validation");
					}
					await this.settings.saveAction(context, next);
					break;
				}
				case "connection.check":
					await this.refresh(true, context, message);
					break;
				case "presets.refresh":
					await this.refresh(false, context, message);
					break;
			}
			if (this.sessionTokens.get(context) === sessionToken) await this.reply(context, message, true);
		} catch (error) {
			if (this.sessionTokens.get(context) === sessionToken)
				await this.reply(
					context,
					message,
					false,
					error instanceof Error && error.message === "storage" ? "storage" : "validation",
				);
		}
	}
	private async refresh(includeHealth: boolean, context: string, message: InspectorMessage): Promise<void> {
		const connection = this.settings.getConnection();
		if (!connection) throw new Error("validation");
		const revision = this.settings.connectionRevision;
		const generation = ++this.generation;
		const token = this.sessionTokens.get(context)!;
		this.refreshContext = context;
		this.catalog = { connectionRevision: revision, status: "loading", entries: [], requestGeneration: generation };
		this.publish();
		const release = this.diagnostics?.retain(connection.accessToken);
		try {
			const [health, catalog] = await Promise.all([
				includeHealth ? this.client.health(connection) : Promise.resolve(undefined),
				this.client.catalog(connection),
			]);
			if (
				this.settings.connectionRevision !== revision ||
				this.generation !== generation ||
				this.sessionTokens.get(context) !== token ||
				this.sessions.get(context)?.sessionId !== message.sessionId
			)
				return;
			if (catalog.value?.presets.some((entry) => !this.isSafePresetId(entry.id))) {
				catalog.value = undefined;
				catalog.errorCategory = "protocol";
			}
			const check = includeHealth ? emptyCheck() : { ...this.check };
			if (health) {
				if (health.value) {
					check.service = "available";
					check.bluetooth = health.value.bluetooth_connected ? "connected" : "disconnected";
				} else
					check.service =
						health.errorCategory === "service" || health.errorCategory === "timeout" ? "unavailable" : "incompatible";
			}
			if (catalog.value) {
				delete check.messageKey;
				check.authorization = "verified";
				check.catalog = "available";
				this.catalog = {
					connectionRevision: revision,
					status: "available",
					entries: catalog.value.presets.map((entry) => ({
						id: entry.id,
						label: (this.diagnostics?.text(entry.label) ?? entry.label)
							.split("")
							.filter((char) => char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
							.join("")
							.split(connection.accessToken)
							.join("[redacted]")
							.replace(/https?:\/\/[^\s]+/gi, "[redacted]")
							.slice(0, 512),
					})),
					refreshedAt: this.operations.clock.now(),
					requestGeneration: generation,
				};
			} else {
				check.authorization = catalog.statusCode === 403 ? "denied" : "unknown";
				check.catalog =
					catalog.statusCode === 400 || catalog.statusCode === 404 || catalog.statusCode === 405
						? "unsupported"
						: "error";
				check.messageKey =
					check.catalog === "unsupported"
						? "unsupported"
						: catalog.statusCode === 403
							? "auth"
							: catalog.errorCategory === "timeout"
								? "readTimeout"
								: (catalog.errorCategory ?? "protocol");
				this.catalog = {
					connectionRevision: revision,
					status: catalog.statusCode === 403 ? "unauthorized" : "unavailable",
					entries: [],
					requestGeneration: generation,
				};
			}
			check.checkedAt = this.operations.clock.now();
			check.requestId = requestId(catalog.requestId ?? health?.requestId, [connection.accessToken]);
			if (this.diagnostics) check.requestId = this.diagnostics.id(check.requestId);
			this.check = check;
			for (const listener of this.catalogListeners) listener();
			this.publish();
			if (includeHealth) this.diagnostics?.emit("connection.checked", { requestId: check.requestId });
			this.diagnostics?.emit(catalog.value ? "presets.loaded" : "presets.failed", {
				requestId: check.requestId,
				errorCategory: catalog.value ? undefined : catalog.errorCategory,
			});
		} finally {
			release?.();
		}
	}
	private async reply(
		context: string,
		message: InspectorMessage,
		ok: boolean,
		messageKey?: string,
		complete = true,
	): Promise<void> {
		await this.send(
			{
				v: 1,
				sessionId: message.sessionId,
				requestId: message.requestId,
				type: "result",
				complete,
				ok,
				...(messageKey ? { messageKey } : {}),
				snapshot: this.snapshot(context),
			},
			context,
		);
	}
	private publish(): void {
		for (const [context, message] of this.sessions)
			void this.reply(context, message, true, undefined, false).catch(() => {});
	}
}
