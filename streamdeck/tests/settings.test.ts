import assert from "node:assert/strict";
import { test } from "node:test";

import { Settings } from "../src/settings.js";
import { globals, port, token } from "../src/validation.js";
import { deferred, MemoryStorage, syntheticToken } from "./helpers.js";

test("blank, invalid and unknown storage preserve trust boundaries", async () => {
	assert.deepEqual(globals({}), { schemaVersion: 2, language: "en" });
	for (const raw of [
		null,
		undefined,
		[],
		{ schemaVersion: 2 },
		{ schemaVersion: 1, connection: { port: 80, accessToken: syntheticToken } },
	]) {
		const storage = new MemoryStorage();
		storage.global = raw;
		const settings = new Settings(storage);
		await settings.load();
		assert.throws(() => settings.get());
		assert.deepEqual(storage.global, raw);
	}
	for (const value of [1024, 65535]) assert.equal(port(value), value);
	for (const value of [1023, 65536, 1.5, "18765", NaN]) assert.throws(() => port(value));
	for (const value of ["a".repeat(24), "a".repeat(128)]) assert.equal(token(value), value);
	for (const value of ["a".repeat(23), "a".repeat(129), "!".repeat(24), 24]) assert.throws(() => token(value));
});

test("offline saves, restart, blank replacement and language-only changes retain connection", async () => {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	await settings.saveConnection(18767, "");
	await settings.saveLanguage("ru");
	const restored = new Settings(storage);
	await restored.load();
	assert.deepEqual(restored.get(), {
		schemaVersion: 1,
		connection: { port: 18767, accessToken: syntheticToken },
		language: "ru",
	});
	assert.equal(settings.connectionRevision, 2);
	assert.equal(storage.actions.size, 0);
	await assert.rejects(new Settings(new MemoryStorage()).saveConnection(18766, ""));
});

test("failed save preserves active snapshot and concurrent saves serialize", async () => {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	storage.fail = true;
	await assert.rejects(settings.saveConnection(18767, "b".repeat(24)));
	assert.equal(settings.getConnection()?.port, 18766);
	assert.equal(settings.connectionRevision, 1);
	storage.fail = false;
	await Promise.all([
		settings.saveConnection(18768, ""),
		settings.saveLanguage("ru"),
		settings.saveConnection(18769, ""),
	]);
	assert.deepEqual(settings.get(), {
		schemaVersion: 1,
		connection: { port: 18769, accessToken: syntheticToken },
		language: "ru",
	});
});

test("persisted power assignments allowlist schema and exclude connection, token, URL", async () => {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	settings.receiveAction("a", "on", {});
	await settings.saveAction("a", {
		schemaVersion: 1,
		accessToken: syntheticToken,
		connection: { port: 18766 },
		url: "http://synthetic.invalid/",
	});
	assert.deepEqual(storage.actions.get("a"), { schemaVersion: 1 });
	settings.receiveAction("a", "on", { schemaVersion: 2 });
	assert.throws(() => settings.getAction("a"));
});

test("initial loading serializes later import and saves without restoring a stale connection", async () => {
	for (const mode of ["import", "save"] as const) {
		const storage = new MemoryStorage();
		const read = deferred<unknown>();
		storage.getGlobal = () => read.promise;
		const settings = new Settings(storage);
		const loading = settings.load();
		const connection = { port: 18767, accessToken: "new_token_1234567890123456" };
		const saving =
			mode === "import"
				? settings.importConnection(connection)
				: settings.saveConnection(connection.port, connection.accessToken);
		read.resolve({ schemaVersion: 1, connection: { port: 18766, accessToken: syntheticToken }, language: "ru" });
		await Promise.all([loading, saving]);
		assert.deepEqual(settings.get(), { schemaVersion: 1, connection, language: "ru" });
		assert.deepEqual(storage.global, settings.get());
		assert.equal(settings.connectionRevision, 2);
	}
});
