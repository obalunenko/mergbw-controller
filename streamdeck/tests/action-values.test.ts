import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Brightness } from "../src/actions/brightness.js";
import { Color } from "../src/actions/color.js";
import { Preset } from "../src/actions/preset.js";
import { BridgeClient } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import { type ActionKind, assignment, type Assignment, colorInput } from "../src/validation.js";
import { KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

test("new actions alone receive defaults; assignments serialize only their UUID's fields", () => {
	assert.deepEqual(assignment("color", {}), { schemaVersion: 1, rgb: "FF5000" });
	assert.deepEqual(assignment("brightness", {}), { schemaVersion: 1, percent: 50 });
	assert.deepEqual(assignment("preset", {}), { schemaVersion: 1 });
	for (const kind of ["color", "brightness", "preset"] as const)
		for (const raw of [null, [], { schemaVersion: 2 }, { rgb: "FF5000" }, { schemaVersion: "1" }])
			assert.throws(() => assignment(kind, raw));
	assert.throws(() => assignment("color", { schemaVersion: 1 }));
	assert.throws(() => assignment("brightness", { schemaVersion: 1 }));
	assert.deepEqual(assignment("color", { schemaVersion: 1, rgb: "ff00aa", token: syntheticToken, url: "secret" }), {
		schemaVersion: 1,
		rgb: "FF00AA",
	});
	assert.deepEqual(assignment("brightness", { schemaVersion: 1, percent: 0, rgb: "FF0000" }), {
		schemaVersion: 1,
		percent: 0,
	});
});

test("RGB picker and one optional UI hash normalize without accepting malformed values", () => {
	for (const rgb of ["ff5000", "#ff5000", "FF5000"]) assert.equal(colorInput(rgb), "FF5000");
	for (const rgb of ["##FF5000", "#fff", " FF5000", "GG0000", 0, null, ""]) assert.throws(() => colorInput(rgb));
	assert.throws(() => assignment("color", { schemaVersion: 1, rgb: "#FF5000" }));
});

test("brightness is an integer number including zero and one hundred; preset IDs are stable identifiers", () => {
	for (const percent of [0, 50, 100])
		assert.equal(assignment("brightness", { schemaVersion: 1, percent }).percent, percent);
	for (const percent of [-1, 101, 0.5, "50", "", NaN, Infinity, null, undefined])
		assert.throws(() => assignment("brightness", { schemaVersion: 1, percent }));
	for (const presetId of ["sunset", "custom_1-a", "a".repeat(40)])
		assert.equal(assignment("preset", { schemaVersion: 1, presetId }).presetId, presetId);
	assert.deepEqual(assignment("preset", { schemaVersion: 1 }), { schemaVersion: 1 });
	for (const presetId of ["", "UPPER", "../on", "a".repeat(41), 1, null])
		assert.throws(() => assignment("preset", { schemaVersion: 1, presetId }));
});

test("three SingletonActions dispatch exactly their canonical command and reject corrupt settings before transport", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	const operations = new OperationStore();
	const client = new BridgeClient();
	const routes: string[] = [];
	client.command = async (record) => {
		routes.push(record.snapshot.route);
		return { status: "sent" };
	};
	const inspector = new InspectorController(settings, operations, client, () => {});
	const services = { settings, operations, client, inspector, diagnostics: new Diagnostics(() => {}) };
	try {
		for (const [kind, Action, raw, route] of [
			["color", Color, { schemaVersion: 1, rgb: "00ff80" }, "color/00FF80"],
			["brightness", Brightness, { schemaVersion: 1, percent: 0 }, "brightness/0"],
			["brightness", Brightness, { schemaVersion: 1, percent: 100 }, "brightness/100"],
			["preset", Preset, { schemaVersion: 1, presetId: "sunset" }, "preset/sunset"],
		] as const) {
			const action = new Action(services);
			const key = new KeyFacade();
			const ev = { action: { id: route, isKey: () => true, ...key }, payload: { settings: raw } };
			await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
			const before = routes.length;
			await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
			assert.equal(routes.length, before + 1);
			assert.equal(routes.at(-1), route);
			assert.equal(key.oks, 1);
			const expectedTitle =
				kind === "color" ? "00FF80" : kind === "brightness" ? `${"percent" in raw ? raw.percent : ""}%` : "sunset";
			assert.equal(key.titles.at(-1), expectedTitle);
			settings.receiveAction(route, kind as ActionKind, { schemaVersion: 2 });
			await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
			assert.equal(routes.length, before + 1);
		}
	} finally {
		inspector.dispose();
	}
});
