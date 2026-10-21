import type { KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Color } from "../src/actions/color.js";
import { PowerOn } from "../src/actions/power-on.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController, type InspectorReply } from "../src/inspector-messages.js";
import { type OperationRecord, type OperationResult, OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

function event(id: string, key: KeyFacade, settings: Assignment = { schemaVersion: 1 }) {
	return { action: { id, isKey: () => true, ...key }, payload: { settings } };
}
function message(type: string, sessionId = "session-a", requestId = type.replaceAll(".", "-")) {
	return { v: 1, type, sessionId, requestId, payload: {} };
}
async function harness() {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	const clock = new ControlledClock();
	const operations = new OperationStore(clock);
	const client = new BridgeClient(clock);
	const sent: { context: string; reply: InspectorReply }[] = [];
	const inspector = new InspectorController(settings, operations, client, (reply, context) => {
		sent.push({ reply, context });
	});
	const calls: OperationRecord[] = [];
	const replies: ReturnType<typeof deferred<OperationResult>>[] = [];
	client.command = (record) => {
		calls.push(record);
		const reply = deferred<OperationResult>();
		replies.push(reply);
		return reply.promise;
	};
	const services = { settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) };
	return { ...services, storage, clock, sent, calls, replies, services };
}

test("pending dispatch snapshot is immutable across assignment and connection mutation", async () => {
	const h = await harness();
	const action = new Color(h.services);
	const key = new KeyFacade();
	const ev = event("a", key, { schemaVersion: 1, rgb: "FF5000" });
	await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	const record = h.calls[0]!;
	assert.equal(record.snapshot.route, "color/FF5000");
	await h.settings.saveAction("a", { schemaVersion: 1, rgb: "0000FF" });
	await h.settings.saveConnection(18767, "b".repeat(24));
	assert.deepEqual(record.snapshot, {
		route: "color/FF5000",
		connection: { port: 18766, accessToken: syntheticToken },
	});
	assert.ok(Object.isFrozen(record.snapshot));
	assert.ok(Object.isFrozen(record.snapshot.connection));
	await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	assert.equal(h.calls.length, 1);
	h.replies[0]!.resolve({ status: "sent" });
	await pending;
	assert.equal(key.oks, 0);
	assert.equal(h.inspector.snapshot("a").operation, undefined);
	const next = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	assert.equal(h.calls[1]!.snapshot.route, "color/0000FF");
	assert.equal(h.calls[1]!.snapshot.connection.port, 18767);
	h.replies[1]!.resolve({ status: "sent" });
	await next;
	assert.equal(key.oks, 1);
	h.inspector.dispose();
});

test("hide and reappear preserve the same busy guard and equivalent revision without replay", async () => {
	const h = await harness();
	const action = new PowerOn(h.services);
	const original = new KeyFacade();
	const first = event("a", original);
	await action.onWillAppear(first as unknown as WillAppearEvent<Assignment>);
	const pending = action.onKeyDown(first as unknown as KeyDownEvent<Assignment>);
	const record = h.operations.get("a");
	const revision = h.settings.revision("a");
	action.onWillDisappear(first as unknown as WillDisappearEvent<Assignment>);
	assert.equal(h.operations.get("a"), record);
	const restored = new KeyFacade();
	const second = event("a", restored);
	await action.onWillAppear(second as unknown as WillAppearEvent<Assignment>);
	assert.equal(h.settings.revision("a"), revision);
	assert.equal(restored.alerts, 1);
	assert.equal(h.calls.length, 1);
	await action.onKeyDown(second as unknown as KeyDownEvent<Assignment>);
	assert.equal(h.calls.length, 1);
	h.replies[0]!.resolve({ status: "sent" });
	await pending;
	assert.equal(original.oks, 0);
	assert.equal(restored.oks, 1);
	h.inspector.dispose();
});

test("deleted contexts retain pending until terminal, then clean invisible records", async () => {
	for (const timeout of [false, true]) {
		const h = await harness();
		const action = new PowerOn(h.services);
		const key = new KeyFacade();
		const ev = event("deleted", key);
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		action.onWillDisappear(ev as unknown as WillDisappearEvent<Assignment>);
		assert.equal(h.operations.get("deleted")?.status, "pending");
		if (timeout) h.clock.advance(45000);
		h.replies[0]!.resolve({ status: "sent" });
		await pending;
		assert.equal(h.operations.get("deleted"), undefined);
		assert.equal(key.oks, 0);
		assert.equal(h.calls.length, 1);
		h.inspector.dispose();
	}
});

