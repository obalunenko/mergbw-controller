import { request } from "node:http";

import { type ErrorCategory, requestId } from "./diagnostics.js";
import { type Clock, type OperationRecord, type OperationResult, systemClock } from "./operation-store.js";
import { type Connection, object, connection as validateConnection } from "./validation.js";

export type Health = { ok: true; version: string; bluetooth_connected: boolean; physical_state_verified: false };
export type PresetEntry = { id: string; label: string };
export type Catalog = { presets: PresetEntry[]; physical_state_verified: false };
export type ReadResult<T> = { statusCode?: number; value?: T; errorCategory?: ErrorCategory; requestId?: string };
type WireResult = ReadResult<unknown> & { dispatched?: boolean };

export class BridgeClient {
	constructor(private readonly clock: Clock = systemClock) {}
	public async health(connection: Connection): Promise<ReadResult<Health>> {
		const result = await this.read(connection, "/health", "GET", 65536, this.clock.now() + 5000);
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
	public async catalog(connection: Connection): Promise<ReadResult<Catalog>> {
		const result = await this.read(
			connection,
			`/${connection.accessToken}/presets`,
			"GET",
			1048576,
			this.clock.now() + 5000,
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
						presets: value.presets.map((entry: PresetEntry) => ({ id: entry.id, label: entry.label })),
						physical_state_verified: false,
					},
				};
		}
		return { ...result, value: undefined, errorCategory: result.errorCategory ?? "protocol" };
	}
	public async command(record: OperationRecord): Promise<OperationResult> {
		const route = record.snapshot.route;
		if (!/^(on|off|color\/[A-F0-9]{6}|brightness\/(?:[0-9]|[1-9][0-9]|100)|preset\/[a-z0-9_-]{1,40})$/.test(route))
			return { status: "rejected", errorCategory: "validation" };
		const result = await this.read(
			record.snapshot.connection,
			`/${record.snapshot.connection.accessToken}/${route}`,
			"POST",
			65536,
			record.deadlineAt,
		);
		const common = { requestId: result.requestId };
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
	private read(
		connection: Connection,
		path: string,
		method: "GET" | "POST",
		cap: number,
		deadline: number,
	): Promise<WireResult> {
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
			const finish = (result: WireResult): void => {
				if (done) return;
				done = true;
				this.clock.clearTimeout(timer);
				req?.destroy();
				resolve({ ...result, dispatched });
			};
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
