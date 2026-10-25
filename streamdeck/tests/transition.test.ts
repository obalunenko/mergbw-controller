import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Transition } from "../src/actions/transition.js";
import { BridgeClient, type ReadResult, type TransitionEnvelope, transitionSnapshot } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController, type InspectorReply, parseMessage } from "../src/inspector-messages.js";
import type { Capability, ManagedController } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { assignment, type Assignment } from "../src/validation.js";
import { deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const target = {
	schemaVersion: 1 as const,
	fromRGB: "FF5000",
	fromPercent: 100,
	toRGB: "112233",
	toPercent: 0,
	durationSeconds: 30,
};
const route = "transition/FF5000/100/112233/0/30";
const job = {
	id: "a".repeat(32),
	state: "running" as const,
	elapsedMs: 0,
	durationMs: 30000,
	physical_state_verified: false as const,
};
const envelope = { transition: job, physical_state_verified: false as const };
const accepted = { accepted: true, action: route, ...envelope };
const message = (type: string, payload: Record<string, unknown> = {}, sessionId = "session") => ({
	v: 2,
	sessionId,
	requestId: randomUUID(),
	type,
	payload,
});

test("transition assignment has explicit defaults and strips secret/path fields", () => {
	assert.deepEqual(assignment("transition", {}), { ...target, toRGB: "FF5000" });
	assert.deepEqual(
		assignment("transition", {
			...target,
			fromRGB: "ff5000",
			toRGB: "112233",
			token: syntheticToken,
			path: "/private/example",
		}),
		target,
	);
	for (const seconds of [1, 60])
		assert.equal(assignment("transition", { ...target, durationSeconds: seconds }).durationSeconds, seconds);
	for (const durationSeconds of [0, 61, 3600, 1.5, "30", NaN, Infinity, undefined])
		assert.throws(() => assignment("transition", { ...target, durationSeconds }));
	for (const field of ["fromPercent", "toPercent"])
		for (const value of [-1, 101, 0.5, "50", null])
			assert.throws(() => assignment("transition", { ...target, [field]: value }));
	for (const field of ["fromRGB", "toRGB"])
		for (const value of ["#FF5000", "FFF", "GG0000", "", null])
			assert.throws(() => assignment("transition", { ...target, [field]: value }));
});

test("transition snapshots reject unknown fields, out-of-range duration/progress, IDs and physical claims", () => {
	assert.ok(transitionSnapshot(job));
	for (const bad of [
		null,
		{ ...job, token: syntheticToken },
		{ ...job, physical_state_verified: true },
		{ ...job, id: "bad" },
		{ ...job, state: "sent" },
		{ ...job, elapsedMs: -1 },
		{ ...job, elapsedMs: 30001 },
		{ ...job, durationMs: 61000 },
		{ ...job, durationMs: 1500 },
	])
		assert.equal(transitionSnapshot(bad), false);
	assert.equal(transitionSnapshot({ ...job, id: "a".repeat(32) }, "a".repeat(24)), false);
});

test("actual Transition key accepts strict 202 without reporting sent/completed or persisting credentials", async () => {
	const requests: { method?: string; url?: string }[] = [];
	const server = await fixture((req, res) => {
		requests.push({ method: req.method, url: req.url });
		res.writeHead(202, { "Content-Type": "application/json" });
		res.end(JSON.stringify(accepted));
	});
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const operations = new OperationStore();
	const client = new BridgeClient();
	const inspector = new InspectorController(settings, operations, client, () => {});
	const logs: unknown[] = [];
	const action = new Transition({
		settings,
		operations,
		client,
		inspector,
		diagnostics: new Diagnostics((value) => logs.push(value)),
	});
	const key = new KeyFacade();
	const ev = { action: { id: "transition-key", isKey: () => true, ...key }, payload: { settings: target } };
	try {
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		assert.equal(requests.length, 0);
		await settings.saveAction("transition-key", { ...target, token: syntheticToken });
		assert.deepEqual(storage.actions.get("transition-key"), target);
		assert.equal(requests.length, 0);
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.deepEqual(requests, [{ method: "POST", url: `/${syntheticToken}/${route}` }]);
		assert.equal(operations.get("transition-key")?.status, "accepted");
		assert.equal(operations.get("transition-key")?.transition?.id, job.id);
		assert.equal(key.oks, 0);
		assert.ok(key.titles.some((title) => String(title).includes("accepted")));
		assert.equal(JSON.stringify(logs).includes(syntheticToken), false);
		assert.equal(JSON.stringify(logs).includes("http://"), false);
	} finally {
		inspector.dispose();
		await server.close();
	}
});

test("legacy sent response, malformed acceptance and lost response remain unknown without retry", async () => {
	for (const reply of [
		{ status: 200, value: { sent: true, action: route, physical_state_verified: false } },
		{ status: 202, value: { ...accepted, transition: { ...job, durationMs: 61000 } } },
		{ status: 202, value: { ...accepted, accepted: false } },
		{ status: 202, value: { ...accepted, transition: { ...job, durationMs: 1000 } } },
		{ status: 202, value: { ...accepted, token: syntheticToken } },
		{ status: 202, value: null },
	]) {
		let requests = 0;
		const server = await fixture((_req, res) => {
			requests++;
			res.writeHead(reply.status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(reply.value));
		});
		const ops = new OperationStore();
		const record = ops.acquire({
			context: "a",
			actionKind: "transition",
			settingsRevision: 0,
			connectionRevision: 0,
			snapshot: { route, connection: { port: server.port, accessToken: syntheticToken } },
		})!;
		try {
			const result = await new BridgeClient().command(record);
			assert.equal(result.status, "unknown");
			ops.finish(record, result);
			assert.equal(requests, 1);
		} finally {
			await server.close();
		}
	}
	let calls = 0;
	const server = await fixture((_req, res) => {
		calls++;
		res.destroy();
	});
	const ops = new OperationStore();
	const record = ops.acquire({
		context: "a",
		actionKind: "transition",
		settingsRevision: 0,
		connectionRevision: 0,
		snapshot: { route, connection: { port: server.port, accessToken: syntheticToken } },
	})!;
	try {
		const result = await new BridgeClient().command(record);
		assert.equal(result.status, "unknown");
		ops.finish(record, result);
		assert.equal(calls, 1);
	} finally {
		await server.close();
	}
});

test("invalid transition routes reject before transport, including 0/61 seconds and query/path escape", async () => {
	let calls = 0;
	const server = await fixture((_req, res) => {
		calls++;
		res.end();
	});
	try {
		for (const invalid of [
			route.replace("/30", "/0"),
			route.replace("/30", "/61"),
			route + "?secret",
			route + "/extra",
			route.replace("FF5000", "ff5000"),
			route.replace("/100/", "/101/"),
		]) {
			const ops = new OperationStore();
			const record = ops.acquire({
				context: "a",
				actionKind: "transition",
				settingsRevision: 0,
				connectionRevision: 0,
				snapshot: { route: invalid, connection: { port: server.port, accessToken: syntheticToken } },
			})!;
			const result = await new BridgeClient().command(record);
			assert.equal(result.status, "rejected");
			ops.finish(record, result);
		}
		assert.equal(calls, 0);
	} finally {
		await server.close();
	}
});

test("status is GET and cancellation is POST for the exact validated job ID", async () => {
	const calls: string[] = [];
	let cancelled = false;
	const server = await fixture((req, res) => {
		calls.push(`${req.method} ${req.url}`);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ...envelope, transition: cancelled ? { ...job, state: "cancelled" } : job }));
	});
	const client = new BridgeClient();
	const connection = { port: server.port, accessToken: syntheticToken };
	try {
		assert.equal((await client.transition(connection)).value?.transition?.state, "running");
		cancelled = true;
		assert.equal((await client.cancelTransition(connection, job.id)).value?.transition?.state, "cancelled");
		assert.equal((await client.cancelTransition(connection, "../on")).errorCategory, "validation");
		assert.deepEqual(calls, [
			`GET /${syntheticToken}/transition`,
			`POST /${syntheticToken}/transition/cancel/${job.id}`,
		]);
	} finally {
		await server.close();
	}
});

