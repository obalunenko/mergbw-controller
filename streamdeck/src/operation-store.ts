import { randomUUID } from "node:crypto";

import { type ErrorCategory, type Outcome, requestId } from "./diagnostics.js";
import type { ActionKind, Connection } from "./validation.js";

export type Clock = {
	now: () => number;
	setTimeout: (callback: () => void, delay: number) => unknown;
	clearTimeout: (id: unknown) => void;
};
export const systemClock: Clock = {
	now: () => performance.now(),
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
export type OperationResult = {
	status: Exclude<Outcome, "pending">;
	errorCategory?: ErrorCategory;
	requestId?: string;
};
export type OperationRecord = {
	readonly operationId: string;
	readonly context: string;
	readonly actionKind: ActionKind;
	readonly settingsRevision: number;
	readonly connectionRevision: number;
	readonly snapshot: { readonly route: string; readonly connection: Readonly<Connection> };
	readonly startedAt: number;
	readonly deadlineAt: number;
	status: Outcome;
	errorCategory?: ErrorCategory;
	requestId?: string;
	durationMs: number;
};
export type OperationSummary = Pick<
	OperationRecord,
	"durationMs" | "errorCategory" | "operationId" | "requestId" | "status"
>;
export function operationSummary(record: OperationRecord): OperationSummary {
	return {
		operationId: record.operationId,
		status: record.status,
		errorCategory: record.errorCategory,
		requestId: record.requestId,
		durationMs: record.durationMs,
	};
}
export class OperationStore {
	private readonly records = new Map<string, OperationRecord>();
	private readonly timers = new Map<string, unknown>();
	private readonly visible = new Set<string>();
	private readonly listeners = new Set<(record: OperationRecord) => void>();
	constructor(public readonly clock: Clock = systemClock) {}
	public get(context: string): OperationRecord | undefined {
		return this.records.get(context);
	}
	public subscribe(listener: (record: OperationRecord) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public appear(context: string): void {
		this.visible.add(context);
	}
	public disappear(context: string): void {
		this.visible.delete(context);
		if (this.records.get(context)?.status !== "pending") this.records.delete(context);
	}
	public acquire(
		input: Pick<OperationRecord, "actionKind" | "connectionRevision" | "context" | "settingsRevision" | "snapshot">,
	): OperationRecord | undefined {
		if (this.records.get(input.context)?.status === "pending") return undefined;
		const startedAt = this.clock.now();
		const record: OperationRecord = {
			...input,
			snapshot: structuredClone(input.snapshot),
			operationId: randomUUID(),
			startedAt,
			deadlineAt: startedAt + 45000,
			status: "pending",
			durationMs: 0,
		};
		Object.freeze(record.snapshot.connection);
		Object.freeze(record.snapshot);
		this.records.set(record.context, record);
		this.timers.set(
			record.operationId,
			this.clock.setTimeout(() => this.finish(record, { status: "unknown", errorCategory: "timeout" }), 45000),
		);
		for (const listener of this.listeners) listener(record);
		return record;
	}
	public finish(record: OperationRecord, result: OperationResult): boolean {
		if (this.records.get(record.context)?.operationId !== record.operationId || record.status !== "pending")
			return false;
		this.clock.clearTimeout(this.timers.get(record.operationId));
		this.timers.delete(record.operationId);
		record.status = result.status;
		record.errorCategory = result.errorCategory;
		record.requestId = requestId(result.requestId, [record.snapshot.connection.accessToken]);
		record.durationMs = Math.max(0, this.clock.now() - record.startedAt);
		for (const listener of this.listeners) listener(record);
		if (!this.visible.has(record.context)) this.records.delete(record.context);
		return true;
	}
	public canRender(record: OperationRecord, settingsRevision: number, connectionRevision: number): boolean {
		return (
			this.visible.has(record.context) &&
			this.records.get(record.context)?.operationId === record.operationId &&
			record.settingsRevision === settingsRevision &&
			record.connectionRevision === connectionRevision
		);
	}
}
