import type {
	DialDownEvent,
	DialRotateEvent,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionServices } from "../src/actions/base-action.js";
import { Brightness } from "../src/actions/brightness.js";
import { PowerOff } from "../src/actions/power-off.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import type { Capability, ManagedController } from "../src/managed-controller.js";
import { type OperationRecord, type OperationResult, OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { ControlledClock, deferred, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

async function harness(managed = false) {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	const clock = new ControlledClock();
	const operations = new OperationStore(clock);
	const client = new BridgeClient(clock);
	const inspector = new InspectorController(settings, operations, client, () => {});
	const calls: OperationRecord[] = [];
	const replies: ReturnType<typeof deferred<OperationResult>>[] = [];
	client.command = (record) => {
		calls.push(record);
		const reply = deferred<OperationResult>();
		replies.push(reply);
		return reply.promise;
	};
	let capability: Capability | null = {
		session: "test-session",
		configurationGeneration: "test-generation",
		launchId: "test-launch",
		connection: { port: 18766, accessToken: syntheticToken },
		signal: new AbortController().signal,
	};
	const runtime = {
		capability: () => capability,
		current: (value: Capability) => capability?.signal === value.signal && !value.signal.aborted,
	} as unknown as ManagedController;
	const diagnostics: Record<string, number | string>[] = [];
	const services: ActionServices = {
		settings,
		operations,
		client,
		inspector,
		diagnostics: new Diagnostics((value) => diagnostics.push(value)),
		...(managed ? { runtime } : {}),
	};
	if (managed) settings.useManaged(() => capability?.connection ?? null);
	const action = new Brightness(services);
	const views = new Map<string, Record<string, unknown>[]>();
	function event(id = "dial", percent = 50) {
		const feedback: Record<string, unknown>[] = [];
		views.set(id, feedback);
		return {
			action: {
				id,
				isKey: () => false,
				isDial: () => true,
				setFeedback: async (value: Record<string, unknown>) => {
					feedback.push(value);
				},
			},
			payload: { settings: { schemaVersion: 1, percent } },
		};
	}
	type Dial = ReturnType<typeof event>;
	async function appear(id = "dial", percent = 50) {
		const ev = event(id, percent);
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		return ev;
	}
	function rotate(ev: Dial, ticks: number) {
		action.onDialRotate({ ...ev, payload: { ...ev.payload, ticks } } as unknown as DialRotateEvent<Assignment>);
	}
	function press(ev: Dial) {
		action.onDialDown(ev as unknown as DialDownEvent<Assignment>);
	}
	function disappear(ev: Dial) {
		action.onWillDisappear(ev as unknown as WillDisappearEvent<Assignment>);
	}
	async function settle(index: number, result: OperationResult = { status: "sent" }) {
		replies[index]!.resolve(result);
		await Promise.resolve();
		await Promise.resolve();
	}
	function replaceCapability(value: Capability | null) {
		capability = value;
		settings.runtimeChanged(false);
	}
	return {
		services,
		action,
		client,
		settings,
		operations,
		storage,
		clock,
		calls,
		replies,
		views,
		diagnostics,
		event,
		appear,
		rotate,
		press,
		disappear,
		settle,
		replaceCapability,
		capability: () => capability,
	};
}

test("actual Encoder rotations adjust signed/multiple ticks and clamp without setup, release or touch commands", async () => {
	const h = await harness();
	const ev = await h.appear();
	assert.equal(h.calls.length, 0);
	assert.equal(h.action.onDialUp, undefined);
	assert.equal(h.action.onTouchTap, undefined);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "50%");
	for (const [ticks, expected] of [
		[4, 54],
		[-7, 47],
		[1000, 100],
		[-1000, 0],
	] as const) {
		h.rotate(ev, ticks);
		assert.equal(h.calls.at(-1)!.snapshot.route, `brightness/${expected}`);
		await h.settle(h.calls.length - 1);
	}
	h.rotate(ev, -1);
	assert.equal(h.calls.at(-1)!.snapshot.route, "brightness/0");
	await h.settle(4);
	for (const ticks of [0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) h.rotate(ev, ticks);
	assert.equal(h.calls.length, 5);
	assert.equal(h.storage.actions.size, 0);
	assert.equal(h.settings.getAction("dial").percent, 50);
	assert.ok(!JSON.stringify([...h.views.values()]).includes(syntheticToken));
});

test("fast rotation keeps one HTTP flight and sends only the latest accumulated target", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 1);
	for (let tick = 0; tick < 20; tick++) h.rotate(ev, 1);
	h.rotate(ev, -6);
	assert.deepEqual(
		h.calls.map((call) => call.snapshot.route),
		["brightness/51"],
	);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "65%");
	await h.settle(0);
	assert.deepEqual(
		h.calls.map((call) => call.snapshot.route),
		["brightness/51", "brightness/65"],
	);
	await h.settle(1);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Brightness/);
	assert.equal(h.calls.length, 2);
});

