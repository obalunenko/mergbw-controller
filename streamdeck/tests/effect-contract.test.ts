import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { OperationStore } from "../src/operation-store.js";
import { defaultPreset, effectSnapshot, presetDefinition, presetKinds } from "../src/preset-effects.js";
import { fixture, syntheticToken } from "./helpers.js";

const run = {
	id: "a".repeat(32),
	presetId: "evening",
	kind: "palette",
	state: "running",
	elapsedMs: 0,
	durationMs: null,
	physical_state_verified: false,
};

test("preset definitions preserve static zero and validate all effect variants without sharing mutable colors", () => {
	for (const kind of presetKinds) {
		const source = { ...defaultPreset(kind), label: "Evening" };
		const value = presetDefinition(source);
		assert.deepEqual(value, source);
		source.rgb[0] = 1;
		assert.notEqual(value.rgb[0], 1);
		if (source.effect?.kind === "palette" && value.effect?.kind === "palette") {
			source.effect.colors[0]![0] = 99;
			assert.equal(value.effect.colors[0]![0], 0);
		}
	}
	assert.equal(presetDefinition({ label: "Zero", rgb: [0, 0, 0], brightness: 0 }).brightness, 0);
	const finite = {
		...defaultPreset("candle"),
		label: "Finite",
		effect: { kind: "candle", loop: false, depth: 0, flickerMs: 250, durationMs: 1000 },
	};
	assert.deepEqual(presetDefinition(finite), finite);
});

test("definitions reject null, foreign/missing fields and invalid variant boundaries", () => {
	const base = { label: "Evening", rgb: [255, 80, 0], brightness: 75 };
	for (const effect of [
		null,
		{ kind: "strobe", onMs: 500, offMs: 500 },
		{ kind: "strobe", loop: true, onMs: 249, offMs: 500 },
		{ kind: "strobe", loop: true, onMs: 500, offMs: 500, depth: 0 },
		{ kind: "breathing", loop: true, minBrightness: 75, cycleMs: 1000 },
		{ kind: "candle", loop: false, depth: 30, flickerMs: 500 },
		{ kind: "palette", loop: true, colors: [], transitionMs: 500 },
	])
		assert.throws(() => presetDefinition({ ...base, effect }));
	assert.throws(() => presetDefinition({ ...base, accessToken: syntheticToken }));
	assert.throws(() => presetDefinition({ ...base, label: "x".repeat(129) }));
	assert.doesNotThrow(() => presetDefinition({ ...base, label: "x".repeat(129) }, false));
	assert.throws(() => presetDefinition({ ...base, label: syntheticToken }, false, syntheticToken));
});

test("effect snapshots represent loops honestly and reject malformed physical claims", () => {
	assert.ok(effectSnapshot(run));
	assert.ok(effectSnapshot({ ...run, durationMs: 1000, elapsedMs: 2000 }));
	for (const value of [
		null,
		{ ...run, extra: true },
		{ ...run, physical_state_verified: true },
		{ ...run, elapsedMs: -1 },
		{ ...run, durationMs: 0 },
		{ ...run, kind: "rainbow" },
		{ ...run, presetId: "bad id" },
	])
		assert.equal(effectSnapshot(value), false);
	assert.equal(effectSnapshot(run, "a".repeat(24)), false);
});

test("BridgeClient distinguishes accepted effect from sent static and validates exact run cancellation", async () => {
	let mode = "effect";
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		requests.push(`${req.method} ${req.url?.split("/").slice(2).join("/")}`);
		const cancel = req.url?.includes("effect/cancel/");
		const status = req.url?.endsWith("/effect");
		res.writeHead(status || cancel || mode === "static" ? 200 : 202, { "Content-Type": "application/json" });
		let body: unknown;
		if (status || cancel)
			body = { effect: { ...run, id: mode === "wrong-id" ? "b".repeat(32) : run.id }, physical_state_verified: false };
		else if (mode === "static") body = { sent: true, action: "preset/evening", physical_state_verified: false };
		else
			body = {
				accepted: true,
				action: "preset/evening",
				effect: mode === "malformed" ? { ...run, presetId: "other" } : run,
				physical_state_verified: false,
			};
		res.end(JSON.stringify(body));
	});
	try {
		const connection = { port: server.port, accessToken: syntheticToken };
		const client = new BridgeClient();
		const operations = new OperationStore();
		operations.appear("key");
		const record = () =>
			operations.acquire({
				context: "key",
				actionKind: "preset",
				settingsRevision: 1,
				connectionRevision: 1,
				snapshot: { route: "preset/evening", connection },
			})!;
		const first = record();
		const accepted = await client.command(first);
		assert.equal(accepted.status, "accepted");
		operations.finish(first, accepted);
		assert.equal(operations.get("key")?.effect?.id, run.id);
		assert.equal((await client.effect(connection)).value?.effect?.id, run.id);
		assert.equal((await client.cancelEffect(connection, run.id)).value?.effect?.id, run.id);
		mode = "wrong-id";
		assert.equal((await client.cancelEffect(connection, run.id)).value, undefined);
		mode = "malformed";
		const second = record();
		const unknown = await client.command(second);
		assert.equal(unknown.status, "unknown");
		operations.finish(second, unknown);
		mode = "static";
		const third = record();
		const sent = await client.command(third);
		assert.equal(sent.status, "sent");
		operations.finish(third, sent);
		const count = requests.length;
		assert.equal((await client.cancelEffect(connection, "bad")).errorCategory, "validation");
		assert.equal(requests.length, count);
	} finally {
		await server.close();
	}
});
