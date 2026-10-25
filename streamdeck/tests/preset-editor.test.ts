import assert from "node:assert/strict";
import test from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { InspectorController, type InspectorReply, parseMessage } from "../src/inspector-messages.js";
import { ManagedController, type ManagedSpawn } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { defaultPreset } from "../src/preset-effects.js";
import { Settings } from "../src/settings.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

const generation = "a".repeat(32),
	candidate = "b".repeat(32),
	transaction = "c".repeat(32);
const definition = { ...defaultPreset("palette"), label: "Colors" };
const message = (
	type: string,
	payload: Record<string, unknown> = {},
	sessionId = "panel",
	requestId = crypto.randomUUID(),
) => ({ v: 2, type, payload, sessionId, requestId });
async function setup() {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 2, language: "en" };
	const settings = new Settings(storage);
	await settings.load();
	settings.receiveAction("key", "preset", { schemaVersion: 1, presetId: "colors" });
	const calls: { type: string; payload: Record<string, unknown> }[] = [];
	let active = generation,
		failRead = false,
		unknown = false;
	const spawn: ManagedSpawn = (receive) => ({
		close: () => {},
		exited: new Promise(() => {}),
		send: (raw) => {
			const frame = raw as { type: string; payload: Record<string, unknown> };
			calls.push(frame);
			let data: unknown = {},
				code: string | undefined;
			if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
			if (frame.type === "configuration.read") {
				if (failRead) code = "storage_unavailable";
				else
					data = {
						configured: true,
						generation: active,
						identity: "AA:BB:CC:DD:EE:FF",
						port: 23456,
						hasToken: true,
						presetCount: 2,
						connection: { port: 23456, accessToken: syntheticToken },
					};
			}
			if (frame.type === "configuration.presetList")
				data = {
					generation: active,
					entries: [{ id: "colors", label: "Colors", labelTruncated: false }],
					nextCursor: null,
				};
			if (frame.type === "configuration.presetRead") data = { generation: active, id: "colors", preset: definition };
			if (frame.type === "configuration.preparePreset")
				data = {
					transactionId: transaction,
					candidateGeneration: candidate,
					expectedGeneration: active,
					identity: "AA:BB:CC:DD:EE:FF",
					port: 23456,
					hasToken: true,
					presetCount: 2,
					changed: true,
					diff: { identity: false, port: false, secret: false, presets: true },
					expiresAt: Date.now() + 300000,
				};
			if (frame.type === "configuration.apply") {
				active = candidate;
				data = { saveOutcome: "applied" };
				if (unknown) {
					failRead = true;
					throw new Error("lost");
				}
			}
			queueMicrotask(() =>
				receive(
					JSON.stringify({
						...frame,
						type: "result",
						payload: code ? { status: "error", code } : { status: "ok", data },
					}),
				),
			);
		},
	});
	const client = new BridgeClient();
	const runtime = new ManagedController(spawn, settings, client, new HostProbeBroker(async () => ({})));
	await runtime.open();
	const replies: InspectorReply[] = [];
	const pi = new InspectorController(
		settings,
		new OperationStore(),
		client,
		(reply) => {
			replies.push(reply);
		},
		undefined,
		runtime,
	);
	return {
		runtime,
		pi,
		calls,
		replies,
		client,
		unknown: () => {
			unknown = true;
		},
		recover: () => {
			failRead = false;
		},
		close: async () => {
			pi.dispose();
			await runtime.shutdown();
		},
	};
}

test("editor messages allow exact fields and validate all six definition kinds", () => {
	for (const kind of ["static", "palette", "strobe", "breathing", "candle", "lightning"] as const) {
		const preset = { ...defaultPreset(kind), label: kind };
		assert.equal(
			parseMessage(
				"key",
				message("configuration.preparePreset", {
					expectedGeneration: generation,
					operation: "create",
					id: "new",
					preset,
				}),
			).type,
			"configuration.preparePreset",
		);
	}
	for (const [type, payload] of [
		["configuration.presetList", { expectedGeneration: null }],
		["configuration.presetList", { expectedGeneration: generation, cursor: null }],
		["configuration.presetRead", { expectedGeneration: generation, id: "../bad" }],
		[
			"configuration.preparePreset",
			{ expectedGeneration: generation, operation: "delete", id: "colors", preset: null },
		],
		[
			"configuration.preparePreset",
			{
				expectedGeneration: generation,
				operation: "update",
				id: "colors",
				preset: { ...definition, accessToken: syntheticToken },
			},
		],
		["effect.cancel", { id: "current" }],
		["effect.status", { id: transaction }],
		["configuration.presetList", { expectedGeneration: generation, ownerSession: "forged" }],
	] as [string, Record<string, unknown>][])
		assert.throws(() => parseMessage("key", message(type, payload)));
});

