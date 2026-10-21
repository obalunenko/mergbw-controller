import type { ActionKind } from "./validation.js";

export type ErrorCategory =
	"auth" | "backend" | "parameter" | "preset" | "protocol" | "service" | "timeout" | "validation";
export type Outcome = "pending" | "rejected" | "sent" | "unknown";
export type SafeEvent =
	| "action.rejected"
	| "action.sent"
	| "action.started"
	| "action.unknown"
	| "connection.checked"
	| "plugin.ready"
	| "presets.failed"
	| "presets.loaded";
export type Diagnostic = {
	actionKind?: ActionKind;
	outcome?: Outcome;
	errorCategory?: ErrorCategory;
	durationMs?: number;
	requestId?: string;
	operationId?: string;
};
export function requestId(value: unknown, secrets: Iterable<string> = []): string | undefined {
	if (typeof value !== "string" || !/^[0-9]{1,32}$/.test(value)) return undefined;
	for (const secret of secrets) if (secret && value.includes(secret)) return undefined;
	return value;
}
export class Diagnostics {
	private readonly secrets = new Map<string, number>();
	private current?: string;
	constructor(private readonly write: (fields: Record<string, number | string>) => void) {}
	public setCurrent(secret?: string): void {
		if (this.current) this.release(this.current);
		this.current = secret;
		if (secret) this.keep(secret);
	}
	public retain(secret: string): () => void {
		this.keep(secret);
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.release(secret);
			}
		};
	}
	public text(value: string): string {
		// Removing control characters is deliberate sanitization of untrusted display text.
		// eslint-disable-next-line no-control-regex
		let safe = value.replace(/https?:\/\/[^\s]+/gi, "[redacted]").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
		for (const secret of this.secrets.keys()) safe = safe.split(secret).join("[redacted]");
		return safe.slice(0, 512);
	}
	public id(value: unknown): string | undefined {
		return requestId(value, this.secrets.keys());
	}
	public hasSecret(value: string): boolean {
		return [...this.secrets.keys()].some((secret) => value.includes(secret));
	}
	public emit(event: SafeEvent, input: Diagnostic = {}): void {
		if (
			![
				"action.rejected",
				"action.sent",
				"action.started",
				"action.unknown",
				"connection.checked",
				"plugin.ready",
				"presets.failed",
				"presets.loaded",
			].includes(event)
		)
			return;
		const fields: Record<string, number | string> = { event };
		if (["on", "off", "color", "brightness", "preset"].includes(input.actionKind ?? ""))
			fields.actionKind = input.actionKind!;
		if (["pending", "sent", "rejected", "unknown"].includes(input.outcome ?? "")) fields.outcome = input.outcome!;
		if (
			["validation", "service", "auth", "parameter", "preset", "backend", "protocol", "timeout"].includes(
				input.errorCategory ?? "",
			)
		)
			fields.errorCategory = input.errorCategory!;
		if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0)
			fields.durationMs = input.durationMs;
		const id = this.id(input.requestId);
		if (id) fields.requestId = id;
		if (typeof input.operationId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(input.operationId))
			fields.operationId = this.text(input.operationId);
		this.write(fields);
	}
	private keep(secret: string): void {
		this.secrets.set(secret, (this.secrets.get(secret) ?? 0) + 1);
	}
	private release(secret: string): void {
		const count = (this.secrets.get(secret) ?? 0) - 1;
		if (count <= 0) this.secrets.delete(secret);
		else this.secrets.set(secret, count);
	}
}
