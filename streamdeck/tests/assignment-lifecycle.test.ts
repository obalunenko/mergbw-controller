import assert from "node:assert/strict";
import { test } from "node:test";

import { safeSnapshot } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { ActionKind, Assignment } from "../src/validation.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

const assignments: [ActionKind, Assignment][] = [
	["on", { schemaVersion: 1 }],
	["off", { schemaVersion: 1 }],
	["color", { schemaVersion: 1, rgb: "FF5000" }],
	["brightness", { schemaVersion: 1, percent: 25 }],
	["preset", { schemaVersion: 1, presetId: "custom_evening" }],
];

test("all five exported assignments are allowlisted and copies remain independent", async () => {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	for (const [kind, value] of assignments) {
		settings.receiveAction(kind, kind, value);
		await settings.saveAction(kind, {
			...value,
			accessToken: syntheticToken,
			url: `http://127.0.0.1:18766/${syntheticToken}/on`,
			connection: settings.getConnection(),
			title: "Host custom title",
			image: "host-image.png",
		});
		assert.deepEqual(storage.actions.get(kind), value);
		settings.receiveAction(`${kind}-copy`, kind, storage.actions.get(kind));
	}
	await settings.saveAction("color-copy", { schemaVersion: 1, rgb: "0000FF" });
	await settings.saveAction("brightness-copy", { schemaVersion: 1, percent: 75 });
	await settings.saveAction("preset-copy", { schemaVersion: 1, presetId: "sunset" });
	assert.equal(settings.getAction("color").rgb, "FF5000");
	assert.equal(settings.getAction("brightness").percent, 25);
	assert.equal(settings.getAction("preset").presetId, "custom_evening");
	const exported = JSON.stringify([...storage.actions]);
	assert.ok(!exported.includes(syntheticToken));
	assert.ok(!exported.includes("http:"));
	assert.ok(!exported.includes("title"));
	assert.ok(!exported.includes("image"));
});

test("ten imported assignments survive three restarts and use only installation globals", async () => {
	const storage = new MemoryStorage();
	const original = new Settings(storage);
	await original.load();
	await original.saveConnection(18766, syntheticToken);
	for (const [kind, value] of assignments) {
		original.receiveAction(kind, kind, value);
		original.receiveAction(`${kind}-copy`, kind, value);
		await original.saveAction(kind, value);
		await original.saveAction(`${kind}-copy`, value);
	}
	for (let restart = 0; restart < 3; restart++) {
		const restored = new Settings(storage);
		await restored.load();
		for (const [kind, value] of assignments)
			for (const context of [kind, `${kind}-copy`]) {
				restored.receiveAction(context, kind, storage.actions.get(context));
				assert.deepEqual(restored.getAction(context), value);
				assert.equal(safeSnapshot(context, restored, new OperationStore()).connection.configured, true);
			}
		assert.equal(restored.getConnection()?.accessToken, syntheticToken);
		assert.equal(new OperationStore().get("on"), undefined);
	}
	const clean = new Settings(new MemoryStorage());
	await clean.load();
	for (const [kind, value] of assignments) {
		clean.receiveAction(kind, kind, storage.actions.get(kind));
		const snapshot = safeSnapshot(kind, clean, new OperationStore());
		assert.deepEqual(snapshot.assignment, value);
		assert.equal(snapshot.connection.configured, false);
		assert.ok(!JSON.stringify(snapshot).includes(syntheticToken));
	}
});

test("equivalent settings notifications retain revisions while actual UUID or value changes advance", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	settings.receiveAction("a", "color", {});
	const revision = settings.revision("a");
	settings.receiveAction("a", "color", { rgb: "ff5000", schemaVersion: 1, title: "host override" });
	assert.equal(settings.revision("a"), revision);
	await settings.saveAction("a", { schemaVersion: 1, rgb: "FF5000" });
	assert.equal(settings.revision("a"), revision);
	settings.receiveAction("a", "color", { schemaVersion: 1, rgb: "0000FF" });
	assert.equal(settings.revision("a"), revision + 1);
	settings.receiveAction("a", "on", { schemaVersion: 1 });
	assert.equal(settings.revision("a"), revision + 2);
});

test("corrupt and unknown assignments are neither reset nor persisted on receipt", async () => {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	for (const raw of [{ schemaVersion: 9, rgb: "FFFFFF" }, { schemaVersion: 1, percent: "25" }, null]) {
		settings.receiveAction("a", "brightness", raw);
		assert.throws(() => settings.getAction("a"));
		assert.equal(safeSnapshot("a", settings, new OperationStore()).settingsValid, false);
		assert.equal(storage.actions.size, 0);
		const revision = settings.revision("a");
		settings.receiveAction("a", "brightness", structuredClone(raw));
		assert.equal(settings.revision("a"), revision);
	}
	await settings.saveAction("a", { schemaVersion: 1, percent: 50 });
	assert.equal(settings.getAction("a").percent, 50);
});
