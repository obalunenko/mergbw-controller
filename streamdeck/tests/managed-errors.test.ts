import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { nativeFiles, validateNativePayload } from "../native/payload-validator.mjs";
import { BridgeClient } from "../src/bridge-client.js";
import { HostProbeBroker } from "../src/host-liveness.js";
import { ManagedController, ManagedLines, type ManagedSpawn } from "../src/managed-controller.js";
import { Settings } from "../src/settings.js";
import { ControlledClock, deferred, MemoryStorage } from "./helpers.js";

const tick = async () => {
	await new Promise<void>((done) => setImmediate(done));
};
test("native byte framing handles split UTF-8, oversized residual, invalid UTF-8 and truncated close once", () => {
	const lines: string[] = [];
	let failures = 0;
	const decoder = new ManagedLines(
		(line) => lines.push(line),
		() => failures++,
	);
	const bytes = Buffer.from('{"text":"лампа"}\n');
	for (const byte of bytes) decoder.push(Buffer.from([byte]));
	assert.deepEqual(lines, ['{"text":"лампа"}']);
	decoder.push(Buffer.concat([Buffer.from("{}\n"), Buffer.alloc(65536, 65)]));
	decoder.end();
	decoder.push(Buffer.from("{}\n"));
	assert.equal(failures, 1);
	assert.equal(lines.length, 2);
	const malformed = new ManagedLines(
		() => assert.fail(),
		() => failures++,
	);
	malformed.push(Buffer.from([0xff, 10]));
	malformed.end();
	assert.equal(failures, 2);
	const truncated = new ManagedLines(
		() => assert.fail(),
		() => failures++,
	);
	truncated.push(Buffer.from("{"));
	truncated.end();
	truncated.end();
	assert.equal(failures, 3);
});

async function fixture(openError?: string, workerError?: string, launchBlocked?: () => Promise<boolean>) {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	let callback!: (line: string) => void;
	let loss!: () => void;
	let session = "";
	const exited = deferred<void>();
	let spawns = 0;
	const calls: string[] = [];
	const spawn: ManagedSpawn = (receive, lost) => {
		callback = receive;
		loss = lost;
		spawns++;
		return {
			exited: exited.promise,
			close: () => {
				exited.resolve();
			},
			send: (raw) => {
				const frame = raw as { session: string; requestId: string; type: string };
				session = frame.session;
				calls.push(frame.type);
				let payload: Record<string, unknown>;
				if (frame.type === "session.open" && openError) payload = { status: "error", code: openError };
				else {
					let data: unknown = {};
					if (frame.type === "session.open") data = { protocolVersion: 1, bridgeVersion: "2.0.0-go" };
					if (frame.type === "configuration.read") {
						data = { configured: false, generation: null };
						if (workerError)
							data = {
								configured: true,
								generation: "a".repeat(32),
								identity: "AA:BB:CC:DD:EE:FF",
								presetCount: 1,
								connection: { port: 18765, accessToken: "synthetic_test_secret_1234567890123456" },
							};
					}
					payload = { status: "ok", data };
				}
				queueMicrotask(() => {
					if (frame.type === "controller.start" && workerError) {
						const binding = { launchId: "b".repeat(32), configurationGeneration: "a".repeat(32) };
						for (const state of ["starting", "failed"])
							receive(
								JSON.stringify({
									v: 1,
									session,
									requestId: "c".repeat(32),
									type: "controller.state",
									payload: { ...binding, state, ...(state === "failed" ? { errorCategory: workerError } : {}) },
								}),
							);
						payload = { status: "error", code: workerError };
					}
					receive(JSON.stringify({ v: 1, session, requestId: frame.requestId, type: "result", payload }));
				});
			},
		};
	};
	if (launchBlocked) spawn.launchBlocked = launchBlocked;
	const runtime = new ManagedController(spawn, settings, new BridgeClient(), new HostProbeBroker(async () => ({})));
	return {
		runtime,
		calls,
		spawns: () => spawns,
		lost: () => loss(),
		emit: (payload: unknown) =>
			callback(JSON.stringify({ v: 1, session, requestId: "a".repeat(32), type: "controller.state", payload })),
	};
}

