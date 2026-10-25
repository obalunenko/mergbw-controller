import type { KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Preset } from "../src/actions/preset.js";
import { BridgeClient, type ReadResult } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import type { Capability, ManagedController } from "../src/managed-controller.js";
import { type OperationRecord, type OperationResult, OperationStore } from "../src/operation-store.js";
import type { EffectEnvelope, EffectSnapshot } from "../src/preset-effects.js";
import { Settings } from "../src/settings.js";
import { type Assignment } from "../src/validation.js";
import { ControlledClock, deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const target = { schemaVersion: 1 as const, presetId: "evening" };
const job: EffectSnapshot = {
	id: "a".repeat(32),
	presetId: "evening",
	kind: "palette",
	state: "running",
	elapsedMs: 0,
	durationMs: null,
	physical_state_verified: false,
};
const envelope = (effect: EffectSnapshot | null): ReadResult<EffectEnvelope> => ({
	statusCode: 200,
	value: { effect: effect ? { ...effect } : null, physical_state_verified: false },
});

async function harness(runtime?: ManagedController) {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	const clock = new ControlledClock();
	const operations = new OperationStore(clock);
	const client = new BridgeClient(clock);
	const inspector = new InspectorController(settings, operations, client, () => {});
	const logs: unknown[] = [];
	const diagnostics = new Diagnostics((value) => logs.push(value));
	const calls = { starts: [] as OperationRecord[], reads: 0, stops: [] as string[] };
	client.command = async (record) => {
		calls.starts.push(record);
		return { status: "accepted", effect: { ...job } };
	};
	client.effect = async () => {
		calls.reads++;
		return envelope(job);
	};
	client.cancelEffect = async (_connection, id) => {
		calls.stops.push(id);
		return envelope({ ...job, state: "cancelled" });
	};
	const action = new Preset({ settings, operations, client, inspector, diagnostics, runtime });
	const appear = async (context = "a", assignment: Assignment = target) => {
		const key = new KeyFacade();
		const event = { action: { id: context, isKey: () => true, ...key }, payload: { settings: assignment } };
		await action.onWillAppear(event as unknown as WillAppearEvent<Assignment>);
		return {
			key,
			down: () => action.onKeyDown(event as unknown as KeyDownEvent<Assignment>),
			hide: () => action.onWillDisappear(event as unknown as WillDisappearEvent<Assignment>),
		};
	};
	return { storage, settings, clock, operations, client, inspector, diagnostics, logs, calls, action, appear };
}

test("preset first press admits each selected mode without a preliminary status read", async () => {
	for (const kind of ["palette", "strobe", "breathing", "candle"] as const) {
		const h = await harness();
		h.client.command = async (record) => {
			h.calls.starts.push(record);
			return { status: "accepted", effect: { ...job, kind } };
		};
		try {
			const a = await h.appear();
			await a.down();
			assert.equal(h.calls.starts.length, 1);
			assert.equal(h.calls.reads, 0);
			assert.deepEqual(h.calls.stops, []);
			assert.equal(h.operations.get("a")?.effect?.kind, kind);
			assert.equal(h.operations.get("a")?.status, "accepted");
			assert.equal(a.key.oks, 0);
		} finally {
			h.inspector.dispose();
		}
	}
});

test("repeat press reads then stops exact owned ID across disappear and reappear", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		await a.down();
		a.hide();
		assert.equal(h.operations.get("a"), undefined);
		const again = await h.appear();
		await again.down();
		assert.equal(h.calls.reads, 1);
		assert.deepEqual(h.calls.stops, [job.id]);
		assert.equal(h.calls.starts.length, 1);
		assert.equal(h.inspector.snapshot("a").effect?.state, "cancelled");
		assert.equal(h.operations.get("a")?.status, "accepted");
		await h.settings.saveAction("a", { ...target, effect: job, runId: job.id });
		assert.deepEqual(h.storage.actions.get("a"), target);
		assert.equal(JSON.stringify(h.storage.global).includes(job.id), false);
		assert.equal(JSON.stringify(h.logs).includes(syntheticToken), false);
	} finally {
		h.inspector.dispose();
	}
});

test("a completed owned run permits a fresh explicit start", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		await a.down();
		h.client.effect = async () => {
			h.calls.reads++;
			return envelope({ ...job, state: "completed", durationMs: 2000, elapsedMs: 2500 });
		};
		await a.down();
		assert.equal(h.calls.reads, 1);
		assert.equal(h.calls.starts.length, 2);
		assert.deepEqual(h.calls.stops, []);
	} finally {
		h.inspector.dispose();
	}
});

test("static presets keep one normal command per press without effect status or stop", async () => {
	const h = await harness();
	try {
		h.client.command = async (record) => {
			h.calls.starts.push(record);
			return { status: "sent" };
		};
		const a = await h.appear();
		await a.down();
		await a.down();
		a.hide();
		const again = await h.appear();
		await again.down();
		assert.equal(h.calls.starts.length, 3);
		assert.equal(h.calls.reads, 0);
		assert.deepEqual(h.calls.stops, []);
		assert.equal(h.operations.get("a")?.status, "sent");
	} finally {
		h.inspector.dispose();
	}
});

