import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { nativeFiles } from "../native/payload-validator.mjs";
import { type AppLauncher, bundledSupervisorSpawn } from "../src/managed-controller.js";

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const deadline = <T>(promise: Promise<T>): Promise<T> => {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("fixture timeout")), 5000);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
async function waitFor(predicate: () => boolean): Promise<void> {
	const until = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= until) throw new Error("fixture timeout");
		await delay(10);
	}
}
function payload(t: TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "mergbw-app-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const thin = Buffer.alloc(56);
	thin.writeUInt32LE(0xfeedfacf, 0);
	thin.writeUInt32LE(process.arch === "arm64" ? 16777228 : 16777223, 4);
	thin.writeUInt32LE(2, 12);
	thin.writeUInt32LE(1, 16);
	thin.writeUInt32LE(24, 20);
	thin.writeUInt32LE(0x32, 32);
	thin.writeUInt32LE(24, 36);
	thin.writeUInt32LE(1, 40);
	thin.writeUInt32LE(0x000d0500, 44);
	const plist = Buffer.from(
		"<plist><dict><key>CFBundleIdentifier</key><string>com.obalunenko.mergbw.controller</string><key>CFBundleExecutable</key><string>mergbw-supervisor</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>NSBluetoothAlwaysUsageDescription</key><string>Fixture lamp</string></dict></plist>",
	);
	const files = nativeFiles.map((name) => {
		const executable = /\/(?:MacOS|Helpers)\//.test(name);
		const path = join(root, "controller", name);
		const bytes = executable ? thin : name.endsWith("/Info.plist") ? plist : Buffer.from("fixture");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes, { mode: executable ? 0o755 : 0o644 });
		return { path: name, sha256: createHash("sha256").update(bytes).digest("hex"), mode: executable ? "0755" : "0644" };
	});
	writeFileSync(
		join(root, "controller", "payload-manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			sourceRevision: "a".repeat(40),
			sourceTreeSHA256: "b".repeat(64),
			managedProtocolVersion: 1,
			bridgeVersion: "2.0.0-go",
			buildMode: "spike",
			architectures: [process.arch === "arm64" ? "arm64" : "x86_64"],
			minimumMacOS: "13.5",
			files,
		}),
	);
	return root;
}
const echoApp = `
 const net = require('node:net');
 const socket = net.connect({path:process.argv[1], allowHalfOpen:true});
 socket.on('data', bytes => socket.write(bytes));
 socket.on('end', () => setTimeout(() => socket.end(), 80));
 socket.on('close', () => setTimeout(() => process.exit(0), 120));
 socket.on('error', () => process.exit(2));
`;
function launcher(t: TestContext, script = echoApp) {
	let announce!: (value: { path: string; args: string[] }) => void;
	const launched = new Promise<{ path: string; args: string[] }>((done) => {
		announce = done;
	});
	let closed = false;
	const launch: AppLauncher = (executable, args, options) => {
		assert.equal(executable, "/usr/bin/open");
		assert.equal(options.shell, false);
		assert.equal(options.detached, false);
		assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
		const path = args.at(-1)!;
		assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
		assert.equal(statSync(path).mode & 0o777, 0o600);
		announce({ path, args });
		const child = spawn(process.execPath, ["-e", script, path], { stdio: ["ignore", "pipe", "pipe"] });
		child.once("close", () => {
			closed = true;
		});
		t.after(() => {
			if (!closed) child.kill();
		});
		return child;
	};
	return { launch, launched, closed: () => closed };
}