test("editor replies and captured review are safe, generation-bound and send no lighting commands", async () => {
	const f = await setup();
	try {
		await f.pi.receive("key", message("inspector.get"));
		await f.pi.receive("key", message("configuration.presetList", { expectedGeneration: generation }));
		assert.equal(f.replies.at(-1)?.snapshot?.presetPage?.entries[0]?.id, "colors");
		await f.pi.receive("key", message("configuration.presetRead", { expectedGeneration: generation, id: "colors" }));
		assert.deepEqual(f.replies.at(-1)?.snapshot?.presetDefinition?.preset, definition);
		const edit = message("configuration.preparePreset", {
			expectedGeneration: generation,
			operation: "update",
			id: "colors",
			preset: { ...definition, label: "Renamed" },
		});
		await f.pi.receive("key", edit);
		await f.pi.receive("key", edit);
		const proposal = f.replies.at(-1)?.snapshot?.proposal;
		assert.equal(proposal?.diff.presets, true);
		assert.equal(proposal?.requiresConfirmation, true);
		assert.equal(f.calls.filter((c) => c.type === "configuration.preparePreset").length, 1);
		assert.equal(f.calls.find((c) => c.type === "configuration.preparePreset")?.payload.ownerSession, "panel");
		assert.ok(!JSON.stringify(f.replies).includes(syntheticToken));
		assert.ok(!JSON.stringify(f.replies).includes("candidateGeneration"));
		assert.equal(f.calls.filter((c) => c.type === "configuration.apply" || c.type === "command").length, 0);
	} finally {
		await f.close();
	}
});

test("private editor validators reject malformed responses and secret-bearing definitions", async () => {
	const f = await setup();
	try {
		for (const raw of [
			{ generation, entries: [{ id: "colors", label: syntheticToken, labelTruncated: false }], nextCursor: null },
			{ generation: candidate, entries: [], nextCursor: null },
			{ generation, entries: [], nextCursor: "absent" },
			{
				generation,
				entries: [{ id: "colors", label: "Safe", labelTruncated: false, token: syntheticToken }],
				nextCursor: null,
			},
		]) {
			f.runtime.request = async () => raw;
			await assert.rejects(f.runtime.presetList(generation, "panel"), /protocol_incompatible/);
		}
		f.runtime.request = async () => ({ generation, id: "colors", preset: { ...definition, label: syntheticToken } });
		await assert.rejects(f.runtime.presetRead(generation, "panel", "colors"), /protocol_incompatible/);
		await assert.rejects(
			f.runtime.preparePreset("update", "colors", { ...definition, label: syntheticToken }, generation, "panel"),
			/validation/,
		);
	} finally {
		await f.close();
	}
});

test("editor save uncertainty uses read-only reconciliation and never replays Apply", async () => {
	const f = await setup();
	try {
		await f.pi.receive("key", message("inspector.get"));
		await f.pi.receive(
			"key",
			message("configuration.preparePreset", {
				expectedGeneration: generation,
				operation: "update",
				id: "colors",
				preset: definition,
			}),
		);
		f.unknown();
		const apply = message("configuration.apply", {
			transactionId: transaction,
			expectedGeneration: generation,
			confirmed: true,
		});
		await f.pi.receive("key", apply);
		await f.pi.receive("key", apply);
		assert.equal(f.runtime.saveOutcome, "commit_unknown");
		assert.equal(f.runtime.activeStateKnown, false);
		await f.pi.receive(
			"key",
			message("configuration.preparePreset", { expectedGeneration: generation, operation: "delete", id: "colors" }),
		);
		assert.equal(f.replies.at(-1)?.messageKey, "storage_unavailable");
		f.recover();
		await f.pi.receive("key", message("configuration.check"));
		assert.equal(f.runtime.saveOutcome, "applied");
		assert.equal(f.calls.filter((c) => c.type === "configuration.apply").length, 1);
	} finally {
		await f.close();
	}
});

test("effect stop requires the exact visible run and publishing rejects malformed snapshots", async () => {
	const f = await setup();
	try {
		await f.pi.receive("key", message("inspector.get"));
		const effect = {
			id: transaction,
			presetId: "colors",
			kind: "palette" as const,
			state: "running" as const,
			elapsedMs: 250,
			durationMs: null,
			physical_state_verified: false as const,
		};
		f.pi.publishEffect("key", effect);
		assert.deepEqual(f.pi.snapshot("key").effect, effect);
		await f.pi.receive("key", message("effect.cancel", { id: candidate }));
		assert.equal(f.replies.at(-1)?.ok, false);
		assert.equal(f.calls.filter((c) => c.type.includes("cancelEffect")).length, 0);
	} finally {
		await f.close();
	}
});