test("a mismatched or missing current run never triggers speculative stop or start", async () => {
	for (const value of [null, { ...job, id: "b".repeat(32) }, { ...job, presetId: "another" }]) {
		const h = await harness();
		try {
			const a = await h.appear();
			await a.down();
			h.client.effect = async () => envelope(value);
			await a.down();
			assert.equal(h.calls.starts.length, 1);
			assert.deepEqual(h.calls.stops, []);
			assert.equal(h.operations.get("a")?.status, "rejected");
		} finally {
			h.inspector.dispose();
		}
	}
});

test("failed status read preserves guarded ownership for an explicit read retry", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		await a.down();
		h.client.effect = async () => ({ errorCategory: "timeout" });
		await a.down();
		assert.equal(h.calls.starts.length, 1);
		assert.deepEqual(h.calls.stops, []);
		assert.equal(h.operations.get("a")?.status, "unknown");
		h.client.effect = async () => envelope(job);
		await a.down();
		assert.deepEqual(h.calls.stops, [job.id]);
		assert.equal(h.calls.starts.length, 1);
	} finally {
		h.inspector.dispose();
	}
});

test("unknown start receipt grants no ownership or blind repeat command", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		h.client.command = async (record) => {
			h.calls.starts.push(record);
			return { status: "unknown", errorCategory: "timeout" };
		};
		await a.down();
		await a.down();
		await a.down();
		assert.equal(h.calls.starts.length, 1);
		assert.equal(h.calls.reads, 2);
		assert.deepEqual(h.calls.stops, []);
		assert.equal(h.inspector.snapshot("a").effect?.id, job.id, "inspector can offer explicit exact-ID Stop");
	} finally {
		h.inspector.dispose();
	}
});

test("unknown admission followed by no run is checked without starting on that press", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		h.client.command = async (record) => {
			h.calls.starts.push(record);
			return { status: "unknown", errorCategory: "protocol" };
		};
		await a.down();
		h.client.effect = async () => envelope(null);
		await a.down();
		assert.equal(h.calls.starts.length, 1);
		assert.deepEqual(h.calls.stops, []);
		await a.down();
		assert.equal(h.calls.starts.length, 2, "a later deliberate press can start again");
	} finally {
		h.inspector.dispose();
	}
});

test("a different terminal effect resolves unknown admission without trapping the key", async () => {
	for (const state of ["completed", "cancelled", "failed", "unknown"] as const) {
		const h = await harness();
		try {
			const a = await h.appear();
			h.client.command = async (record) => {
				h.calls.starts.push(record);
				return { status: "unknown", errorCategory: "timeout" };
			};
			await a.down();
			h.client.effect = async () => envelope({ ...job, id: "b".repeat(32), presetId: "external", state });
			await a.down();
			assert.equal(h.calls.starts.length, 1, `${state}: resolving press stays read-only`);
			assert.deepEqual(h.calls.stops, [], state);
			await a.down();
			assert.equal(h.calls.starts.length, 2, `${state}: next explicit press can start the selected preset`);
			assert.deepEqual(h.calls.stops, [], state);
		} finally {
			h.inspector.dispose();
		}
	}
});

test("ordinary lighting and dial admissions invalidate old ownership", async () => {
	for (const [kind, assignment, route] of [
		["off", { schemaVersion: 1 }, "off"],
		["brightness", { schemaVersion: 1, percent: 100 }, "brightness/100"],
		["color", { schemaVersion: 1, rgb: "112233" }, "color/112233"],
		["preset", { schemaVersion: 1, presetId: "another" }, "preset/another"],
		["transition", { schemaVersion: 1 }, "transition/FF5000/100/000000/0/30"],
	] as const) {
		const h = await harness();
		try {
			const a = await h.appear();
			await a.down();
			h.settings.receiveAction("other", kind, assignment);
			const other = h.operations.acquire({
				context: "other",
				actionKind: kind,
				settingsRevision: h.settings.revision("other"),
				connectionRevision: h.settings.connectionRevision,
				snapshot: { route, connection: h.settings.getConnection()! },
			})!;
			h.operations.finish(other, { status: "sent" });
			await a.down();
			assert.equal(h.calls.starts.length, 2, route);
			assert.equal(h.calls.reads, 0, route);
			assert.deepEqual(h.calls.stops, [], route);
		} finally {
			h.inspector.dispose();
		}
	}
});

test("assignment and connection changes fence old ownership and late status responses", async () => {
	for (const change of ["assignment", "connection", "admission"] as const) {
		const h = await harness();
		try {
			const a = await h.appear();
			await a.down();
			const late = deferred<ReadResult<EffectEnvelope>>();
			h.client.effect = () => late.promise;
			const stopping = a.down();
			if (change === "assignment") h.settings.receiveAction("a", "preset", { ...target, presetId: "new" });
			else if (change === "connection") await h.settings.saveConnection(18767, syntheticToken);
			else {
				const b = await h.appear("b");
				await b.down();
			}
			late.resolve(envelope(job));
			await stopping;
			assert.deepEqual(h.calls.stops, [], change);
			assert.equal(h.calls.starts.length, change === "admission" ? 2 : 1, change);
		} finally {
			h.inspector.dispose();
		}
	}
});