test("cancel cannot treat another job, null status, or timeout as confirmed cancellation", async () => {
	for (const value of [
		{ ...envelope, transition: null },
		{ ...envelope, transition: { ...job, id: "b".repeat(32) } },
	]) {
		const server = await fixture((_req, res) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(value));
		});
		try {
			const result = await new BridgeClient().cancelTransition(
				{ port: server.port, accessToken: syntheticToken },
				job.id,
			);
			assert.equal(result.value, undefined);
			assert.equal(result.errorCategory, "protocol");
		} finally {
			await server.close();
		}
	}
	const server = await fixture((_req, res) => {
		res.writeHead(504, { "Content-Type": "application/json" });
		res.end("{}");
	});
	try {
		assert.equal(
			(await new BridgeClient().cancelTransition({ port: server.port, accessToken: syntheticToken }, job.id))
				.errorCategory,
			"timeout",
		);
	} finally {
		await server.close();
	}
});

test("managed status/cancel rejects provisional-only callers without any transport", async () => {
	const client = new BridgeClient();
	client.useManaged(
		() => false,
		() => true,
	);
	const connection = { port: 18766, accessToken: syntheticToken };
	assert.equal((await client.transition(connection)).errorCategory, "service");
	assert.equal((await client.cancelTransition(connection, job.id)).errorCategory, "service");
});

