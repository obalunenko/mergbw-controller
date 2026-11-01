import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { type ActionServices } from "../src/actions/base-action.js";
import { Brightness } from "../src/actions/brightness.js";
import { Color } from "../src/actions/color.js";
import { PowerOff } from "../src/actions/power-off.js";
import { PowerOn } from "../src/actions/power-on.js";
import { Preset } from "../src/actions/preset.js";
import { Scene } from "../src/actions/scene.js";
import { Transition } from "../src/actions/transition.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { translate } from "../src/i18n.js";
import { InspectorController } from "../src/inspector-messages.js";
import type { ManagedController } from "../src/managed-controller.js";
import { type OperationResult, OperationStore } from "../src/operation-store.js";
import type { EffectSnapshot } from "../src/preset-effects.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

type Services = ActionServices & { routes: string[]; logs: Record<string, number | string>[] };
async function services(connected = true): Promise<Services> {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	if (connected) await settings.saveConnection(18766, syntheticToken);
	const clock = new ControlledClock();
	const operations = new OperationStore(clock);
	const client = new BridgeClient(clock);
	const routes: string[] = [];
	client.command = async (record) => {
		routes.push(record.snapshot.route);
		return { status: "sent" };
	};
	const logs: Services["logs"] = [];
	const diagnostics = new Diagnostics((fields) => logs.push(fields));
	const inspector = new InspectorController(settings, operations, client, () => {}, diagnostics);
	return { settings, operations, client, inspector, diagnostics, routes, logs };
}
function step(id: string, key: KeyFacade, settings: unknown) {
	return { action: { id, isKey: () => true, ...key }, payload: { settings, isInMultiAction: true } };
}
function keyEvent(id: string, key: KeyFacade, settings: unknown) {
	return { action: { id, isKey: () => true, ...key }, payload: { settings } };
}
const appear = (ev: unknown) => ev as WillAppearEvent<Assignment>;
const down = (ev: unknown) => ev as KeyDownEvent<Assignment>;
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("each step kind sends its key route", async () => {
	const s = await services();
	try {
		for (const [Action, raw, route] of [
			[PowerOn, {}, "on"],
			[PowerOff, {}, "off"],
			[Color, { schemaVersion: 1, rgb: "00ff80" }, "color/00FF80"],
			[Scene, { schemaVersion: 1, sceneId: "disco" }, "scene/disco"],
			[Brightness, { schemaVersion: 1, percent: 30 }, "brightness/30"],
			[Preset, { schemaVersion: 1, presetId: "sunset" }, "preset/sunset"],
			[
				Transition,
				{ schemaVersion: 1, fromRGB: "FF0000", fromPercent: 10, toRGB: "0000FF", toPercent: 80, durationSeconds: 5 },
				"transition/FF0000/10/0000FF/80/5",
			],
		] as const) {
			const action = new Action(s);
			const key = new KeyFacade();
			const ev = step(route, key, raw);
			await action.onWillAppear(appear(ev));
			const before = s.routes.length;
			await action.onKeyDown(down(ev));
			await flush();
			assert.deepEqual(s.routes.slice(before), [route]);
			assert.equal(key.oks, 1, route);
			assert.deepEqual(key.titles, [], route);
			assert.deepEqual(key.images, [], route);
		}
	} finally {
		s.inspector.dispose();
	}
});

test("a step writes no title or image", async () => {
	const s = await services();
	try {
		const action = new Color(s);
		const stepKey = new KeyFacade();
		const plainKey = new KeyFacade();
		const raw = { schemaVersion: 1, rgb: "FF0000" };
		for (const ev of [step("step", stepKey, raw), keyEvent("key", plainKey, raw)]) {
			await action.onWillAppear(appear(ev));
			await action.onKeyDown(down(ev));
			s.settings.receiveAction(ev.action.id, "color", { schemaVersion: 1, rgb: "0000FF" });
		}
		await s.settings.saveLanguage("ru");
		await flush();
		assert.deepEqual(stepKey.titles, []);
		assert.deepEqual(stepKey.images, []);
		assert.equal(stepKey.oks, 1);
		assert.ok(plainKey.titles.includes("FF0000"));
		assert.ok(plainKey.titles.includes("0000FF"));
		assert.ok(plainKey.images.length > 0);
	} finally {
		s.inspector.dispose();
	}
});

