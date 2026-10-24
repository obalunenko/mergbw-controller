import { type ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { validateNativePayload } from "../native/payload-validator.mjs";
import { BridgeClient } from "./bridge-client.js";
import { HostLiveness, type HostProbeBroker } from "./host-liveness.js";
import { type Clock, systemClock } from "./operation-store.js";
import type { Settings } from "./settings.js";
import { connection, type Connection, object, port } from "./validation.js";

const id = (): string => randomBytes(16).toString("hex");
const validID = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
export type Binding = { session: string; configurationGeneration: string; launchId: string };
export type Capability = Binding & { connection: Connection; signal: AbortSignal };
export type ActiveConfiguration = {
	configured: boolean;
	generation: string | null;
	identity?: string;
	port?: number;
	hasToken?: boolean;
	presetCount?: number;
};
export type SaveOutcome = "applied" | "commit_unknown" | "not_applied" | "unchanged";
export type Proposal = {
	transactionId: string;
	ownerSession?: string;
	candidateGeneration: string;
	expectedGeneration: string | null;
	identity: string;
	port: number;
	hasToken: boolean;
	presetCount: number;
	changed: boolean;
	diff: Record<string, boolean>;
	expiresAt: number;
};
export const runtimeErrors = [
	"auth",
	"instance_busy",
	"port_conflict",
	"binary_missing",
	"binary_incompatible",
	"spawn_failed",
	"protocol_incompatible",
	"startup_timeout",
	"host_unavailable",
	"permission_denied",
	"bluetooth_unavailable",
	"backend_restart_required",
	"worker_exited",
	"cleanup_blocked",
	"storage_unavailable",
	"stale_configuration",
	"invalid_configuration",
	"invalid_identity",
	"invalid_settings",
	"proposal_expired",
	"confirmation_required",
	"unconfigured",
	"control_busy",
	"import_missing",
	"import_unreadable",
	"import_size",
	"import_file",
	"internal_error",
] as const;
export function runtimeError(error: unknown, fallback = "internal_error"): string {
	return error instanceof Error && runtimeErrors.includes(error.message as (typeof runtimeErrors)[number])
		? error.message
		: fallback;
}
export type ManagedTransport = { send: (frame: unknown) => void; close: () => void; exited: Promise<void> };
export type ManagedSpawn = (receive: (line: string) => void, lost: (reason?: string) => void) => ManagedTransport;
// Frame bytes first, then decode one complete UTF-8 object. Retained memory is
// bounded independently of how many complete lines arrived in the same chunk.
export class ManagedLines {
	private buffer: Buffer = Buffer.alloc(0);
	private failed = false;
	constructor(
		private readonly receive: (line: string) => void,
		private readonly lost: () => void,
	) {}
	public fail(): void {
		if (this.failed) return;
		this.failed = true;
		this.buffer = Buffer.alloc(0);
		this.lost();
	}
	public push(chunk: Buffer): void {
		if (this.failed) return;
		let offset = 0;
		while (offset < chunk.length) {
			const end = chunk.indexOf(10, offset),
				stop = end < 0 ? chunk.length : end;
			if (this.buffer.length + stop - offset > 65535) {
				this.fail();
				return;
			}
			const bytes = Buffer.concat([this.buffer, chunk.subarray(offset, stop)]);
			if (end < 0) {
				this.buffer = bytes;
				return;
			}
			this.buffer = Buffer.alloc(0);
			try {
				this.receive(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
			} catch {
				this.fail();
				return;
			}
			offset = end + 1;
		}
	}
	public end(): void {
		this.fail();
	}
}
// The injected launcher is a process-boundary seam for non-BLE fixtures.
export type AppLauncher = (executable: string, args: string[], options: SpawnOptions) => ChildProcess;
export function bundledSupervisorSpawn(pluginRoot: string, launch: AppLauncher = spawn): ManagedSpawn {
	return (receive, lost) => {
		const { supervisor: executable } = validateNativePayload(pluginRoot);
		let directory: string | undefined;
		try {
			directory = mkdtempSync(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "mergbw-"));
			chmodSync(directory, 0o700);
		} catch {
			if (directory) rmSync(directory, { recursive: true, force: true });
			throw new Error("spawn_failed");
		}
		const endpoint = join(directory, "control.sock");
		const app = dirname(dirname(dirname(executable)));
		let socket: Socket | undefined;
		let accepted = false;
		let failed = false;
		let closing = false;
		let launcherDone = false;
		let launchStarted = false;
		let completed = false;
		let connectionDone = true;
		let endpointDone = false;
		const queued: Buffer[] = [];
		let complete!: () => void;
		const exited = new Promise<void>((done) => {
			complete = done;
		});
		const finish = (): void => {
			if (completed || !launcherDone || !connectionDone || !endpointDone) return;
			completed = true;
			rmSync(directory!, { recursive: true, force: true });
			complete();
		};
		const fail = (reason = "worker_exited"): void => {
			if (failed) return;
			failed = true;
			queued.length = 0;
			lost(reason);
		};
		const lines = new ManagedLines(receive, () => fail("protocol_incompatible"));
		const server = createServer({ allowHalfOpen: true }, (peer) => {
			if (accepted || closing || failed) {
				peer.destroy();
				return;
			}
			accepted = true;
			connectionDone = false;
			socket = peer;
			peer.on("data", (chunk: Buffer) => lines.push(chunk));
			peer.once("end", () => {
				lines.end();
				peer.end();
			});
			peer.once("error", () => lines.fail());
			peer.once("close", () => {
				connectionDone = true;
				fail();
				finish();
			});
			for (const bytes of queued) peer.write(bytes);
			queued.length = 0;
		});
		server.once("close", () => {
			endpointDone = true;
			finish();
		});
		const stopListening = (): void => {
			if (server.listening) server.close();
		};
		server.once("error", () => {
			if (!launchStarted) {
				launcherDone = true; // Listening failed, so no app was launched.
				endpointDone = true;
			} else stopListening();
			fail("spawn_failed");
			finish();
		});
		server.listen(endpoint, () => {
			if (closing || failed) {
				launcherDone = true;
				stopListening();
				return;
			}
			let child: ChildProcess;
			try {
				chmodSync(endpoint, 0o600);
				launchStarted = true;
				child = launch("/usr/bin/open", ["-n", "-g", "-W", app, "--args", "--control-socket", endpoint], {
					shell: false,
					detached: false,
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch {
				launcherDone = true;
				stopListening();
				fail("spawn_failed");
				return;
			}
			// App control never uses the launcher's stdout/stderr. Drain both
			// without retaining or logging private helper/native diagnostics.
			child.stdout?.on("data", () => {});
			child.stderr?.on("data", () => {});
			child.stdout?.once("error", () => fail());
			child.stderr?.once("error", () => fail());
			child.once("error", () => {
				stopListening();
				fail("spawn_failed");
			});
			child.once("close", () => {
				launcherDone = true;
				stopListening();
				fail(accepted ? "worker_exited" : "spawn_failed");
				finish();
			});
		});
		return {
			send: (frame) => {
				if (failed || closing) throw new Error("host_unavailable");
				const bytes = Buffer.from(JSON.stringify(frame) + "\n");
				if (bytes.length > 65536) throw new Error("protocol_incompatible");
				if (socket) {
					if (socket.destroyed || socket.writableEnded) throw new Error("host_unavailable");
					socket.write(bytes);
				} else {
					if (queued.length >= 16) throw new Error("control_busy");
					queued.push(bytes);
				}
			},
			close: () => {
				closing = true;
				queued.length = 0;
				// close() can cancel listen's callback before launch admission.
				if (!launchStarted) launcherDone = true;
				stopListening();
				// Half-close retains the read side until the helper has reaped its
				// worker. exited also waits for the actual owned open -W process.
				socket?.end();
			},
			exited,
		};
	};
}
export class ManagedController {
	public state = "unconfigured";
	public error?: string;
	public bluetooth: "connected" | "disconnected" | "unknown" = "unknown";
	public active: ActiveConfiguration = { configured: false, generation: null };
	public saveOutcome?: SaveOutcome;
	public saveTransaction?: string;
	private session = "";
	private transport?: ManagedTransport;
	private pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	private binding?: Binding;
	private abort?: AbortController;
	private credentials?: Connection;
	private authorized = false;
	private helperLive = false;
	private starting = false;
	private epoch = 0;
	private managementEpoch = 0;
	private closing = false;
	private pipeClosed = false;
	private stopping?: Promise<void>;
	private revoking?: Promise<void>;
	private recovering?: Promise<void>;
	private revisionKey = "";
	private revisionSignal?: AbortSignal;
	private bootstrapPending?: object;
	private shutdownVersion = 0;
	private listeners = new Set<() => void>();
	private liveness?: HostLiveness;
	private opening?: Promise<void>;
	private uncertainty?: { candidate: string; expected: string | null };
	private attempt?: { candidate: string; expected: string | null; unchanged: boolean };
	constructor(
		private readonly spawnHelper: ManagedSpawn,
		private readonly settings: Settings,
		private readonly client: BridgeClient,
		private readonly broker: HostProbeBroker,
		private readonly clock: Clock = systemClock,
	) {
		settings.useManaged(
			() => this.capability()?.connection ?? null,
			(value) => !this.credentials || !value.includes(this.credentials.accessToken),
		);
		client.useManaged(
			(cap) => this.current(cap) && this.capability() !== null,
			(connection, signal) => {
				const cap = this.provisional();
				return (
					cap !== null &&
					cap.signal === signal &&
					cap.connection.port === connection.port &&
					cap.connection.accessToken === connection.accessToken
				);
			},
		);
	}
	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed(): void {
		const provisional = this.provisional();
		const key = JSON.stringify([
			this.session,
			this.active.generation,
			this.credentials,
			provisional?.launchId,
			!!this.capability(),
		]);
		const invalidate = key !== this.revisionKey || provisional?.signal !== this.revisionSignal;
		this.revisionKey = key;
		this.revisionSignal = provisional?.signal;
		this.settings.runtimeChanged(invalidate);
		for (const listener of this.listeners) listener();
	}
	public managementSession(): string {
		return this.session;
	}
	public get activeStateKnown(): boolean {
		return !this.uncertainty && this.error !== "storage_unavailable";
	}
	public capability(): Capability | null {
		return this.authorized &&
			this.state === "ready" &&
			this.binding &&
			this.binding.configurationGeneration === this.active.generation &&
			this.credentials &&
			this.abort &&
			!this.abort.signal.aborted &&
			!this.uncertainty
			? { ...this.binding, connection: { ...this.credentials }, signal: this.abort.signal }
			: null;
	}
	public provisional(): Capability | null {
		return this.binding &&
			this.binding.configurationGeneration === this.active.generation &&
			this.credentials &&
			this.abort &&
			!this.abort.signal.aborted
			? { ...this.binding, connection: { ...this.credentials }, signal: this.abort.signal }
			: null;
	}
	public current(cap: Capability): boolean {
		return (
			this.binding?.session === cap.session &&
			this.binding.launchId === cap.launchId &&
			this.binding.configurationGeneration === cap.configurationGeneration &&
			cap.signal === this.abort?.signal &&
			cap.connection.port === this.credentials?.port &&
			cap.connection.accessToken === this.credentials?.accessToken &&
			!cap.signal.aborted
		);
	}
	public startupFailed(error: unknown): void {
		this.state = "failed";
		this.error = runtimeError(error, "storage_unavailable");
		this.changed();
	}
	public async open(): Promise<void> {
		if (this.opening) return this.opening;
		this.opening = this.openSession().catch((error: unknown) => {
			this.state = "failed";
			this.error = runtimeError(error, "host_unavailable");
			this.changed();
			throw new Error(this.error);
		});
		try {
			await this.opening;
		} finally {
			this.opening = undefined;
		}
	}
	private async openSession(expectedGeneration?: string | null): Promise<void> {
		if (this.transport) return;
		const management = this.managementEpoch;
		await this.broker.probe();
		if (management !== this.managementEpoch || this.closing) throw new Error("host_unavailable");
		this.session = id();
		const session = this.session;
		this.transport = this.spawnHelper(
			(line) => this.receive(session, line),
			(reason) => {
				if (session === this.session) void this.loss(reason ?? "worker_exited");
			},
		);
		this.helperLive = true;
		this.pipeClosed = false;
		const current = (): boolean =>
			management === this.managementEpoch && session === this.session && !this.closing && this.helperLive;
		const hello = await this.request("session.open", { protocolVersion: 1 });
		if (!current()) return;
		if (!object(hello) || hello.protocolVersion !== 1 || hello.bridgeVersion !== "2.0.0-go") {
			await this.shutdown();
			throw new Error("protocol_incompatible");
		}
		this.error = undefined;
		this.state = "unconfigured";
		this.bluetooth = "unknown";
		await this.request("host.alive", {});
		if (!current()) return;
		this.liveness = new HostLiveness(
			this.broker,
			() => this.request("host.alive", {}),
			() => this.shutdown("host_unavailable"),
			this.clock,
		);
		await this.reload();
		if (!current()) return;
		if (expectedGeneration !== undefined && expectedGeneration !== this.active.generation)
			throw new Error("stale_configuration");
		void this.liveness.start();
		if (this.active.configured) await this.start();
	}
	public request(type: string, payload: Record<string, unknown>): Promise<unknown> {
		const transport = this.transport;
		if (!transport || !this.helperLive || this.pipeClosed || this.pending.size >= 16)
			return Promise.reject(new Error("host_unavailable"));
		const requestId = id();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("control_timeout"));
			}, 20000);
			this.pending.set(requestId, { resolve, reject, timer });
			try {
				transport.send({ v: 1, session: this.session, requestId, type, payload });
			} catch {
				clearTimeout(timer);
				this.pending.delete(requestId);
				reject(new Error("host_unavailable"));
			}
		});
	}
	private receive(session: string, line: string): void {
		if (session !== this.session || !this.helperLive) return;
		let frame: unknown;
		try {
			if (Buffer.byteLength(line) > 65535) throw new Error("protocol_incompatible");
			frame = JSON.parse(line);
		} catch {
			void this.shutdown("protocol_incompatible");
			return;
		}
		if (
			!object(frame) ||
			frame.v !== 1 ||
			frame.session !== session ||
			!validID(frame.requestId) ||
			typeof frame.type !== "string" ||
			!object(frame.payload) ||
			Object.keys(frame).some((key) => !["v", "session", "requestId", "type", "payload"].includes(key)) ||
			!["result", "controller.bootstrap", "controller.state", "worker.bluetooth"].includes(String(frame.type))
		) {
			void this.shutdown("protocol_incompatible");
			return;
		}
		const payload = frame.payload;
		const allowed: Record<string, string[]> = {
			result: ["status", "code", "data"],
			"controller.bootstrap": ["launchId", "configurationGeneration", "port", "protocolVersion", "bridgeVersion"],
			"controller.state": ["launchId", "configurationGeneration", "state", "errorCategory"],
			"worker.bluetooth": ["launchId", "configurationGeneration", "bluetooth", "errorCategory"],
		};
		if (
			Object.keys(payload).some((key) => !allowed[String(frame.type)]!.includes(key)) ||
			(frame.type === "result" &&
				(!["ok", "error"].includes(String(payload.status)) ||
					(payload.status === "error" &&
						(typeof payload.code !== "string" ||
							!runtimeErrors.includes(payload.code as (typeof runtimeErrors)[number]))) ||
					(payload.status === "ok" && payload.code !== undefined))) ||
			(frame.type !== "result" && (!validID(payload.launchId) || !validID(payload.configurationGeneration))) ||
			(frame.type === "controller.state" &&
				(typeof payload.state !== "string" ||
					!["unconfigured", "starting", "ready", "stopping", "stopped", "failed", "cleanup_blocked"].includes(
						payload.state,
					))) ||
			(frame.type === "worker.bluetooth" &&
				!["unknown", "connected", "disconnected"].includes(String(payload.bluetooth))) ||
			(frame.type === "controller.bootstrap" &&
				(typeof payload.port !== "number" ||
					!Number.isInteger(payload.port) ||
					payload.port < 1024 ||
					payload.port > 65535 ||
					payload.protocolVersion !== 1 ||
					payload.bridgeVersion !== "2.0.0-go")) ||
			(payload.errorCategory !== undefined &&
				(typeof payload.errorCategory !== "string" ||
					!runtimeErrors.includes(payload.errorCategory as (typeof runtimeErrors)[number])))
		) {
			void this.shutdown("protocol_incompatible");
			return;
		}
		if (frame.type === "result") {
			const pending = this.pending.get(frame.requestId);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(frame.requestId);
			if (payload.status === "ok") pending.resolve(payload.data);
			else
				pending.reject(
					new Error(
						typeof payload.code === "string" && runtimeErrors.includes(payload.code as (typeof runtimeErrors)[number])
							? payload.code
							: "protocol_incompatible",
					),
				);
			return;
		}
		if (frame.type === "controller.bootstrap") {
			this.scheduleBootstrap(payload);
			return;
		}
		if (
			frame.type === "worker.bluetooth" &&
			!this.closing &&
			!this.abort?.signal.aborted &&
			this.binding &&
			payload.launchId === this.binding.launchId &&
			payload.configurationGeneration === this.binding.configurationGeneration &&
			["unknown", "connected", "disconnected"].includes(String(payload.bluetooth))
		) {
			this.bluetooth = payload.bluetooth as typeof this.bluetooth;
			this.error = ["permission_denied", "bluetooth_unavailable", "backend_restart_required"].includes(
				String(payload.errorCategory),
			)
				? String(payload.errorCategory)
				: undefined;
			this.changed();
			return;
		}
		if (frame.type === "controller.state") {
			if (
				!this.closing &&
				this.starting &&
				!this.binding &&
				payload.state === "starting" &&
				validID(payload.launchId) &&
				payload.configurationGeneration === this.active.generation
			) {
				this.binding = {
					session,
					launchId: payload.launchId,
					configurationGeneration: payload.configurationGeneration as string,
				};
				this.abort = new AbortController();
				this.starting = false;
				this.error = undefined;
				this.bluetooth = "unknown";
				this.state = "starting";
				this.changed();
			} else if (
				this.binding &&
				payload.launchId === this.binding.launchId &&
				payload.configurationGeneration === this.binding.configurationGeneration
			) {
				if (payload.state === "ready" && this.authorized) {
					this.state = "ready";
					this.changed();
				} else if (["stopping", "stopped", "failed", "cleanup_blocked"].includes(String(payload.state))) {
					this.state = String(payload.state);
					this.error =
						typeof payload.errorCategory === "string" &&
						runtimeErrors.includes(payload.errorCategory as (typeof runtimeErrors)[number])
							? payload.errorCategory
							: undefined;
					void this.revoke();
				}
			}
		}
	}
	private scheduleBootstrap(payload: Record<string, unknown>): void {
		const epoch = this.epoch;
		if (this.closing || this.bootstrapPending || this.authorized || this.state !== "starting") return;
		const pending = {};
		this.bootstrapPending = pending;
		void this.bootstrap(payload)
			.catch(() => (epoch === this.epoch ? this.shutdown("protocol_incompatible") : undefined))
			.finally(() => {
				if (this.bootstrapPending === pending) this.bootstrapPending = undefined;
			});
	}
	private async bootstrap(payload: Record<string, unknown>): Promise<void> {
		const cap = this.provisional();
		if (
			!cap ||
			payload.launchId !== cap.launchId ||
			payload.configurationGeneration !== cap.configurationGeneration ||
			payload.port !== cap.connection.port ||
			payload.protocolVersion !== 1 ||
			payload.bridgeVersion !== "2.0.0-go"
		)
			return;
		const [health, catalog] = await Promise.all([
			this.client.health(cap.connection, cap.signal),
			this.client.catalog(cap.connection, cap.signal),
		]);
		if (!this.current(cap)) return;
		if (!health.value || health.value.version !== "2.0.0-go" || !catalog.value) {
			await this.shutdown(catalog.errorCategory === "auth" ? "auth" : "protocol_incompatible");
			return;
		}
		await this.request("runtime.authorized", {
			launchId: cap.launchId,
			configurationGeneration: cap.configurationGeneration,
		});
		if (this.current(cap)) {
			this.authorized = true;
			this.state = "ready";
			this.bluetooth = health.value.bluetooth_connected ? "connected" : "disconnected";
			this.changed();
		}
	}
	public async reload(): Promise<void> {
		const management = this.managementEpoch,
			session = this.session;
		let epoch = this.epoch;
		const current = (): boolean =>
			management === this.managementEpoch &&
			epoch === this.epoch &&
			session === this.session &&
			this.helperLive &&
			!this.closing;
		try {
			const raw = await this.request("configuration.read", {});
			if (!current()) return;
			if (!object(raw) || typeof raw.configured !== "boolean" || !(raw.generation === null || validID(raw.generation)))
				throw new Error("invalid_configuration");
			let next: ActiveConfiguration = { configured: raw.configured, generation: raw.generation };
			let credentials: Connection | undefined;
			if (raw.configured) {
				if (
					!validID(raw.generation) ||
					typeof raw.identity !== "string" ||
					!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(raw.identity) ||
					typeof raw.presetCount !== "number" ||
					!Number.isInteger(raw.presetCount) ||
					raw.presetCount < 1
				)
					throw new Error("invalid_configuration");
				credentials = connection(raw.connection);
				next = {
					...next,
					identity: raw.identity,
					port: credentials.port,
					hasToken: true,
					presetCount: raw.presetCount,
				};
			} else if (raw.generation !== null) throw new Error("invalid_configuration");
			// A read-only reload cannot transfer ownership from one launch to new
			// credentials, even when a damaged producer reuses a generation ID.
			const invalidated =
				!!this.binding &&
				(this.binding.configurationGeneration !== next.generation ||
					this.credentials?.port !== credentials?.port ||
					this.credentials?.accessToken !== credentials?.accessToken);
			if (invalidated) {
				await this.revoke();
				epoch = this.epoch;
				this.state = "failed";
			}
			this.active = next;
			this.credentials = credentials;
			if (this.attempt) {
				this.saveOutcome =
					this.attempt.unchanged && next.generation === this.attempt.expected
						? "unchanged"
						: next.generation === this.attempt.candidate
							? "applied"
							: next.generation === this.attempt.expected
								? "not_applied"
								: "commit_unknown";
			}
			if (next.configured)
				await this.settings.migrateCommitted().catch(() => {
					/* Disk remains authoritative; SDK cleanup is retried on reload. */
				});
			if (!current()) return;
			this.uncertainty = undefined;
			if (invalidated) this.error = "stale_configuration";
			else if (["storage_unavailable", "invalid_configuration", "stale_configuration"].includes(this.error ?? ""))
				this.error = undefined;
			this.changed();
		} catch {
			if (!current()) return;
			this.authorized = false;
			this.abort?.abort();
			this.state = "failed";
			this.error = "storage_unavailable";
			this.changed();
			throw new Error("storage_unavailable");
		}
	}
	public async prepare(
		identity: string,
		expectedGeneration: string | null,
		ownerSession = "backend",
	): Promise<Proposal> {
		if (!this.activeStateKnown) throw new Error("storage_unavailable");
		const raw = await this.request("configuration.prepareManual", {
			ownerSession,
			identity,
			expectedGeneration,
			...(!this.active.configured && this.settings.legacyConnection()
				? { legacyConnection: this.settings.legacyConnection() }
				: {}),
		});
		return this.review(raw, ownerSession, expectedGeneration);
	}
	public async prepareImport(
		settingsPath: string,
		presetsPath: string | undefined,
		expectedGeneration: string | null,
		ownerSession = "backend",
	): Promise<Proposal> {
		if (!this.activeStateKnown) throw new Error("storage_unavailable");
		const raw = await this.request("configuration.prepareImport", {
			ownerSession,
			settingsPath,
			...(presetsPath ? { presetsPath } : {}),
			expectedGeneration,
		});
		return this.review(raw, ownerSession, expectedGeneration);
	}
	private review(raw: unknown, ownerSession: string, expectedGeneration: string | null): Proposal {
		if (
			!object(raw) ||
			!validID(raw.transactionId) ||
			!validID(raw.candidateGeneration) ||
			raw.expectedGeneration !== expectedGeneration ||
			typeof raw.identity !== "string" ||
			!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(raw.identity) ||
			raw.hasToken !== true ||
			typeof raw.presetCount !== "number" ||
			!Number.isInteger(raw.presetCount) ||
			raw.presetCount < 1 ||
			typeof raw.changed !== "boolean" ||
			typeof raw.expiresAt !== "number" ||
			!Number.isSafeInteger(raw.expiresAt) ||
			!object(raw.diff)
		)
			throw new Error("protocol_incompatible");
		const diff: Record<string, boolean> = {};
		for (const [key, value] of Object.entries(raw.diff)) {
			if (!["identity", "port", "secret", "presets"].includes(key) || typeof value !== "boolean")
				throw new Error("protocol_incompatible");
			diff[key] = value;
		}
		let reviewedPort: number;
		try {
			reviewedPort = port(raw.port);
		} catch {
			throw new Error("protocol_incompatible");
		}
		return {
			transactionId: raw.transactionId,
			candidateGeneration: raw.candidateGeneration,
			ownerSession,
			expectedGeneration,
			identity: raw.identity,
			port: reviewedPort,
			hasToken: true,
			presetCount: raw.presetCount,
			changed: raw.changed,
			diff,
			expiresAt: raw.expiresAt,
		};
	}
	public async apply(proposal: Proposal, confirmed: boolean): Promise<void> {
		if (!this.activeStateKnown) throw new Error("storage_unavailable");
		this.saveTransaction = proposal.transactionId;
		this.attempt = {
			candidate: proposal.candidateGeneration,
			expected: proposal.expectedGeneration,
			unchanged: !proposal.changed,
		};
		if (proposal.changed)
			this.uncertainty = { candidate: proposal.candidateGeneration, expected: proposal.expectedGeneration };
		let replyOutcome: SaveOutcome | undefined;
		let failure: unknown;
		let runtimeError: string | undefined;
		try {
			// Revoke admissions and destroy/drain transports before the mutating RPC.
			// The independent Watch acknowledgement cannot depend on a stopping event.
			if (proposal.changed) await this.revoke(true);
			const result = await this.request("configuration.apply", {
				transactionId: proposal.transactionId,
				ownerSession: proposal.ownerSession ?? "backend",
				expectedGeneration: proposal.expectedGeneration,
				confirmed,
			});
			if (
				!object(result) ||
				!["applied", "not_applied", "commit_unknown", "unchanged"].includes(String(result.saveOutcome))
			)
				throw new Error("protocol_incompatible");
			replyOutcome = result.saveOutcome as SaveOutcome;
			if (
				typeof result.runtimeError === "string" &&
				["port_conflict", "cleanup_blocked", "host_unavailable"].includes(result.runtimeError)
			)
				runtimeError = result.runtimeError;
		} catch (error) {
			failure = error;
		}
		try {
			await this.reload();
		} catch {
			this.saveOutcome = "commit_unknown";
			this.changed();
			return;
		}
		if (replyOutcome === "unchanged") this.saveOutcome = "unchanged";
		if (runtimeError) {
			this.error = runtimeError;
			this.state = "failed";
		}
		this.changed();
		if (this.saveOutcome === "not_applied") {
			if (proposal.changed && !this.binding) {
				this.state = "failed";
				this.error = runtimeError ?? "storage";
				this.changed();
			}
			if (failure) throw failure;
			return;
		}
		if (this.active.configured && this.saveOutcome === "applied" && !this.binding && !this.capability()) {
			try {
				await this.start();
			} catch {
				this.state = "failed";
				this.error = "spawn_failed";
				this.changed();
			}
		}
	}
	public async cancel(transactionId: string, ownerSession = "backend"): Promise<void> {
		await this.request("configuration.cancel", { transactionId, ownerSession });
	}
	public async start(): Promise<void> {
		if (this.closing || !this.helperLive) throw new Error("host_unavailable");
		this.starting = true;
		const epoch = this.epoch;
		const session = this.session;
		try {
			const payload = await this.request("controller.start", { expectedGeneration: this.active.generation });
			if (epoch !== this.epoch || session !== this.session || !this.helperLive) return;
			this.acceptStartReply(payload);
		} catch (error) {
			if (epoch !== this.epoch || session !== this.session) return;
			this.starting = false;
			this.state = "failed";
			this.error = runtimeError(error, "spawn_failed");
			this.changed();
			throw new Error(this.error);
		}
	}
	public revoke(requireAcknowledgement = false): Promise<void> {
		this.epoch++;
		this.starting = false;
		this.bootstrapPending = undefined;
		this.authorized = false;
		this.abort?.abort();
		this.changed();
		if (this.revoking) return requireAcknowledgement ? this.revoking : this.revoking.catch(() => {});
		const binding = this.binding,
			transport = this.transport,
			session = this.session;
		const work = async (): Promise<void> => {
			await this.client.drain();
			if (binding && transport === this.transport && session === this.session && this.helperLive && !this.pipeClosed) {
				await this.request("runtime.revoked", {
					launchId: binding.launchId,
					configurationGeneration: binding.configurationGeneration,
				});
			}
			if (this.binding === binding) this.binding = undefined;
		};
		this.revoking = work().finally(() => {
			this.revoking = undefined;
		});
		return requireAcknowledgement ? this.revoking : this.revoking.catch(() => {});
	}
	private async loss(reason: string): Promise<void> {
		const transport = this.transport;
		const session = this.session;
		const binding = this.binding;
		this.managementEpoch++;
		this.epoch++;
		this.starting = false;
		this.helperLive = false;
		this.bluetooth = "unknown";
		this.state = "failed";
		if (!this.closing && !(this.state === "failed" && this.error && !this.binding)) this.error = reason;
		this.liveness?.stop();
		this.authorized = false;
		this.abort?.abort();
		for (const value of this.pending.values()) {
			clearTimeout(value.timer);
			value.reject(new Error(reason));
		}
		this.pending.clear();
		this.changed();
		await this.client.drain();
		if (this.binding === binding) this.binding = undefined;
		if (transport === this.transport && session === this.session && !this.pipeClosed) {
			this.pipeClosed = true;
			transport?.close();
		}
	}
	// Only the actual process exit hook uses this synchronous path. Teardown
	// closes the parent's transports; ordinary signals must await shutdown.
	public exit(): void {
		this.authorized = false;
		this.abort?.abort();
		this.transport?.close();
	}
	public shutdown(reason = "host_unavailable"): Promise<void> {
		if (this.stopping) {
			if (this.recovering) this.shutdownVersion++;
			return this.stopping;
		}
		this.shutdownVersion++;
		this.managementEpoch++;
		this.closing = true;
		this.liveness?.stop();
		this.state = "failed";
		this.error = reason;
		this.stopping = this.revoke(true).then(() => {
			this.pipeClosed = true;
			this.transport?.close();
			this.changed();
		});
		return this.stopping;
	}
	public restart(expectedGeneration: string | null): Promise<void> {
		if (this.recovering) return this.recovering;
		this.recovering = this.recover(expectedGeneration).finally(() => {
			this.recovering = undefined;
		});
		return this.recovering;
	}
	private async recover(expectedGeneration: string | null): Promise<void> {
		const version = this.shutdownVersion;
		const current = (): void => {
			if (version !== this.shutdownVersion) throw new Error("host_unavailable");
		};
		this.liveness?.stop();
		try {
			if (this.stopping)
				await this.stopping.catch(() => {
					this.stopping = undefined;
				});
			current();
			await this.revoke(true);
			current();
			if (this.helperLive && !this.pipeClosed) {
				this.closing = false;
				this.stopping = undefined;
			}
			if (this.transport && (!this.helperLive || this.pipeClosed)) {
				this.state = "cleanup_blocked";
				this.changed();
				// Confirm the owned helper exit. Its orphaned child's inherited lock is
				// independently checked by the next helper; no PID is adopted or killed.
				if (!this.pipeClosed) {
					this.pipeClosed = true;
					this.transport.close();
				}
				await this.transport.exited;
				current();
				this.transport = undefined;
				this.binding = undefined;
			}
			if (!this.transport) {
				this.closing = false;
				this.stopping = undefined;
				await this.openSession(expectedGeneration);
				return;
			}
			await this.broker.probe();
			current();
			if (!this.helperLive || this.closing) throw new Error("host_unavailable");
			await this.request("host.alive", {});
			await this.reload();
			if (expectedGeneration !== this.active.generation) throw new Error("stale_configuration");
			this.starting = true;
			const epoch = this.epoch;
			const payload = await this.request("controller.restart", { expectedGeneration });
			if (epoch !== this.epoch || this.closing || !this.helperLive) return;
			// Handle helpers that reply before emitting the matching Starting event.
			this.acceptStartReply(payload);
			void this.liveness?.start();
		} catch (error) {
			this.state = "failed";
			const category = runtimeError(error, "host_unavailable");
			this.error = category === "instance_busy" ? "cleanup_blocked" : category;
			this.changed();
			throw new Error(this.error);
		}
	}
	private acceptStartReply(payload: unknown): void {
		if (
			object(payload) &&
			validID(payload.launchId) &&
			payload.configurationGeneration === this.active.generation &&
			payload.port === this.credentials?.port &&
			payload.protocolVersion === 1 &&
			payload.bridgeVersion === "2.0.0-go"
		) {
			if (!this.binding && this.starting && !this.closing) {
				this.binding = {
					session: this.session,
					launchId: payload.launchId,
					configurationGeneration: payload.configurationGeneration as string,
				};
				this.abort = new AbortController();
				this.starting = false;
				this.state = "starting";
				this.error = undefined;
				this.changed();
			}
			this.scheduleBootstrap(payload);
		}
	}
}

export function shutdownOnSignal(
	runtime: Pick<ManagedController, "shutdown">,
	exit: (code: number) => void,
): () => void {
	let stopping = false;
	return (): void => {
		if (stopping) return;
		stopping = true;
		void runtime.shutdown().then(
			() => exit(0),
			() => {
				/* An incomplete drain/revocation retains the lifetime pipe. */
			},
		);
	};
}