async function panel() {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	settings.receiveAction("a", "transition", target);
	const client = new BridgeClient();
	const operations = new OperationStore();
	const replies: InspectorReply[] = [];
	const pi = new InspectorController(settings, operations, client, (reply) => {
		replies.push(reply);
	});
	await pi.receive("a", message("inspector.get"));
	return { settings, client, operations, replies, pi };
}

test("PI status/cancel requires a checked current ID and never starts an action on get/save/check", async () => {
	const h = await panel();
	let starts = 0,
		reads = 0,
		cancels = 0;
	h.client.command = async () => {
		starts++;
		return { status: "accepted" };
	};
	h.client.transition = async () => {
		reads++;
		return { value: envelope };
	};
	h.client.cancelTransition = async (_connection, id) => {
		assert.equal(id, job.id);
		cancels++;
		return { value: { ...envelope, transition: { ...job, state: "cancelled" } } };
	};
	try {
		await h.pi.receive("a", message("assignment.save", { settings: target }));
		assert.equal(starts, 0);
		assert.equal(reads, 0);
		await h.pi.receive("a", message("transition.cancel", { id: job.id }));
		assert.equal(cancels, 0);
		await h.pi.receive("a", message("transition.status"));
		assert.equal(reads, 1);
		assert.equal(h.replies.at(-1)?.snapshot?.transition?.id, job.id);
		const cancel = message("transition.cancel", { id: job.id });
		await h.pi.receive("a", cancel);
		await h.pi.receive("a", cancel);
		assert.equal(cancels, 1);
		assert.equal(starts, 0);
		assert.equal(h.replies.at(-1)?.snapshot?.transition?.state, "cancelled");
		assert.equal(JSON.stringify(h.replies).includes(syntheticToken), false);
		assert.throws(() => parseMessage("a", message("transition.cancel", { id: "bad" })));
	} finally {
		h.pi.dispose();
	}
});

test("PI closing/reopening and connection changes discard late status and retain raw-request fence", async () => {
	for (const change of ["session", "connection"] as const) {
		const h = await panel();
		const pending = deferred<ReadResult<TransitionEnvelope>>();
		let reads = 0;
		h.client.transition = () => {
			reads++;
			return pending.promise;
		};
		try {
			const checking = h.pi.receive("a", message("transition.status"));
			if (change === "session") {
				h.pi.close("a");
				await h.pi.receive("a", message("inspector.get", {}, "new-session"));
				await h.pi.receive("a", message("transition.status", {}, "new-session"));
			} else await h.settings.saveConnection(18767);
			assert.equal(reads, 1);
			pending.resolve({ value: envelope });
			await checking;
			assert.equal(h.pi.snapshot("a").transition, undefined);
			assert.equal(h.replies.at(-1)?.snapshot?.transitionPending, false);
		} finally {
			h.pi.dispose();
		}
	}
});

