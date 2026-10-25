import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import test from "node:test";

import { Brightness } from "../src/actions/brightness.js";
import { Color } from "../src/actions/color.js";
import { PowerOff } from "../src/actions/power-off.js";
import { PowerOn } from "../src/actions/power-on.js";
import { Preset } from "../src/actions/preset.js";
import { BridgeClient, type Catalog, type Health, type ReadResult } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { HostLiveness, HostProbeBroker } from "../src/host-liveness.js";
import { translate } from "../src/i18n.js";
import { InspectorController } from "../src/inspector-messages.js";
import { ManagedController, type ManagedSpawn } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const generation = "a".repeat(32),
	launch = "b".repeat(32);
class ReadClient extends BridgeClient {
	public healthCalls = 0;
	public catalogCalls = 0;
	public auth = deferred<ReadResult<Catalog>>();
	public override health = async (): Promise<ReadResult<Health>> => {
		this.healthCalls++;
		return { value: { ok: true, version: "2.0.0-go", bluetooth_connected: false, physical_state_verified: false } };
	};
	public override catalog = (): Promise<ReadResult<Catalog>> => {
		this.catalogCalls++;
		return this.auth.promise;
	};
}
async function setup(configured: boolean, replyOnly = false) {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	const client = new ReadClient();
	let receiver!: (line: string) => void;
	let session = "";
	let readGeneration = generation,
		readPort = 18765,
		readToken = syntheticToken;
	const sent: { type: string; payload: Record<string, unknown> }[] = [];
	const spawn: ManagedSpawn = (receive) => {
		receiver = receive;
		return {
			exited: new Promise(() => {}),
			close: () => {},
			send: (raw) => {
				const frame = raw as {
					v: number;
					session: string;
					requestId: string;
					type: string;
					payload: Record<string, unknown>;
				};
				session = frame.session;
				sent.push(frame);
				let data: unknown = {};
				if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
				if (frame.type === "configuration.read") {
					data = { configured: false, generation: null };
					if (configured)
						data = {
							configured: true,
							generation: readGeneration,
							identity: "AA:BB:CC:DD:EE:FF",
							port: readPort,
							hasToken: true,
							presetCount: 1,
							connection: { port: readPort, accessToken: readToken },
						};
				}
				if (frame.type === "controller.start")
					data = {
						launchId: launch,
						configurationGeneration: generation,
						port: 18765,
						protocolVersion: 1,
						bridgeVersion: "2.0.0-go",
					};
				queueMicrotask(() => receiver(JSON.stringify({ ...frame, type: "result", payload: { status: "ok", data } })));
				if (frame.type === "controller.start" && !replyOnly)
					queueMicrotask(() => {
						emit("controller.state", { state: "starting", launchId: launch, configurationGeneration: generation });
						emit("controller.bootstrap", {
							launchId: launch,
							configurationGeneration: generation,
							port: 18765,
							protocolVersion: 1,
							bridgeVersion: "2.0.0-go",
						});
					});
			},
		};
	};
	function emit(type: string, payload: Record<string, unknown>) {
		receiver(JSON.stringify({ v: 1, session, requestId: "c".repeat(32), type, payload }));
	}
	const runtime = new ManagedController(
		spawn,
		settings,
		client,
		new HostProbeBroker(async () => ({ schemaVersion: 2, language: "en" })),
	);
	await runtime.open();
	return {
		runtime,
		settings,
		client,
		sent,
		emit,
		setRead: (nextGeneration: string, nextPort = 18765, nextToken = syntheticToken) => {
			readGeneration = nextGeneration;
			readPort = nextPort;
			readToken = nextToken;
		},
	};
}
const tick = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve));
};
test("empty owned runtime starts no worker and legacy credentials cannot authorize actions", async () => {
	const { runtime, client, sent } = await setup(false);
	assert.equal(runtime.capability(), null);
	assert.equal(client.healthCalls, 0);
	assert.equal(sent.filter((x) => x.type === "controller.start").length, 0);
	await runtime.shutdown();
});
test("private matching bootstrap permits reads; only current authenticated catalog grants capability", async () => {
	const { runtime, settings, client, sent, emit } = await setup(true);
	assert.equal(runtime.capability(), null);
	assert.equal(runtime.provisional()?.launchId, launch);
	assert.equal(client.healthCalls, 1);
	assert.equal(client.catalogCalls, 1);
	client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
	await tick();
	assert.equal(runtime.capability()?.configurationGeneration, generation);
	const cap = runtime.capability()!;
	assert.equal(runtime.current({ ...cap, signal: new AbortController().signal }), false);
	assert.equal(runtime.current({ ...cap, connection: { ...cap.connection, port: 23456 } }), false);
	assert.equal(
		runtime.current({ ...cap, connection: { ...cap.connection, accessToken: "forged_token_1234567890123456789" } }),
		false,
	);
	assert.equal(settings.getConnection()?.accessToken, syntheticToken);
	assert.equal(sent.filter((x) => x.type === "runtime.authorized").length, 1);
	emit("controller.state", { state: "failed", launchId: launch, configurationGeneration: generation });
	await tick();
	assert.equal(runtime.capability(), null);
	assert.equal(settings.getConnection(), null);
	emit("controller.state", { state: "ready", launchId: launch, configurationGeneration: generation });
	assert.equal(runtime.capability(), null);
	await runtime.shutdown();
});
test("late authenticated read cannot restore a revoked launch", async () => {
	const { runtime, client, sent } = await setup(true);
	await runtime.revoke();
	client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
	await tick();
	assert.equal(runtime.capability(), null);
	assert.equal(sent.filter((x) => x.type === "runtime.authorized").length, 0);
	await runtime.shutdown();
});
test("host timeout retains raw SDK request and recovery needs a fresh reply", async () => {
	const clock = new ControlledClock();
	const first = deferred<unknown>();
	let calls = 0;
	const broker = new HostProbeBroker(() => {
		calls++;
		return calls === 1 ? first.promise : Promise.resolve({});
	}, clock);
	const initial = broker.probe();
	await tick();
	clock.advance(5000);
	await assert.rejects(initial, /host_unavailable/);
	assert.equal(broker.hasPending, true);
	const recovery = broker.probe();
	await tick();
	assert.equal(calls, 1);
	first.resolve({ stale: true });
	await recovery;
	assert.equal(calls, 2);
	assert.equal(broker.hasPending, false);
});
test("polling results do not activate or save globals and timeout ends renewal", async () => {
	const clock = new ControlledClock();
	const raw = deferred<unknown>();
	let probes = 0,
		alive = 0,
		lost = 0;
	const broker = new HostProbeBroker(
		() => (++probes === 1 ? Promise.resolve({ schemaVersion: 99 }) : raw.promise),
		clock,
	);
	const monitor = new HostLiveness(
		broker,
		async () => {
			alive++;
		},
		async () => {
			lost++;
		},
		clock,
	);
	await monitor.start();
	assert.equal(alive, 1);
	clock.advance(2000);
	await tick();
	clock.advance(5000);
	await tick();
	assert.equal(alive, 1);
	assert.equal(lost, 1);
	assert.equal(broker.hasPending, true);
	monitor.stop();
});
test("overlapping waiters cannot accept a probe that expired while they were waiting", async () => {
	const clock = new ControlledClock();
	const first = deferred<unknown>(),
		fresh = deferred<unknown>();
	let calls = 0;
	const broker = new HostProbeBroker(() => (++calls === 1 ? first.promise : fresh.promise), clock);
	const initial = broker.probe();
	await tick();
	clock.advance(1000);
	const overlapping = broker.probe();
	await tick();
	assert.equal(calls, 1);
	clock.advance(4000);
	await assert.rejects(initial, /host_unavailable/);
	first.resolve({ stale: true });
	await tick();
	assert.equal(calls, 2);
	let settled = false;
	void overlapping.then(() => {
		settled = true;
	});
	await tick();
	assert.equal(settled, false);
	fresh.resolve({ fresh: true });
	assert.deepEqual(await overlapping, { fresh: true });
});
test("concurrent callers and retries never create two unsettled raw SDK requests", async () => {
	const clock = new ControlledClock();
	const pending = deferred<unknown>();
	let calls = 0;
	const broker = new HostProbeBroker(() => {
		calls++;
		return pending.promise;
	}, clock);
	const first = broker.probe(),
		second = broker.probe();
	await tick();
	assert.equal(calls, 1);
	clock.advance(5000);
	await Promise.all([assert.rejects(first), assert.rejects(second)]);
	const retry = broker.probe();
	await tick();
	assert.equal(calls, 1);
	clock.advance(5000);
	await assert.rejects(retry);
	assert.equal(calls, 1);
});
test("managed reads reject pre-bootstrap, foreign and stale credential-only access before transport", async () => {
	const client = new BridgeClient();
	const abort = new AbortController();
	const connection = { port: 23456, accessToken: syntheticToken };
	let provisional = false;
	client.useManaged(
		() => false,
		(value, signal) =>
			provisional &&
			value.port === connection.port &&
			value.accessToken === connection.accessToken &&
			signal === abort.signal &&
			!signal.aborted,
	);
	assert.equal((await client.health(connection, abort.signal)).errorCategory, "service");
	provisional = true;
	assert.equal((await client.health(connection)).errorCategory, "service");
	assert.equal((await client.catalog({ ...connection, port: 23457 }, abort.signal)).errorCategory, "service");
	abort.abort();
	assert.equal((await client.catalog(connection, abort.signal)).errorCategory, "service");
	await client.drain();
});
test("revocation aborts an in-flight command, keeps observation unknown and drains transport before acknowledgment", async () => {
	const accepted = deferred<void>();
	let requests = 0;
	const server = await fixture((req, res) => {
		requests++;
		if (req.method === "POST") {
			accepted.resolve();
			return;
		}
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ ok: true, version: "2.0.0-go", bluetooth_connected: false, physical_state_verified: false }),
		);
	});
	const client = new BridgeClient();
	const abort = new AbortController();
	const connection = { port: server.port, accessToken: syntheticToken };
	const capability = {
		session: "d".repeat(32),
		configurationGeneration: generation,
		launchId: launch,
		connection,
		signal: abort.signal,
	};
	client.useManaged(
		(cap) => cap.signal === abort.signal && !cap.signal.aborted,
		(value, signal) => value.port === connection.port && signal === abort.signal && !signal.aborted,
	);
	const store = new OperationStore();
	store.appear("key");
	const record = store.acquire({
		context: "key",
		actionKind: "on",
		settingsRevision: 1,
		connectionRevision: 1,
		snapshot: { route: "on", connection, capability },
	})!;
	try {
		const command = client.command(record);
		await accepted.promise;
		abort.abort();
		const result = await command;
		store.finish(record, result);
		assert.equal(result.status, "unknown");
		await client.drain();
		assert.equal(requests, 1);
		assert.equal((await client.command(record)).status, "rejected");
		assert.equal(requests, 1);
	} finally {
		await server.close();
	}
});

