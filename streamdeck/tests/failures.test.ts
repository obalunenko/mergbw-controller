import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { OperationStore } from "../src/operation-store.js";
import { ControlledClock, deferred, fixture, syntheticToken } from "./helpers.js";

function operation(port: number, clock = new ControlledClock(), route = "on") {
	const store = new OperationStore(clock);
	store.appear("key");
	return store.acquire({
		context: "key",
		actionKind: route.startsWith("preset") ? "preset" : "on",
		settingsRevision: 1,
		connectionRevision: 1,
		snapshot: { route, connection: { port, accessToken: syntheticToken } },
	})!;
}

test("offline before dispatch is a definite service rejection", async () => {
	const server = await fixture(() => {});
	await server.close();
	const result = await new BridgeClient().command(operation(server.port));
	assert.equal(result.status, "rejected");
	assert.equal(result.errorCategory, "service");
});

test("status taxonomy uses HTTP status rather than server error text, with no retry", async () => {
	for (const [status, route, outcome, category] of [
		[400, "on", "rejected", "parameter"],
		[400, "preset/night", "rejected", "preset"],
		[403, "on", "rejected", "auth"],
		[404, "on", "rejected", "protocol"],
		[405, "on", "rejected", "protocol"],
		[503, "on", "unknown", "backend"],
		[504, "on", "unknown", "timeout"],
		[302, "on", "unknown", "protocol"],
	] as const) {
		let calls = 0;
		const server = await fixture((_req, res) => {
			calls++;
			res.writeHead(status, { "content-type": "application/json", location: "/followed" });
			res.end(JSON.stringify({ error: "Любой текст", physical_state_verified: false }));
		});
		try {
			const result = await new BridgeClient().command(operation(server.port, undefined, route));
			assert.equal(result.status, outcome, String(status));
			assert.equal(result.errorCategory, category, String(status));
			assert.equal(calls, 1);
		} finally {
			await server.close();
		}
	}
});

test("invalid, truncated, oversized, redirected and lost responses never claim sent or retry", async () => {
	for (const mode of ["type", "schema", "action", "state", "json", "truncated", "oversized", "stream-cap", "lost"]) {
		let calls = 0;
		const server = await fixture((req, res) => {
			calls++;
			if (mode === "lost") {
				req.socket.destroy();
				return;
			}
			res.setHeader("content-type", mode === "type" ? "text/html" : "application/json");
			if (mode === "truncated") {
				res.setHeader("content-length", 1000);
				res.write('{"sent":true');
				res.flushHeaders();
				setImmediate(() => res.destroy());
				return;
			}
			if (mode === "oversized") {
				res.setHeader("content-length", 65537);
				res.end("x");
				return;
			}
			if (mode === "stream-cap") {
				res.write("x".repeat(65537));
				res.end();
				return;
			}
			if (mode === "json") {
				res.end("{");
				return;
			}
			res.end(
				JSON.stringify({
					sent: mode !== "schema",
					action: mode === "action" ? "off" : "on",
					physical_state_verified: mode === "state",
				}),
			);
		});
		try {
			const result = await new BridgeClient().command(operation(server.port));
			assert.equal(result.status, "unknown", mode);
			assert.ok(["protocol", "service"].includes(result.errorCategory!), mode);
			assert.equal(calls, 1, mode);
		} finally {
			await server.close();
		}
	}
});

test("one total deadline includes response body and activation time; read-only deadline is 5 seconds", async () => {
	for (const mode of ["command", "health", "catalog"] as const) {
		const clock = new ControlledClock();
		const received = deferred<void>();
		let calls = 0;
		const server = await fixture((_req, res) => {
			calls++;
			res.writeHead(200, { "content-type": "application/json" });
			res.write('{"incomplete":');
			received.resolve();
		});
		try {
			const client = new BridgeClient(clock);
			const record = operation(server.port, clock);
			if (mode === "command") clock.advance(10000);
			const promise =
				mode === "command" ? client.command(record) : client[mode]({ port: server.port, accessToken: syntheticToken });
			await received.promise;
			clock.advance(mode === "command" ? 34999 : 4999);
			let completed = false;
			void promise.then(() => {
				completed = true;
			});
			await Promise.resolve();
			assert.equal(completed, false);
			clock.advance(1);
			const result = await promise;
			assert.equal(result.errorCategory, "timeout");
			if ("status" in result) assert.equal(result.status, "unknown");
			assert.equal(calls, 1);
		} finally {
			await server.close();
		}
	}
});
