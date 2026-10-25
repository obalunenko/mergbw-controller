import type { KeyDownEvent, KeyUpEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Scene } from "../src/actions/scene.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { RAW_SCENE_IDS, SCENE_ROUTE, SCENE_ROUTE_SOURCE, SCENES, sceneSelector } from "../src/scenes.js";
import { Settings } from "../src/settings.js";
import { type Assignment, assignment, parseConnectionLink } from "../src/validation.js";
import { fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

// Canonical table from specs/009-full-command-scene-support/contracts/scenes.md.
const contract: [string, string, number][] = [
	["red", "Red", 0x80],
	["green", "Green", 0x81],
	["night", "Night", 0x82],
	["sunrise", "Sunrise", 0x83],
	["ghost", "Ghost", 0x84],
	["pink", "Pink", 0x85],
	["warmwhite", "Warm White", 0x86],
	["disco", "Disco", 0x87],
	["party", "Party", 0x88],
	["rgbfade", "RGB Fade", 0x89],
	["rainbowfade", "Rainbow Fade", 0x8a],
	["redpulse", "Red Pulse", 0x8b],
	["greenpulse", "Green Pulse", 0x8c],
	["bluepulse", "Blue Pulse", 0x8d],
	["amberpulse", "Amber Pulse", 0x8e],
	["icepulse", "Ice Pulse", 0x8f],
	["pinkpulse", "Pink Pulse", 0x90],
	["whitepulse", "White Pulse", 0x91],
	["greenredpulse", "Green Red Pulse", 0x92],
	["blueredpulse", "Blue Red Pulse", 0x93],
];

test("scene catalog mirrors the contract table in order", () => {
	assert.deepEqual(
		SCENES.map((scene) => ({ ...scene })),
		contract.map(([slug, label, id]) => ({ slug, label, id })),
	);
	assert.deepEqual(
		RAW_SCENE_IDS,
		Array.from({ length: 20 }, (_, index) => 0x80 + index),
	);
	assert.equal(SCENE_ROUTE_SOURCE, "scene\\/(?:[a-z]{1,40}|[0-9A-Fa-f]{2})");
	assert.equal(SCENE_ROUTE.source, "^scene\\/([a-z]{1,40}|[0-9A-F]{2})$");
	assert.equal(SCENE_ROUTE.flags, "");
	assert.equal(sceneSelector("disco"), "disco");
	assert.equal(sceneSelector("8a"), "8A");
	assert.equal(sceneSelector("0x92"), "92");
	for (const invalid of ["Disco", "green prairie", "94", "7F", "0x", "8", "abc", ""])
		assert.equal(sceneSelector(invalid), undefined, invalid);
});

test("scene assignment defaults to disco, canonicalizes hex and rejects invalid selectors", () => {
	assert.deepEqual(assignment("scene", {}), { schemaVersion: 1, sceneId: "disco" });
	assert.deepEqual(assignment("scene", { schemaVersion: 1, sceneId: "rgbfade" }), {
		schemaVersion: 1,
		sceneId: "rgbfade",
	});
	for (const raw of ["0x8a", "8a", "8A", "0X8A"])
		assert.deepEqual(assignment("scene", { schemaVersion: 1, sceneId: raw }), { schemaVersion: 1, sceneId: "8A" });
	for (const sceneId of ["94", "Disco", "green prairie", 0x87, null, undefined])
		assert.throws(() => assignment("scene", { schemaVersion: 1, sceneId }), /validation/, String(sceneId));
	assert.throws(() => assignment("scene", { schemaVersion: 2, sceneId: "disco" }), /validation/);
});

test("bridge client sends only canonical scene routes", async () => {
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		requests.push(`${req.method} ${req.url}`);
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				sent: true,
				action: req.url!.split("/").slice(2).join("/"),
				physical_state_verified: false,
			}),
		);
	});
	const connection = { port: server.port, accessToken: syntheticToken };
	const client = new BridgeClient();
	const ops = new OperationStore();
	const run = async (route: string) => {
		const context = `ctx-${route}`;
		ops.appear(context);
		const record = ops.acquire({
			context,
			actionKind: "scene",
			settingsRevision: 1,
			connectionRevision: 1,
			snapshot: { route, connection },
		})!;
		return client.command(record);
	};
	try {
		assert.equal((await run("scene/disco")).status, "sent");
		assert.equal((await run("scene/8A")).status, "sent");
		for (const route of ["scene/94", "scene/Disco", "scene/8a", "scene/0x8A", "scene/disco/extra"])
			assert.deepEqual(await run(route), { status: "rejected", errorCategory: "validation" }, route);
		assert.deepEqual(requests, [`POST /${syntheticToken}/scene/disco`, `POST /${syntheticToken}/scene/8A`]);
	} finally {
		await server.close();
	}
});

test("connection links accept catalog and in-range raw scene routes only", () => {
	const base = `http://127.0.0.1:18765/${syntheticToken}`;
	for (const route of ["scene/disco", "scene/8a", "scene/8A", "scene/92"])
		assert.deepEqual(parseConnectionLink(`${base}/${route}`), { port: 18765, accessToken: syntheticToken }, route);
	for (const route of ["scene/Disco", "scene/94", "scene/7F", "scene/0x8A", "scene/unknown", "Scene/disco"])
		assert.throws(() => parseConnectionLink(`${base}/${route}`), /validation/, route);
});

test("scene key press sends the assigned scene route", async () => {
	const requests: string[] = [];
	const server = await fixture((req, res) => {
		requests.push(`${req.method} ${req.url}`);
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ sent: true, action: "scene/disco", physical_state_verified: false }));
	});
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(server.port, syntheticToken);
	const operations = new OperationStore();
	const client = new BridgeClient();
	const inspector = new InspectorController(settings, operations, client, () => {});
	const action = new Scene({ settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) });
	const key = new KeyFacade();
	const ev = { action: { id: "scene-key", isKey: () => true, ...key }, payload: { settings: {} } };
	try {
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		assert.deepEqual(key.titles, ["Disco"]);
		assert.deepEqual(key.images, ["imgs/scene.png"]);
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		action.onKeyUp?.(ev as unknown as KeyUpEvent<Assignment>);
		assert.equal(key.oks, 1);
		assert.equal(key.alerts, 0);
		assert.deepEqual(requests, [`POST /${syntheticToken}/scene/disco`]);
	} finally {
		inspector.dispose();
		await server.close();
	}
});