test("runtime capability loss fences late status and never cancels an old run", async () => {
	const abort = new AbortController();
	const capability: Capability = {
		session: "1".repeat(32),
		configurationGeneration: "2".repeat(32),
		launchId: "3".repeat(32),
		connection: { port: 18766, accessToken: syntheticToken },
		signal: abort.signal,
	};
	const runtime = {
		capability: () => (abort.signal.aborted ? null : capability),
		current: (value: Capability) => value.signal === abort.signal && !abort.signal.aborted,
		subscribe: () => () => {},
	} as unknown as ManagedController;
	const h = await harness(runtime);
	try {
		const a = await h.appear();
		await a.down();
		const late = deferred<ReadResult<EffectEnvelope>>();
		h.client.effect = () => late.promise;
		const stopping = a.down();
		abort.abort();
		late.resolve(envelope(job));
		await stopping;
		assert.deepEqual(h.calls.stops, []);
		assert.equal(h.calls.starts.length, 1);
	} finally {
		h.inspector.dispose();
	}
});

test("pending and expired raw flights coalesce presses and late admission stays ambiguous", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		const late = deferred<OperationResult>();
		h.client.command = (record) => {
			h.calls.starts.push(record);
			return late.promise;
		};
		const first = a.down();
		await a.down();
		assert.equal(h.calls.starts.length, 1);
		h.clock.advance(45000);
		assert.equal(h.operations.get("a")?.status, "unknown");
		await a.down();
		assert.equal(h.calls.reads, 0, "raw flight remains fenced after the operation timer");
		late.resolve({ status: "accepted", effect: job });
		await first;
		assert.equal(h.operations.get("a")?.status, "unknown");
		await a.down();
		assert.equal(h.calls.reads, 1);
		assert.equal(h.calls.starts.length, 1);
		assert.deepEqual(h.calls.stops, []);
	} finally {
		h.inspector.dispose();
	}
});

test("a newer admitted job prevents a delayed receipt from reclaiming ownership", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		const b = await h.appear("b");
		const late = deferred<OperationResult>();
		h.client.command = (record) => {
			h.calls.starts.push(record);
			return record.context === "a" ? late.promise : Promise.resolve({ status: "accepted", effect: job });
		};
		const first = a.down();
		await b.down();
		late.resolve({ status: "accepted", effect: job });
		await first;
		await b.down();
		assert.deepEqual(h.calls.stops, [job.id]);
		assert.equal(h.calls.starts.length, 2);
	} finally {
		h.inspector.dispose();
	}
});

test("late cancellation acknowledgement cannot clear a newer key's ownership", async () => {
	const h = await harness();
	try {
		const a = await h.appear();
		const b = await h.appear("b");
		await a.down();
		const entered = deferred<void>();
		const late = deferred<ReadResult<EffectEnvelope>>();
		h.client.cancelEffect = async (_connection, id) => {
			h.calls.stops.push(id);
			entered.resolve();
			return late.promise;
		};
		const stopping = a.down();
		await entered.promise;
		const newer = { ...job, id: "b".repeat(32) };
		h.client.command = async (record) => {
			h.calls.starts.push(record);
			return { status: "accepted", effect: newer };
		};
		await b.down();
		late.resolve(envelope({ ...job, state: "cancelled" }));
		await stopping;
		h.client.effect = async () => envelope(newer);
		h.client.cancelEffect = async (_connection, id) => {
			h.calls.stops.push(id);
			return envelope({ ...newer, state: "cancelled" });
		};
		await b.down();
		assert.deepEqual(h.calls.stops, [job.id, newer.id]);
		assert.equal(h.calls.starts.length, 2);
		assert.equal(h.inspector.snapshot("b").effect?.id, newer.id);
	} finally {
		h.inspector.dispose();
	}
});

test("real HTTP preset key dispatches start, status and exact stop once", async () => {
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		const route = req.url?.split("/").slice(2).join("/");
		requests.push(`${req.method} ${route}`);
		res.writeHead(route === "preset/evening" ? 202 : 200, { "Content-Type": "application/json" });
		if (route === "preset/evening")
			res.end(JSON.stringify({ accepted: true, action: route, effect: job, physical_state_verified: false }));
		else
			res.end(
				JSON.stringify({
					effect: { ...job, state: route?.includes("cancel/") ? "cancelled" : "running" },
					physical_state_verified: false,
				}),
			);
	});
	const h = await harness();
	const client = new BridgeClient();
	h.client.command = client.command.bind(client);
	h.client.effect = client.effect.bind(client);
	h.client.cancelEffect = client.cancelEffect.bind(client);
	try {
		await h.settings.saveConnection(server.port, syntheticToken);
		const a = await h.appear();
		await a.down();
		await a.down();
		assert.deepEqual(requests, ["POST preset/evening", "GET effect", `POST effect/cancel/${job.id}`]);
		assert.equal(h.inspector.snapshot("a").effect?.state, "cancelled");
	} finally {
		h.inspector.dispose();
		await server.close();
	}
});