test("a step dispatches without waiting for another step", async () => {
	const s = await services();
	const color = deferred<OperationResult>();
	s.client.command = async (record) => {
		s.routes.push(record.snapshot.route);
		return record.actionKind === "color" ? color.promise : { status: "sent" };
	};
	try {
		const first = new Color(s);
		const second = new PowerOff(s);
		const colorStep = step("color", new KeyFacade(), { schemaVersion: 1, rgb: "FF0000" });
		const offStep = step("off", new KeyFacade(), {});
		await first.onWillAppear(appear(colorStep));
		await second.onWillAppear(appear(offStep));
		const pending = first.onKeyDown(down(colorStep));
		await second.onKeyDown(down(offStep));
		assert.deepEqual(s.routes, ["color/FF0000", "off"]);
		assert.equal(s.operations.get("color")?.status, "pending");
		assert.equal(s.operations.get("off")?.status, "sent");
		color.resolve({ status: "sent" });
		await pending;
		assert.equal(s.operations.get("color")?.status, "sent");
	} finally {
		s.inspector.dispose();
	}
});

test("an accepted step writes no title", async () => {
	const s = await services();
	s.client.command = async (record) => {
		s.routes.push(record.snapshot.route);
		return { status: "accepted" };
	};
	try {
		const action = new Transition(s);
		const raw = {
			schemaVersion: 1,
			fromRGB: "FF0000",
			fromPercent: 10,
			toRGB: "0000FF",
			toPercent: 80,
			durationSeconds: 5,
		};
		const stepKey = new KeyFacade();
		const plainKey = new KeyFacade();
		for (const ev of [step("step", stepKey, raw), keyEvent("key", plainKey, raw)]) {
			await action.onWillAppear(appear(ev));
			await action.onKeyDown(down(ev));
		}
		await flush();
		assert.equal(s.routes.length, 2);
		assert.deepEqual(stepKey.titles, []);
		assert.equal(plainKey.titles.at(-1), translate(s.settings.getLanguage(), "accepted"));
	} finally {
		s.inspector.dispose();
	}
});

test("a dynamic preset step starts its effect like a key and writes no title", async () => {
	const job: EffectSnapshot = {
		id: "a".repeat(32),
		presetId: "candle",
		kind: "candle",
		state: "running",
		elapsedMs: 0,
		durationMs: null,
		physical_state_verified: false,
	};
	const sequences: string[][] = [];
	for (const make of [step, keyEvent]) {
		const s = await services();
		const calls: string[] = [];
		s.client.command = async (record) => {
			calls.push(record.snapshot.route);
			return { status: "accepted", effect: { ...job } };
		};
		s.client.effect = async () => {
			calls.push("read");
			return { statusCode: 200, value: { effect: { ...job }, physical_state_verified: false } };
		};
		s.client.cancelEffect = async (_connection, id) => {
			calls.push(`cancel ${id}`);
			return { statusCode: 200, value: { effect: { ...job, state: "cancelled" }, physical_state_verified: false } };
		};
		try {
			const action = new Preset(s);
			const key = new KeyFacade();
			const ev = make("preset", key, { schemaVersion: 1, presetId: "candle" });
			await action.onWillAppear(appear(ev));
			await action.onKeyDown(down(ev));
			assert.deepEqual(calls, ["preset/candle"]);
			await action.onKeyDown(down(ev));
			await flush();
			if (make === step) assert.deepEqual(key.titles, []);
			sequences.push(calls);
		} finally {
			s.inspector.dispose();
		}
	}
	assert.deepEqual(sequences, [
		["preset/candle", "read", `cancel ${job.id}`],
		["preset/candle", "read", `cancel ${job.id}`],
	]);
});