test("app transport queues bounded v1 frames privately and waits for socket plus owned launcher", async (t) => {
	const root = payload(t),
		fixture = launcher(t);
	const replies: string[] = [],
		losses: string[] = [];
	const transport = bundledSupervisorSpawn(root, fixture.launch)(
		(line) => replies.push(line),
		(reason) => losses.push(reason!),
	);
	t.after(() => transport.close());
	for (let n = 0; n < 16; n++) transport.send({ v: 1, index: n });
	assert.throws(() => transport.send({ v: 1 }), /control_busy/);
	assert.throws(() => transport.send({ private: "x".repeat(65536) }), /protocol_incompatible/);
	const { path, args } = await deadline(fixture.launched);
	assert.deepEqual(args, [
		"-n",
		"-g",
		"-W",
		join(root, "controller", "MeRGBW Controller.app"),
		"--args",
		"--control-socket",
		path,
	]);
	await waitFor(() => replies.length === 16);
	assert.deepEqual(
		replies.map((line) => JSON.parse(line).index),
		Array.from({ length: 16 }, (_, n) => n),
	);
	// A second peer must not inject frames or replace the accepted connection.
	const extra = connect(path);
	extra.on("error", () => {});
	const extraClosed = new Promise<void>((done) => extra.once("close", () => done()));
	await deadline(extraClosed);
	assert.equal(replies.length, 16);
	let exited = false;
	void transport.exited.then(() => {
		exited = true;
	});
	transport.close();
	await delay(30);
	assert.equal(exited, false);
	await delay(90); // Socket cleanup has finished, launcher still remains owned.
	assert.equal(fixture.closed(), false);
	assert.equal(exited, false);
	await deadline(transport.exited);
	assert.equal(fixture.closed(), true);
	assert.equal(existsSync(dirname(path)), false);
	assert.equal(losses.length, 1);
	assert.throws(() => transport.send({}), /host_unavailable/);
});

test("launcher throw and early exit fail safely and remove only run endpoint", async (t) => {
	for (const mode of ["throw", "exit"]) {
		const root = payload(t),
			fixture = launcher(t, "process.exit(0)");
		let path = "";
		const losses: string[] = [];
		const launch: AppLauncher = (exe, args, options) => {
			path = args.at(-1)!;
			if (mode === "throw") throw new Error("private helper diagnostic");
			return fixture.launch(exe, args, options);
		};
		const transport = bundledSupervisorSpawn(root, launch)(
			() => assert.fail(),
			(reason) => losses.push(reason!),
		);
		await deadline(transport.exited);
		assert.deepEqual(losses, ["spawn_failed"]);
		assert.equal(existsSync(dirname(path)), false);
		assert.throws(() => transport.send({}), /host_unavailable/);
	}
});

test("close before launch admits no app and close before connection rejects late dial", async (t) => {
	const root = payload(t);
	let starts = 0;
	const transport = bundledSupervisorSpawn(root, () => {
		starts++;
		throw new Error("unexpected launch");
	})(
		() => assert.fail(),
		() => {},
	);
	transport.close();
	await deadline(transport.exited);
	assert.equal(starts, 0);
	const fixture = launcher(
		t,
		`setTimeout(() => { const s=require('node:net').connect(process.argv[1]); s.on('connect',()=>process.exit(3)); s.on('error',()=>process.exit(0)); },100);`,
	);
	const late = bundledSupervisorSpawn(root, fixture.launch)(
		() => assert.fail(),
		() => {},
	);
	const { path } = await deadline(fixture.launched);
	late.close();
	await deadline(late.exited);
	assert.equal(fixture.closed(), true);
	assert.equal(existsSync(dirname(path)), false);
});

test("connection loss is reported once and still waits owned launcher exit", async (t) => {
	const root = payload(t);
	const fixture = launcher(
		t,
		`const s=require('node:net').connect(process.argv[1]); s.on('connect',()=>s.end()); s.on('close',()=>setTimeout(()=>process.exit(0),120)); s.on('error',()=>process.exit(2));`,
	);
	const losses: string[] = [];
	const transport = bundledSupervisorSpawn(root, fixture.launch)(
		() => assert.fail(),
		(reason) => losses.push(reason!),
	);
	await deadline(fixture.launched);
	await waitFor(() => losses.length !== 0);
	assert.equal(fixture.closed(), false);
	transport.close();
	await deadline(transport.exited);
	assert.equal(losses.length, 1);
});

test("asynchronous launcher error closes listener and keeps raw diagnostics private", async (t) => {
	const root = payload(t);
	let path = "";
	const losses: string[] = [];
	const launch: AppLauncher = (_exe, args) => {
		path = args.at(-1)!;
		chmodSync(dirname(path), 0o700);
		return spawn(join(root, "private-missing-launcher"), [], { stdio: ["ignore", "pipe", "pipe"] });
	};
	const transport = bundledSupervisorSpawn(root, launch)(
		() => assert.fail(),
		(reason) => losses.push(reason!),
	);
	await deadline(transport.exited);
	assert.deepEqual(losses, ["spawn_failed"]);
	assert.equal(existsSync(dirname(path)), false);
});