test("a coalesced target returning to the in-flight target does not send a duplicate", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 1);
	h.rotate(ev, 2);
	h.rotate(ev, -2);
	await h.settle(0);
	assert.equal(h.calls.length, 1);
});

test("rejected and uncertain responses discard queued ticks and never retry automatically", async () => {
	for (const status of ["rejected", "unknown"] as const) {
		const h = await harness();
		const ev = await h.appear();
		h.rotate(ev, 1);
		h.rotate(ev, 5);
		await h.settle(0, { status, errorCategory: "backend" });
		assert.equal(h.calls.length, 1);
		assert.match(String(h.views.get("dial")!.at(-1)!.title), status === "unknown" ? /Unknown/ : /Rejected/);
		h.rotate(ev, 1);
		assert.equal(h.calls[1]!.snapshot.route, "brightness/57");
		await h.settle(1);
	}
});

test("operation timeout retains the raw-flight fence and ignores late success", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 1);
	h.rotate(ev, 10);
	h.clock.advance(45000);
	assert.equal(h.operations.get("dial")!.status, "unknown");
	const before = h.views.get("dial")!.length;
	h.rotate(ev, 3);
	assert.equal(h.calls.length, 1);
	await h.settle(0);
	assert.equal(h.calls.length, 1);
	assert.equal(h.views.get("dial")!.length, before + 1);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Unknown/);
});

test("disappearance/reappearance keeps old raw work fenced and drops all old feedback and targets", async () => {
	const h = await harness();
	const first = await h.appear();
	h.rotate(first, 1);
	h.rotate(first, 15);
	h.disappear(first);
	const second = await h.appear("dial", 25);
	const freshFeedback = h.views.get("dial")!.length;
	h.rotate(second, 2);
	assert.equal(h.calls.length, 1);
	await h.settle(0);
	assert.equal(h.views.get("dial")!.length, freshFeedback);
	h.rotate(second, -1);
	assert.equal(h.calls[1]!.snapshot.route, "brightness/24");
	await h.settle(1);
});

test("assignment edits reset the target, retain raw fence and discard obsolete completion", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 1);
	h.rotate(ev, 10);
	await h.settings.saveAction("dial", { schemaVersion: 1, percent: 80 });
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "80%");
	const count = h.views.get("dial")!.length;
	await h.settle(0);
	assert.equal(h.views.get("dial")!.length, count);
	assert.equal(h.calls.length, 1);
	h.rotate(ev, -2);
	assert.equal(h.calls[1]!.snapshot.route, "brightness/78");
	await h.settle(1);
});

test("language-only changes retain live target and localize touch feedback", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 3);
	await h.settle(0);
	await h.settings.saveLanguage("ru");
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "53%");
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Яркость/);
	assert.equal(h.calls.length, 1);
	h.rotate(ev, 2);
	assert.equal(h.calls[1]!.snapshot.route, "brightness/55");
	await h.settle(1);
});

test("connection changes and managed capability loss prevent pending dispatch and never replay after readiness", async () => {
	for (const managed of [false, true]) {
		const h = await harness(managed);
		const ev = await h.appear();
		h.rotate(ev, 1);
		h.rotate(ev, 10);
		const saved = h.capability();
		if (managed) h.replaceCapability(null);
		else await h.settings.saveConnection(18767);
		const count = h.views.get("dial")!.length;
		await h.settle(0);
		assert.equal(h.views.get("dial")!.length, count);
		assert.equal(h.calls.length, 1);
		if (managed) {
			h.rotate(ev, 2);
			assert.equal(h.calls.length, 1);
			h.replaceCapability({ ...saved!, signal: new AbortController().signal });
			assert.equal(h.calls.length, 1);
		}
		h.rotate(ev, -1);
		assert.equal(h.calls[1]!.snapshot.route, "brightness/49");
		await h.settle(1);
	}
});