test("an invalid step sends nothing, alerts, and the next step still runs", async () => {
	for (const fault of ["corrupt", "deleted-preset"]) {
		const s = await services();
		try {
			const off = new PowerOff(s);
			const offKey = new KeyFacade();
			const offStep = step("off", offKey, {});
			await off.onWillAppear(appear(offStep));
			const key = new KeyFacade();
			if (fault === "corrupt") {
				const ev = step("color", key, { schemaVersion: 2 });
				const action = new Color(s);
				await action.onWillAppear(appear(ev));
				await action.onKeyDown(down(ev));
			} else {
				const ev = step("preset", key, { schemaVersion: 1, presetId: "night" });
				const action = new Preset(s);
				await action.onWillAppear(appear(ev));
				s.inspector.catalog = {
					connectionRevision: s.settings.connectionRevision,
					status: "available",
					entries: [],
					requestGeneration: 1,
				};
				await action.onKeyDown(down(ev));
			}
			assert.deepEqual(s.routes, [], fault);
			assert.equal(key.alerts, 1, fault);
			await off.onKeyDown(down(offStep));
			assert.deepEqual(s.routes, ["off"], fault);
			assert.equal(offKey.oks, 1, fault);
		} finally {
			s.inspector.dispose();
		}
	}
});

test("a step without a connection or readiness is rejected without a request", async () => {
	for (const fault of ["no-connection", "not-ready"]) {
		const s = await services(fault !== "no-connection");
		if (fault === "not-ready")
			s.runtime = {
				capability: () => undefined,
				current: () => false,
				subscribe: () => () => {},
			} as unknown as ManagedController;
		try {
			const action = new Color(s);
			const key = new KeyFacade();
			const ev = step("color", key, { schemaVersion: 1, rgb: "FF0000" });
			await action.onWillAppear(appear(ev));
			await action.onKeyDown(down(ev));
			assert.deepEqual(s.routes, [], fault);
			assert.equal(key.alerts, 1, fault);
		} finally {
			s.inspector.dispose();
		}
	}
});

test("a repeated press skips a pending step", async () => {
	const s = await services();
	const result = deferred<OperationResult>();
	s.client.command = async (record) => {
		s.routes.push(record.snapshot.route);
		return result.promise;
	};
	try {
		const action = new Color(s);
		const ev = step("color", new KeyFacade(), { schemaVersion: 1, rgb: "FF0000" });
		await action.onWillAppear(appear(ev));
		const first = action.onKeyDown(down(ev));
		await action.onKeyDown(down(ev));
		assert.deepEqual(s.routes, ["color/FF0000"]);
		result.resolve({ status: "sent" });
		await first;
		assert.deepEqual(s.routes, ["color/FF0000"]);
	} finally {
		s.inspector.dispose();
	}
});

test("diagnostics flag step events without secrets", async () => {
	for (const make of [step, keyEvent]) {
		const s = await services();
		try {
			const action = new Color(s);
			const valid = make("valid", new KeyFacade(), { schemaVersion: 1, rgb: "FF0000" });
			const corrupt = make("corrupt", new KeyFacade(), { schemaVersion: 2 });
			for (const ev of [valid, corrupt]) {
				await action.onWillAppear(appear(ev));
				await action.onKeyDown(down(ev));
			}
			const events = s.logs.filter((log) => String(log.event).startsWith("action."));
			assert.deepEqual(
				events.map((log) => log.event),
				["action.started", "action.sent", "action.rejected"],
			);
			for (const log of events) assert.equal(log.multiAction, make === step ? "true" : undefined, String(log.event));
			assert.equal(JSON.stringify(s.logs).includes(syntheticToken), false);
		} finally {
			s.inspector.dispose();
		}
	}
});
