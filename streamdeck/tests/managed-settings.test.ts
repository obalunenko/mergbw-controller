import assert from "node:assert/strict";
import test from "node:test";

import { Settings } from "../src/settings.js";
import { assignment, globals } from "../src/validation.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

test("v2 globals contain language only; legacy source survives until disk commit", async () => {
	const store = new MemoryStorage();
	store.global = { schemaVersion: 1, connection: { port: 18765, accessToken: syntheticToken }, language: "ru" };
	const settings = new Settings(store);
	await settings.load();
	assert.deepEqual(settings.legacyConnection(), { port: 18765, accessToken: syntheticToken });
	settings.useManaged(() => null);
	assert.equal(settings.getConnection(), null);
	assert.equal((store.global as { schemaVersion: number }).schemaVersion, 1);
	await settings.migrateCommitted();
	assert.deepEqual(store.global, { schemaVersion: 2, language: "ru" });
	assert.equal(settings.legacyConnection(), null);
});
test("empty globals are v2 and unknown versions are preserved without overwrite", async () => {
	assert.deepEqual(globals({}), { schemaVersion: 2, language: "en" });
	assert.deepEqual(globals({ schemaVersion: 2, language: "en" }), { schemaVersion: 2, language: "en" });
	assert.throws(() =>
		globals({ schemaVersion: 2, language: "en", connection: { port: 18765, accessToken: syntheticToken } }),
	);
	const store = new MemoryStorage();
	store.global = { schemaVersion: 3, language: "ru" };
	const settings = new Settings(store);
	await settings.load();
	await assert.rejects(settings.saveLanguage("en"));
	await assert.rejects(settings.migrateCommitted());
	assert.deepEqual(store.global, { schemaVersion: 3, language: "ru" });
});
test("legacy cleanup storage failure keeps source and action v1 assignments", async () => {
	const store = new MemoryStorage();
	store.global = { schemaVersion: 1, connection: null, language: "en" };
	const settings = new Settings(store);
	await settings.load();
	settings.receiveAction("key", "color", { schemaVersion: 1, rgb: "ab12ef" });
	store.fail = true;
	await assert.rejects(settings.migrateCommitted(), /storage/);
	assert.equal((store.global as { schemaVersion: number }).schemaVersion, 1);
	assert.deepEqual(settings.getAction("key"), { schemaVersion: 1, rgb: "AB12EF" });
	assert.deepEqual(assignment("on", {}), { schemaVersion: 1 });
	assert.equal(store.actions.size, 0);
});
