import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { ManagedController, type ManagedSpawn } from "../src/managed-controller.js";
import { type Persistence, Settings } from "../src/settings.js";
import type { ActionKind, Assignment } from "../src/validation.js";
import { syntheticToken } from "./helpers.js";

// Disk/SDK adapters model the supervisor and host boundaries. No native process is started.
test("replacement preserves Application Support plus ten host assignments/artwork/language across three restarts", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "mergbw-upgrade-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const installed = join(root, "Plugins/com.obalunenko.mergbw.sdPlugin");
	const support = join(root, "Application Support/MeRGBW Controller");
	const host = join(root, "Stream Deck profile.json");
	mkdirSync(support, { recursive: true });
	const active = {
		generation: "a".repeat(32),
		identity: "AA:BB:CC:DD:EE:FF",
		port: 23456,
		accessToken: syntheticToken,
		presets: [{ id: "custom", label: "Custom", steps: [{ brightness: 37 }] }],
	};
	writeFileSync(join(support, "active.json"), JSON.stringify(active));
	const entries = Array.from({ length: 10 }, (_, i) => {
		const kind = (["on", "off", "color", "brightness", "preset"] as const)[i % 5]!;
		const settings: Assignment =
			kind === "color"
				? { schemaVersion: 1, rgb: "AABBCC" }
				: kind === "brightness"
					? { schemaVersion: 1, percent: 37 }
					: kind === "preset"
						? { schemaVersion: 1, presetId: "custom" }
						: { schemaVersion: 1 };
		return {
			id: `key-${i}`,
			kind,
			settings,
			title: `Custom title ${i}`,
			image: `data:image/png;base64,synthetic-${i}`,
		};
	});
	writeFileSync(
		host,
		JSON.stringify({
			global: {
				schemaVersion: 1,
				language: "ru",
				connection: { port: 34567, accessToken: "obsolete_access_token_1234567890" },
			},
			entries,
		}),
	);
	const beforeConfig = readFileSync(join(support, "active.json"));
	let mutatingRPCs = 0;
	const persistence: Persistence = {
		getGlobal: async () => JSON.parse(readFileSync(host, "utf8")).global,
		// Simulate old host cleanup failing: authoritative disk must still win on every launch.
		setGlobal: async () => {
			throw new Error("synthetic SDK cleanup failure");
		},
		setAction: async () => assert.fail("upgrade must not rewrite assignments"),
	};
	for (let restart = 0; restart < 3; restart++) {
		rmSync(installed, { recursive: true, force: true });
		mkdirSync(installed, { recursive: true });
		writeFileSync(join(installed, "version"), `0.2.0 restart ${restart}`);
		const settings = new Settings(persistence);
		await settings.load();
		const profile = JSON.parse(readFileSync(host, "utf8")) as { entries: typeof entries };
		for (const entry of profile.entries) settings.receiveAction(entry.id, entry.kind, entry.settings);
		const spawn: ManagedSpawn = (receive) => ({
			exited: new Promise(() => {}),
			close: () => {},
			send: (raw) => {
				const frame = raw as { type: string };
				let data: unknown = {};
				if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
				if (frame.type === "configuration.read") {
					const disk = JSON.parse(readFileSync(join(support, "active.json"), "utf8")) as typeof active;
					data = {
						configured: true,
						generation: disk.generation,
						identity: disk.identity,
						port: disk.port,
						hasToken: true,
						presetCount: disk.presets.length,
						connection: { port: disk.port, accessToken: disk.accessToken },
					};
				}
				if (["configuration.prepareManual", "configuration.prepareImport", "configuration.apply"].includes(frame.type))
					mutatingRPCs++;
				queueMicrotask(() => receive(JSON.stringify({ ...frame, type: "result", payload: { status: "ok", data } })));
			},
		});
		const runtime = new ManagedController(spawn, settings, new BridgeClient(), new HostProbeBroker(async () => ({})));
		try {
			await runtime.open();
			assert.equal(runtime.active.port, active.port);
			assert.equal(runtime.active.presetCount, active.presets.length);
			assert.equal(runtime.active.generation, active.generation);
			assert.equal(settings.getLanguage(), "ru");
			assert.equal(settings.getConnection(), null); // No action capability before authenticated worker readiness.
			for (const entry of entries) assert.deepEqual(settings.getAction(entry.id), entry.settings);
			assert.deepEqual(profile.entries, entries);
			assert.deepEqual(readFileSync(join(support, "active.json")), beforeConfig);
			assert.equal(runtime.capability(), null);
		} finally {
			await runtime.shutdown();
		}
	}
	assert.equal(mutatingRPCs, 0);
});

test("future settings survive inspection and a profile transfers assignments without local credentials", async () => {
	const future = { schemaVersion: 99, language: "ru", unknown: { preserve: true } };
	let global: unknown = structuredClone(future);
	let writes = 0;
	const settings = new Settings({
		getGlobal: async () => global,
		setGlobal: async (value) => {
			global = value;
			writes++;
		},
		setAction: async () => {
			writes++;
		},
	});
	await settings.load();
	settings.receiveAction("future", "color", { schemaVersion: 99, rgb: "FFFFFF", unknown: true });
	assert.equal(settings.migrationStatus(), "invalid");
	assert.throws(() => settings.getAction("future"), /validation/);
	assert.deepEqual(global, future);
	assert.equal(writes, 0);
	const exported: { kind: ActionKind; settings: Assignment }[] = [
		{ kind: "on", settings: { schemaVersion: 1 } },
		{ kind: "off", settings: { schemaVersion: 1 } },
		{ kind: "color", settings: { schemaVersion: 1, rgb: "FF5000" } },
		{ kind: "brightness", settings: { schemaVersion: 1, percent: 25 } },
		{ kind: "preset", settings: { schemaVersion: 1, presetId: "custom" } },
	];
	const profile = JSON.stringify(exported);
	assert.ok(!/accessToken|connection|identity|sourcePath|settingsPath/.test(profile));
	const target = new Settings({
		getGlobal: async () => ({}),
		setGlobal: async () => assert.fail(),
		setAction: async () => assert.fail(),
	});
	await target.load();
	target.useManaged(() => null);
	for (const [i, entry] of exported.entries()) {
		target.receiveAction(String(i), entry.kind, entry.settings);
		assert.deepEqual(target.getAction(String(i)), entry.settings);
	}
	assert.equal(target.getConnection(), null);
	assert.equal(target.legacyConnection(), null);
});