test("deadline and late old responses cannot release or repaint a newer operation", async () => {
	const h = await harness();
	const action = new PowerOn(h.services);
	const key = new KeyFacade();
	const ev = event("a", key);
	await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	const first = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	h.clock.advance(45000);
	assert.equal(h.operations.get("a")?.status, "unknown");
	const second = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	const current = h.operations.get("a");
	assert.notEqual(current?.operationId, h.calls[0]!.operationId);
	h.replies[0]!.resolve({ status: "sent" });
	await first;
	assert.equal(h.operations.get("a"), current);
	assert.equal(current?.status, "pending");
	assert.equal(key.oks, 0);
	await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	assert.equal(h.calls.length, 2);
	h.replies[1]!.resolve({ status: "sent", requestId: "42" });
	await second;
	assert.equal(key.oks, 1);
	assert.equal(current?.requestId, "42");
	h.inspector.dispose();
});

test("reopening PI gets pending and safe last error, while closing never cancels or replays", async () => {
	const h = await harness();
	const action = new PowerOn(h.services);
	const key = new KeyFacade();
	const ev = event("a", key);
	await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	await h.inspector.receive("a", message("inspector.get"));
	assert.equal(h.sent.at(-1)?.reply.snapshot?.operation?.status, "pending");
	h.inspector.close("a");
	const count = h.sent.length;
	h.replies[0]!.resolve({ status: "rejected", errorCategory: "auth", requestId: "123" });
	await pending;
	assert.equal(h.sent.length, count);
	await h.inspector.receive("a", message("inspector.get", "session-b"));
	assert.equal(h.sent.at(-1)?.reply.sessionId, "session-b");
	assert.equal(h.sent.at(-1)?.reply.snapshot?.operation?.errorCategory, "auth");
	assert.ok(!JSON.stringify(h.sent).includes(syntheticToken));
	assert.equal(h.calls.length, 1);
	await h.settings.saveConnection(18767, "b".repeat(24));
	assert.equal(h.sent.at(-1)?.reply.snapshot?.operation, undefined);
	assert.equal(h.sent.at(-1)?.reply.snapshot?.check?.authorization, "unknown");
	h.inspector.dispose();
});

test("late check from a closed or replaced PI cannot populate a new session even with reused ID", async () => {
	for (const reopenSameId of [false, true]) {
		const h = await harness();
		h.settings.receiveAction("a", "on", {});
		const health = deferred<Awaited<ReturnType<BridgeClient["health"]>>>();
		const catalog = deferred<Awaited<ReturnType<BridgeClient["catalog"]>>>();
		h.client.health = () => health.promise;
		h.client.catalog = () => catalog.promise;
		await h.inspector.receive("a", message("inspector.get"));
		const check = h.inspector.receive("a", message("connection.check"));
		h.inspector.close("a");
		await h.inspector.receive("a", message("inspector.get", reopenSameId ? "session-a" : "session-b"));
		health.resolve({
			value: { ok: true, version: "fixture", bluetooth_connected: true, physical_state_verified: false },
		});
		catalog.resolve({ value: { presets: [{ id: "old", label: "Old" }], physical_state_verified: false } });
		await check;
		assert.equal(h.inspector.check.authorization, "unknown");
		assert.equal(h.inspector.catalog.status, "idle");
		assert.deepEqual(h.inspector.catalog.entries, []);
		assert.equal(h.calls.length, 0);
		h.inspector.dispose();
	}
});

test("connection rotation invalidates prior read-only results and all current sessions get sanitized snapshots", async () => {
	const h = await harness();
	h.settings.receiveAction("a", "on", {});
	h.settings.receiveAction("b", "off", {});
	const health = deferred<Awaited<ReturnType<BridgeClient["health"]>>>();
	const catalog = deferred<Awaited<ReturnType<BridgeClient["catalog"]>>>();
	h.client.health = () => health.promise;
	h.client.catalog = () => catalog.promise;
	await h.inspector.receive("a", message("inspector.get"));
	await h.inspector.receive("b", message("inspector.get", "session-b"));
	const check = h.inspector.receive("a", message("connection.check"));
	await h.settings.saveConnection(18767, "b".repeat(24));
	health.resolve({
		value: { ok: true, version: "fixture", bluetooth_connected: true, physical_state_verified: false },
	});
	catalog.resolve({ value: { presets: [{ id: "old", label: "Old" }], physical_state_verified: false } });
	await check;
	assert.equal(h.inspector.check.authorization, "unknown");
	assert.deepEqual(h.inspector.catalog.entries, []);
	assert.equal(h.sent.filter(({ reply }) => reply.snapshot?.connection.port === 18767).length >= 2, true);
	assert.ok(!JSON.stringify(h.sent).includes(syntheticToken));
	assert.ok(!JSON.stringify(h.sent).includes("b".repeat(24)));
	h.inspector.dispose();
});

test("runtime title/image defaults and temporary overlays never persist appearance settings", async () => {
	const h = await harness();
	const action = new PowerOn(h.services);
	const key = new KeyFacade();
	const ev = event("a", key);
	await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	assert.equal(key.alerts, 1);
	h.replies[0]!.resolve({ status: "sent" });
	await pending;
	assert.equal(key.oks, 1);
	assert.deepEqual(key.titles, ["On"]);
	assert.deepEqual(key.images, ["imgs/on.png"]);
	assert.equal(h.storage.actions.size, 0);
	h.inspector.dispose();
});