test("initial instance lock rejection stays categorized after helper exit, without a worker request", async () => {
	const f = await fixture("instance_busy");
	await assert.rejects(f.runtime.open(), /instance_busy/);
	f.lost();
	await tick();
	assert.equal(f.runtime.error, "instance_busy");
	assert.equal(f.calls.includes("controller.start"), false);
	await f.runtime.shutdown();
});
test("explicit recovery reports retained installation ownership as blocked cleanup without a worker", async () => {
	const f = await fixture("instance_busy");
	await assert.rejects(f.runtime.open(), /instance_busy/);
	f.lost();
	await tick();
	await assert.rejects(f.runtime.restart(null), /cleanup_blocked/);
	assert.equal(f.runtime.error, "cleanup_blocked");
	assert.equal(f.runtime.capability(), null);
	assert.equal(f.spawns(), 2);
	assert.equal(f.calls.includes("controller.start"), false);
	await f.runtime.shutdown();
});
test("unknown frame payload types invalidate once and never authorize a misleading foreign health response", async () => {
	const f = await fixture();
	await f.runtime.open();
	f.emit({ state: 5, launchId: "a".repeat(32), configurationGeneration: "b".repeat(32) });
	await tick();
	assert.equal(f.runtime.error, "protocol_incompatible");
	assert.equal(f.runtime.capability(), null);
	await f.runtime.shutdown();
});
test("exited helper recovery coalesces repeated clicks into one new session and no lamp replay", async () => {
	const f = await fixture();
	await f.runtime.open();
	const first = f.runtime.managementSession();
	f.lost();
	await tick();
	const one = f.runtime.restart(null);
	const two = f.runtime.restart(null);
	assert.equal(one, two);
	await one;
	assert.equal(f.spawns(), 2);
	assert.notEqual(f.runtime.managementSession(), first);
	assert.equal(f.calls.filter((type) => type === "configuration.read").length, 2);
	assert.equal(
		f.calls.some((type) => type.startsWith("command")),
		false,
	);
	await f.runtime.shutdown();
});
test("failed initial host proof is visible and repeated recovery does not accumulate raw SDK probes", async () => {
	const clock = new ControlledClock(),
		pending = deferred<unknown>();
	let probes = 0,
		spawns = 0;
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	const runtime = new ManagedController(
		() => {
			spawns++;
			throw new Error("unexpected");
		},
		settings,
		new BridgeClient(),
		new HostProbeBroker(() => {
			probes++;
			return pending.promise;
		}, clock),
		clock,
	);
	const opening = runtime.open();
	await tick();
	clock.advance(5000);
	await assert.rejects(opening, /host_unavailable/);
	assert.equal(runtime.state, "failed");
	assert.equal(runtime.error, "host_unavailable");
	const one = runtime.restart(null),
		two = runtime.restart(null);
	assert.equal(one, two);
	await tick();
	clock.advance(5000);
	await assert.rejects(one, /host_unavailable/);
	assert.equal(probes, 1);
	assert.equal(spawns, 0);
});

test("bundled payload inspector rejects missing native payload before any spawn", async () => {
	const { bundledSupervisorSpawn } = await import("../src/managed-controller.js");
	assert.throws(
		() =>
			bundledSupervisorSpawn("/synthetic/nonexistent/plugin")(
				() => assert.fail(),
				() => assert.fail(),
			),
		/binary_missing/,
	);
});