test("independent visible dials use individual initial targets and at most one raw flight each", async () => {
	const h = await harness();
	const a = await h.appear("a", 10);
	const b = await h.appear("b", 75);
	h.rotate(a, 1);
	h.rotate(b, -1);
	h.rotate(a, 2);
	h.rotate(b, -3);
	assert.deepEqual(
		h.calls.map((call) => call.snapshot.route),
		["brightness/11", "brightness/74"],
	);
	await h.settle(1);
	assert.equal(h.calls[2]!.snapshot.route, "brightness/71");
	await h.settle(0);
	assert.equal(h.calls[3]!.snapshot.route, "brightness/13");
	await h.settle(2);
	await h.settle(3);
});

test("host feedback failures do not reject appearance or cause command retries", async () => {
	for (const synchronous of [false, true]) {
		const h = await harness();
		const ev = h.event();
		ev.action.setFeedback = () => {
			if (synchronous) throw new Error("synthetic host loss");
			return Promise.reject(new Error("synthetic host loss"));
		};
		await h.action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		h.rotate(ev, 1);
		await h.settle(0);
		assert.equal(h.calls.length, 1);
	}
});

test("Brightness Keypad path keeps its assigned value and user-facing key methods", async () => {
	const h = await harness();
	const key = new KeyFacade();
	const ev = {
		action: { id: "key", isKey: () => true, ...key },
		payload: { settings: { schemaVersion: 1, percent: 25 } },
	};
	await h.action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	const completion = h.action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
	assert.equal(h.calls[0]!.snapshot.route, "brightness/25");
	await h.settle(0);
	await completion;
	assert.equal(h.calls.length, 1);
	assert.equal(h.storage.actions.size, 0);
});

test("disappearance during the appearance callback cannot reinsert a stale dial", async () => {
	const h = await harness();
	const ev = h.event();
	const appearing = h.action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
	h.disappear(ev);
	await appearing;
	h.rotate(ev, 1);
	assert.equal(h.calls.length, 0);
});

test("a rejected raw client promise clears its coalesced target without a replay", async () => {
	const h = await harness();
	const ev = await h.appear();
	let calls = 0;
	h.client.command = async () => {
		calls++;
		throw new Error("synthetic transport loss");
	};
	h.rotate(ev, 1);
	h.rotate(ev, 10);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(calls, 1);
	assert.equal(h.operations.get("dial")!.status, "unknown");
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Unknown/);
});

test("unready rotation stays blocked and recovery requires a fresh physical gesture", async () => {
	const h = await harness(true);
	const saved = h.capability();
	h.replaceCapability(null);
	const ev = await h.appear();
	h.rotate(ev, 25);
	assert.equal(h.calls.length, 0);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Not ready/);
	h.replaceCapability(saved);
	assert.equal(h.calls.length, 0);
	h.rotate(ev, 1);
	assert.equal(h.calls[0]!.snapshot.route, "brightness/51");
	await h.settle(0);
});

test("a pending operation in the same context prevents another request without queued replay", async () => {
	const h = await harness();
	const ev = await h.appear();
	const existing = h.operations.acquire({
		context: "dial",
		actionKind: "brightness",
		settingsRevision: h.settings.revision("dial"),
		connectionRevision: h.settings.connectionRevision,
		snapshot: { route: "brightness/50", connection: h.settings.getConnection()! },
	});
	assert.ok(existing);
	h.rotate(ev, 1);
	assert.equal(h.calls.length, 0);
	h.operations.finish(existing, { status: "sent" });
	assert.equal(h.calls.length, 0);
	h.rotate(ev, 1);
	assert.equal(h.calls[0]!.snapshot.route, "brightness/52");
	await h.settle(0);
});