test("initial storage restoration publishes RU and configured state to early keys and PI sessions", async () => {
	const storage = new MemoryStorage();
	const read = deferred<unknown>();
	storage.getGlobal = () => read.promise;
	const settings = new Settings(storage);
	const operations = new OperationStore(new ControlledClock());
	const client = new BridgeClient();
	let commands = 0;
	client.command = async () => {
		commands++;
		return { status: "sent" };
	};
	const replies: InspectorReply[] = [];
	const inspector = new InspectorController(settings, operations, client, (reply) => {
		replies.push(reply);
	});
	const action = new PowerOn({ settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) });
	const key = new KeyFacade();
	try {
		const loading = settings.load();
		await action.onWillAppear(event("a", key) as unknown as WillAppearEvent<Assignment>);
		await inspector.receive("a", message("inspector.get"));
		assert.equal(key.titles.at(-1), "On");
		assert.equal(replies.at(-1)?.snapshot?.connection.configured, false);
		read.resolve({ schemaVersion: 1, connection: { port: 18766, accessToken: syntheticToken }, language: "ru" });
		await loading;
		assert.equal(key.titles.at(-1), "Включить");
		assert.equal(replies.at(-1)?.snapshot?.language, "ru");
		assert.equal(replies.at(-1)?.snapshot?.connection.configured, true);
		assert.ok(!JSON.stringify(replies).includes(syntheticToken));
		assert.equal(commands, 0);
		assert.equal(storage.actions.size, 0);
	} finally {
		inspector.dispose();
	}
});

test("safe failure summaries survive key hiding before and after completion without private records or replay", async () => {
	for (const hiddenAtFailure of [false, true]) {
		for (const result of [
			{ status: "rejected", errorCategory: "auth" },
			{ status: "unknown", errorCategory: "backend" },
			{ status: "unknown", errorCategory: "timeout" },
		] as const) {
			const h = await harness();
			const action = new PowerOn(h.services);
			const key = new KeyFacade();
			const ev = event("a", key);
			try {
				await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
				const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
				if (hiddenAtFailure) action.onWillDisappear(ev as unknown as WillDisappearEvent<Assignment>);
				h.replies[0]!.resolve({ ...result, requestId: "42" });
				await pending;
				if (!hiddenAtFailure) action.onWillDisappear(ev as unknown as WillDisappearEvent<Assignment>);
				assert.equal(h.operations.get("a"), undefined);
				const restored = new KeyFacade();
				const again = event("a", restored);
				await action.onWillAppear(again as unknown as WillAppearEvent<Assignment>);
				await h.inspector.receive("a", message("inspector.get", "reopened"));
				const snapshot = h.sent.at(-1)?.reply.snapshot;
				assert.equal(snapshot?.operation?.status, result.status);
				assert.equal(snapshot?.operation?.errorCategory, result.errorCategory);
				assert.equal(snapshot?.operation?.requestId, "42");
				assert.equal(restored.oks, 0);
				assert.equal(h.calls.length, 1);
				assert.ok(!JSON.stringify(snapshot).includes(syntheticToken));
				assert.ok(!JSON.stringify(snapshot).includes('"route"'));
				assert.ok(!JSON.stringify(snapshot).includes('"snapshot"'));
				const next = action.onKeyDown(again as unknown as KeyDownEvent<Assignment>);
				assert.equal(h.inspector.snapshot("a").operation?.status, "pending");
				assert.equal(h.inspector.snapshot("a").operation?.errorCategory, undefined);
				h.replies[1]!.resolve({ status: "sent" });
				await next;
				action.onWillDisappear(again as unknown as WillDisappearEvent<Assignment>);
				await action.onWillAppear(again as unknown as WillAppearEvent<Assignment>);
				assert.equal(h.inspector.snapshot("a").operation, undefined);
			} finally {
				h.inspector.dispose();
			}
		}
	}
});

test("retained command failures are invalidated by assignment and connection changes", async () => {
	for (const change of ["assignment", "connection"] as const) {
		const h = await harness();
		const action = new Color(h.services);
		const ev = event("a", new KeyFacade(), { schemaVersion: 1, rgb: "FF5000" });
		try {
			await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
			const pending = action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
			action.onWillDisappear(ev as unknown as WillDisappearEvent<Assignment>);
			h.replies[0]!.resolve({ status: "unknown", errorCategory: "backend" });
			await pending;
			assert.equal(h.inspector.snapshot("a").operation?.status, "unknown");
			if (change === "assignment") await h.settings.saveAction("a", { schemaVersion: 1, rgb: "0000FF" });
			else await h.settings.saveConnection(18767, syntheticToken);
			assert.equal(h.inspector.snapshot("a").operation, undefined);
			assert.equal(h.calls.length, 1);
		} finally {
			h.inspector.dispose();
		}
	}
});
