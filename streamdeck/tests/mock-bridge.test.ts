import assert from "node:assert/strict";
import { test } from "node:test";

import { createMockBridge } from "../scripts/mock-bridge.mjs";
import { fixture, syntheticToken } from "./helpers.js";

test("synthetic catalogs have exact variants and read-only calls never count as commands", async () => {
	const variants: Record<string, unknown[]> = {
		baseline: [
			{ id: "night", label: "Ночь" },
			{ id: "sunset", label: "Закат" },
		],
		renamed: [
			{ id: "night", label: "Ночь" },
			{ id: "sunset", label: "Вечер" },
		],
		deleted: [{ id: "night", label: "Ночь" }],
		"duplicate-labels": [
			{ id: "night", label: "Одинаковый" },
			{ id: "sunset", label: "Одинаковый" },
		],
		empty: [],
	};
	for (const [catalog, expected] of Object.entries(variants)) {
		const mock = createMockBridge({ catalog });
		const server = await fixture(mock.handler);
		try {
			const health = await fetch(`http://127.0.0.1:${server.port}/health`);
			assert.equal((await health.json()).bluetooth_connected, false);
			const response = await fetch(`http://127.0.0.1:${server.port}/${syntheticToken}/presets`);
			assert.deepEqual(await response.json(), { presets: expected, physical_state_verified: false });
			assert.equal(mock.commands.length, 0);
		} finally {
			await server.close();
		}
	}
	assert.throws(() => createMockBridge({ catalog: "invalid" }));
});

test("received counter includes rejected preset commands and resets with a new fixture", async () => {
	const mock = createMockBridge({ catalog: "deleted" });
	const server = await fixture(mock.handler);
	try {
		for (const [route, status] of [
			["on", 200],
			["off", 200],
			["preset/sunset", 400],
			["preset/night", 200],
		] as const) {
			const response = await fetch(`http://127.0.0.1:${server.port}/${syntheticToken}/${route}`, { method: "POST" });
			assert.equal(response.status, status);
			const body = await response.json();
			assert.equal(body.physical_state_verified, false);
			assert.equal(body.sent, status === 200 ? true : undefined);
		}
		assert.deepEqual(mock.commands, [
			{ type: "on", outcome: "sent" },
			{ type: "off", outcome: "sent" },
			{ type: "preset", parameter: "sunset", outcome: "rejected" },
			{ type: "preset", parameter: "night", outcome: "sent" },
		]);
		assert.equal(createMockBridge().commands.length, 0);
	} finally {
		await server.close();
	}
});

test("failure mode and Bluetooth flag remain independent of the catalog snapshot", async () => {
	for (const mode of ["normal", "auth-denied", "legacy", "backend-error", "malformed", "echo-secret"]) {
		const mock = createMockBridge({ mode, catalog: "renamed", bluetoothConnected: true });
		const server = await fixture(mock.handler);
		try {
			const health = await fetch(`http://127.0.0.1:${server.port}/health`);
			assert.equal((await health.json()).bluetooth_connected, true);
			const catalog = await fetch(`http://127.0.0.1:${server.port}/${syntheticToken}/presets`);
			assert.equal(catalog.status, mode === "auth-denied" ? 403 : mode === "legacy" ? 400 : 200);
			if (catalog.status === 200) assert.equal((await catalog.json()).presets[1].label, "Вечер");
			assert.equal(mock.commands.length, 0);
			const response = await fetch(`http://127.0.0.1:${server.port}/${syntheticToken}/on`, { method: "POST" });
			assert.equal(
				response.status,
				mode === "auth-denied" ? 403 : ["backend-error", "echo-secret"].includes(mode) ? 503 : 200,
			);
			const body = await response.json();
			assert.equal(body.sent, ["normal", "legacy"].includes(mode) ? true : undefined);
			assert.equal(mock.commands.length, 1);
			assert.ok(!JSON.stringify(mock.commands).includes(syntheticToken));
			if (mode === "echo-secret") assert.ok(body.error.includes(syntheticToken));
		} finally {
			await server.close();
		}
	}
	assert.throws(() => createMockBridge({ mode: "invalid" }));
});

test("synthetic command counter omits token-shaped rejected parameter", async () => {
	const mock = createMockBridge();
	const server = await fixture(mock.handler);
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}/${syntheticToken}/preset/${syntheticToken}`, {
			method: "POST",
		});
		assert.equal(response.status, 400);
		assert.deepEqual(mock.commands, [{ type: "preset", outcome: "rejected" }]);
	} finally {
		await server.close();
	}
});

test("catalog authorization failures remain read-only while rejected lamp commands count", async () => {
	for (const mode of ["normal", "auth-denied"]) {
		for (const catalog of ["baseline", "renamed", "deleted", "duplicate-labels", "empty"]) {
			const mock = createMockBridge({ mode, catalog });
			const server = await fixture(mock.handler);
			const base = `http://127.0.0.1:${server.port}`;
			const wrong = "incorrect_token_1234567890123456";
			try {
				for (const [path, status] of [
					["/health", 200],
					[`/${syntheticToken}/presets`, mode === "auth-denied" ? 403 : 200],
					[`/${wrong}/presets`, 403],
				] as const) {
					const response = await fetch(`${base}${path}`);
					assert.equal(response.status, status);
					await response.json();
					assert.equal(mock.commands.length, 0);
				}
				const rejected = await fetch(`${base}/${wrong}/on`, { method: "POST" });
				assert.equal(rejected.status, 403);
				await rejected.json();
				assert.deepEqual(mock.commands, [{ type: "on", outcome: "rejected" }]);
				const command = await fetch(`${base}/${syntheticToken}/off`, { method: "POST" });
				assert.equal(command.status, mode === "auth-denied" ? 403 : 200);
				await command.json();
				assert.deepEqual(mock.commands[1], { type: "off", outcome: mode === "auth-denied" ? "rejected" : "sent" });
				assert.equal(mock.commands.length, 2);
			} finally {
				await server.close();
			}
		}
	}
});
