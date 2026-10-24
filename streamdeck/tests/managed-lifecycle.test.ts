import type { KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import test from "node:test";

import { PowerOn } from "../src/actions/power-on.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { InspectorController } from "../src/inspector-messages.js";
import { ManagedController, type ManagedSpawn, shutdownOnSignal } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const generation = "a".repeat(32);
const tick = async () => new Promise<void>((done) => setImmediate(done));
type Frame = { v: number; session: string; requestId: string; type: string; payload: Record<string, unknown> };
async function harness(
	options: { client?: BridgeClient; port?: number; clock?: ControlledClock; probe?: () => Promise<unknown> } = {},
) {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 2, language: "en" };
	const settings = new Settings(storage);
	await settings.load();
	const client = options.client ?? new BridgeClient();
	if (!options.client) {
		client.health = async () => ({
			value: { ok: true, version: "2.0.0-go", bluetooth_connected: false, physical_state_verified: false },
		});
		client.catalog = async () => ({ value: { presets: [], physical_state_verified: false } });
	}
	const sessions: {
		receive: (line: string) => void;
		lost: () => void;
		exit: ReturnType<typeof deferred<void>>;
		frames: Frame[];
		closed: number;
		launch: string;
		finish: () => void;
	}[] = [];
	let nextGeneration = generation,
		holdExit = false,
		rejectRevocation = false,
		holdRevocation = false;
	const spawn: ManagedSpawn = (receive, lost) => {
		const exit = deferred<void>(),
			session = {
				receive,
				lost,
				exit,
				frames: [] as Frame[],
				closed: 0,
				launch: "",
				finish: () => {
					lost();
					exit.resolve();
				},
			};
		sessions.push(session);
		return {
			exited: exit.promise,
			close: () => {
				session.closed++;
				lost();
				if (!holdExit) exit.resolve();
			},
			send: (raw) => {
				const frame = raw as Frame;
				session.frames.push(frame);
				let data: unknown = {};
				if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
				if (frame.type === "configuration.read")
					data = {
						configured: true,
						generation: nextGeneration,
						identity: "AA:BB:CC:DD:EE:FF",
						port: options.port ?? 23456,
						presetCount: 1,
						connection: { port: options.port ?? 23456, accessToken: syntheticToken },
					};
				if (frame.type === "controller.start" || frame.type === "controller.restart") {
					session.launch = (
						sessions.length +
						session.frames.filter((f) => f.type === "controller.start" || f.type === "controller.restart").length
					)
						.toString(16)
						.padStart(32, "0");
					data = {
						launchId: session.launch,
						configurationGeneration: nextGeneration,
						port: options.port ?? 23456,
						protocolVersion: 1,
						bridgeVersion: "2.0.0-go",
					};
				}
				if (frame.type === "runtime.revoked" && holdRevocation) return;
				queueMicrotask(() =>
					receive(
						JSON.stringify({
							...frame,
							type: "result",
							payload:
								frame.type === "runtime.revoked" && rejectRevocation
									? { status: "error", code: "cleanup_blocked" }
									: { status: "ok", data },
						}),
					),
				);
			},
		};
	};
	const clock = options.clock ?? new ControlledClock();
	const broker = new HostProbeBroker(options.probe ?? (async () => ({ schemaVersion: 99 })), clock);
	const runtime = new ManagedController(spawn, settings, client, broker, clock);
	await runtime.open();
	await tick();
	const emit = (index: number, type: string, payload: Record<string, unknown>) => {
		const session = sessions[index]!;
		session.receive(
			JSON.stringify({ v: 1, session: session.frames[0]!.session, requestId: "e".repeat(32), type, payload }),
		);
	};
	return {
		runtime,
		settings,
		client,
		clock,
		broker,
		sessions,
		emit,
		storage,
		setGeneration: (value: string) => {
			nextGeneration = value;
		},
		holdRevocation: (value: boolean) => {
			holdRevocation = value;
		},
		rejectRevocation: (value: boolean) => {
			rejectRevocation = value;
		},
		holdExit: (hold: boolean) => {
			holdExit = hold;
		},
	};
}

