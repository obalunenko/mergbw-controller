import assert from "node:assert/strict";
import test from "node:test";

import { Settings } from "../src/settings.js";
import { globals, parseConnectionLink } from "../src/validation.js";
import { MemoryStorage, syntheticToken } from "./helpers.js";

test("legacy endpoints and command links have no identity and need explicit manual setup", async () => {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 1, language: "ru", connection: { port: 23456, accessToken: syntheticToken } };
	const settings = new Settings(storage);
	await settings.load();
	settings.useManaged(() => null);
	assert.equal(settings.getConnection(), null);
	assert.deepEqual(settings.legacyConnection(), { port: 23456, accessToken: syntheticToken });
	assert.deepEqual(parseConnectionLink(`http://127.0.0.1:23456/${syntheticToken}/on`), settings.legacyConnection());
	assert.equal("identity" in settings.legacyConnection()!, false);
	assert.equal((storage.global as { schemaVersion: number }).schemaVersion, 1);
});
test("failed globals cleanup retains legacy data but never outranks authoritative disk", async () => {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 1, language: "ru", connection: { port: 23456, accessToken: syntheticToken } };
	const before = structuredClone(storage.global);
	const settings = new Settings(storage);
	await settings.load();
	const disk = { port: 34567, accessToken: "new_synthetic_token_123456789" };
	settings.useManaged(() => disk);
	storage.fail = true;
	await assert.rejects(settings.migrateCommitted());
	assert.deepEqual(storage.global, before);
	assert.deepEqual(settings.getConnection(), disk);
	storage.fail = false;
	await settings.migrateCommitted();
	await settings.migrateCommitted();
	assert.deepEqual(storage.global, { schemaVersion: 2, language: "ru" });
	assert.deepEqual(settings.getConnection(), disk);
});
test("unknown and corrupt global versions are preserved without automatic reset", async () => {
	for (const raw of [
		{ schemaVersion: 99, language: "ru", private: "future" },
		{ schemaVersion: 1, connection: { port: 1, accessToken: "bad" }, language: "en" },
	]) {
		const storage = new MemoryStorage();
		storage.global = raw;
		const settings = new Settings(storage);
		await settings.load();
		await assert.rejects(settings.migrateCommitted());
		await assert.rejects(settings.saveLanguage("ru"));
		assert.deepEqual(storage.global, raw);
		assert.throws(() => globals(raw));
	}
});
