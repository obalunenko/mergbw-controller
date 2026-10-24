import assert from "node:assert/strict";
import test from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { en, ru } from "../src/i18n.js";
import { InspectorController, type InspectorReply, parseMessage } from "../src/inspector-messages.js";
import { ManagedController, type ManagedSpawn } from "../src/managed-controller.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

const candidate = "a".repeat(32),
	transaction = "b".repeat(32);
const message = (
	type: string,
	payload: Record<string, unknown> = {},
	requestId = Math.random().toString().slice(2),
) => ({ v: 2, sessionId: "session", requestId, type, payload });
async function setup() {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	for (const kind of ["on", "off", "color", "brightness", "preset"] as const) settings.receiveAction(kind, kind, {});
	let configured = false,
		readFailure = false,
		applyMode = "normal",
		applies = 0,
		starts = 0,
		controls = 0;
	let identity = "AA:BB:CC:DD:EE:FF";
	const spawn: ManagedSpawn = (receive) => ({
		exited: new Promise(() => {}),
		close: () => {},
		send: (raw) => {
			const f = raw as { type: string; payload: Record<string, unknown> };
			let data: unknown = {};
			let code: string | undefined;
			if (f.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
			if (f.type === "configuration.read") {
				if (readFailure) code = "storage_unavailable";
				else {
					data = { configured: false, generation: null };
					if (configured)
						data = {
							configured: true,
							generation: candidate,
							identity,
							port: 18765,
							hasToken: true,
							presetCount: 3,
							connection: { port: 18765, accessToken: syntheticToken },
						};
				}
			}
			if (f.type === "configuration.prepareManual")
				data = {
					transactionId: transaction,
					candidateGeneration: candidate,
					expectedGeneration: f.payload.expectedGeneration,
					identity: f.payload.identity,
					port: 18765,
					hasToken: true,
					presetCount: 3,
					changed: !configured || f.payload.identity !== identity,
					diff: {
						identity: !configured || f.payload.identity !== identity,
						port: false,
						secret: false,
						presets: false,
					},
					expiresAt: Date.now() + 300000,
				};
			if (f.type === "configuration.apply") {
				applies++;
				if (applyMode === "before") code = "storage_unavailable";
				else {
					configured = true;
					identity = "AA:BB:CC:DD:EE:FF";
					data = { saveOutcome: f.payload.expectedGeneration === candidate ? "unchanged" : "applied" };
					if (applyMode === "lost") {
						throw new Error("lost reply");
					}
					if (applyMode === "unknown") {
						readFailure = true;
						throw new Error("lost reply");
					}
				}
			}
			if (f.type === "controller.start") starts++;
			if (f.type === "command") controls++;
			queueMicrotask(() =>
				receive(
					JSON.stringify({ ...f, type: "result", payload: code ? { status: "error", code } : { status: "ok", data } }),
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
		storage,
		settings,
		runtime,
		pi,
		replies,
		setMode: (mode: string) => {
			applyMode = mode;
		},
		readable: () => {
			readFailure = false;
		},
		counts: () => ({ applies, starts, controls }),
	};
}
test("every action panel supports manual prepare/apply, with invalid identity changing nothing", async () => {
	for (const kind of ["on", "off", "color", "brightness", "preset"]) {
		const f = await setup();
		try {
			await f.pi.receive(kind, message("inspector.get"));
			assert.equal(f.replies.at(-1)?.snapshot?.configuration?.configured, false);
			await f.pi.receive(kind, message("configuration.prepareManual", { identity: "bad", expectedGeneration: null }));
			assert.equal(f.replies.at(-1)?.messageKey, "invalid_identity");
			assert.equal(f.counts().starts, 0);
			assert.equal(f.counts().applies, 0);
			await f.pi.receive(
				kind,
				message("configuration.prepareManual", { identity: "aa:bb:cc:dd:ee:ff", expectedGeneration: null }),
			);
			const snapshot = f.replies.at(-1)?.snapshot;
			assert.equal(snapshot?.proposal?.identity, "AA:BB:CC:DD:EE:FF");
			assert.equal(snapshot?.proposal?.requiresConfirmation, false);
			await f.pi.receive(
				kind,
				message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
			);
			assert.equal(f.replies.at(-1)?.snapshot?.saveOutcome?.status, "applied");
			assert.equal(f.counts().starts, 1);
			assert.equal(f.counts().controls, 0);
			assert.deepEqual(f.storage.global, {});
			assert.ok(!JSON.stringify(f.replies).includes(syntheticToken));
			assert.ok(!JSON.stringify(f.replies).includes("candidateGeneration"));
			assert.ok(!JSON.stringify(f.replies).includes("/Users/"));
		} finally {
			f.pi.dispose();
			await f.runtime.shutdown();
		}
	}
});
test("v2 allowlists reject extra credentials, paths and external mode; obsolete setup receives migration_required", async () => {
	for (const raw of [
		message("configuration.prepareManual", {
			identity: "AA:BB:CC:DD:EE:FF",
			expectedGeneration: null,
			accessToken: syntheticToken,
		}),
		message("configuration.apply", { transactionId: transaction, expectedGeneration: "/tmp/path", confirmed: true }),
		message("connection.save", { port: 18765 }),
		message("configuration.prepareImport", { settingsPath: "/tmp/file" }),
	])
		assert.throws(() => parseMessage("on", raw));
	const f = await setup();
	try {
		await f.pi.receive("on", {
			...message("connection.save", { port: 18765, replacementToken: syntheticToken }),
			v: 1,
		});
		assert.equal(f.replies.at(-1)?.messageKey, "migration_required");
		assert.equal(f.settings.getConnection(), null);
		assert.deepEqual(f.counts(), { applies: 0, starts: 0, controls: 0 });
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
test("cancel, changed-data confirmation and repeated-save no-op are explicit", async () => {
	const f = await setup();
	const ctx = "on";
	try {
		await f.pi.receive(ctx, message("inspector.get"));
		await f.pi.receive(
			ctx,
			message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: null }),
		);
		await f.pi.receive(ctx, message("configuration.cancel", { transactionId: transaction }));
		assert.equal(f.replies.at(-1)?.snapshot?.proposal, undefined);
		assert.equal(f.counts().applies, 0);
		await f.pi.receive(
			ctx,
			message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: null }),
		);
		await f.pi.receive(
			ctx,
			message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
		);
		await f.pi.receive(
			ctx,
			message("configuration.prepareManual", { identity: "11:22:33:44:55:66", expectedGeneration: candidate }),
		);
		assert.equal(f.replies.at(-1)?.snapshot?.proposal?.requiresConfirmation, true);
		await f.pi.receive(
			ctx,
			message("configuration.apply", { transactionId: transaction, expectedGeneration: candidate, confirmed: false }),
		);
		assert.equal(f.replies.at(-1)?.messageKey, "confirmation_required");
		assert.equal(f.counts().applies, 1);
		await f.pi.receive(ctx, message("configuration.cancel", { transactionId: transaction }));
		await f.pi.receive(
			ctx,
			message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: candidate }),
		);
		await f.pi.receive(
			ctx,
			message("configuration.apply", { transactionId: transaction, expectedGeneration: candidate, confirmed: false }),
		);
		assert.equal(f.replies.at(-1)?.snapshot?.saveOutcome?.status, "unchanged");
		assert.equal(f.counts().starts, 1);
		assert.equal(f.counts().controls, 0);
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
test("save before commit versus lost confirmation is reported by authoritative read-back without apply replay", async () => {
	for (const mode of ["before", "lost", "unknown"]) {
		const f = await setup();
		try {
			f.setMode(mode);
			await f.pi.receive("on", message("inspector.get"));
			await f.pi.receive(
				"on",
				message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: null }),
			);
			await f.pi.receive(
				"on",
				message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
			);
			assert.equal(
				f.replies.at(-1)?.snapshot?.saveOutcome?.status,
				mode === "before" ? "not_applied" : mode === "lost" ? "applied" : "commit_unknown",
			);
			assert.equal(f.counts().applies, 1);
			assert.equal(f.counts().controls, 0);
			if (mode === "unknown") {
				assert.equal(f.runtime.capability(), null);
				assert.equal(f.replies.at(-1)?.snapshot?.saveOutcome?.activeStateKnown, false);
				await assert.rejects(f.runtime.prepare("AA:BB:CC:DD:EE:FF", candidate), /storage_unavailable/);
				f.readable();
				await f.pi.receive("on", message("configuration.check"));
				assert.equal(f.replies.at(-1)?.snapshot?.saveOutcome?.status, "applied");
				assert.equal(f.counts().applies, 1);
			}
		} finally {
			f.pi.dispose();
			await f.runtime.shutdown();
		}
	}
});
test("setup and lifecycle copy have matching English and Russian keys", () => {
	assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
});

test("committed save remains applied when SDK legacy cleanup is rejected", async () => {
	const f = await setup();
	try {
		f.storage.global = { schemaVersion: 1, connection: { port: 18765, accessToken: syntheticToken }, language: "ru" };
		await f.settings.load();
		f.storage.fail = true;
		await f.pi.receive("on", message("inspector.get"));
		await f.pi.receive(
			"on",
			message("configuration.prepareManual", { identity: "AA:BB:CC:DD:EE:FF", expectedGeneration: null }),
		);
		await f.pi.receive(
			"on",
			message("configuration.apply", { transactionId: transaction, expectedGeneration: null, confirmed: false }),
		);
		assert.equal(f.replies.at(-1)?.snapshot?.saveOutcome?.status, "applied");
		assert.equal(f.runtime.activeStateKnown, true);
		assert.equal(f.runtime.active.generation, candidate);
		assert.equal((f.storage.global as { schemaVersion: number }).schemaVersion, 1);
		assert.equal(f.counts().applies, 1);
		assert.equal(f.counts().starts, 1);
	} finally {
		f.pi.dispose();
		await f.runtime.shutdown();
	}
});