test("host timeout and signals retain the lifetime pipe through stalled transport drain and stop renewal", async () => {
	const clock = new ControlledClock(),
		stalled = deferred<unknown>();
	let probes = 0;
	const f = await harness({ clock, probe: () => (++probes <= 2 ? Promise.resolve({}) : stalled.promise) });
	const drain = deferred<void>();
	f.client.drain = () => drain.promise;
	clock.advance(2000);
	await tick();
	clock.advance(5000);
	await tick();
	const session = f.sessions[0]!,
		alive = session.frames.filter((f) => f.type === "host.alive").length;
	assert.equal(f.runtime.error, "host_unavailable");
	assert.equal(f.runtime.capability(), null);
	assert.equal(session.closed, 0);
	clock.advance(20000);
	await tick();
	assert.equal(session.frames.filter((f) => f.type === "host.alive").length, alive);
	assert.equal(probes, 3);
	f.emit(0, "worker.bluetooth", {
		launchId: session.launch,
		configurationGeneration: generation,
		bluetooth: "connected",
	});
	assert.equal(f.runtime.error, "host_unavailable");
	const exits: number[] = [];
	const signal = shutdownOnSignal(f.runtime, (code) => exits.push(code));
	signal();
	signal();
	await tick();
	assert.deepEqual(exits, []);
	assert.equal(session.closed, 0);
	drain.resolve();
	await f.runtime.shutdown();
	await tick();
	assert.equal(session.closed, 1);
	assert.deepEqual(exits, [0]);
	assert.ok(session.frames.findIndex((f) => f.type === "runtime.revoked") < session.frames.length - 0);
});

test("three full restarts coalesce clicks, retain settings and reject old session telemetry with no replay", async () => {
	const f = await harness();
	const operations = new OperationStore(),
		diagnostics = new Diagnostics(() => {}),
		inspector = new InspectorController(f.settings, operations, f.client, () => {}, diagnostics, f.runtime);
	let commands = 0;
	f.client.command = async () => {
		commands++;
		return { status: "sent" };
	};
	const action = new PowerOn({
		settings: f.settings,
		operations,
		client: f.client,
		inspector,
		diagnostics,
		runtime: f.runtime,
	});
	const keys = [new KeyFacade(), new KeyFacade()];
	for (let i = 0; i < 2; i++)
		await action.onWillAppear({
			action: { id: `key${i}`, isKey: () => true, ...keys[i] },
			payload: { settings: {} },
		} as unknown as WillAppearEvent<Assignment>);
	await action.onKeyDown({
		action: { id: "key0", ...keys[0] },
		payload: { settings: {} },
	} as unknown as KeyDownEvent<Assignment>);
	action.onWillDisappear({ action: { id: "key0" } } as WillDisappearEvent<Assignment>);
	action.onWillDisappear({ action: { id: "key1" } } as WillDisappearEvent<Assignment>);
	assert.equal(f.sessions.length, 1);
	assert.equal(f.sessions[0]!.closed, 0);
	assert.equal(commands, 1);
	for (let i = 0; i < 3; i++) {
		const old = f.runtime.capability()!;
		assert.ok(old);
		await f.runtime.shutdown();
		await tick();
		const first = f.runtime.restart(generation),
			second = f.runtime.restart(generation);
		assert.equal(first, second);
		await first;
		await tick();
		assert.equal(f.sessions.length, i + 2);
		assert.ok(f.runtime.capability());
		assert.equal(f.runtime.current(old), false);
		f.emit(i, "controller.state", { state: "ready", launchId: old.launchId, configurationGeneration: generation });
		f.emit(i, "worker.bluetooth", {
			bluetooth: "connected",
			launchId: old.launchId,
			configurationGeneration: generation,
		});
		assert.notEqual(f.runtime.capability()?.session, old.session);
		assert.equal(commands, 1);
		assert.equal(f.runtime.capability()?.connection.accessToken, syntheticToken);
	}
	assert.deepEqual(f.storage.global, { schemaVersion: 2, language: "en" });
	assert.equal(f.sessions.flatMap((s) => s.frames).filter((f) => f.type === "controller.start").length, 4);
	inspector.dispose();
	await f.runtime.shutdown();
});

