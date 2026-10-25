import { request } from "node:http";

import { type ErrorCategory, requestId } from "./diagnostics.js";
import { type Clock, type OperationRecord, type OperationResult, systemClock } from "./operation-store.js";
import { type EffectEnvelope, effectSnapshot } from "./preset-effects.js";
import { SCENE_ROUTE, sceneSelector } from "./scenes.js";
import { type Connection, object, connection as validateConnection } from "./validation.js";

export type TransitionSnapshot = {
	id: string;
	state: "cancelled" | "cancelling" | "completed" | "failed" | "running" | "unknown";
	elapsedMs: number;
	durationMs: number;
	physical_state_verified: false;
};
export type TransitionEnvelope = { transition: TransitionSnapshot | null; physical_state_verified: false };
export function transitionSnapshot(value: unknown, secret = ""): value is TransitionSnapshot {
	if (!object(value) || Object.keys(value).sort().join(",") !== "durationMs,elapsedMs,id,physical_state_verified,state")
		return false;
	return (
		typeof value.id === "string" &&
		/^[0-9a-f]{32}$/.test(value.id) &&
		!(secret && value.id.includes(secret)) &&
		["running", "cancelling", "completed", "cancelled", "failed", "unknown"].includes(String(value.state)) &&
		typeof value.durationMs === "number" &&
		Number.isInteger(value.durationMs) &&
		value.durationMs >= 1000 &&
		value.durationMs <= 60000 &&
		value.durationMs % 1000 === 0 &&
		typeof value.elapsedMs === "number" &&
		Number.isInteger(value.elapsedMs) &&
		value.elapsedMs >= 0 &&
		value.elapsedMs <= value.durationMs &&
		value.physical_state_verified === false
	);
}
function sceneRoute(route: string): boolean {
	const match = SCENE_ROUTE.exec(route);
	return match !== null && sceneSelector(match[1]!) === match[1];
}
const transitionRoute =
	/^transition\/[A-F0-9]{6}\/(?:100|[1-9]?[0-9])\/[A-F0-9]{6}\/(?:100|[1-9]?[0-9])\/(?:[1-9]|[1-5][0-9]|60)$/;
export type Health = { ok: true; version: string; bluetooth_connected: boolean; physical_state_verified: false };
export type PresetEntry = { id: string; label: string; builtIn?: boolean };
export type Catalog = { presets: PresetEntry[]; physical_state_verified: false };
export type ReadResult<T> = { statusCode?: number; value?: T; errorCategory?: ErrorCategory; requestId?: string };
type WireResult = ReadResult<unknown> & { dispatched?: boolean };

