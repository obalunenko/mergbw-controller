import type { KeyDownEvent, KeyUpEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockBridge } from "../scripts/mock-bridge.mjs";
import { BaseAction } from "../src/actions/base-action.js";
import { Brightness } from "../src/actions/brightness.js";
import { Color } from "../src/actions/color.js";
import { PowerOff } from "../src/actions/power-off.js";
import { PowerOn } from "../src/actions/power-on.js";
import { Preset } from "../src/actions/preset.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { en, ru } from "../src/i18n.js";
import { InspectorController } from "../src/inspector-messages.js";
import { type OperationResult, OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

function event(id: string, key: KeyFacade, value: unknown = {}) {
	return {
		action: { id, isKey: () => true, ...key },
		payload: { settings: value },
	} as unknown as KeyDownEvent<Assignment> & KeyUpEvent<Assignment> & WillAppearEvent<Assignment>;
}
async function services(port = 18766) {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(port, syntheticToken);
	const clock = new ControlledClock();
	const operations = new OperationStore(clock);
	const client = new BridgeClient(clock);
	const logs: unknown[] = [];
	const diagnostics = new Diagnostics((value) => logs.push(value));
	diagnostics.setCurrent(syntheticToken);
	const inspector = new InspectorController(settings, operations, client, () => {}, diagnostics);
	return { settings, clock, operations, client, diagnostics, inspector, logs };
}

test("100 independent SDK activations send exactly one matching command each, never on release", async () => {
	const mock = createMockBridge();
	const server = await fixture(mock.handler);
	const service = await services(server.port);
	try {
		const actions: BaseAction[] = [
			new PowerOn(service),
			new PowerOff(service),
			new Color(service),
			new Brightness(service),
			new Preset(service),
		];
		const expected: unknown[] = [];
		for (let index = 0; index < 100; index++) {
			const action = actions[index % actions.length]!;
			const key = new KeyFacade();
			const percent = index % 101;
			const value =
				action.kind === "color"
					? { schemaVersion: 1, rgb: "ABC123" }
					: action.kind === "brightness"
						? { schemaVersion: 1, percent }
						: action.kind === "preset"
							? { schemaVersion: 1, presetId: "night" }
							: {};
			const ev = event(`key-${index}`, key, value);
			await action.onWillAppear(ev);
			await action.onKeyDown(ev);
			action.onKeyUp?.(ev);
			assert.equal(mock.commands.length, index + 1);
			assert.equal(key.oks, 1);
			expected.push({
				type: action.kind,
				...(action.kind === "color"
					? { parameter: "ABC123" }
					: action.kind === "brightness"
						? { parameter: String(percent) }
						: action.kind === "preset"
							? { parameter: "night" }
							: {}),
				outcome: "sent",
			});
		}
		assert.deepEqual(mock.commands, expected);
		assert.ok(!JSON.stringify(service.logs).includes(syntheticToken));
	} finally {
		service.inspector.dispose();
		await server.close();
	}
});

test("real timeout mode releases busy at 45 seconds, suppresses repeats and permits explicit recovery", async () => {
	const timeout = createMockBridge({ mode: "timeout" });
	const normal = createMockBridge();
	let active = timeout;
	let received = deferred<void>();
	const server = await fixture((req, res) => {
		active.handler(req, res);
		received.resolve();
	});
	const service = await services(server.port);
	const action = new PowerOn(service);
	const key = new KeyFacade();
	const ev = event("key", key);
	try {
		await action.onWillAppear(ev);
		const first = action.onKeyDown(ev);
		await received.promise;
		await action.onKeyDown(ev);
		assert.equal(timeout.commands.length, 1);
		service.clock.advance(45000);
		await first;
		assert.equal(service.inspector.snapshot("key").operation?.status, "unknown");
		assert.equal(key.oks, 0);
		assert.equal(timeout.commands[0]?.outcome, "unknown");
		active = normal;
		received = deferred<void>();
		await action.onKeyDown(ev);
		assert.equal(normal.commands.length, 1);
		assert.equal(service.inspector.snapshot("key").operation?.status, "sent");
		assert.equal(key.oks, 1);
		assert.equal(timeout.commands.length, 1);
	} finally {
		service.inspector.dispose();
		await server.close();
	}
});

test("independent contexts submit concurrently; stale finalization never unlocks or paints a new operation", async () => {
	const service = await services();
	const first = deferred<OperationResult>();
	let calls = 0;
	service.client.command = async () => {
		calls++;
		return calls === 1 ? first.promise : { status: "sent" };
	};
	const action = new PowerOn(service);
	const a = new KeyFacade();
	const b = new KeyFacade();
	const aEvent = event("a", a);
	const bEvent = event("b", b);
	try {
		await action.onWillAppear(aEvent);
		await action.onWillAppear(bEvent);
		const pending = action.onKeyDown(aEvent);
		const old = service.operations.get("a")!;
		await action.onKeyDown(aEvent);
		await action.onKeyDown(bEvent);
		assert.equal(calls, 2);
		assert.equal(b.oks, 1);
		service.clock.advance(45000);
		service.settings.receiveAction("a", "on", { schemaVersion: 1 });
		await action.onKeyDown(aEvent);
		const latest = service.operations.get("a")!;
		assert.notEqual(latest.operationId, old.operationId);
		assert.equal(a.oks, 1);
		first.resolve({ status: "sent", requestId: syntheticToken });
		await pending;
		assert.equal(service.operations.get("a"), latest);
		assert.equal(a.oks, 1);
		assert.equal(old.status, "unknown");
		assert.equal(service.operations.finish(old, { status: "sent" }), false);
		assert.ok(!JSON.stringify(service.logs).includes(syntheticToken));
	} finally {
		service.inspector.dispose();
	}
});

test("local validation and missing preset remain inspectable until a change or next operation", async () => {
	const service = await services();
	let calls = 0;
	service.client.command = async () => {
		calls++;
		return { status: "sent" };
	};
	const action = new Preset(service);
	const key = new KeyFacade();
	const ev = event("preset", key, { schemaVersion: 1, presetId: "sunset" });
	try {
		await action.onWillAppear(ev);
		await action.onKeyDown(ev);
		service.inspector.catalog = {
			connectionRevision: service.settings.connectionRevision,
			status: "available",
			entries: [],
			requestGeneration: 1,
		};
		await action.onKeyDown(ev);
		assert.equal(calls, 1);
		assert.equal(service.inspector.snapshot("preset").explanation, "preset");
		assert.equal(service.inspector.snapshot("preset").operation, undefined);
		service.settings.receiveAction("preset", "preset", { schemaVersion: 1, presetId: "night" });
		assert.equal(service.inspector.snapshot("preset").explanation, undefined);
		service.settings.receiveAction("preset", "preset", { schemaVersion: 9 });
		await action.onKeyDown(ev);
		assert.equal(service.inspector.snapshot("preset").explanation, "validation");
		assert.equal(calls, 1);
		assert.equal(key.oks, 1);
	} finally {
		service.inspector.dispose();
	}
});

test("all simulator failures remain secret-free, retain settings and never show success", async () => {
	for (const mode of ["auth-denied", "backend-error", "malformed", "echo-secret"]) {
		const mock = createMockBridge({ mode });
		const server = await fixture(mock.handler);
		const service = await services(server.port);
		const action = new PowerOn(service);
		const key = new KeyFacade();
		const ev = event("key", key);
		try {
			await action.onWillAppear(ev);
			await action.onKeyDown(ev);
			assert.equal(key.oks, 0, mode);
			assert.equal(mock.commands.length, 1, mode);
			assert.equal(service.settings.getConnection()?.accessToken, syntheticToken);
			assert.ok(
				!JSON.stringify({
					logs: service.logs,
					snapshot: service.inspector.snapshot("key"),
					titles: key.titles,
				}).includes(syntheticToken),
			);
		} finally {
			service.inspector.dispose();
			await server.close();
		}
	}
});

test("RU and EN dictionaries cover identical recovery states and never promise a physical state", () => {
	assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
	for (const key of [
		"unconfigured",
		"ready",
		"pending",
		"sent",
		"error",
		"unknown",
		"validation",
		"service",
		"auth",
		"parameter",
		"presetMissing",
		"backend",
		"protocol",
		"timeout",
	] as const) {
		assert.ok(en[key].length > 0);
		assert.ok(ru[key].length > 0);
	}
	assert.ok(en.unknown.includes("may execute later"));
	assert.ok(ru.unknown.includes("поздний эффект"));
});

test("old command completion cannot paint a replaced assignment or new inspector session", async () => {
	const service = await services();
	const pending = deferred<OperationResult>();
	service.client.command = () => pending.promise;
	const replies: import("../src/inspector-messages.js").InspectorReply[] = [];
	const inspector = new InspectorController(
		service.settings,
		service.operations,
		service.client,
		(reply) => {
			replies.push(reply);
		},
		service.diagnostics,
	);
	const action = new Color({ ...service, inspector });
	const key = new KeyFacade();
	const ev = event("key", key, { schemaVersion: 1, rgb: "ABC123" });
	const message = (sessionId: string) => ({
		v: 1,
		sessionId,
		requestId: "request",
		type: "inspector.get",
		payload: {},
	});
	try {
		await action.onWillAppear(ev);
		await inspector.receive("key", message("old-session"));
		const command = action.onKeyDown(ev);
		const oldOperation = service.operations.get("key")!.operationId;
		inspector.close("key");
		await service.settings.saveAction("key", { schemaVersion: 1, rgb: "FF0000" });
		await inspector.receive("key", message("new-session"));
		const boundary = replies.length;
		pending.resolve({ status: "sent", requestId: "123" });
		await command;
		assert.equal(key.oks, 0);
		assert.equal(inspector.snapshot("key").assignment?.rgb, "FF0000");
		assert.equal(inspector.snapshot("key").operation, undefined);
		assert.ok(
			replies
				.slice(boundary)
				.every((reply) => reply.sessionId === "new-session" && reply.snapshot?.operation?.operationId !== oldOperation),
		);
	} finally {
		inspector.dispose();
		service.inspector.dispose();
	}
});

test("local invalid, unconfigured and missing-preset rejection logs include measured duration without dispatch", async () => {
	for (const reason of ["invalid", "unconfigured", "missing"] as const) {
		const service = await services();
		let calls = 0;
		service.client.command = async () => {
			calls++;
			return { status: "sent" };
		};
		const action = reason === "missing" ? new Preset(service) : new PowerOn(service);
		const ev = event(
			"a",
			new KeyFacade(),
			reason === "invalid" ? { schemaVersion: 9 } : reason === "missing" ? { schemaVersion: 1, presetId: "night" } : {},
		);
		try {
			await action.onWillAppear(ev);
			if (reason === "unconfigured") service.settings.getConnection = () => null;
			service.inspector.catalog = {
				connectionRevision: service.settings.connectionRevision,
				status: "available",
				entries: [],
				requestGeneration: 1,
			};
			const getAction = service.settings.getAction.bind(service.settings);
			service.settings.getAction = (context) => {
				service.clock.advance(7);
				return getAction(context);
			};
			await action.onKeyDown(ev);
			assert.deepEqual(service.logs, [
				{
					event: "action.rejected",
					actionKind: reason === "missing" ? "preset" : "on",
					outcome: "rejected",
					errorCategory: reason === "missing" ? "preset" : "validation",
					durationMs: 7,
				},
			]);
			assert.equal(calls, 0);
			assert.equal(service.operations.get("a"), undefined);
			assert.ok(!JSON.stringify(service.logs).includes(syntheticToken));
			assert.ok(!JSON.stringify(service.logs).includes("night"));
		} finally {
			service.inspector.dispose();
		}
	}
});
