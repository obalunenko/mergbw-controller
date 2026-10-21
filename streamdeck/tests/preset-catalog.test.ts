import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Preset } from "../src/actions/preset.js";
import { BridgeClient, type Catalog, type ReadResult } from "../src/bridge-client.js";
import { Diagnostics } from "../src/diagnostics.js";
import { InspectorController, type InspectorReply, presetOptions } from "../src/inspector-messages.js";
import { OperationStore } from "../src/operation-store.js";
import { Settings } from "../src/settings.js";
import type { Assignment } from "../src/validation.js";
import { deferred, fixture, KeyFacade, MemoryStorage, syntheticToken } from "./helpers.js";

const message = (type: string, payload: Record<string, unknown> = {}, sessionId = "session") => ({
	v: 1,
	sessionId,
	requestId: "req",
	type,
	payload,
});
async function harness() {
	const storage = new MemoryStorage();
	const settings = new Settings(storage);
	await settings.load();
	await settings.saveConnection(18766, syntheticToken);
	settings.receiveAction("a", "preset", { schemaVersion: 1, presetId: "sunset" });
	const client = new BridgeClient();
	const operations = new OperationStore();
	const replies: InspectorReply[] = [];
	const inspector = new InspectorController(settings, operations, client, (r) => {
		replies.push(r);
	});
	return { storage, settings, client, operations, replies, inspector };
}
const catalog = (presets: Catalog["presets"]): ReadResult<Catalog> => ({
	statusCode: 200,
	value: { presets, physical_state_verified: false },
});

test("opening preset selection loads current catalog; refresh retains stable id across rename/delete/empty", async () => {
	const h = await harness();
	let entries = [
		{ id: "custom", label: "User scene" },
		{ id: "sunset", label: "Sunset" },
	];
	let reads = 0;
	h.client.catalog = async () => {
		reads++;
		return catalog(entries);
	};
	try {
		await h.inspector.receive("a", message("inspector.get"));
		assert.equal(reads, 1);
		assert.deepEqual(h.inspector.catalog.entries, entries);
		for (const next of [
			[{ id: "sunset", label: "Renamed" }],
			[{ id: "custom", label: "User scene" }],
			[],
		]) {
			entries = next;
			await h.inspector.receive("a", message("presets.refresh"));
			assert.deepEqual(h.inspector.catalog.entries, entries);
			assert.equal(h.settings.getAction("a").presetId, "sunset");
		}
	} finally {
		h.inspector.dispose();
	}
});

test("duplicate labels include ids, malicious labels remain text and no secrets enter snapshots", async () => {
	const entries = [
		{ id: "a", label: "Scene" },
		{ id: "b", label: "Scene" },
		{ id: "c", label: "<img onerror=bad>" },
	];
	assert.deepEqual(presetOptions(entries), [
		{ id: "a", label: "Scene (a)" },
		{ id: "b", label: "Scene (b)" },
		{ id: "c", label: "<img onerror=bad>" },
	]);
	const h = await harness();
	h.client.catalog = async () => catalog([{ id: "sunset", label: syntheticToken }]);
	try {
		await h.inspector.receive("a", message("inspector.get"));
		assert.ok(!JSON.stringify(h.replies).includes(syntheticToken));
	} finally {
		h.inspector.dispose();
	}
});

test("only an available list permits a new preset selection; existing id remains valid when unavailable", async () => {
	const h = await harness();
	h.client.catalog = async () => ({ statusCode: 404, errorCategory: "protocol" });
	try {
		await h.inspector.receive("a", message("inspector.get"));
		await h.inspector.receive("a", message("assignment.save", { settings: { schemaVersion: 1, presetId: "other" } }));
		assert.equal(h.replies.at(-1)?.ok, false);
		assert.equal(h.settings.getAction("a").presetId, "sunset");
		await h.inspector.receive(
			"a",
			message("assignment.save", { settings: { schemaVersion: 1, presetId: "sunset", token: syntheticToken } }),
		);
		assert.equal(h.replies.at(-1)?.ok, true);
		assert.deepEqual(h.storage.actions.get("a"), { schemaVersion: 1, presetId: "sunset" });
		h.client.catalog = async () => catalog([{ id: "other", label: "Other" }]);
		await h.inspector.receive("a", message("presets.refresh"));
		await h.inspector.receive("a", message("assignment.save", { settings: { schemaVersion: 1, presetId: "other" } }));
		assert.equal(h.replies.at(-1)?.ok, true);
		assert.equal(h.settings.getAction("a").presetId, "other");
		assert.equal(h.inspector.check.messageKey, undefined);
	} finally {
		h.inspector.dispose();
	}
});

