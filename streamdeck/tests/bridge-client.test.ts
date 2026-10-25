import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeClient } from "../src/bridge-client.js";
import { OperationStore } from "../src/operation-store.js";
import { parseConnectionLink } from "../src/validation.js";
import { ControlledClock, fixture, syntheticToken } from "./helpers.js";

test("import checks raw syntax and extracts connection without side effects", () => {
	for (const route of ["on", "off", "color/fF5000", "brightness/100", "preset/sunset"]) {
		assert.deepEqual(parseConnectionLink(`  http://LOCALHOST:18766/${syntheticToken}/${route}  `), {
			port: 18766,
			accessToken: syntheticToken,
		});
	}
	for (const suffix of [
		"on/",
		"on?",
		"on#",
		"on?x=1",
		"on\n/off",
		"%6fn",
		"x/../on",
		"brightness/101",
		"preset/UPPER",
	]) {
		assert.throws(() => parseConnectionLink(`http://127.0.0.1:18766/${syntheticToken}/${suffix}`));
	}
	for (const host of ["127.1", "2130706433", "[::1]", "user@localhost", "localhost.", "0x7f000001"])
		assert.throws(() => parseConnectionLink(`http://${host}:18766/${syntheticToken}/on`));
	for (const value of [
		`https://localhost:18766/${syntheticToken}/on`,
		`http://localhost/${syntheticToken}/on`,
		`http://localhost:80/${syntheticToken}/on`,
		`http://localhost:18766\\${syntheticToken}/on`,
	])
		assert.throws(() => parseConnectionLink(value));
});

test("fixed IPv4 transport uses exact read-only GET and body-free POST, ignoring proxy", async () => {
	const seen: string[] = [];
	const server = await fixture((req, res) => {
		seen.push(`${req.method} ${req.url}`);
		assert.equal(req.headers.host, `127.0.0.1:${server.port}`);
		if (req.method === "POST") assert.equal(req.headers["content-length"], "0");
		res.setHeader("content-type", "application/json");
		if (req.url === "/health")
			res.end(
				JSON.stringify({ ok: true, version: "test", bluetooth_connected: false, physical_state_verified: false }),
			);
		else if (req.url?.endsWith("/presets")) res.end(JSON.stringify({ presets: [], physical_state_verified: false }));
		else res.end(JSON.stringify({ sent: true, action: "on", physical_state_verified: false }));
	});
	try {
		const client = new BridgeClient();
		const connection = { port: server.port, accessToken: syntheticToken };
		assert.equal((await client.health(connection)).value?.bluetooth_connected, false);
		assert.deepEqual((await client.catalog(connection)).value?.presets, []);
		const ops = new OperationStore();
		ops.appear("a");
		const record = ops.acquire({
			context: "a",
			actionKind: "on",
			settingsRevision: 1,
			connectionRevision: 1,
			snapshot: { route: "on", connection },
		})!;
		assert.equal((await client.command(record)).status, "sent");
		ops.finish(record, { status: "sent" });
		assert.deepEqual(seen, ["GET /health", `GET /${syntheticToken}/presets`, `POST /${syntheticToken}/on`]);
	} finally {
		await server.close();
	}
});

test("unsafe responses never succeed, redirect or retry", async () => {
	for (const reply of [
		{ sent: true, action: "off", physical_state_verified: false },
		{ sent: true, action: "on", physical_state_verified: true },
		{ sent: false, action: "on", physical_state_verified: false },
		"invalid",
		"x".repeat(65537),
	]) {
		let count = 0;
		const server = await fixture((_req, res) => {
			count++;
			res.setHeader("content-type", "application/json");
			res.end(typeof reply === "string" ? reply : JSON.stringify(reply));
		});
		const ops = new OperationStore();
		ops.appear("a");
		const record = ops.acquire({
			context: "a",
			actionKind: "on",
			settingsRevision: 1,
			connectionRevision: 1,
			snapshot: { route: "on", connection: { port: server.port, accessToken: syntheticToken } },
		})!;
		try {
			assert.equal((await new BridgeClient().command(record)).status, "unknown");
			assert.equal(count, 1);
		} finally {
			ops.finish(record, { status: "unknown" });
			await server.close();
		}
	}
	let count = 0;
	const server = await fixture((_req, res) => {
		count++;
		res.writeHead(302, { location: "/health" });
		res.end();
	});
	try {
		assert.equal(
			(await new BridgeClient().health({ port: server.port, accessToken: syntheticToken })).errorCategory,
			"protocol",
		);
		assert.equal(count, 1);
	} finally {
		await server.close();
	}
});

test("read caps reject health over 64 KiB and catalog over 1 MiB", async () => {
	const server = await fixture((req, res) => {
		res.setHeader("content-type", "application/json");
		res.end(" ".repeat(req.url === "/health" ? 65537 : 1048577));
	});
	try {
		const client = new BridgeClient();
		const c = { port: server.port, accessToken: syntheticToken };
		assert.equal((await client.health(c)).errorCategory, "protocol");
		assert.equal((await client.catalog(c)).errorCategory, "protocol");
	} finally {
		await server.close();
	}
});

test("total deadline includes elapsed setup and finalizes once", async () => {
	const clock = new ControlledClock();
	const ops = new OperationStore(clock);
	ops.appear("a");
	const server = await fixture(() => {});
	const record = ops.acquire({
		context: "a",
		actionKind: "on",
		settingsRevision: 1,
		connectionRevision: 1,
		snapshot: { route: "on", connection: { port: server.port, accessToken: syntheticToken } },
	})!;
	clock.advance(44999);
	const pending = new BridgeClient(clock).command(record);
	clock.advance(1);
	try {
		assert.equal((await pending).errorCategory, "timeout");
		assert.equal(record.status, "unknown");
		assert.equal(ops.finish(record, { status: "sent" }), false);
	} finally {
		await server.close();
	}
});