test("PI full-capability guard drops late snapshots after runtime invalidation", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	settings.receiveAction("a", "on", {});
	let cap: Capability | null = {
		session: "session",
		configurationGeneration: "a".repeat(32),
		launchId: "b".repeat(32),
		connection: { port: 18766, accessToken: syntheticToken },
		signal: new AbortController().signal,
	};
	settings.useManaged(() => cap?.connection ?? null);
	const callbacks = new Set<() => void>();
	const runtime = {
		subscribe: (fn: () => void) => {
			callbacks.add(fn);
			return () => callbacks.delete(fn);
		},
		managementSession: () => "session",
		capability: () => cap,
		current: (value: Capability) => cap === value,
		active: { configured: true },
		state: "ready",
		bluetooth: "connected",
		activeStateKnown: true,
	} as unknown as ManagedController;
	const client = new BridgeClient();
	const pending = deferred<ReadResult<TransitionEnvelope>>();
	client.transition = () => pending.promise;
	const pi = new InspectorController(settings, new OperationStore(), client, () => {}, undefined, runtime);
	try {
		await pi.receive("a", message("inspector.get"));
		const checking = pi.receive("a", message("transition.status"));
		cap = null;
		settings.runtimeChanged();
		for (const fn of callbacks) fn();
		pending.resolve({ value: envelope });
		await checking;
		assert.equal(pi.snapshot("a").transition, undefined);
	} finally {
		pi.dispose();
	}
});

test("transition start validates one and sixty second acknowledgements against the requested duration", async () => {
	for (const seconds of [1, 60]) {
		const action = route.slice(0, -2) + seconds;
		const server = await fixture((_req, res) => {
			res.writeHead(202, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ...accepted, action, transition: { ...job, durationMs: seconds * 1000 } }));
		});
		const ops = new OperationStore();
		const record = ops.acquire({
			context: "a",
			actionKind: "transition",
			settingsRevision: 0,
			connectionRevision: 0,
			snapshot: { route: action, connection: { port: server.port, accessToken: syntheticToken } },
		})!;
		try {
			const result = await new BridgeClient().command(record);
			assert.equal(result.status, "accepted");
			ops.finish(record, result);
		} finally {
			await server.close();
		}
	}
});

test("a new lighting operation invalidates an earlier pending transition observation", async () => {
	const h = await panel();
	const pending = deferred<ReadResult<TransitionEnvelope>>();
	h.client.transition = () => pending.promise;
	try {
		const checking = h.pi.receive("a", message("transition.status"));
		const record = h.operations.acquire({
			context: "a",
			actionKind: "transition",
			settingsRevision: h.settings.revision("a"),
			connectionRevision: h.settings.connectionRevision,
			snapshot: { route, connection: h.settings.getConnection()! },
		})!;
		pending.resolve({ value: envelope });
		await checking;
		assert.equal(h.pi.snapshot("a").transition, undefined);
		h.operations.finish(record, { status: "accepted" });
	} finally {
		h.pi.dispose();
	}
});

test("obsolete admission and late acceptance cannot erase a fresh checked transition", async () => {
	const h = await panel();
	h.client.transition = async () => ({ value: envelope });
	try {
		await h.pi.receive("a", message("transition.status"));
		assert.equal(h.pi.snapshot("a").transition?.id, job.id);
		const record = h.operations.acquire({
			context: "a",
			actionKind: "transition",
			settingsRevision: h.settings.revision("a"),
			connectionRevision: h.settings.connectionRevision - 1,
			snapshot: { route, connection: h.settings.getConnection()! },
		})!;
		assert.equal(h.pi.snapshot("a").transition?.id, job.id);
		h.operations.finish(record, { status: "accepted" });
		assert.equal(h.pi.snapshot("a").transition?.id, job.id);
	} finally {
		h.pi.dispose();
	}
});