test("shared native validator accepts an explicit host spike and rejects tampering, foreign architecture, symlinks and full-package fallback", (t) => {
	const root = mkdtempSync(join(tmpdir(), "mergbw-payload-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const controller = join(root, "controller");
	mkdirSync(controller);
	const thin = Buffer.alloc(56);
	thin.writeUInt32LE(0xfeedfacf, 0);
	thin.writeUInt32LE(16777228, 4);
	thin.writeUInt32LE(2, 12);
	thin.writeUInt32LE(1, 16);
	thin.writeUInt32LE(24, 20);
	thin.writeUInt32LE(0x32, 32);
	thin.writeUInt32LE(24, 36);
	thin.writeUInt32LE(1, 40);
	thin.writeUInt32LE(0x000d0500, 44);
	const plist = Buffer.from(
		`<plist><dict><key>CFBundleIdentifier</key><string>com.obalunenko.mergbw.controller</string><key>CFBundleExecutable</key><string>mergbw-supervisor</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>NSBluetoothAlwaysUsageDescription</key><string>Local lamp</string></dict></plist>`,
	);
	const files = nativeFiles.map((name) => {
		const executable = /\/(?:MacOS|Helpers)\//.test(name),
			path = join(controller, name),
			bytes = executable ? thin : name.endsWith("/Info.plist") ? plist : Buffer.from("fixture");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes, { mode: executable ? 0o755 : 0o644 });
		return { path: name, sha256: createHash("sha256").update(bytes).digest("hex"), mode: executable ? "0755" : "0644" };
	});
	const manifest = {
		schemaVersion: 1,
		sourceRevision: "a".repeat(40),
		sourceTreeSHA256: "b".repeat(64),
		managedProtocolVersion: 1,
		bridgeVersion: "2.0.0-go",
		buildMode: "spike",
		architectures: ["arm64"],
		minimumMacOS: "13.5",
		files,
	};
	const writeManifest = () =>
		writeFileSync(join(controller, "payload-manifest.json"), JSON.stringify(manifest), { mode: 0o644 });
	writeManifest();
	assert.ok(validateNativePayload(root, { hostArchitecture: "arm64" }).worker.endsWith("/Helpers/sunset"));
	assert.throws(
		() => validateNativePayload(root, { hostArchitecture: "arm64", fullPackage: true }),
		/binary_incompatible/,
	);
	assert.throws(() => validateNativePayload(root, { hostArchitecture: "x86_64" }), /binary_incompatible/);
	assert.throws(
		() => validateNativePayload(root, { hostArchitecture: "arm64", sourceRevision: "c".repeat(40) }),
		/binary_incompatible/,
	);
	manifest.managedProtocolVersion = 99;
	writeManifest();
	assert.throws(() => validateNativePayload(root, { hostArchitecture: "arm64" }), /binary_incompatible/);
	manifest.managedProtocolVersion = 1;
	writeManifest();
	const worker = join(controller, files.find((entry) => entry.path.endsWith("/sunset"))!.path);
	chmodSync(worker, 0o644);
	assert.throws(() => validateNativePayload(root, { hostArchitecture: "arm64" }), /binary_incompatible/);
	chmodSync(worker, 0o755);
	const original = readFileSync(worker);
	writeFileSync(worker, "hostile secret /private/source");
	assert.throws(() => validateNativePayload(root, { hostArchitecture: "arm64" }), /^Error: binary_incompatible$/);
	writeFileSync(worker, original);
	symlinkSync(worker, join(controller, "unexpected"));
	assert.throws(() => validateNativePayload(root, { hostArchitecture: "arm64" }), /binary_incompatible/);
});

test("read-only configuration check preserves actionable runtime failure without restart or replay", async () => {
	const f = await fixture();
	await f.runtime.open();
	for (const category of ["port_conflict", "binary_missing", "auth", "worker_exited"]) {
		f.runtime.startupFailed(new Error(category));
		const starts = f.calls.filter((type) => type === "controller.start" || type === "controller.restart").length;
		await f.runtime.reload();
		assert.equal(f.runtime.error, category);
		assert.equal(f.runtime.capability(), null);
		assert.equal(f.calls.filter((type) => type === "controller.start" || type === "controller.restart").length, starts);
	}
	f.runtime.startupFailed(new Error("storage_unavailable"));
	await f.runtime.reload();
	assert.equal(f.runtime.error, undefined);
	await f.runtime.shutdown();
});

test("worker failure event before start result retains missing/incompatible/spawn cause after revocation", async () => {
	for (const category of ["binary_missing", "binary_incompatible", "spawn_failed", "startup_timeout"]) {
		const f = await fixture(undefined, category);
		await f.runtime.open();
		await tick();
		assert.equal(f.runtime.state, "failed");
		assert.equal(f.runtime.error, category);
		assert.equal(f.runtime.capability(), null);
		assert.equal(f.calls.filter((type) => type === "controller.start").length, 1);
		assert.equal(f.calls.includes("runtime.authorized"), false);
		await f.runtime.shutdown();
	}
});

test("quarantined bundled app turns spawn_failed or startup_timeout into launch_blocked", async () => {
	for (const category of ["spawn_failed", "startup_timeout"]) {
		let probes = 0;
		const f = await fixture(undefined, category, async () => {
			probes++;
			return true;
		});
		await f.runtime.open();
		await tick();
		await tick();
		assert.equal(f.runtime.state, "failed");
		assert.equal(f.runtime.error, "launch_blocked");
		assert.equal(probes, 1);
		assert.equal(f.runtime.capability(), null);
		await f.runtime.shutdown();
	}
});

test("failing quarantine probe keeps the original launch category", async () => {
	for (const probe of [async () => false, () => Promise.reject(new Error("probe exploded"))]) {
		for (const category of ["spawn_failed", "startup_timeout"]) {
			const f = await fixture(undefined, category, probe);
			await f.runtime.open();
			await tick();
			await tick();
			assert.equal(f.runtime.error, category);
			await f.runtime.shutdown();
		}
	}
	let probes = 0;
	const f = await fixture(undefined, "binary_missing", async () => {
		probes++;
		return true;
	});
	await f.runtime.open();
	await tick();
	assert.equal(f.runtime.error, "binary_missing");
	assert.equal(probes, 0);
	await f.runtime.shutdown();
});

test("bundled quarantine probe only reads the attribute on the bundled app and never removes it", async () => {
	const { bundledSupervisorSpawn, quarantineProbe } = await import("../src/managed-controller.js");
	const calls: string[][] = [];
	const present = quarantineProbe("/synthetic/plugin", async (file, args) => {
		calls.push([file, ...args]);
		return "0083;synthetic;Safari;";
	});
	assert.equal(await present(), true);
	const absent = quarantineProbe("/synthetic/plugin", async (file, args) => {
		calls.push([file, ...args]);
		throw new Error("xattr: No such xattr: com.apple.quarantine");
	});
	assert.equal(await absent(), false);
	assert.deepEqual(calls, [
		["/usr/bin/xattr", "-p", "com.apple.quarantine", "/synthetic/plugin/controller/MeRGBW Controller.app"],
		["/usr/bin/xattr", "-p", "com.apple.quarantine", "/synthetic/plugin/controller/MeRGBW Controller.app"],
	]);
	assert.ok(!calls.some((call) => call.includes("-d") || call.includes("-dr") || call.includes("-c")));
	const spawn = bundledSupervisorSpawn("/synthetic/plugin", undefined, async (file, args) => {
		calls.push([file, ...args]);
		return "";
	});
	assert.equal(await spawn.launchBlocked?.(), true);
	assert.equal(calls.length, 3);
});