test("dial-down sends one explicit Off, preserves target and an outward maximum turn reactivates brightness", async () => {
	const h = await harness();
	const ev = await h.appear("dial", 100);
	h.press(ev);
	assert.equal(h.calls.length, 1);
	assert.equal(h.calls[0]!.snapshot.route, "off");
	assert.equal(h.calls[0]!.actionKind, "off");
	assert.equal(h.action.onDialUp, undefined);
	assert.equal(h.action.onTouchTap, undefined);
	h.press(ev);
	h.rotate(ev, 1);
	assert.equal(h.calls.length, 1);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "100%");
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Sending Off/);
	await h.settle(0);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Off sent/);
	h.rotate(ev, 1);
	assert.equal(h.calls[1]!.snapshot.route, "brightness/100");
	await h.settle(1);
	assert.equal(h.settings.getAction("dial").percent, 100);
	assert.equal(h.storage.actions.size, 0);
	assert.ok(!JSON.stringify([...h.views.values(), h.diagnostics]).includes(syntheticToken));
});

test("idle outward rotations reapply both clamped limits without changing the target", async () => {
	for (const [target, ticks] of [
		[100, 1],
		[0, -1],
	] as const) {
		const h = await harness();
		const ev = await h.appear("dial", target);
		for (let n = 0; n < 2; n++) {
			h.rotate(ev, ticks);
			assert.equal(h.calls[n]!.snapshot.route, `brightness/${target}`);
			await h.settle(n);
		}
		assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, `${target}%`);
	}
});

test("boundary gestures retain one reapplication behind an equal raw flight", async () => {
	for (const [initial, ticks, target] of [
		[99, 1, 100],
		[1, -1, 0],
	] as const) {
		const h = await harness();
		const ev = await h.appear("dial", initial);
		h.rotate(ev, ticks);
		for (let n = 0; n < 25; n++) h.rotate(ev, ticks);
		assert.equal(h.calls.length, 1);
		await h.settle(0);
		assert.deepEqual(
			h.calls.map((r) => r.snapshot.route),
			[`brightness/${target}`, `brightness/${target}`],
		);
		await h.settle(1);
		assert.equal(h.calls.length, 2);
	}
});

test("press replaces queued brightness and Off has priority over repeated presses and turns", async () => {
	const h = await harness();
	const ev = await h.appear();
	h.rotate(ev, 1);
	h.rotate(ev, 9);
	h.press(ev);
	for (let n = 0; n < 10; n++) {
		h.rotate(ev, 1);
		h.press(ev);
	}
	assert.equal(h.calls.length, 1);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "60%");
	await h.settle(0);
	assert.deepEqual(
		h.calls.map((r) => r.snapshot.route),
		["brightness/51", "off"],
	);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Sending Off/);
	assert.equal(
		h.views.get("dial")!.some((v) => String(v.title).includes("Off sent")),
		false,
	);
	h.rotate(ev, -20);
	h.press(ev);
	assert.equal(h.calls.length, 2);
	await h.settle(1);
	assert.equal(h.calls.length, 2);
	h.rotate(ev, 1);
	assert.equal(h.calls[2]!.snapshot.route, "brightness/61");
	await h.settle(2);
});

test("failed or unknown brightness drops a queued Off without replay", async () => {
	for (const status of ["rejected", "unknown"] as const) {
		const h = await harness();
		const ev = await h.appear();
		h.rotate(ev, 1);
		h.press(ev);
		await h.settle(0, { status, errorCategory: "backend" });
		assert.equal(h.calls.length, 1);
		assert.match(String(h.views.get("dial")!.at(-1)!.title), status === "unknown" ? /Unknown/ : /Rejected/);
		h.press(ev);
		assert.equal(h.calls[1]!.snapshot.route, "off");
		await h.settle(1);
	}
});

test("timed-out brightness or Off keeps its raw fence and drops queued Off until a fresh press", async () => {
	for (const initial of ["brightness", "off"] as const) {
		const h = await harness();
		const ev = await h.appear();
		if (initial === "brightness") {
			h.rotate(ev, 1);
			h.press(ev);
		} else h.press(ev);
		h.clock.advance(45000);
		h.press(ev);
		h.rotate(ev, 1);
		assert.equal(h.calls.length, 1);
		await h.settle(0);
		assert.equal(h.calls.length, 1);
		assert.match(String(h.views.get("dial")!.at(-1)!.title), /Unknown/);
		h.press(ev);
		assert.equal(h.calls[1]!.snapshot.route, "off");
		await h.settle(1);
	}
});

