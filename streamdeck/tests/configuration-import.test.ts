import assert from "node:assert/strict";
import test from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { InspectorController, type InspectorReply, parseMessage } from "../src/inspector-messages.js";
import { ManagedController, type ManagedSpawn } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

const expected = "a".repeat(32);
const candidate = "b".repeat(32);
const transaction = "c".repeat(32);
const message = (
	type: string,
	payload: Record<string, unknown> = {},
	sessionId = "panel",
	requestId = crypto.randomUUID(),
) => ({ v: 2, type, payload, sessionId, requestId });
async function setup() {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 1, language: "ru", connection: { port: 23456, accessToken: syntheticToken } };
	const settings = new Settings(storage);
	await settings.load();
	settings.receiveAction("key", "on", {});
	let active: string | null = null,
		mode = "normal",
		readsFail = false,
		expiresAt = Date.now() + 300000;
	const sent: { type: string; payload: Record<string, unknown> }[] = [];
	const spawn: ManagedSpawn = (receive) => ({
		close: () => {},
		exited: new Promise(() => {}),
		send: (raw) => {
			const frame = raw as { type: string; payload: Record<string, unknown> };
			sent.push(frame);
			let data: unknown = {},
				code: string | undefined;
			if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
			if (frame.type === "configuration.read") {
				if (readsFail) code = "storage_unavailable";
				else if (active) {
					data = {
						configured: true,
						generation: active,
						identity: "AA:BB:CC:DD:EE:FF",
						port: 23456,
						hasToken: true,
						presetCount: 1,
						connection: { port: 23456, accessToken: syntheticToken },
					};
				} else {
					data = { configured: false, generation: null };
				}
			}
			if (frame.type === "configuration.prepareImport" || frame.type === "configuration.prepareManual")
				data = {
					transactionId: transaction,
					candidateGeneration: candidate,
					expectedGeneration: frame.payload.expectedGeneration,
					identity: "AA:BB:CC:DD:EE:FF",
					port: 23456,
					hasToken: true,
					presetCount: 1,
					changed: true,
					diff: { identity: true, port: true, secret: true, presets: true },
					expiresAt,
				};
			if (frame.type === "configuration.apply") {
				if (mode === "before") code = "storage_unavailable";
				else {
					active = candidate;
					data = { saveOutcome: "applied" };
					if (mode === "unknown") readsFail = true;
					if (mode === "lost" || mode === "unknown") throw new Error("lost reply");
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
		pi,
		runtime,
		settings,
		storage,
		replies,
		sent,
		mode: (value: string) => {
			mode = value;
		},
		expire: () => {
			expiresAt = Date.now() - 1;
		},
		recover: (generation: string | null = candidate) => {
			readsFail = false;
			active = generation;
		},
	};
}
const selected = {
	settingsPath: "/synthetic/private/settings.json",
	presetsPath: "/synthetic/private/presets.json",
	expectedGeneration: null,
};
test("import message requires bounded absolute selected paths and explicit null-or-ID generation", () => {
	assert.equal(
		parseMessage("key", message("configuration.prepareImport", selected)).type,
		"configuration.prepareImport",
	);
	for (const payload of [
		{ ...selected, settingsPath: "relative" },
		{ ...selected, settingsPath: "/" + "x".repeat(4096) },
		{ ...selected, settingsPath: "/😀".repeat(1100) },
		{ settingsPath: selected.settingsPath },
		{ ...selected, expectedGeneration: "" },
		{ ...selected, token: syntheticToken },
	])
		assert.throws(() => parseMessage("key", message("configuration.prepareImport", payload)));
});
test("captured import review is private, cancel/session replacement/stale/expiry never apply", async () => {
	const f = await setup();
	try {
		await f.pi.receive("key", message("inspector.get"));
		await f.pi.receive("key", message("configuration.prepareImport", selected));
		const preview = JSON.stringify(f.replies.at(-1));
		assert.ok(preview.includes("AA:BB:CC:DD:EE:FF"));
		assert.ok(!preview.includes("/synthetic"));
		assert.ok(!preview.includes(syntheticToken));
		assert.ok(!preview.includes("candidateGeneration"));
		await f.pi.receive(
			"key",
			message("configuration.apply", { transactionId: transaction, expectedGeneration: expected, confirmed: true }),
		);
		assert.equal(f.replies.at(-1)?.messageKey, "stale_configuration");
		await f.pi.receive("key", message("configuration.cancel", { transactionId: transaction }));
		await f.pi.receive(
			"key",
			message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
		);
		assert.equal(f.replies.at(-1)?.messageKey, "proposal_expired");
		f.expire();
		await f.pi.receive("key", message("configuration.prepareImport", selected));
		await f.pi.receive(
			"key",
			message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
		);
		assert.equal(f.replies.at(-1)?.messageKey, "proposal_expired");
		await f.pi.receive("key", message("inspector.get", {}, "replacement"));
		await f.pi.receive(
			"key",
			message(
				"configuration.apply",
				{ transactionId: transaction, expectedGeneration: null, confirmed: false },
				"replacement",
			),
		);
		assert.equal(f.sent.filter((frame) => frame.type === "configuration.apply").length, 0);
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
for (const mode of ["normal", "before", "lost", "unknown"]) {
	test(`import ${mode} preserves outcome and never replays confirmation`, async () => {
		const f = await setup();
		try {
			f.mode(mode);
			if (mode === "normal") f.storage.fail = true;
			await f.pi.receive("key", message("inspector.get"));
			await f.pi.receive("key", message("configuration.prepareImport", selected));
			const apply = message("configuration.apply", {
				transactionId: transaction,
				expectedGeneration: null,
				confirmed: false,
			});
			await f.pi.receive("key", apply);
			await f.pi.receive("key", apply);
			assert.equal(f.sent.filter((frame) => frame.type === "configuration.apply").length, 1);
			assert.equal(
				f.runtime.saveOutcome,
				mode === "before" ? "not_applied" : mode === "unknown" ? "commit_unknown" : "applied",
			);
			if (mode === "unknown") {
				assert.equal(f.runtime.activeStateKnown, false);
				assert.equal(f.runtime.capability(), null);
				await f.pi.receive("key", message("configuration.prepareImport", selected));
				assert.equal(f.replies.at(-1)?.messageKey, "storage_unavailable");
				f.recover(expected);
				await f.pi.receive("key", message("configuration.check"));
				assert.equal(f.runtime.saveOutcome, "commit_unknown");
				assert.equal(f.runtime.activeStateKnown, true);
			}
			assert.equal(f.sent.filter((frame) => frame.type === "configuration.apply").length, 1);
			assert.equal(f.sent.filter((frame) => frame.type === "command").length, 0);
		} finally {
			f.pi.dispose();
			await f.runtime.shutdown();
		}
	});
}

test("legacy manual identity preserves explicit old credentials privately, while complete import never merges them", async () => {
	const f = await setup();
	try {
		await f.pi.receive("key", message("inspector.get"));
		await f.pi.receive(
			"key",
			message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: null }),
		);
		const manual = f.sent.find((frame) => frame.type === "configuration.prepareManual")!;
		assert.equal(manual.payload.ownerSession, "panel");
		assert.deepEqual(manual.payload.legacyConnection, { port: 23456, accessToken: syntheticToken });
		await f.pi.receive("key", message("configuration.prepareImport", selected));
		const imported = f.sent.find((frame) => frame.type === "configuration.prepareImport")!;
		assert.ok(!("legacyConnection" in imported.payload));
		assert.ok(!JSON.stringify(f.replies).includes(syntheticToken));
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
test("malformed private preview fields cannot echo credentials or arbitrary diff keys to the inspector", async () => {
	const f = await setup();
	try {
		const valid = {
			transactionId: transaction,
			candidateGeneration: candidate,
			expectedGeneration: null,
			identity: "AA:BB:CC:DD:EE:FF",
			port: 23456,
			hasToken: true,
			presetCount: 1,
			changed: true,
			diff: { identity: true },
			expiresAt: Date.now() + 300000,
		};
		for (const patch of [
			{ identity: syntheticToken },
			{ port: 1 },
			{ diff: { [syntheticToken]: true } },
			{ diff: { identity: syntheticToken } },
			{ expectedGeneration: expected },
		]) {
			f.runtime.request = async () => ({ ...valid, ...patch });
			await assert.rejects(
				f.runtime.prepareImport(selected.settingsPath, undefined, null, "panel"),
				/protocol_incompatible/,
			);
		}
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