test("restart waits for old owned helper exit and rejects stale authoritative configuration before a worker", async () => {
	const f = await harness();
	f.holdExit(true);
	await f.runtime.shutdown();
	const restart = f.runtime.restart(generation);
	await tick();
	assert.equal(f.sessions.length, 1);
	assert.equal(f.runtime.state, "cleanup_blocked");
	f.setGeneration("d".repeat(32));
	f.sessions[0]!.finish();
	await assert.rejects(restart, /stale_configuration/);
	assert.equal(f.sessions.length, 2);
	assert.equal(f.sessions[1]!.frames.filter((f) => f.type === "controller.start").length, 0);
	assert.equal(f.runtime.capability(), null);
	f.holdExit(false);
	await f.runtime.shutdown();
});

test("same-launch telemetry, read-only reload and language changes preserve a pending sent result", async () => {
	const f = await harness(),
		operations = new OperationStore(),
		diagnostics = new Diagnostics(() => {}),
		inspector = new InspectorController(f.settings, operations, f.client, () => {}, diagnostics, f.runtime);
	const result = deferred<{ status: "sent" }>();
	let commands = 0;
	f.client.command = () => {
		commands++;
		return result.promise;
	};
	const action = new PowerOn({
			settings: f.settings,
			operations,
			client: f.client,
			inspector,
			diagnostics,
			runtime: f.runtime,
		}),
		key = new KeyFacade();
	const event = { action: { id: "key", isKey: () => true, ...key }, payload: { settings: {} } };
	await action.onWillAppear(event as unknown as WillAppearEvent<Assignment>);
	const command = action.onKeyDown(event as unknown as KeyDownEvent<Assignment>),
		revision = f.settings.connectionRevision,
		cap = f.runtime.capability()!;
	f.emit(0, "worker.bluetooth", {
		launchId: cap.launchId,
		configurationGeneration: generation,
		bluetooth: "connected",
	});
	await f.runtime.reload();
	await f.settings.saveLanguage("ru");
	assert.equal(f.settings.connectionRevision, revision);
	assert.equal(f.runtime.capability()?.signal, cap.signal);
	result.resolve({ status: "sent" });
	await command;
	await tick();
	assert.equal(commands, 1);
	assert.equal(operations.get("key")?.status, "sent");
	assert.equal(key.oks, 1);
	inspector.dispose();
	await f.runtime.shutdown();
});

test("an old sent command finishes bookkeeping but cannot repaint a new launch or replay", async () => {
	const f = await harness(),
		operations = new OperationStore(),
		diagnostics = new Diagnostics(() => {}),
		inspector = new InspectorController(f.settings, operations, f.client, () => {}, diagnostics, f.runtime);
	const result = deferred<{ status: "unknown" }>();
	let commands = 0;
	f.client.command = () => {
		commands++;
		return result.promise;
	};
	const action = new PowerOn({
			settings: f.settings,
			operations,
			client: f.client,
			inspector,
			diagnostics,
			runtime: f.runtime,
		}),
		key = new KeyFacade(),
		event = { action: { id: "key", isKey: () => true, ...key }, payload: { settings: {} } };
	await action.onWillAppear(event as unknown as WillAppearEvent<Assignment>);
	const command = action.onKeyDown(event as unknown as KeyDownEvent<Assignment>);
	await f.runtime.restart(generation);
	await tick();
	const alerts = key.alerts;
	result.resolve({ status: "unknown" });
	await command;
	await tick();
	assert.equal(operations.get("key")?.status, "unknown");
	assert.equal(key.alerts, alerts);
	assert.equal(key.oks, 0);
	assert.equal(commands, 1);
	inspector.dispose();
	await f.runtime.shutdown();
});

