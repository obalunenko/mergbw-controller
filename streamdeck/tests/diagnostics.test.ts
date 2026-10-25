import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics, type SafeEvent } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { ControlledClock, deferred, MemoryStorage, syntheticToken } from "./helpers.js";

test("diagnostic records keep the scene action kind", () => {
	const logs: Record<string, number | string>[] = [];
	const diagnostics = new Diagnostics((fields) => logs.push(fields));
	diagnostics.emit("action.sent", { actionKind: "scene", outcome: "sent", durationMs: 3 });
	assert.deepEqual(logs, [{ event: "action.sent", actionKind: "scene", outcome: "sent", durationMs: 3 }]);
});

test("diagnostic runtime allowlist excludes raw fields, invalid identifiers, errors and nonfinite durations", () => {
	const logs: Record<string, number | string>[] = [];
	const diagnostics = new Diagnostics((fields) => logs.push(fields));
	diagnostics.setCurrent(syntheticToken);
	diagnostics.emit("action.unknown", {
		actionKind: "on",
		outcome: "unknown",
		errorCategory: "protocol",
		durationMs: 4,
		requestId: "123",
		operationId: "opaque-id",
		...({
			url: `http://127.0.0.1/${syntheticToken}/on`,
			error: new Error(syntheticToken),
			label: syntheticToken,
		} as object),
	});
	assert.deepEqual(logs[0], {
		event: "action.unknown",
		actionKind: "on",
		outcome: "unknown",
		errorCategory: "protocol",
		durationMs: 4,
		requestId: "123",
		operationId: "opaque-id",
	});
	for (const id of ["-1", "1e4", "1\n", "9".repeat(33), syntheticToken]) {
		diagnostics.emit("connection.checked", { requestId: id, durationMs: Number.NaN });
		assert.deepEqual(logs.at(-1), { event: "connection.checked" });
	}
	const before = logs.length;
	diagnostics.emit(syntheticToken as SafeEvent);
	assert.equal(logs.length, before);
});

test("decimal tokens and in-flight previous tokens never leak through request IDs or labels", () => {
	const old = "123456789012345678901234";
	const next = "987654321098765432109876";
	const logs: unknown[] = [];
	const diagnostics = new Diagnostics((value) => logs.push(value));
	diagnostics.setCurrent(old);
	const release = diagnostics.retain(old);
	diagnostics.setCurrent(next);
	for (const requestId of [old, `00${old}11`, next])
		diagnostics.emit("action.unknown", { requestId, operationId: old });
	const safe = JSON.stringify(logs) + diagnostics.text(`\u0000${old}\n${next} http://127.0.0.1/${old}/on`);
	assert.ok(!safe.includes(old));
	assert.ok(!safe.includes(next));
	assert.ok(!safe.includes("http://"));
	assert.equal(diagnostics.text("\u0000a\nb"), "ab");
	release();
});

test("PI read-only diagnostics and snapshots strip server text and secret IDs across token rotation", async () => {
	const old = "123456789012345678901234";
	const next = "987654321098765432109876";
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(18766, old);
	settings.receiveAction("key", "on", {});
	const logs: unknown[] = [];
	const replies: unknown[] = [];
	const diagnostics = new Diagnostics((fields) => logs.push(fields));
	diagnostics.setCurrent(old);
	settings.subscribe(() => diagnostics.setCurrent(settings.getConnection()?.accessToken));
	const operations = new OperationStore(new ControlledClock());
	operations.appear("key");
	const record = operations.acquire({
		context: "key",
		actionKind: "on",
		settingsRevision: settings.revision("key"),
		connectionRevision: settings.connectionRevision,
		snapshot: { route: "on", connection: settings.getConnection()! },
	})!;
	const release = diagnostics.retain(old);
	const client = new BridgeClient();
	let commands = 0;
	client.command = async () => {
		commands++;
		return { status: "sent" };
	};
	client.health = async () => ({
		value: { ok: true, version: "test", bluetooth_connected: false, physical_state_verified: false },
		requestId: old,
	});
	client.catalog = async () => ({
		value: {
			presets: [{ id: "night", label: `${old}\u0000 http://127.0.0.1/${next}/on` }],
			physical_state_verified: false,
		},
		requestId: old,
	});
	const inspector = new InspectorController(
		settings,
		operations,
		client,
		(reply) => {
			replies.push(reply);
		},
		diagnostics,
	);
	const message = (type: string) => ({
		v: 2,
		sessionId: "session",
		requestId: type.replace(".", "_"),
		type,
		payload: {},
	});
	try {
		await inspector.receive("key", message("inspector.get"));
		await settings.saveConnection(18766, next);
		await inspector.receive("key", message("connection.check"));
		operations.finish(record, { status: "unknown", errorCategory: "protocol", requestId: old });
		const snapshot = inspector.snapshot("key");
		const output = JSON.stringify({ replies, snapshot, logs });
		assert.ok(!output.includes(old));
		assert.ok(!output.includes(next));
		assert.ok(!output.includes("http://"));
		assert.ok(!JSON.stringify(snapshot.catalog).includes("\\u0000"));
		assert.equal(commands, 0);
		assert.ok(logs.some((value) => (value as { event: string }).event === "presets.loaded"));
		assert.ok(!output.includes("command.sent"));
	} finally {
		release();
		inspector.dispose();
	}
});