test("validated private start reply authorizes once even without events", async () => {
	const { runtime, client, sent } = await setup(true, true);
	assert.equal(runtime.provisional()?.launchId, launch);
	client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
	await tick();
	assert.ok(runtime.capability());
	assert.equal(sent.filter((frame) => frame.type === "runtime.authorized").length, 1);
	await runtime.shutdown();
});
test("managed action wiring blocks startup, then each explicit press sends exactly one canonical command", async () => {
	const f = await setup(true);
	const operations = new OperationStore();
	const diagnostics = new Diagnostics(() => {});
	const inspector = new InspectorController(f.settings, operations, f.client, () => {}, diagnostics, f.runtime);
	let commands = 0;
	f.client.command = async (record) => {
		assert.equal(record.snapshot.capability?.signal, f.runtime.capability()?.signal);
		commands++;
		return { status: "sent" };
	};
	const services = { settings: f.settings, operations, client: f.client, inspector, diagnostics, runtime: f.runtime };
	try {
		const startup = new PowerOn(services);
		const key = new KeyFacade();
		const event = { action: { id: "starting", isKey: () => true, ...key }, payload: { settings: {} } };
		await startup.onWillAppear(event as unknown as WillAppearEvent<Assignment>);
		assert.equal(key.titles.at(-1), translate("en", "starting"));
		await startup.onKeyDown(event as unknown as KeyDownEvent<Assignment>);
		assert.equal(commands, 0);
		f.client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
		await tick();
		for (const [kind, Action, raw] of [
			["on", PowerOn, {}],
			["off", PowerOff, {}],
			["color", Color, { schemaVersion: 1, rgb: "FF5000" }],
			["brightness", Brightness, { schemaVersion: 1, percent: 25 }],
			["preset", Preset, { schemaVersion: 1, presetId: "sunset" }],
		] as const) {
			const action = new Action(services);
			const key = new KeyFacade();
			const event = { action: { id: kind, isKey: () => true, ...key }, payload: { settings: raw } };
			await action.onWillAppear(event as unknown as WillAppearEvent<Assignment>);
			const before: number = commands;
			await action.onKeyDown(event as unknown as KeyDownEvent<Assignment>);
			assert.equal(commands, before + 1);
			assert.equal(key.oks, 1);
			assert.ok(key.images.every((image) => image === `imgs/${kind}.png`));
		}
		assert.equal(commands, 5);
		assert.equal(inspector.snapshot("on").controller?.physical_state_verified, false);
	} finally {
		inspector.dispose();
		await f.runtime.shutdown();
	}
});
test("a private start reply arriving after shutdown cannot restore a capability", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	const client = new ReadClient();
	let receive!: (line: string) => void;
	let startFrame: Record<string, unknown> | undefined;
	const started = deferred<void>();
	const spawn: ManagedSpawn = (callback) => {
		receive = callback;
		return {
			exited: new Promise(() => {}),
			close: () => {},
			send: (raw) => {
				const frame = raw as Record<string, unknown>;
				if (frame.type === "controller.start") {
					startFrame = frame;
					started.resolve();
					return;
				}
				let data: unknown = {};
				if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
				if (frame.type === "configuration.read")
					data = {
						configured: true,
						generation,
						identity: "AA:BB:CC:DD:EE:FF",
						port: 18765,
						presetCount: 1,
						connection: { port: 18765, accessToken: syntheticToken },
					};
				queueMicrotask(() => receive(JSON.stringify({ ...frame, type: "result", payload: { status: "ok", data } })));
			},
		};
	};
	const runtime = new ManagedController(spawn, settings, client, new HostProbeBroker(async () => ({})));
	const opening = runtime.open();
	await started.promise;
	await runtime.shutdown();
	receive(
		JSON.stringify({
			...startFrame,
			type: "result",
			payload: {
				status: "ok",
				data: {
					launchId: launch,
					configurationGeneration: generation,
					port: 18765,
					protocolVersion: 1,
					bridgeVersion: "2.0.0-go",
				},
			},
		}),
	);
	await opening;
	assert.equal(runtime.capability(), null);
	assert.equal(runtime.provisional(), null);
	assert.equal(client.healthCalls, 0);
	assert.equal(client.catalogCalls, 0);
});