test("accepted transition enables panel cancel without a status check, including PI reopen", async () => {
	const h = await panel();
	let reads = 0,
		cancels = 0;
	h.client.command = async () => ({ status: "accepted", transition: { ...job } });
	h.client.transition = async () => {
		reads++;
		return { value: envelope };
	};
	h.client.cancelTransition = async (_connection, id) => {
		assert.equal(id, job.id);
		cancels++;
		return { value: { ...envelope, transition: { ...job, state: "cancelled" } } };
	};
	const action = new Transition({
		settings: h.settings,
		operations: h.operations,
		client: h.client,
		inspector: h.pi,
		diagnostics: new Diagnostics(() => {}),
	});
	const key = new KeyFacade();
	const ev = { action: { id: "a", isKey: () => true, ...key }, payload: { settings: target } };
	try {
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(h.pi.snapshot("a").transition?.id, job.id);
		h.pi.close("a");
		await h.pi.receive("a", message("inspector.get", {}, "reopened"));
		assert.equal(h.pi.snapshot("a").transition?.state, "running");
		await h.pi.receive("a", message("transition.cancel", { id: job.id }, "reopened"));
		assert.equal(reads, 0);
		assert.equal(cancels, 1);
		assert.equal(h.pi.snapshot("a").transition?.state, "cancelled");
		assert.equal(JSON.stringify(h.replies).includes(syntheticToken), false);
	} finally {
		h.pi.dispose();
	}
});

test("late accepted job cannot restore cancellation after a newer lighting admission or settings change", async () => {
	for (const change of ["operation", "assignment", "connection"] as const) {
		const h = await panel();
		h.operations.appear("a");
		try {
			const record = h.operations.acquire({
				context: "a",
				actionKind: "transition",
				settingsRevision: h.settings.revision("a"),
				connectionRevision: h.settings.connectionRevision,
				snapshot: { route, connection: h.settings.getConnection()! },
			})!;
			if (change === "operation") {
				h.settings.receiveAction("b", "brightness", {});
				const newer = h.operations.acquire({
					context: "b",
					actionKind: "brightness",
					settingsRevision: h.settings.revision("b"),
					connectionRevision: h.settings.connectionRevision,
					snapshot: { route: "brightness/75", connection: h.settings.getConnection()! },
				})!;
				h.operations.finish(newer, { status: "sent" });
			} else if (change === "assignment") await h.settings.saveAction("a", { ...target, durationSeconds: 10 });
			else await h.settings.saveConnection(18767);
			h.operations.finish(record, { status: "accepted", transition: { ...job } });
			assert.equal(h.pi.snapshot("a").transition, undefined);
		} finally {
			h.pi.dispose();
		}
	}
});

test("accepted job fences a pending old status while retaining a newer checked snapshot of the same job", async () => {
	for (const checkedFirst of [false, true]) {
		const h = await panel();
		h.operations.appear("a");
		const pending = deferred<ReadResult<TransitionEnvelope>>();
		h.client.transition = () => pending.promise;
		try {
			const record = h.operations.acquire({
				context: "a",
				actionKind: "transition",
				settingsRevision: h.settings.revision("a"),
				connectionRevision: h.settings.connectionRevision,
				snapshot: { route, connection: h.settings.getConnection()! },
			})!;
			const checking = h.pi.receive("a", message("transition.status"));
			if (checkedFirst) {
				pending.resolve({ value: { ...envelope, transition: { ...job, elapsedMs: 500 } } });
				await checking;
			}
			h.operations.finish(record, { status: "accepted", transition: { ...job } });
			if (!checkedFirst) {
				pending.resolve({ value: { ...envelope, transition: null } });
				await checking;
			}
			assert.equal(h.pi.snapshot("a").transition?.id, job.id);
			assert.equal(h.pi.snapshot("a").transition?.elapsedMs, checkedFirst ? 500 : 0);
		} finally {
			h.pi.dispose();
		}
	}
});