test("real HTTP command is aborted unknown before revocation and fresh authorization; no Off or command replay", async () => {
	const accepted = deferred<void>();
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		requests.push(`${req.method} ${req.url}`);
		if (req.method === "POST") {
			accepted.resolve();
			return;
		}
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify(
				req.url === "/health"
					? { ok: true, version: "2.0.0-go", bluetooth_connected: false, physical_state_verified: false }
					: { presets: [], physical_state_verified: false },
			),
		);
	});
	const f = await harness({ client: new BridgeClient(), port: server.port });
	for (let i = 0; i < 100 && !f.runtime.capability(); i++) await tick();
	const store = new OperationStore();
	store.appear("key");
	try {
		const cap = f.runtime.capability()!;
		assert.ok(cap);
		const record = store.acquire({
			context: "key",
			actionKind: "on",
			settingsRevision: 1,
			connectionRevision: f.settings.connectionRevision,
			snapshot: { route: "on", connection: cap.connection, capability: cap },
		})!;
		const command = f.client.command(record);
		await accepted.promise;
		await f.runtime.shutdown();
		store.finish(record, await command);
		assert.equal(record.status, "unknown");
		await f.runtime.restart(generation);
		for (let i = 0; i < 100 && !f.runtime.capability(); i++) await tick();
		assert.ok(f.runtime.capability());
		assert.equal(requests.filter((r) => r.startsWith("POST")).length, 1);
		assert.ok(requests.every((r) => !r.includes("off")));
		assert.ok(requests.filter((r) => r === `GET /${syntheticToken}/presets`).length >= 2);
	} finally {
		await f.runtime.shutdown();
		await server.close();
	}
});

test("unresolved raw host probe across exited sessions permits no duplicate SDK call or new worker", async () => {
	const clock = new ControlledClock(),
		old = deferred<unknown>();
	let calls = 0;
	const f = await harness({ clock, probe: () => (++calls <= 2 ? Promise.resolve({}) : old.promise) });
	clock.advance(2000);
	await tick();
	clock.advance(5000);
	await tick();
	await f.runtime.shutdown();
	for (let attempt = 0; attempt < 3; attempt++) {
		const restart = f.runtime.restart(generation);
		assert.equal(f.runtime.restart(generation), restart);
		await tick();
		clock.advance(5000);
		await assert.rejects(restart, /host_unavailable/);
		assert.equal(calls, 3);
		assert.equal(f.sessions.length, 1);
	}
	const recovery = f.runtime.restart(generation);
	await tick();
	old.resolve({ stale: true });
	await tick();
	assert.equal(calls, 5);
	await recovery;
	await tick();
	assert.equal(f.sessions.length, 2);
	assert.ok(f.runtime.capability());
	await f.runtime.shutdown();
});

test("failed fresh probe after an expired old reply starts no replacement helper", async () => {
	const clock = new ControlledClock(),
		old = deferred<unknown>(),
		fresh = deferred<unknown>();
	let calls = 0;
	const f = await harness({
		clock,
		probe: () => (++calls <= 2 ? Promise.resolve({}) : calls === 3 ? old.promise : fresh.promise),
	});
	clock.advance(2000);
	await tick();
	clock.advance(5000);
	await tick();
	await f.runtime.shutdown();
	const recovery = f.runtime.restart(generation);
	await tick();
	old.resolve({ old: true });
	await tick();
	assert.equal(calls, 4);
	assert.equal(f.sessions.length, 1);
	clock.advance(5000);
	await assert.rejects(recovery, /host_unavailable/);
	assert.equal(f.sessions.length, 1);
	assert.equal(f.runtime.capability(), null);
	const next = f.runtime.restart(generation);
	await tick();
	assert.equal(calls, 4);
	clock.advance(5000);
	await assert.rejects(next);
	assert.equal(f.sessions.length, 1);
});