for (const change of ["generation", "port", "token"]) {
	test(`authoritative ${change} change revokes old ownership without foreign reads or automatic worker`, async () => {
		const f = await setup(true);
		try {
			f.client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
			await tick();
			const old = f.runtime.capability()!;
			assert.ok(old);
			const health = f.client.healthCalls,
				catalog = f.client.catalogCalls,
				starts = f.sent.filter((frame) => frame.type === "controller.start").length;
			f.setRead(
				change === "generation" ? "d".repeat(32) : generation,
				change === "port" ? 23456 : 18765,
				change === "token" ? "replacement_synthetic_token_123456" : syntheticToken,
			);
			await f.runtime.reload();
			assert.equal(f.runtime.capability(), null);
			assert.equal(f.runtime.provisional(), null);
			assert.equal(f.runtime.current(old), false);
			assert.equal(old.signal.aborted, true);
			assert.equal(f.client.healthCalls, health);
			assert.equal(f.client.catalogCalls, catalog);
			assert.equal(f.sent.filter((frame) => frame.type === "controller.start").length, starts);
			assert.equal(f.sent.filter((frame) => frame.type === "runtime.authorized").length, 1);
		} finally {
			await f.runtime.shutdown();
		}
	});
}
test("confirmed changed apply revokes admissions then drains and acknowledges before its mutating RPC", async () => {
	const f = await setup(true);
	try {
		f.client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
		await tick();
		assert.ok(f.runtime.capability());
		const drain = deferred<void>();
		f.client.drain = () => drain.promise;
		const operation = f.runtime
			.apply(
				{
					transactionId: "c".repeat(32),
					candidateGeneration: "d".repeat(32),
					expectedGeneration: generation,
					identity: "11:22:33:44:55:66",
					port: 18765,
					hasToken: true,
					presetCount: 1,
					changed: true,
					diff: { identity: true },
					expiresAt: Date.now() + 300000,
				},
				true,
			)
			.catch((error) => error);
		assert.equal(f.runtime.capability(), null);
		assert.equal(f.sent.filter((frame) => frame.type === "configuration.apply").length, 0);
		drain.resolve();
		await operation;
		assert.equal(f.runtime.capability(), null);
		assert.notEqual(f.runtime.state, "ready");
		const revoked = f.sent.findIndex((frame) => frame.type === "runtime.revoked"),
			applied = f.sent.findIndex((frame) => frame.type === "configuration.apply");
		assert.ok(revoked >= 0);
		assert.ok(applied > revoked);
	} finally {
		await f.runtime.shutdown();
	}
});
test("private current secret blocks exported preset assignments before readiness and after runtime failure", async () => {
	const f = await setup(true);
	try {
		const secret = "123456789012345678901234";
		f.setRead(generation, 18765, secret);
		await f.runtime.reload();
		for (const state of ["starting", "failed"]) {
			f.runtime.state = state;
			f.settings.receiveAction("secret", "preset", { schemaVersion: 1, presetId: secret });
			assert.throws(() => f.settings.getAction("secret"));
			await assert.rejects(f.settings.saveAction("secret", { schemaVersion: 1, presetId: secret }));
			const pi = new InspectorController(f.settings, new OperationStore(), f.client, () => {}, undefined, f.runtime);
			assert.ok(!JSON.stringify(pi.snapshot("secret")).includes(secret));
			pi.dispose();
		}
	} finally {
		await f.runtime.shutdown();
	}
});

test("equal-data apply keeps its ready capability and never revokes, drains or restarts", async () => {
	const f = await setup(true);
	try {
		f.client.auth.resolve({ value: { presets: [], physical_state_verified: false } });
		await tick();
		const before = f.runtime.capability()!;
		assert.ok(before);
		const pending = f.runtime.apply(
			{
				transactionId: "c".repeat(32),
				candidateGeneration: "d".repeat(32),
				expectedGeneration: generation,
				identity: "AA:BB:CC:DD:EE:FF",
				port: 18765,
				hasToken: true,
				presetCount: 1,
				changed: false,
				diff: {},
				expiresAt: Date.now() + 300000,
			},
			false,
		);
		assert.equal(f.runtime.capability()?.signal, before.signal);
		await pending;
		assert.equal(f.runtime.saveOutcome, "unchanged");
		assert.equal(f.runtime.capability()?.signal, before.signal);
		assert.equal(f.runtime.state, "ready");
		assert.equal(f.sent.filter((frame) => frame.type === "runtime.revoked").length, 0);
		assert.equal(f.sent.filter((frame) => frame.type === "controller.start").length, 1);
	} finally {
		await f.runtime.shutdown();
	}
});
