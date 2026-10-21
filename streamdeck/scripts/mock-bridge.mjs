import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const syntheticToken = "mock_access_token_1234567890123456";
const catalogs = {
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
export function createMockBridge({ catalog = "baseline", mode = "normal", bluetoothConnected = false } = {}) {
	if (!["normal", "auth-denied", "legacy", "backend-error", "timeout", "malformed", "echo-secret"].includes(mode))
		throw new Error("Unknown synthetic failure mode");
	if (!Object.hasOwn(catalogs, catalog)) throw new Error("Unknown synthetic catalog variant");
	const entries = catalogs[catalog];
	const commands = [];
	let requestId = 0;
	const handler = (req, res) => {
		const reply = (status, payload) => {
			const body = JSON.stringify({ ...payload, physical_state_verified: false }) + "\n";
			res.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"content-length": Buffer.byteLength(body),
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"x-request-id": String(++requestId),
			});
			res.end(req.method === "HEAD" ? undefined : body);
		};
		if (req.url === "/health") {
			reply(200, { ok: true, version: "synthetic-mock", bluetooth_connected: bluetoothConnected });
			return;
		}
		const parts = (req.url ?? "").split("/");
		if (parts.length === 3 && parts[2] === "presets") {
			if (parts[1] !== syntheticToken || mode === "auth-denied") reply(403, { error: "Synthetic access denied" });
			else if (mode === "legacy") reply(400, { error: "Synthetic legacy catalog unsupported" });
			else if (req.method !== "GET") reply(405, { error: "GET only" });
			else reply(200, { presets: entries });
			return;
		}
		const type = ["on", "off", "color", "brightness", "preset"].includes(parts[2]) ? parts[2] : "unknown";
		const parameter = parts[3];
		const valid =
			!/[?#%\\]/.test(req.url ?? "") &&
			parts[1] === syntheticToken &&
			req.method === "POST" &&
			(req.headers["content-length"] === undefined || req.headers["content-length"] === "0") &&
			!req.headers["transfer-encoding"] &&
			(((type === "on" || type === "off") && parts.length === 3) ||
				(type === "color" && /^[A-F0-9]{6}$/.test(parameter ?? "") && parts.length === 4) ||
				(type === "brightness" && /^(?:[0-9]|[1-9][0-9]|100)$/.test(parameter ?? "") && parts.length === 4) ||
				(type === "preset" && entries.some((entry) => entry.id === parameter) && parts.length === 4));
		commands.push({
			type,
			...(["color", "brightness", "preset"].includes(type) &&
			/^[A-Za-z0-9_-]{1,40}$/.test(parameter ?? "") &&
			!parameter.includes(syntheticToken)
				? { parameter }
				: {}),
			outcome: !valid || mode === "auth-denied" ? "rejected" : ["normal", "legacy"].includes(mode) ? "sent" : "unknown",
		});
		if (mode === "auth-denied") {
			reply(403, { error: "Synthetic access denied" });
			return;
		}
		if (!valid) {
			reply(parts[1] !== syntheticToken ? 403 : 400, { error: "Synthetic rejection" });
			return;
		}
		if (mode === "backend-error") {
			reply(503, { error: "Synthetic backend failure" });
			return;
		}
		if (mode === "malformed") {
			reply(200, { incompatible: true });
			return;
		}
		if (mode === "echo-secret") {
			reply(503, { error: `Synthetic ${syntheticToken} http://127.0.0.1:18766/${syntheticToken}/on` });
			return;
		}
		if (mode === "timeout") {
			const timer = setTimeout(() => reply(200, { sent: true, action: parts.slice(2).join("/") }), 46000);
			res.once("close", () => clearTimeout(timer));
			return;
		}
		reply(200, { sent: true, action: parts.slice(2).join("/") });
	};
	return { handler, commands };
}
export function main(args = process.argv.slice(2)) {
	let catalog = "baseline";
	let mode = "normal";
	let bluetoothConnected = false;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--bluetooth-connected") bluetoothConnected = true;
		else if (args[index] === "--catalog" && args[index + 1]) catalog = args[++index];
		else if (args[index] === "--mode" && args[index + 1]) mode = args[++index];
		else throw new Error("Invalid synthetic fixture options");
	}
	const fixture = createMockBridge({ catalog, mode, bluetoothConnected });
	const server = createServer((req, res) => {
		const before = fixture.commands.length;
		fixture.handler(req, res);
		if (fixture.commands.length !== before)
			console.log(JSON.stringify({ count: fixture.commands.length, ...fixture.commands.at(-1) }));
	});
	server.listen(18766, "127.0.0.1", () => {
		console.log(`Synthetic MeRGBW simulator on 127.0.0.1:18766, catalog ${catalog}, mode ${mode}. No physical lamp.`);
	});
	return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main();
	} catch {
		console.error("Invalid synthetic fixture options.");
		process.exitCode = 1;
	}
}