test("known missing and unset ids block commands; unavailable catalogs permit an explicit saved id", async () => {
	const h = await harness();
	let calls = 0;
	h.client.command = async () => {
		calls++;
		return { status: "sent" };
	};
	h.client.catalog = async () => catalog([]);
	const key = new KeyFacade();
	const ev = {
		action: { id: "a", isKey: () => true, ...key },
		payload: { settings: { schemaVersion: 1, presetId: "sunset" } },
	};
	const action = new Preset({ ...h, diagnostics: new Diagnostics(() => {}) });
	try {
		await action.onWillAppear(ev as unknown as WillAppearEvent<Assignment>);
		await h.inspector.receive("a", message("inspector.get"));
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(calls, 0);
		h.client.catalog = async () => ({ errorCategory: "service" });
		await h.inspector.receive("a", message("presets.refresh"));
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(calls, 1);
		h.settings.receiveAction("a", "preset", {});
		await action.onKeyDown(ev as unknown as KeyDownEvent<Assignment>);
		assert.equal(calls, 1);
	} finally {
		h.inspector.dispose();
	}
});

test("refresh generations and connection/session changes discard stale catalogs", async () => {
	const h = await harness();
	h.client.catalog = async () => catalog([]);
	try {
		await h.inspector.receive("a", message("inspector.get"));
		const old = deferred<ReadResult<Catalog>>();
		h.client.catalog = () => old.promise;
		const first = h.inspector.receive("a", message("presets.refresh"));
		h.client.catalog = async () => catalog([{ id: "new", label: "New" }]);
		await h.inspector.receive("a", message("presets.refresh"));
		old.resolve(catalog([{ id: "old", label: "Old" }]));
		await first;
		assert.equal(h.inspector.catalog.entries[0]?.id, "new");
		for (const change of ["connection", "session", "close"] as const) {
			const late = deferred<ReadResult<Catalog>>();
			h.client.catalog = () => late.promise;
			const read = h.inspector.receive("a", message("presets.refresh"));
			if (change === "connection") await h.settings.saveConnection(18767, syntheticToken);
			else if (change === "session") {
				h.client.catalog = async () => catalog([]);
				await h.inspector.receive("a", message("inspector.get", {}, "new"));
			} else h.inspector.close("a");
			late.resolve(catalog([{ id: "stale", label: "Stale" }]));
			await read;
			assert.ok(!h.inspector.catalog.entries.some((entry) => entry.id === "stale"));
			await h.inspector.receive("a", message("inspector.get"));
		}
	} finally {
		h.inspector.dispose();
	}
});

test("legacy 400/404/405 catalogs preserve assignments and do not invalidate other action kinds", async () => {
	for (const statusCode of [400, 404, 405]) {
		const h = await harness();
		h.client.catalog = async () => ({ statusCode, errorCategory: "protocol" });
		try {
			await h.inspector.receive("a", message("inspector.get"));
			assert.equal(h.inspector.catalog.status, "unavailable");
			assert.equal(h.inspector.check.catalog, "unsupported");
			assert.equal(h.settings.getAction("a").presetId, "sunset");
			for (const kind of ["on", "off", "color", "brightness"] as const) {
				h.settings.receiveAction(kind, kind, {});
				assert.equal(h.inspector.snapshot(kind).settingsValid, true);
			}
		} finally {
			h.inspector.dispose();
		}
	}
});

test("runtime catalog validation rejects malformed, unsorted, duplicate, multiline and oversized snapshots", async () => {
	for (const body of [
		{ presets: null, physical_state_verified: false },
		{ presets: [{ id: "bad id", label: "Scene" }], physical_state_verified: false },
		{
			presets: [
				{ id: "b", label: "B" },
				{ id: "a", label: "A" },
			],
			physical_state_verified: false,
		},
		{
			presets: [
				{ id: "a", label: "A" },
				{ id: "a", label: "B" },
			],
			physical_state_verified: false,
		},
		{ presets: [{ id: "a", label: "\nBad" }], physical_state_verified: false },
		{ presets: [{ id: "a", label: "Bad\u2028label" }], physical_state_verified: false },
		{ presets: [{ id: "a", label: "Bad\u2029label" }], physical_state_verified: false },
		{ presets: [{ id: "a", label: " " }], physical_state_verified: false },
		{ presets: [{ id: "a", label: "x".repeat(1048576) }], physical_state_verified: false },
	]) {
		const server = await fixture((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(body));
		});
		try {
			const result = await new BridgeClient().catalog({ port: server.port, accessToken: syntheticToken });
			assert.equal(result.value, undefined);
			assert.equal(result.errorCategory, "protocol");
		} finally {
			await server.close();
		}
	}
});

test("HTTP catalog rejects schema-valid identifiers containing the connection credential", async () => {
	for (const id of [syntheticToken, `a_${syntheticToken}`]) {
		const server = await fixture((_req, res) => {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ presets: [{ id, label: "Scene" }], physical_state_verified: false }));
		});
		try {
			const result = await new BridgeClient().catalog({ port: server.port, accessToken: syntheticToken });
			assert.equal(result.value, undefined);
			assert.equal(result.errorCategory, "protocol");
			assert.ok(!JSON.stringify(result).includes(syntheticToken));
		} finally {
			await server.close();
		}
	}
});