test("queued and in-flight Off cannot replay across appearance, assignment, connection or capability changes", async () => {
	for (const mode of ["queued", "inflight"] as const) {
		for (const change of ["appearance", "assignment", "connection", "capability"] as const) {
			const h = await harness(change === "capability");
			let ev = await h.appear();
			if (mode === "queued") h.rotate(ev, 1);
			h.press(ev);
			const saved = h.capability();
			if (change === "appearance") {
				h.disappear(ev);
				ev = await h.appear();
			} else if (change === "assignment") await h.settings.saveAction("dial", { schemaVersion: 1, percent: 70 });
			else if (change === "connection") await h.settings.saveConnection(18767);
			else h.replaceCapability(null);
			h.press(ev);
			assert.equal(h.calls.length, 1);
			await h.settle(0);
			assert.equal(h.calls.length, 1);
			if (change === "capability") h.replaceCapability({ ...saved!, signal: new AbortController().signal });
			assert.equal(h.calls.length, 1);
			h.press(ev);
			assert.equal(h.calls[1]!.snapshot.route, "off");
			await h.settle(1);
		}
	}
});

test("unready presses stay blocked and Off feedback is localized without claiming physical state", async () => {
	const h = await harness(true);
	const saved = h.capability();
	h.replaceCapability(null);
	const ev = await h.appear();
	h.press(ev);
	assert.equal(h.calls.length, 0);
	h.replaceCapability({ ...saved!, signal: new AbortController().signal });
	assert.equal(h.calls.length, 0);
	await h.settings.saveLanguage("ru");
	h.press(ev);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Отправка Off/);
	await h.settle(0);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Off отправлено/);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "50%");
});

test("press cannot queue behind an untracked pending operation in the reused context", async () => {
	const h = await harness();
	const ev = await h.appear();
	const existing = h.operations.acquire({
		context: "dial",
		actionKind: "brightness",
		settingsRevision: h.settings.revision("dial"),
		connectionRevision: h.settings.connectionRevision,
		snapshot: { route: "brightness/50", connection: h.settings.getConnection()! },
	})!;
	h.press(ev);
	assert.equal(h.calls.length, 0);
	assert.match(String(h.views.get("dial")!.at(-1)!.title), /Rejected/);
	h.operations.finish(existing, { status: "sent" });
	assert.equal(h.calls.length, 0);
	h.press(ev);
	assert.equal(h.calls[0]!.snapshot.route, "off");
	await h.settle(0);
});

test("a separate Off key during a held brightness reply cannot suppress a later return to the maximum", async () => {
	const h = await harness();
	const ev = await h.appear("dial", 99);
	h.rotate(ev, 1);
	const key = new KeyFacade();
	const keyEvent = { action: { id: "off-key", isKey: () => true, ...key }, payload: { settings: {} } };
	const off = new PowerOff(h.services);
	await off.onWillAppear(keyEvent as unknown as WillAppearEvent<Assignment>);
	const offCompletion = off.onKeyDown(keyEvent as unknown as KeyDownEvent<Assignment>);
	assert.deepEqual(
		h.calls.map((r) => r.snapshot.route),
		["brightness/100", "off"],
	);
	await h.settle(1);
	await offCompletion;
	h.rotate(ev, -1);
	h.rotate(ev, 1);
	assert.equal(h.calls.length, 2);
	await h.settle(0);
	assert.deepEqual(
		h.calls.map((r) => r.snapshot.route),
		["brightness/100", "off", "brightness/100"],
	);
	await h.settle(2);
});

test("dial feedback separates a compact prominent percentage from localized status", async () => {
	const h = await harness();
	const ev = await h.appear("dial", 100);
	assert.deepEqual(h.views.get("dial")!.at(-1)!.value, {
		value: "100%",
		font: { size: 28, weight: 600 },
		alignment: "center",
	});
	assert.equal(h.views.get("dial")!.at(-1)!.title, "Brightness");
	h.press(ev);
	await h.settle(0);
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "100%");
	assert.equal(h.views.get("dial")!.at(-1)!.title, "Off sent");
	await h.settings.saveLanguage("ru");
	assert.equal((h.views.get("dial")!.at(-1)!.value as { value: string }).value, "100%");
	assert.equal(h.views.get("dial")!.at(-1)!.title, "Off отправлено");
});