test("superseded read-only connection retains its secret until the response is discarded", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	settings.receiveAction("key", "on", {});
	const diagnostics = new Diagnostics(() => {});
	diagnostics.setCurrent(syntheticToken);
	const client = new BridgeClient();
	const pending = deferred<Awaited<ReturnType<BridgeClient["catalog"]>>>();
	client.catalog = () => pending.promise;
	const inspector = new InspectorController(settings, new OperationStore(), client, () => {}, diagnostics);
	try {
		await inspector.receive("key", { v: 2, sessionId: "s", requestId: "r", type: "inspector.get", payload: {} });
		const checking = inspector.receive("key", {
			v: 2,
			sessionId: "s",
			requestId: "r2",
			type: "presets.refresh",
			payload: {},
		});
		await settings.saveConnection(18766, "replacement_access_token_123456789");
		diagnostics.setCurrent(settings.getConnection()?.accessToken);
		assert.ok(!diagnostics.text(syntheticToken).includes(syntheticToken));
		pending.resolve({ errorCategory: "protocol" });
		await checking;
		assert.equal(inspector.catalog.status, "idle");
	} finally {
		inspector.dispose();
	}
});

test("plugin fixes INFO before connect in all modes and never enables payload tracing", async () => {
	const source = await readFile(new URL("../../src/plugin.ts", import.meta.url), "utf8");
	assert.ok(source.indexOf('logger.setLevel("info")') < source.indexOf("streamDeck.connect()"));
	assert.ok(!source.includes('setLevel("trace")'));
	assert.ok(!source.includes("NODE_ENV"));
});

test("current and retained tokens cannot become preset assignments, snapshots or fallback titles", async () => {
	const old = "old_token_1234567890123456";
	const next = "new_token_1234567890123456";
	const diagnostics = new Diagnostics(() => {});
	const storage = new MemoryStorage();
	const settings = new Settings(storage, diagnostics);
	await settings.load();
	await settings.saveConnection(18766, old);
	diagnostics.setCurrent(old);
	const release = diagnostics.retain(old);
	await settings.saveConnection(18766, next);
	diagnostics.setCurrent(next);
	const client = new BridgeClient();
	const inspector = new InspectorController(settings, new OperationStore(), client, () => {}, diagnostics);
	const { Feedback } = await import("../src/feedback.js");
	const { KeyFacade } = await import("./helpers.js");
	try {
		for (const secret of [old, next]) {
			for (const id of [secret, `a_${secret}_b`]) {
				settings.receiveAction("key", "preset", { schemaVersion: 1, presetId: id });
				client.catalog = async () => ({
					value: {
						presets: [
							{ id: "a", label: "Safe scene" },
							{ id, label: "Scene" },
						],
						physical_state_verified: false,
					},
				});
				await inspector.receive("key", { v: 2, sessionId: "s", requestId: "r", type: "inspector.get", payload: {} });
				await inspector.receive("key", {
					v: 1,
					sessionId: "s",
					requestId: "r2",
					type: "assignment.save",
					payload: { settings: { schemaVersion: 1, presetId: id } },
				});
				await assert.rejects(settings.saveAction("key", { schemaVersion: 1, presetId: id }));
				const key = new KeyFacade();
				await new Feedback(settings, inspector).ready(key, "preset", "key");
				const snapshot = inspector.snapshot("key");
				assert.equal(snapshot.settingsValid, false);
				assert.deepEqual(snapshot.catalog?.entries, []);
				const output = JSON.stringify({ snapshot, titles: key.titles, saved: [...storage.actions] });
				assert.ok(!output.includes(old));
				assert.ok(!output.includes(next));
				assert.equal(storage.actions.size, 0);
			}
		}
	} finally {
		release();
		inspector.dispose();
	}
});

test("managed private secret safety is independent of ready capability and source paths never enter exported settings", async () => {
	const storage = new MemoryStorage(),
		settings = new Settings(storage);
	await settings.load();
	const privateSecret = "123456789012345678901234";
	const diagnostics = new Diagnostics(() => {});
	settings.useManaged(
		() => null,
		(value) => !value.includes(privateSecret),
	);
	assert.equal(settings.getConnection(), null);
	assert.equal(diagnostics.hasSecret(privateSecret), false);
	settings.receiveAction("preset", "preset", { schemaVersion: 1, presetId: privateSecret });
	await assert.rejects(settings.saveAction("preset", { schemaVersion: 1, presetId: privateSecret }));
	settings.receiveAction("preset", "preset", { schemaVersion: 1, presetId: "custom" });
	await settings.saveAction("preset", {
		schemaVersion: 1,
		presetId: "custom",
		settingsPath: "/synthetic/private/settings.json",
		accessToken: privateSecret,
	});
	const pi = new InspectorController(settings, new OperationStore(), new BridgeClient(), () => {}, diagnostics);
	const exported = JSON.stringify([...storage.actions]) + JSON.stringify(pi.snapshot("preset"));
	assert.ok(!exported.includes(privateSecret));
	assert.ok(!exported.includes("/synthetic/private"));
	assert.deepEqual(storage.actions.get("preset"), { schemaVersion: 1, presetId: "custom" });
	pi.dispose();
});

test("managed diagnostics accept only bounded lifecycle fields before any secret is loaded", () => {
	const events: Record<string, number | string>[] = [];
	const diagnostics = new Diagnostics((fields) => events.push(fields));
	const hostile = "token=never-display https://127.0.0.1/on?access_token=hidden /private/source/settings.json\n{}";
	diagnostics.emit("runtime.failed", { errorCategory: "binary_missing", phase: "startup", durationMs: 500 });
	diagnostics.emit("runtime.failed", {
		errorCategory: hostile,
		phase: hostile,
		requestId: hostile,
		durationMs: Infinity,
		raw: hostile,
	} as never);
	assert.deepEqual(events, [
		{ event: "runtime.failed", errorCategory: "binary_missing", durationMs: 500, phase: "startup" },
		{ event: "runtime.failed" },
	]);
	assert.ok(!JSON.stringify(events).includes("never-display"));
});
