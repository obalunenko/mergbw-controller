import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { InspectorController, type InspectorReply, parseMessage, safeSnapshot } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { deferred, fixture, MemoryStorage, syntheticToken } from "./helpers.js";

const message = (type: string, payload: Record<string, unknown> = {}, sessionId = "session") => ({
	v: 2,
	sessionId,
	requestId: randomUUID(),
	type,
	payload,
});

test("envelope version, type, context and payload fields are constrained", () => {
	for (const raw of [
		{},
		message("bogus"),
		{ ...message("inspector.get"), v: 1 },
		{ ...message("inspector.get"), sessionId: "bad id" },
		message("connection.check", { context: "foreign" }),
		{ ...message("inspector.get"), requestId: "" },
	])
		assert.throws(() => parseMessage("a", raw));
	assert.throws(() => parseMessage("", message("inspector.get")));
	assert.equal(parseMessage("a", message("inspector.get")).type, "inspector.get");
});

test("PI read checks and obsolete setup never send commands or echo secrets", async () => {
	let commands = 0;
	const server = await fixture((req, res) => {
		if (req.method === "POST") commands++;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify(
				req.url === "/health"
					? { ok: true, version: "test", bluetooth_connected: false, physical_state_verified: false }
					: { presets: [], physical_state_verified: false },
			),
		);
	});
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	settings.receiveAction("a", "on", {});
	await settings.saveConnection(server.port, syntheticToken);
	const ops = new OperationStore();
	const replies: InspectorReply[] = [];
	const pi = new InspectorController(settings, ops, new BridgeClient(), (reply) => {
		replies.push(reply);
	});
	try {
		await pi.receive("a", message("inspector.get"));
		await pi.receive("a", {
			...message("connection.save", { port: server.port, replacementToken: syntheticToken }),
			v: 1,
		});
		assert.equal(replies.at(-1)?.messageKey, "migration_required");
		await pi.receive("a", message("connection.check"));
		assert.equal(replies.at(-1)?.snapshot?.check?.authorization, "verified");
		assert.equal(replies.at(-1)?.snapshot?.check?.bluetooth, "disconnected");
		await pi.receive("a", message("inspector.close"));
		assert.equal(commands, 0);
		assert.ok(!JSON.stringify(replies).includes(syntheticToken));
		assert.ok(!JSON.stringify(safeSnapshot("a", settings, ops)).includes(syntheticToken));
	} finally {
		pi.dispose();
		await server.close();
	}
});

test("health does not verify token and legacy catalog stays unknown", async () => {
	const server = await fixture((req, res) => {
		res.setHeader("content-type", "application/json");
		if (req.url === "/health")
			res.end(JSON.stringify({ ok: true, version: "old", bluetooth_connected: true, physical_state_verified: false }));
		else {
			res.statusCode = 400;
			res.end("{}");
		}
	});
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const replies: InspectorReply[] = [];
	const pi = new InspectorController(settings, new OperationStore(), new BridgeClient(), (r) => {
		replies.push(r);
	});
	try {
		await pi.receive("a", message("inspector.get"));
		await pi.receive("a", message("connection.check"));
		const check = replies.at(-1)?.snapshot?.check;
		assert.equal(check?.service, "available");
		assert.equal(check?.authorization, "unknown");
		assert.equal(check?.catalog, "unsupported");
	} finally {
		pi.dispose();
		await server.close();
	}
});

test("late old-session read reply is discarded", async () => {
	const pending = deferred<void>();
	const server = await fixture(async (req, res) => {
		await pending.promise;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify(
				req.url === "/health"
					? { ok: true, version: "test", bluetooth_connected: false, physical_state_verified: false }
					: { presets: [], physical_state_verified: false },
			),
		);
	});
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const replies: InspectorReply[] = [];
	const pi = new InspectorController(settings, new OperationStore(), new BridgeClient(), (r) => {
		replies.push(r);
	});
	try {
		await pi.receive("a", message("inspector.get"));
		const check = pi.receive("a", message("connection.check"));
		await pi.receive("a", message("inspector.get", {}, "new"));
		const count = replies.length;
		pending.resolve();
		await check;
		assert.equal(replies.length, count);
	} finally {
		pending.resolve();
		pi.dispose();
		await server.close();
	}
});

