import type { KeyDownEvent, KeyUpEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { PowerOff } from "../src/actions/power-off.js";
import { PowerOn } from "../src/actions/power-on.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const event = (id: string, key: KeyFacade) => ({
	action: { id, isKey: () => true, ...key },
	payload: { settings: {} },
});

test("power SDK press/release sends exactly one POST and never claims physical state", async () => {
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		requests.push(`${req.method} ${req.url}`);
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ sent: true, action: req.url?.split("/").at(-1), physical_state_verified: false }));
	});
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const operations = new OperationStore();
	const client = new BridgeClient();
	const diagnostics = new Diagnostics(() => {});
	const inspector = new InspectorController(settings, operations, client, () => {});
	const services = { settings, operations, client, diagnostics, inspector };
	try {
		for (const [kind, Action] of [
			["on", PowerOn],
			["off", PowerOff],
		] as const) {
			const action = new Action(services);
			const key = new KeyFacade();
			const ev = event(kind, key);
			await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
			assert.equal(requests.length, kind === "on" ? 0 : 1);
			await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
			action.onKeyUp?.(ev as unknown as KeyUpEvent<Assignment>);
			assert.equal(key.oks, 1);
			assert.equal(key.alerts, 0);
			assert.ok(key.titles.every((title) => title === "On" || title === "Off"));
			assert.equal(operations.get(kind)?.status, "sent");
		}
		assert.deepEqual(requests, [`POST /${syntheticToken}/on`, `POST /${syntheticToken}/off`]);
		const restored = new Settings(storage);
		await restored.load();
		assert.equal(restored.getConnection()?.accessToken, syntheticToken);
		assert.equal(requests.length, 2);
	} finally {
		inspector.dispose();
		await server.close();
	}
});

test("busy repeat adds no request while independent contexts dispatch immediately", async () => {
	const pending = deferred<void>();
	const seen: string[] = [];
	const server = await fixture(async (req, res) => {
		seen.push(req.url!);
		await pending.promise;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ sent: true, action: "on", physical_state_verified: false }));
	});
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const operations = new OperationStore();
	const client = new BridgeClient();
	const inspector = new InspectorController(settings, operations, client, () => {});
	const action = new PowerOn({ settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) });
	try {
		const a = event("a", new KeyFacade());
		const b = event("b", new KeyFacade());
		await action.onWillAppear(a as unknown as WillAppearEvent<Assignment>);
		await action.onWillAppear(b as unknown as WillAppearEvent<Assignment>);
		const first = action.onKeyDown(a as unknown as KeyDownEvent<Assignment>);
		const repeat = action.onKeyDown(a as unknown as KeyDownEvent<Assignment>);
		const second = action.onKeyDown(b as unknown as KeyDownEvent<Assignment>);
		assert.equal(operations.get("a")?.status, "pending");
		assert.equal(operations.get("b")?.status, "pending");
		await repeat;
		pending.resolve();
		await Promise.all([first, second]);
		assert.equal(seen.length, 2);
	} finally {
		pending.resolve();
		inspector.dispose();
		await server.close();
	}
});

test("unconfigured or corrupt assignments never dispatch", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	const operations = new OperationStore();
	const client = new BridgeClient();
	let calls = 0;
	client.command = async () => {
		calls++;
		return { status: "sent" };
	};
	const inspector = new InspectorController(settings, operations, client, () => {});
	const action = new PowerOn({ settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) });
	const key = new KeyFacade();
	const ev = event("a", key);
	try {
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(calls, 0);
		assert.equal(key.oks, 0);
		await settings.saveConnection(18766, syntheticToken);
		settings.receiveAction("a", "on", { schemaVersion: 2 });
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(calls, 0);
	} finally {
		inspector.dispose();
	}
});