test("late catalog from an old launch cannot repopulate inspector after restart", async () => {
	const f = await harness(),
		operations = new OperationStore(),
		inspector = new InspectorController(f.settings, operations, f.client, () => {}, undefined, f.runtime);
	f.settings.receiveAction("key", "preset", { schemaVersion: 1, presetId: "old" });
	await inspector.receive("key", { v: 2, sessionId: "panel", requestId: "open", type: "inspector.get", payload: {} });
	const old = deferred<Awaited<ReturnType<BridgeClient["catalog"]>>>(),
		catalog = f.client.catalog;
	f.client.catalog = () => old.promise;
	const refresh = inspector.receive("key", {
		v: 2,
		sessionId: "panel",
		requestId: "refresh",
		type: "presets.refresh",
		payload: {},
	});
	await tick();
	f.client.catalog = catalog;
	await f.runtime.restart(generation);
	await tick();
	old.resolve({ value: { presets: [{ id: "stale", label: "Stale" }], physical_state_verified: false } });
	await refresh;
	assert.ok(!inspector.catalog.entries.some((e) => e.id === "stale"));
	inspector.dispose();
	await f.runtime.shutdown();
});

test("signal during pending recovery prevents a late helper exit from reopening a session", async () => {
	const f = await harness();
	f.holdExit(true);
	await f.runtime.shutdown();
	const recovery = f.runtime.restart(generation);
	await tick();
	// Simulate a new live-parent stop after recovery was requested.
	const stopping = f.runtime.shutdown();
	await stopping;
	f.sessions[0]!.finish();
	await assert.rejects(recovery, /host_unavailable/);
	assert.equal(f.sessions.length, 1);
	assert.equal(f.runtime.capability(), null);
});

test("a rejected cleanup cannot turn a live-parent signal into early process exit", async () => {
	const exits: number[] = [];
	const signal = shutdownOnSignal(
		{
			shutdown: async () => {
				throw new Error("drain unavailable");
			},
		},
		(code) => exits.push(code),
	);
	signal();
	await tick();
	assert.deepEqual(exits, []);
});

test("overlapping weak revocation cannot weaken shutdown acknowledgment or close its lifetime pipe", async () => {
	const f = await harness(),
		drain = deferred<void>();
	f.client.drain = () => drain.promise;
	f.rejectRevocation(true);
	const cap = f.runtime.capability()!;
	f.emit(0, "controller.state", { state: "stopping", launchId: cap.launchId, configurationGeneration: generation });
	const stopping = f.runtime.shutdown();
	drain.resolve();
	await assert.rejects(stopping, /cleanup_blocked/);
	assert.equal(f.sessions[0]!.closed, 0);
	assert.equal(f.runtime.capability(), null);
	f.rejectRevocation(false);
	await f.runtime.restart(generation);
	await tick();
	assert.ok(f.runtime.capability());
	assert.equal(f.sessions.length, 1);
	await f.runtime.shutdown();
});

test("helper death during revocation does not cache a permanent recovery failure", async () => {
	const f = await harness(),
		old = f.runtime.capability()!;
	f.holdRevocation(true);
	const stopping = f.runtime.shutdown(),
		rejected = assert.rejects(stopping, /worker_exited/);
	await tick();
	assert.equal(f.sessions[0]!.frames.filter((frame) => frame.type === "runtime.revoked").length, 1);
	assert.equal(f.sessions[0]!.closed, 0);
	f.sessions[0]!.finish();
	await rejected;
	f.holdRevocation(false);
	await f.runtime.restart(generation);
	await tick();
	assert.equal(f.sessions.length, 2);
	assert.ok(f.runtime.capability());
	assert.equal(f.runtime.current(old), false);
	assert.equal(f.sessions[1]!.frames.filter((frame) => frame.type === "controller.start").length, 1);
	assert.equal(f.runtime.capability()?.connection.accessToken, syntheticToken);
	await f.runtime.shutdown();
});