test("save acknowledgements retain their identity after intervening requests and suppress replaced sessions", async () => {
	for (const saveType of ["assignment.save", "language.save"]) {
		for (const interveningType of ["language.save", "connection.check", "presets.refresh", "inspector.get"]) {
			for (const fails of [false, true]) {
				const storage = new MemoryStorage();
				const settings = new Settings(storage);
				await settings.load();
				await settings.saveConnection(18766, syntheticToken);
				settings.receiveAction("a", "color", { schemaVersion: 1, rgb: "FF5000" });
				const pending = deferred<void>();
				let first = true;
				const pause = async () => {
					if (!first) return;
					first = false;
					await pending.promise;
					if (fails) throw new Error(`Synthetic failure ${syntheticToken}`);
				};
				const persistAction = storage.setAction;
				const persistGlobal = storage.setGlobal;
				if (saveType === "assignment.save")
					storage.setAction = async (context, value) => {
						await pause();
						await persistAction(context, value);
					};
				else
					storage.setGlobal = async (value) => {
						await pause();
						await persistGlobal(value);
					};
				let commands = 0;
				const client = new BridgeClient();
				client.command = async () => {
					commands++;
					return { status: "sent" };
				};
				client.health = async () => ({
					value: { ok: true, version: "fixture", bluetooth_connected: false, physical_state_verified: false },
				});
				client.catalog = async () => ({ value: { presets: [], physical_state_verified: false } });
				const replies: InspectorReply[] = [];
				const pi = new InspectorController(settings, new OperationStore(), client, (reply) => {
					replies.push(reply);
				});
				try {
					await pi.receive("a", message("inspector.get"));
					const saving = pi.receive("a", {
						...message(
							saveType,
							saveType === "assignment.save" ? { settings: { schemaVersion: 1, rgb: "00FF00" } } : { language: "ru" },
						),
						requestId: "save",
					});
					const intervening = pi.receive("a", {
						...message(
							interveningType,
							interveningType === "language.save" ? { language: "ru" } : {},
							interveningType === "inspector.get" ? "replacement" : "session",
						),
						requestId: "other",
					});
					pending.resolve();
					await Promise.all([saving, intervening]);
					const acknowledgements = replies.filter((reply) => reply.requestId === "save" && reply.complete);
					assert.equal(acknowledgements.length, interveningType === "inspector.get" ? 0 : 1);
					if (acknowledgements.length) {
						assert.equal(acknowledgements[0]!.ok, !fails);
						assert.equal(acknowledgements[0]!.messageKey, fails ? "storage" : undefined);
					}
					assert.equal(commands, 0);
					assert.ok(!JSON.stringify(replies).includes(syntheticToken));
					if (fails && interveningType !== "inspector.get") {
						await pi.receive("a", {
							...message(
								saveType,
								saveType === "assignment.save" ? { settings: { schemaVersion: 1, rgb: "0000FF" } } : { language: "en" },
							),
							requestId: "retry",
						});
						assert.equal(replies.at(-1)?.complete, true);
						assert.equal(replies.at(-1)?.ok, true);
						assert.equal(
							saveType === "assignment.save" ? settings.getAction("a").rgb : settings.getLanguage(),
							saveType === "assignment.save" ? "0000FF" : "en",
						);
					}
				} finally {
					pi.dispose();
				}
			}
		}
	}
});

test("read-only timeouts preserve assignments and independent status without implying an unknown lamp command", async () => {
	for (const type of ["connection.check", "presets.refresh"]) {
		const settings = new Settings(new MemoryStorage());
		await settings.load();
		await settings.saveConnection(18766, syntheticToken);
		settings.receiveAction("a", "color", { schemaVersion: 1, rgb: "FF5000" });
		const client = new BridgeClient();
		let commands = 0;
		client.command = async () => {
			commands++;
			return { status: "sent" };
		};
		client.health = async () => ({
			value: { ok: true, version: "fixture", bluetooth_connected: true, physical_state_verified: false },
		});
		client.catalog = async () => ({ value: { presets: [], physical_state_verified: false } });
		const pi = new InspectorController(settings, new OperationStore(), client, () => {});
		try {
			await pi.receive("a", message("inspector.get"));
			await pi.receive("a", message("connection.check"));
			client.health = async () => ({ errorCategory: "timeout" });
			client.catalog = async () => ({ errorCategory: "timeout" });
			await pi.receive("a", message(type));
			const snapshot = pi.snapshot("a");
			assert.equal(snapshot.check?.messageKey, "readTimeout");
			assert.equal(snapshot.check?.service, type === "connection.check" ? "unavailable" : "available");
			assert.equal(snapshot.check?.bluetooth, type === "connection.check" ? "unknown" : "connected");
			assert.equal(snapshot.check?.authorization, "unknown");
			assert.equal(snapshot.catalog?.status, "unavailable");
			assert.deepEqual(snapshot.assignment, { schemaVersion: 1, rgb: "FF5000" });
			assert.equal(snapshot.operation, undefined);
			assert.equal(commands, 0);
			assert.equal(settings.getConnection()?.port, 18766);
		} finally {
			pi.dispose();
		}
	}
});
