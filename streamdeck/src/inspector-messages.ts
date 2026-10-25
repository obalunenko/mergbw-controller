import { BridgeClient, type PresetEntry, type TransitionSnapshot } from "./bridge-client.js";
import { type Diagnostics, type ErrorCategory, requestId } from "./diagnostics.js";
import type { ManagedController, Proposal } from "./managed-controller.js";
import { type OperationStore, operationSummary, type OperationSummary } from "./operation-store.js";
import {
	effectSnapshot,
	type EffectSnapshot,
	generationId,
	presetDefinition,
	type PresetDefinition,
	presetId,
	type PresetPage,
	type PresetRead,
} from "./preset-effects.js";
import type { Settings } from "./settings.js";
import { assignment, type Assignment, identity, type Language, object, selectedPath } from "./validation.js";

export const messageTypes = [
	"inspector.get",
	"configuration.prepareManual",
	"configuration.prepareImport",
	"configuration.presetList",
	"configuration.presetRead",
	"configuration.preparePreset",
	"configuration.apply",
	"configuration.cancel",
	"configuration.check",
	"controller.restart",
	"connection.check",
	"presets.refresh",
	"transition.status",
	"transition.cancel",
	"effect.status",
	"effect.cancel",
	"assignment.save",
	"language.save",
	"inspector.close",
] as const;
export type MessageType = (typeof messageTypes)[number];
export type InspectorMessage = {
	v: 2;
	sessionId: string;
	requestId: string;
	type: MessageType;
	payload: Record<string, unknown>;
};
const keys: Record<MessageType, string[]> = {
	"inspector.get": [],
	"configuration.prepareManual": ["identity", "expectedGeneration"],
	"configuration.prepareImport": ["settingsPath", "presetsPath", "expectedGeneration"],
	"configuration.presetList": ["expectedGeneration", "cursor"],
	"configuration.presetRead": ["expectedGeneration", "id"],
	"configuration.preparePreset": ["expectedGeneration", "operation", "id", "preset"],
	"configuration.apply": ["transactionId", "expectedGeneration", "confirmed"],
	"configuration.cancel": ["transactionId"],
	"configuration.check": [],
	"controller.restart": ["expectedGeneration"],
	"connection.check": [],
	"presets.refresh": [],
	"transition.status": [],
	"transition.cancel": ["id"],
	"effect.status": [],
	"effect.cancel": ["id"],
	"assignment.save": ["settings"],
	"language.save": ["language"],
	"inspector.close": [],
};
export function parseMessage(context: string, raw: unknown): InspectorMessage {
	if (
		!context ||
		context.length > 256 ||
		!object(raw) ||
		raw.v !== 2 ||
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
	if (type === "configuration.prepareManual") identity(raw.payload.identity);
	if (type === "configuration.prepareImport") {
		selectedPath(raw.payload.settingsPath);
		if (raw.payload.presetsPath !== undefined) selectedPath(raw.payload.presetsPath);
	}
	if (
		type === "configuration.prepareManual" ||
		type === "configuration.prepareImport" ||
		type === "configuration.apply" ||
		type === "controller.restart"
	) {
		if (
			raw.payload.expectedGeneration !== null &&
			(typeof raw.payload.expectedGeneration !== "string" || !/^[0-9a-f]{32}$/.test(raw.payload.expectedGeneration))
		)
			throw new Error("validation");
	}
	if (type === "configuration.apply" || type === "configuration.cancel") {
		if (typeof raw.payload.transactionId !== "string" || !/^[0-9a-f]{32}$/.test(raw.payload.transactionId))
			throw new Error("validation");
	}
	if (type === "transition.cancel" && (typeof raw.payload.id !== "string" || !/^[0-9a-f]{32}$/.test(raw.payload.id)))
		throw new Error("validation");
	if (type === "configuration.apply" && typeof raw.payload.confirmed !== "boolean") throw new Error("validation");
	if (["configuration.presetList", "configuration.presetRead", "configuration.preparePreset"].includes(type)) {
		if (!generationId(raw.payload.expectedGeneration)) throw new Error("validation");
		if (type === "configuration.presetList" && raw.payload.cursor !== undefined && !presetId(raw.payload.cursor))
			throw new Error("validation");
		if (type !== "configuration.presetList" && !presetId(raw.payload.id)) throw new Error("validation");
		if (type === "configuration.preparePreset") {
			if (!["create", "update", "delete"].includes(String(raw.payload.operation))) throw new Error("validation");
			if (raw.payload.operation === "delete") {
				if ("preset" in raw.payload) throw new Error("validation");
			} else presetDefinition(raw.payload.preset);
		}
	}
	if (type === "effect.cancel" && !generationId(raw.payload.id)) throw new Error("validation");
	return { v: 2, sessionId: raw.sessionId, requestId: raw.requestId, type, payload: raw.payload };
}
export type ConnectionSummary = { configured: boolean; port: number; hasToken: boolean };
export type InspectorSnapshot = {
	presetPage?: PresetPage;
	presetDefinition?: PresetRead;
	presetEditorError?: string;
	effect?: EffectSnapshot | null;
	effectError?: ErrorCategory;
	effectPending?: boolean;
	transition?: TransitionSnapshot | null;
	transitionError?: ErrorCategory;
	transitionPending?: boolean;
	connection: ConnectionSummary;
	activeStateKnown?: boolean;
	configuration?: import("./managed-controller.js").ActiveConfiguration;
	controller?: {
		state: string;
		errorCategory?: string;
		bluetooth: "connected" | "disconnected" | "unknown";
		physical_state_verified: false;
	};
	proposal?: Omit<Proposal, "candidateGeneration" | "ownerSession"> & { requiresConfirmation: boolean };
	saveOutcome?: {
		transactionId?: string;
		status: import("./managed-controller.js").SaveOutcome;
		activeStateKnown: boolean;
		canCheck: boolean;
	};
	language: Language;
	migration?: "invalid" | "legacy" | "ready";
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
		operation.connectionRevision === settings.connectionRevision &&
		(operation.status === "pending" || operation.settingsRevision === settings.revision(context))
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
	return entries.map(({ id, label, builtIn }) => ({
		id,
		label: counts.get(label)! > 1 ? `${label} (${id})` : label,
		...(builtIn === undefined ? {} : { builtIn }),
	}));
}
export type InspectorReply = {
	v: 2;
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
	private readonly editors = new Map<
		string,
		{ generation: string; page?: PresetPage; definition?: PresetRead; error?: string }
	>();
	private readonly effects = new Map<
		string,
		{ value?: EffectSnapshot | null; error?: ErrorCategory; capability?: import("./managed-controller.js").Capability }
	>();
	private readonly effectRequests = new Set<string>();
	private effectGeneration = 0;
	private readonly transitions = new Map<
		string,
		{
			value?: TransitionSnapshot | null;
			error?: ErrorCategory;
			capability?: import("./managed-controller.js").Capability;
		}
	>();
	private readonly transitionRequests = new Set<string>();
	private transitionGeneration = 0;
	private transitionOperation?: string;
	private readonly proposals = new Map<string, Proposal>();
	private readonly completedRequests = new Map<string, Map<string, { ok: boolean; messageKey?: string }>>();
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
	private managementSession?: string;
	private readonly catalogListeners = new Set<() => void>();
	constructor(
		private readonly settings: Settings,
		private readonly operations: OperationStore,
		private readonly client: BridgeClient,
		private readonly send: (reply: InspectorReply, context: string) => Promise<void> | void,
		private readonly diagnostics?: Diagnostics,
		private readonly runtime?: ManagedController,
	) {
		this.revision = settings.connectionRevision;
		this.catalog = { connectionRevision: this.revision, status: "idle", entries: [], requestGeneration: 0 };
		const runtimeUnsubscribe = runtime?.subscribe(() => {
			const session = runtime.managementSession();
			if (session !== this.managementSession) {
				this.managementSession = session;
				this.proposals.clear();
				this.editors.clear();
				this.effects.clear();
				this.effectGeneration++;
				this.transitions.clear();
				this.transitionGeneration++;
				this.completedRequests.clear();
			}
			this.publish();
		});
		this.unsubscribers = [
			...(runtimeUnsubscribe ? [runtimeUnsubscribe] : []),
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
					this.transitions.clear();
					this.effects.clear();
					this.effectGeneration++;
					this.transitionGeneration++;
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
				if (record.status === "pending") {
					this.explanations.delete(record.context);
					if (
						record.settingsRevision === settings.revision(record.context) &&
						record.connectionRevision === settings.connectionRevision &&
						(this.runtime
							? !!record.snapshot.capability && this.runtime.current(record.snapshot.capability)
							: !record.snapshot.capability)
					) {
						this.transitions.clear();
						this.effects.clear();
						this.effectGeneration++;
						this.transitionOperation = record.operationId;
						this.transitionGeneration++;
					}
				} else if (
					record.status === "accepted" &&
					record.transition &&
					record.operationId === this.transitionOperation &&
					record.settingsRevision === settings.revision(record.context) &&
					record.connectionRevision === settings.connectionRevision &&
					(!record.snapshot.capability || this.runtime?.current(record.snapshot.capability))
				) {
					this.transitionGeneration++;
					for (const [context, checked] of this.transitions)
						if (checked.value?.id !== record.transition.id) this.transitions.delete(context);
				} else if (
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
		const proposal = this.proposals.get(context);
		if (proposal) void this.runtime?.cancel(proposal.transactionId, proposal.ownerSession).catch(() => {});
		this.proposals.delete(context);
		this.transitions.delete(context);
		this.effects.delete(context);
		this.editors.delete(context);
		this.completedRequests.delete(context);
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
	public lifecycleState(): string | undefined {
		return this.runtime?.error ?? this.runtime?.state;
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
		const record = this.operations.get(context);
		const accepted =
			record?.status === "accepted" &&
			record.actionKind === "transition" &&
			record.operationId === this.transitionOperation &&
			record.settingsRevision === this.settings.revision(context) &&
			record.connectionRevision === this.settings.connectionRevision
				? record.transition
				: undefined;
		// The validated 202 response already identifies this admitted job. An
		// explicit status read can replace it with newer progress or final state.
		const transition =
			this.transitions.get(context) ??
			(accepted ? { value: accepted, capability: record?.snapshot.capability } : undefined);
		const snapshot: InspectorSnapshot = {
			...safeSnapshot(context, this.settings, this.operations),
			migration:
				this.runtime?.active.configured && this.settings.migrationStatus() === "legacy"
					? "ready"
					: this.settings.migrationStatus(),
			check: { ...this.check },
			catalog: structuredClone(this.catalog),
		};
		const editor = this.editors.get(context);
		if (editor && editor.generation === this.runtime?.active.generation) {
			if (editor.page) snapshot.presetPage = structuredClone(editor.page);
			if (editor.definition) snapshot.presetDefinition = structuredClone(editor.definition);
			snapshot.presetEditorError = editor.error;
			if (snapshot.presetPage)
				snapshot.presetPage.entries = snapshot.presetPage.entries.map((entry) => ({
					...entry,
					label: this.safeEditorText(entry.label),
				}));
			if (snapshot.presetDefinition)
				snapshot.presetDefinition.preset.label = this.safeEditorText(snapshot.presetDefinition.preset.label);
		}
		const effect =
			this.effects.get(context) ??
			(record?.effect &&
			record.status === "accepted" &&
			record.operationId === this.transitionOperation &&
			record.settingsRevision === this.settings.revision(context) &&
			record.connectionRevision === this.settings.connectionRevision
				? { value: record.effect, capability: record.snapshot.capability }
				: undefined);
		if (effect && (!effect.capability || this.runtime?.current(effect.capability))) {
			snapshot.effect = effect.value;
			snapshot.effectError = effect.error;
		}
		snapshot.effectPending = this.effectRequests.has(context);
		if (transition && (!transition.capability || this.runtime?.current(transition.capability))) {
			snapshot.transition = transition.value;
			snapshot.transitionError = transition.error;
		}
		snapshot.transitionPending = this.transitionRequests.has(context);
		if (this.runtime) {
			snapshot.activeStateKnown = this.runtime.activeStateKnown;
			const { configured, generation, identity, port, hasToken, presetCount } = this.runtime.active;
			snapshot.configuration = { configured, generation, identity, port, hasToken, presetCount };
			snapshot.connection = { configured, port: port ?? 18765, hasToken: hasToken ?? false };
			snapshot.controller = {
				state: this.runtime.state,
				errorCategory: this.runtime.error,
				bluetooth: this.runtime.bluetooth,
				physical_state_verified: false,
			};
			const proposal = this.proposals.get(context);
			if (proposal) {
				const { transactionId, expectedGeneration, identity, port, hasToken, presetCount, changed, diff, expiresAt } =
					proposal;
				snapshot.proposal = {
					transactionId,
					expectedGeneration,
					identity,
					port,
					hasToken,
					presetCount,
					changed,
					diff: { ...diff },
					expiresAt,
					requiresConfirmation: configured && changed,
				};
			}
			if (this.runtime.saveOutcome)
				snapshot.saveOutcome = {
					status: this.runtime.saveOutcome,
					transactionId: this.runtime.saveTransaction,
					activeStateKnown: this.runtime.activeStateKnown,
					canCheck: true,
				};
		}
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
	private safeEditorText(value: string): string {
		return this.diagnostics?.text(value) ?? value.replace(/https?:\/\/[^\s]+/gi, "[redacted]");
	}
	public publishEffect(
		context: string,
		value: EffectSnapshot | null,
		error?: ErrorCategory,
		capability?: import("./managed-controller.js").Capability,
	): void {
		if (
			(capability && !this.runtime?.current(capability)) ||
			(value && (!effectSnapshot(value) || !this.isSafePresetId(value.presetId)))
		)
			return;
		this.effects.set(context, { value: value ? structuredClone(value) : null, error, capability });
		this.publish();
	}
	public async receive(context: string, raw: unknown): Promise<void> {
		let message: InspectorMessage;
		try {
			message = parseMessage(context, raw);
		} catch (error) {
			if (
				object(raw) &&
				raw.v === 2 &&
				typeof raw.sessionId === "string" &&
				/^[A-Za-z0-9_-]{1,80}$/.test(raw.sessionId) &&
				typeof raw.requestId === "string" &&
				/^[A-Za-z0-9_-]{1,80}$/.test(raw.requestId)
			)
				await this.send(
					{
						v: 2,
						sessionId: raw.sessionId,
						requestId: raw.requestId,
						type: "result",
						complete: true,
						ok: false,
						messageKey:
							error instanceof Error && ["invalid_identity", "import_file"].includes(error.message)
								? error.message
								: "validation",
						snapshot: this.snapshot(context),
					},
					context,
				);
			if (
				object(raw) &&
				raw.v === 1 &&
				typeof raw.sessionId === "string" &&
				/^[A-Za-z0-9_-]{1,80}$/.test(raw.sessionId) &&
				typeof raw.requestId === "string" &&
				/^[A-Za-z0-9_-]{1,80}$/.test(raw.requestId)
			)
				await this.send(
					{
						v: 2,
						sessionId: raw.sessionId,
						requestId: raw.requestId,
						type: "result",
						complete: true,
						ok: false,
						messageKey: "migration_required",
					},
					context,
				);
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
		const oldReply = this.completedRequests.get(context)?.get(message.requestId);
		if (oldReply) {
			await this.reply(context, message, oldReply.ok, oldReply.messageKey);
			return;
		}
		const sessionToken = this.sessionTokens.get(context);
		const runtimeSession = this.runtime?.managementSession();
		try {
			switch (message.type) {
				case "configuration.presetList":
				case "configuration.presetRead": {
					if (!this.runtime) throw new Error("unconfigured");
					const expected = message.payload.expectedGeneration as string;
					const result =
						message.type === "configuration.presetList"
							? await this.runtime.presetList(expected, message.sessionId, message.payload.cursor as string | undefined)
							: await this.runtime.presetRead(expected, message.sessionId, message.payload.id as string);
					if (
						runtimeSession !== this.runtime.managementSession() ||
						this.sessionTokens.get(context) !== sessionToken ||
						this.sessions.get(context)?.requestId !== message.requestId ||
						this.runtime.active.generation !== expected
					)
						return;
					const editor =
						this.editors.get(context)?.generation === expected ? this.editors.get(context)! : { generation: expected };
					if (message.type === "configuration.presetList") editor.page = result as PresetPage;
					else editor.definition = result as PresetRead;
					delete editor.error;
					this.editors.set(context, editor);
					break;
				}
				case "configuration.preparePreset":
				case "configuration.prepareManual":
				case "configuration.prepareImport": {
					if (!this.runtime) throw new Error("unconfigured");
					const old = this.proposals.get(context);
					if (old) await this.runtime.cancel(old.transactionId, old.ownerSession);
					this.proposals.delete(context);
					let proposal: Proposal;
					if (message.type === "configuration.preparePreset") {
						proposal = await this.runtime.preparePreset(
							message.payload.operation as "create" | "delete" | "update",
							message.payload.id as string,
							message.payload.preset as PresetDefinition | undefined,
							message.payload.expectedGeneration as string,
							message.sessionId,
						);
					} else if (message.type === "configuration.prepareImport") {
						proposal = await this.runtime.prepareImport(
							selectedPath(message.payload.settingsPath),
							message.payload.presetsPath === undefined ? undefined : selectedPath(message.payload.presetsPath),
							message.payload.expectedGeneration as string | null,
							message.sessionId,
						);
					} else {
						proposal = await this.runtime.prepare(
							identity(message.payload.identity),
							message.payload.expectedGeneration as string | null,
							message.sessionId,
						);
					}
					if (runtimeSession !== this.runtime.managementSession()) return;
					if (this.sessionTokens.get(context) !== sessionToken) {
						await this.runtime.cancel(proposal.transactionId, proposal.ownerSession);
						return;
					}
					this.proposals.set(context, proposal);
					break;
				}
				case "configuration.apply": {
					const proposal = this.proposals.get(context);
					if (
						!this.runtime ||
						!proposal ||
						proposal.transactionId !== message.payload.transactionId ||
						proposal.expiresAt <= Date.now()
					)
						throw new Error("proposal_expired");
					if (proposal.expectedGeneration !== message.payload.expectedGeneration)
						throw new Error("stale_configuration");
					if (this.runtime.active.configured && proposal.changed && !message.payload.confirmed)
						throw new Error("confirmation_required");
					this.proposals.delete(context);
					await this.runtime.apply(proposal, message.payload.confirmed as boolean);
					break;
				}
				case "configuration.cancel": {
					const proposal = this.proposals.get(context);
					if (!proposal || proposal.transactionId !== message.payload.transactionId)
						throw new Error("proposal_expired");
					this.proposals.delete(context);
					await this.runtime?.cancel(proposal.transactionId, proposal.ownerSession);
					break;
				}
				case "controller.restart":
					if (!this.runtime) throw new Error("unconfigured");
					for (const key of this.proposals.keys()) this.proposals.delete(key);
					await this.runtime.restart(message.payload.expectedGeneration as string | null);
					break;
				case "configuration.check":
					if (!this.runtime) throw new Error("unconfigured");
					await this.runtime.reload();
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
				case "transition.status":
				case "transition.cancel":
					await this.refreshTransition(context, message);
					break;
				case "effect.status":
				case "effect.cancel":
					await this.refreshEffect(context, message);
					break;
				case "connection.check":
					await this.refresh(true, context, message);
					break;
				case "presets.refresh":
					await this.refresh(false, context, message);
					break;
			}
			if (this.sessionTokens.get(context) === sessionToken) await this.reply(context, message, true);
		} catch (error) {
			if (message.type.startsWith("configuration.preset") || message.type === "configuration.preparePreset") {
				const expected = message.payload.expectedGeneration as string;
				if (this.runtime?.active.generation === expected && this.sessionTokens.get(context) === sessionToken) {
					const editor = this.editors.get(context) ?? { generation: expected };
					editor.error =
						error instanceof Error &&
						[
							"stale_configuration",
							"preset_exists",
							"preset_not_found",
							"preset_too_large",
							"storage_unavailable",
						].includes(error.message)
							? error.message
							: "invalid_configuration";
					this.editors.set(context, editor);
				}
			}
			if (this.sessionTokens.get(context) === sessionToken)
				await this.reply(
					context,
					message,
					false,
					error instanceof Error &&
						[
							"storage",
							"storage_unavailable",
							"instance_busy",
							"binary_missing",
							"binary_incompatible",
							"spawn_failed",
							"protocol_incompatible",
							"port_conflict",
							"startup_timeout",
							"permission_denied",
							"bluetooth_unavailable",
							"backend_restart_required",
							"worker_exited",
							"cleanup_blocked",
							"host_unavailable",
							"stale_configuration",
							"proposal_expired",
							"confirmation_required",
							"unconfigured",
							"invalid_identity",
							"import_missing",
							"import_unreadable",
							"import_size",
							"import_file",
							"invalid_configuration",
							"preset_exists",
							"preset_not_found",
							"preset_too_large",
							"port_conflict",
							"host_unavailable",
							"cleanup_blocked",
							"instance_busy",
						].includes(error.message)
						? error.message
						: "validation",
				);
		}
	}
	private async refreshEffect(context: string, message: InspectorMessage): Promise<void> {
		if (this.effectRequests.has(context)) throw new Error("validation");
		const capability = this.runtime?.capability();
		const connection = this.runtime ? capability?.connection : this.settings.getConnection();
		if (!connection) throw new Error("unconfigured");
		const id = message.payload.id;
		if (message.type === "effect.cancel" && this.snapshot(context).effect?.id !== id) throw new Error("validation");
		const revision = this.settings.connectionRevision,
			generation = this.effectGeneration,
			token = this.sessionTokens.get(context);
		this.effectRequests.add(context);
		this.publish();
		const release = this.diagnostics?.retain(connection.accessToken);
		try {
			const result =
				message.type === "effect.cancel"
					? await this.client.cancelEffect(connection, id as string, capability?.signal, capability ?? undefined)
					: await this.client.effect(connection, capability?.signal, capability ?? undefined);
			if (
				(capability && !this.runtime?.current(capability)) ||
				revision !== this.settings.connectionRevision ||
				generation !== this.effectGeneration ||
				token !== this.sessionTokens.get(context) ||
				this.sessions.get(context)?.requestId !== message.requestId
			)
				return;
			this.publishEffect(
				context,
				result.value?.effect ?? null,
				result.value ? undefined : (result.errorCategory ?? "protocol"),
				capability ?? undefined,
			);
		} finally {
			release?.();
			this.effectRequests.delete(context);
			this.publish();
		}
	}
	private async refreshTransition(context: string, message: InspectorMessage): Promise<void> {
		if (this.transitionRequests.has(context)) throw new Error("validation");
		const capability = this.runtime?.capability();
		const connection = this.runtime ? capability?.connection : this.settings.getConnection();
		if (!connection) throw new Error("unconfigured");
		const known = this.snapshot(context).transition;
		const id = message.payload.id;
		if (message.type === "transition.cancel" && (!known || known.id !== id)) throw new Error("validation");
		const revision = this.settings.connectionRevision;
		const generation = this.transitionGeneration;
		const token = this.sessionTokens.get(context);
		this.transitionRequests.add(context);
		this.publish();
		const release = this.diagnostics?.retain(connection.accessToken);
		try {
			const result =
				message.type === "transition.cancel"
					? await this.client.cancelTransition(connection, id as string, capability?.signal, capability ?? undefined)
					: await this.client.transition(connection, capability?.signal, capability ?? undefined);
			if (
				(capability && !this.runtime?.current(capability)) ||
				this.settings.connectionRevision !== revision ||
				this.transitionGeneration !== generation ||
				this.sessionTokens.get(context) !== token ||
				this.sessions.get(context)?.requestId !== message.requestId
			)
				return;
			this.transitions.set(context, {
				value: result.value?.transition,
				error: result.value ? undefined : (result.errorCategory ?? "protocol"),
				capability: capability ?? undefined,
			});
		} finally {
			release?.();
			this.transitionRequests.delete(context);
			this.publish();
		}
	}
	private async refresh(includeHealth: boolean, context: string, message: InspectorMessage): Promise<void> {
		const capability = this.runtime?.provisional();
		const connection = this.runtime ? capability?.connection : this.settings.getConnection();
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
				includeHealth ? this.client.health(connection, capability?.signal) : Promise.resolve(undefined),
				this.client.catalog(connection, capability?.signal),
			]);
			if (
				(capability && !this.runtime?.current(capability)) ||
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
						...(entry.builtIn === undefined ? {} : { builtIn: entry.builtIn }),
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
		if (complete) {
			const cache = this.completedRequests.get(context) ?? new Map<string, { ok: boolean; messageKey?: string }>();
			if (cache.size >= 32) cache.delete(cache.keys().next().value!);
			cache.set(message.requestId, { ok, messageKey });
			this.completedRequests.set(context, cache);
		}
		await this.send(
			{
				v: 2,
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