export class BridgeClient {
	private managedReadGuard?: (connection: Connection, signal?: AbortSignal) => boolean;
	private managedGuard?: (cap: import("./managed-controller.js").Capability) => boolean;
	public useManaged(
		guard: (cap: import("./managed-controller.js").Capability) => boolean,
		readGuard: (connection: Connection, signal?: AbortSignal) => boolean,
	): void {
		this.managedGuard = guard;
		this.managedReadGuard = readGuard;
	}
	private readonly transports = new Set<Promise<void>>();
	public async drain(): Promise<void> {
		await Promise.all([...this.transports]);
	}
	constructor(private readonly clock: Clock = systemClock) {}
	public async health(connection: Connection, signal?: AbortSignal): Promise<ReadResult<Health>> {
		const result = await this.read(connection, "/health", "GET", 65536, this.clock.now() + 5000, signal);
		const value = result.value;
		if (
			result.statusCode === 200 &&
			object(value) &&
			value.ok === true &&
			typeof value.version === "string" &&
			value.version.length > 0 &&
			value.version.length <= 128 &&
			typeof value.bluetooth_connected === "boolean" &&
			value.physical_state_verified === false
		)
			return { ...result, value: value as Health };
		return { ...result, value: undefined, errorCategory: result.errorCategory ?? "protocol" };
	}
	public async catalog(connection: Connection, signal?: AbortSignal): Promise<ReadResult<Catalog>> {
		const result = await this.read(
			connection,
			`/${connection.accessToken}/presets`,
			"GET",
			1048576,
			this.clock.now() + 5000,
			signal,
		);
		const value = result.value;
		if (
			result.statusCode === 200 &&
			object(value) &&
			value.physical_state_verified === false &&
			Array.isArray(value.presets)
		) {
			let previous = "";
			const valid = value.presets.every((entry: unknown) => {
				if (
					!object(entry) ||
					typeof entry.id !== "string" ||
					!/^[a-z0-9_-]{1,40}$/.test(entry.id) ||
					entry.id.includes(connection.accessToken) ||
					entry.id <= previous ||
					typeof entry.label !== "string" ||
					(entry.builtIn !== undefined && typeof entry.builtIn !== "boolean") ||
					!entry.label.trim() ||
					[...entry.label].some(
						(char) =>
							char.charCodeAt(0) < 32 ||
							(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) ||
							char === "\u2028" ||
							char === "\u2029",
					)
				)
					return false;
				previous = entry.id;
				return true;
			});
			if (valid)
				return {
					...result,
					value: {
						presets: value.presets.map((entry: PresetEntry) => ({
							id: entry.id,
							label: entry.label,
							...(entry.builtIn === undefined ? {} : { builtIn: entry.builtIn }),
						})),
						physical_state_verified: false,
					},
				};
		}
		return { ...result, value: undefined, errorCategory: result.errorCategory ?? "protocol" };
	}
	public async command(record: OperationRecord): Promise<OperationResult> {
		if (this.managedGuard && (!record.snapshot.capability || !this.managedGuard(record.snapshot.capability)))
			return { status: "rejected", errorCategory: "service" };
		if (record.snapshot.capability?.signal.aborted) return { status: "rejected", errorCategory: "service" };
		const route = record.snapshot.route;
		if (
			!/^(on|off|color\/[A-F0-9]{6}|brightness\/(?:[0-9]|[1-9][0-9]|100)|preset\/[a-z0-9_-]{1,40})$/.test(route) &&
			!transitionRoute.test(route) &&
			!sceneRoute(route)
		)
			return { status: "rejected", errorCategory: "validation" };
		const result = await this.read(
			record.snapshot.connection,
			`/${record.snapshot.connection.accessToken}/${route}`,
			"POST",
			65536,
			record.deadlineAt,
			record.snapshot.capability?.signal,
		);
		const common = { requestId: result.requestId };
		if (route.startsWith("preset/") && result.statusCode === 202) {
			const value = result.value;
			if (
				object(value) &&
				Object.keys(value).sort().join(",") === "accepted,action,effect,physical_state_verified" &&
				value.accepted === true &&
				value.action === route &&
				value.physical_state_verified === false &&
				effectSnapshot(value.effect, record.snapshot.connection.accessToken) &&
				value.effect.presetId === route.slice("preset/".length)
			)
				return { ...common, status: "accepted", effect: value.effect };
			return { ...common, status: "unknown", errorCategory: "protocol" };
		}
		if (transitionRoute.test(route)) {
			if (
				result.statusCode === 202 &&
				object(result.value) &&
				Object.keys(result.value).sort().join(",") === "accepted,action,physical_state_verified,transition" &&
				result.value.accepted === true &&
				result.value.action === route &&
				result.value.physical_state_verified === false &&
				transitionSnapshot(result.value.transition, record.snapshot.connection.accessToken) &&
				result.value.transition.durationMs === Number(route.split("/").at(-1)) * 1000
			)
				return { ...common, status: "accepted", transition: result.value.transition };
			// A legacy-style 200 response cannot prove that a transition was admitted.
			if (result.statusCode === 200 || result.statusCode === 202)
				return { ...common, status: "unknown", errorCategory: "protocol" };
		}
		if (!result.dispatched && (result.errorCategory === "service" || result.errorCategory === "validation"))
			return { ...common, status: "rejected", errorCategory: result.errorCategory };
		if (
			result.statusCode === 200 &&
			object(result.value) &&
			result.value.sent === true &&
			result.value.action === route &&
			result.value.physical_state_verified === false
		)
			return { ...common, status: "sent" };
		if (result.statusCode === 400)
			return { ...common, status: "rejected", errorCategory: record.actionKind === "preset" ? "preset" : "parameter" };
		if (result.statusCode === 403) return { ...common, status: "rejected", errorCategory: "auth" };
		if (result.statusCode === 404 || result.statusCode === 405)
			return { ...common, status: "rejected", errorCategory: "protocol" };
		return {
			...common,
			status: "unknown",
			errorCategory:
				result.statusCode === 503
					? "backend"
					: result.statusCode === 504
						? "timeout"
						: (result.errorCategory ?? "protocol"),
		};
	}
	public async transition(
		connection: Connection,
		signal?: AbortSignal,
		capability?: import("./managed-controller.js").Capability,
	): Promise<ReadResult<TransitionEnvelope>> {
		if (this.managedGuard && (!capability || !this.managedGuard(capability))) return { errorCategory: "service" };
		return this.transitionRequest(connection, "transition", "GET", signal);
	}
	public async cancelTransition(
		connection: Connection,
		id: string,
		signal?: AbortSignal,
		capability?: import("./managed-controller.js").Capability,
	): Promise<ReadResult<TransitionEnvelope>> {
		if (this.managedGuard && (!capability || !this.managedGuard(capability))) return { errorCategory: "service" };
		if (!/^[0-9a-f]{32}$/.test(id) || id.includes(connection.accessToken)) return { errorCategory: "validation" };
		return this.transitionRequest(connection, `transition/cancel/${id}`, "POST", signal);
	}
	private async transitionRequest(
		connection: Connection,
		route: string,
		method: "GET" | "POST",
		signal?: AbortSignal,
	): Promise<ReadResult<TransitionEnvelope>> {
		const result = await this.read(
			connection,
			`/${connection.accessToken}/${route}`,
			method,
			65536,
			this.clock.now() + (method === "POST" ? 45000 : 5000),
			signal,
		);
		const value = result.value;
		if (
			result.statusCode === 200 &&
			object(value) &&
			Object.keys(value).sort().join(",") === "physical_state_verified,transition" &&
			value.physical_state_verified === false &&
			(value.transition === null || transitionSnapshot(value.transition, connection.accessToken)) &&
			(method === "GET" ||
				(object(value.transition) && value.transition.id === route.slice("transition/cancel/".length)))
		)
			return { ...result, value: value as TransitionEnvelope };
		return {
			...result,
			value: undefined,
			errorCategory:
				result.errorCategory ??
				(result.statusCode === 403 ? "auth" : result.statusCode === 504 ? "timeout" : "protocol"),
		};
	}
	public async effect(
		connection: Connection,
		signal?: AbortSignal,
		capability?: import("./managed-controller.js").Capability,
	): Promise<ReadResult<EffectEnvelope>> {
		if (this.managedGuard && (!capability || !this.managedGuard(capability))) return { errorCategory: "service" };
		return this.effectRequest(connection, "effect", "GET", signal);
	}
	public async cancelEffect(
		connection: Connection,
		id: string,
		signal?: AbortSignal,
		capability?: import("./managed-controller.js").Capability,
	): Promise<ReadResult<EffectEnvelope>> {
		if (this.managedGuard && (!capability || !this.managedGuard(capability))) return { errorCategory: "service" };
		if (!/^[0-9a-f]{32}$/.test(id) || id.includes(connection.accessToken)) return { errorCategory: "validation" };
		return this.effectRequest(connection, `effect/cancel/${id}`, "POST", signal);
	}
	private async effectRequest(
		connection: Connection,
		route: string,
		method: "GET" | "POST",
		signal?: AbortSignal,
	): Promise<ReadResult<EffectEnvelope>> {
		const result = await this.read(
			connection,
			`/${connection.accessToken}/${route}`,
			method,
			65536,
			this.clock.now() + (method === "POST" ? 45000 : 5000),
			signal,
		);
		const value = result.value;
		if (
			result.statusCode === 200 &&
			object(value) &&
			Object.keys(value).sort().join(",") === "effect,physical_state_verified" &&
			value.physical_state_verified === false &&
			(value.effect === null || effectSnapshot(value.effect, connection.accessToken)) &&
			(method === "GET" || (object(value.effect) && value.effect.id === route.slice("effect/cancel/".length)))
		)
			return { ...result, value: value as EffectEnvelope };
		return {
			...result,
			value: undefined,
			errorCategory:
				result.errorCategory ??
				(result.statusCode === 403 ? "auth" : result.statusCode === 504 ? "timeout" : "protocol"),
		};
	}
	private read(
		connection: Connection,
		path: string,
		method: "GET" | "POST",
		cap: number,
		deadline: number,
		signal?: AbortSignal,
	): Promise<WireResult> {
		if (this.managedReadGuard && !this.managedReadGuard(connection, signal))
			return Promise.resolve({ errorCategory: "service" });
		try {
			validateConnection(connection);
		} catch {
			return Promise.resolve({ errorCategory: "validation" });
		}
		return new Promise((resolve) => {
			let done = false;
			let dispatched = false;
			let timer: unknown = undefined;
			let req: ReturnType<typeof request> | undefined;
			let drained!: () => void;
			const transport = new Promise<void>((resolve) => {
				drained = resolve;
			});
			this.transports.add(transport);
			const completeDrain = (): void => {
				this.transports.delete(transport);
				drained();
			};
			const abort = (): void => finish({ errorCategory: "service" });
			const finish = (result: WireResult): void => {
				if (done) return;
				done = true;
				this.clock.clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				if (req) req.destroy();
				else completeDrain();
				resolve({ ...result, dispatched });
			};
			if (signal?.aborted) {
				finish({ errorCategory: "service" });
				return;
			}
			signal?.addEventListener("abort", abort, { once: true });
			const remaining = deadline - this.clock.now();
			if (remaining <= 0) {
				finish({ errorCategory: "timeout" });
				return;
			}
			timer = this.clock.setTimeout(() => finish({ errorCategory: "timeout" }), remaining);
			try {
				req = request(
					{
						hostname: "127.0.0.1",
						family: 4,
						port: connection.port,
						path,
						method,
						agent: false,
						headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Length": "0" } : {}) },
					},
					(res) => {
						const statusCode = res.statusCode;
						const id = requestId(res.headers["x-request-id"], [connection.accessToken]);
						const base = { statusCode, requestId: id };
						if (
							!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers["content-type"] ?? "") ||
							(res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") ||
							(statusCode && statusCode >= 300 && statusCode < 400)
						) {
							finish({ ...base, errorCategory: "protocol" });
							return;
						}
						const length = Number(res.headers["content-length"]);
						if (Number.isFinite(length) && length > cap) {
							finish({ ...base, errorCategory: "protocol" });
							return;
						}
						const chunks: Buffer[] = [];
						let bytes = 0;
						res.on("data", (chunk: Buffer) => {
							if (done) return;
							bytes += chunk.length;
							if (bytes > cap) finish({ ...base, errorCategory: "protocol" });
							else chunks.push(chunk);
						});
						res.once("error", () => finish({ ...base, errorCategory: "protocol" }));
						res.once("aborted", () => finish({ ...base, errorCategory: "protocol" }));
						res.once("end", () => {
							if (done) return;
							if (!res.complete) {
								finish({ ...base, errorCategory: "protocol" });
								return;
							}
							try {
								finish({ ...base, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
							} catch {
								finish({ ...base, errorCategory: "protocol" });
							}
						});
					},
				);
				req.once("close", completeDrain);
				req.once("socket", (socket) => {
					socket.once("connect", () => {
						dispatched = true;
					});
				});
				req.once("error", () => finish({ errorCategory: "service" }));
				req.end();
			} catch {
				finish({ errorCategory: "service" });
			}
		});
	}
}
