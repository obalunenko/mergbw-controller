import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Diagnostics } from "../src/diagnostics.js";
import { Settings } from "../src/settings.js";
import {
	CHECKSUMS,
	compareTags,
	INSTALLER,
	newer,
	RELEASES_URL,
	releaseStamp,
	type UpdateFetch,
	UpdateService,
} from "../src/updates.js";
import { ControlledClock, deferred, MemoryStorage, syntheticToken } from "./helpers.js";

const payload = Buffer.from("synthetic stream deck installer payload");
const digest = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const page = "https://github.com/obalunenko/mergbw-controller/releases";
const assetUrl = (tag: string, name: string): string => `${page}/download/${tag}/${name}`;
function release(tag = "v1.3.0", assets = [INSTALLER, CHECKSUMS], extra: Record<string, unknown> = {}) {
	return {
		tag_name: tag,
		html_url: `${page}/tag/${tag}`,
		body: "<script>alert(1)</script> notes",
		assets: assets.map((name) => ({
			name,
			size: name === INSTALLER ? payload.length : 120,
			browser_download_url: assetUrl(tag, name),
		})),
		...extra,
	};
}
type Route = (init: RequestInit & { signal: AbortSignal }) => Promise<Response>;
function json(value: unknown, status = 200): Route {
	return async () => new Response(JSON.stringify(value), { status });
}
async function harness(
	options: { stamp?: unknown; global?: unknown; storage?: MemoryStorage; root?: string; latest?: unknown } = {},
) {
	const root = options.root ?? (await mkdtemp(join(tmpdir(), "mergbw-us3-")));
	const storage = options.storage ?? new MemoryStorage();
	if (options.global) storage.global = options.global;
	const settings = new Settings(storage);
	await settings.load();
	const clock = new ControlledClock();
	const requests: { url: string; init: RequestInit }[] = [];
	const execs: { file: string; args: string[] }[] = [];
	const failing = new Set<string>();
	const routes = new Map<string, Route>([
		[RELEASES_URL, json(options.latest ?? release())],
		[assetUrl("v1.3.0", CHECKSUMS), async () => new Response(`${digest(payload)}  ${INSTALLER}\n`)],
		[assetUrl("v1.3.0", INSTALLER), async () => new Response(payload)],
	]);
	const fetch: UpdateFetch = async (url, init) => {
		requests.push({ url, init });
		const route = routes.get(url);
		if (!route) throw new TypeError("fetch failed");
		return route(init);
	};
	const events: Record<string, number | string>[] = [];
	const service = new UpdateService({
		fetch,
		exec: async (file, args) => {
			execs.push({ file, args });
			if (failing.has(file)) throw new Error("synthetic exit 1");
		},
		clock,
		tmpRoot: root,
		settings,
		readStamp: () => ("stamp" in options ? options.stamp : { tag: "v1.2.0", build: 0 }),
		diagnostics: new Diagnostics((fields) => events.push(fields)),
	});
	return { service, settings, storage, clock, requests, execs, failing, routes, events, root };
}

test("semver and (tag, build) ordering decide what is newer", () => {
	assert.equal(compareTags("v1.10.0", "v1.9.0"), 1);
	assert.equal(compareTags("v1.3.0", "v1.3.0-rc.1"), 1);
	const ordered = [
		"v1.0.0-alpha",
		"v1.0.0-alpha.1",
		"v1.0.0-alpha.beta",
		"v1.0.0-beta",
		"v1.0.0-beta.2",
		"v1.0.0-beta.11",
		"v1.0.0-rc.1",
		"v1.0.0",
	];
	for (let i = 1; i < ordered.length; i++) {
		assert.equal(compareTags(ordered[i]!, ordered[i - 1]!), 1, ordered[i]);
		assert.equal(compareTags(ordered[i - 1]!, ordered[i]!), -1, ordered[i]);
	}
	assert.equal(compareTags("v2.0.0", "v2.0.0"), 0);
	for (const bad of ["1.2.0", "v1.2", "v01.2.0", "v1.2.0-01", "v1.2.0-", "latest"])
		assert.equal(compareTags(bad, "v0.0.1"), undefined, bad);
	const local = { tag: "v1.2.0", build: 7 };
	assert.equal(newer("v1.2.1", local), true);
	assert.equal(newer("v1.2.0", local), false);
	assert.equal(newer("v1.1.9", local), false);
	assert.equal(newer("v1.3.0", { tag: "v1.3.0-rc.1", build: 0 }), true);
	assert.equal(newer("v1.4.0-rc.1", local), false);
	assert.equal(newer("garbage", local), false);
	assert.deepEqual(releaseStamp({ tag: "v1.3.0-rc.1", build: 0 }), { tag: "v1.3.0-rc.1", build: 0 });
	for (const bad of [
		undefined,
		null,
		{ tag: "v1.2.0" },
		{ tag: "v1.2.0", build: -1 },
		{ tag: "v1.2.0", build: 1.5 },
		{ tag: "1.2.0", build: 0 },
		{ tag: "v1.2.0", build: 0, extra: true },
	])
		assert.equal(releaseStamp(bad), undefined);
});

test("no valid release stamp means no request and no offer", async () => {
	for (const stamp of [undefined, { tag: "v0.2.0" }, "not json"]) {
		const h = await harness({ stamp });
		await h.service.start();
		await h.service.check();
		h.clock.advance(86400000 * 2);
		assert.equal(h.requests.length, 0);
		assert.equal(h.service.snapshot(), undefined);
	}
	const h = await harness();
	(h.service as unknown as { options: { readStamp: () => unknown } }).options.readStamp = () => {
		throw new Error("ENOENT");
	};
	await h.service.start();
	assert.equal(h.requests.length, 0);
});

test("offer decision covers newer, equal, older, prerelease and missing assets", async () => {
	const cases: [unknown, unknown, string, boolean | undefined, string | undefined][] = [
		[release("v1.3.0"), { tag: "v1.2.0", build: 0 }, "available", true, undefined],
		[release("v1.2.1"), { tag: "v1.2.0", build: 7 }, "available", true, undefined],
		[release("v1.2.0"), { tag: "v1.2.0", build: 7 }, "up_to_date", undefined, undefined],
		[release("v1.2.0"), { tag: "v1.2.0", build: 0 }, "up_to_date", undefined, undefined],
		[release("v1.1.0"), { tag: "v1.2.0", build: 0 }, "up_to_date", undefined, undefined],
		[release("v1.4.0-rc.1"), { tag: "v1.2.0", build: 0 }, "up_to_date", undefined, undefined],
		[release("v1.3.0", [CHECKSUMS]), { tag: "v1.2.0", build: 0 }, "up_to_date", false, "no_asset"],
		[release("v1.3.0", [INSTALLER]), { tag: "v1.2.0", build: 0 }, "up_to_date", false, "no_asset"],
	];
	for (const [latest, stamp, state, installable, errorCategory] of cases) {
		const h = await harness({ latest, stamp });
		await h.service.start();
		const snapshot = h.service.snapshot()!;
		assert.equal(snapshot.state, state, JSON.stringify(latest));
		assert.equal(snapshot.installable, installable);
		assert.equal(snapshot.errorCategory, errorCategory);
		if (installable !== undefined) assert.equal(snapshot.releaseUrl, (latest as { html_url: string }).html_url);
		assert.equal(snapshot.lastCheckedAt, new Date(0).toISOString());
		assert.equal(h.events.at(-1)?.event, "update.checked");
	}
	const local = await harness({ latest: release("v1.2.1"), stamp: { tag: "v1.2.0", build: 7 } });
	await local.service.start();
	assert.deepEqual(local.events.at(-1), {
		event: "update.checked",
		installed: "v1.2.0+7",
		latest: "v1.2.1",
		result: "available",
	});
	assert.ok(local.service.snapshot()!.notes!.length <= 2000);
	const long = await harness({ latest: release("v1.3.0", undefined, { body: "x".repeat(5000) }) });
	await long.service.start();
	assert.equal(long.service.snapshot()!.notes!.length, 2000);
});

test("malformed, foreign, oversized and failing responses fail the check without throwing", async () => {
	const foreignAsset = release();
	foreignAsset.assets[0]!.browser_download_url = `https://evil.example/${INSTALLER}`;
	const plainAsset = release();
	plainAsset.assets[1]!.browser_download_url = assetUrl("v1.3.0", CHECKSUMS).replace("https:", "http:");
	const routes: [Route, string][] = [
		[async () => new Response("{not json"), "malformed"],
		[json({ tag_name: "v1.3.0" }), "malformed"],
		[
			json(release("v1.3.0", undefined, { html_url: "https://github.com/someone/else/releases/tag/v1.3.0" })),
			"malformed",
		],
		[json(foreignAsset), "malformed"],
		[json(plainAsset), "malformed"],
		[async () => new Response(" ".repeat(1024 * 1024 + 1)), "malformed"],
		[json({}, 403), "rate_limited"],
		[json({}, 429), "rate_limited"],
		[json({}, 500), "http"],
		[json({}, 404), "http"],
		[
			async () => {
				throw new TypeError("fetch failed");
			},
			"network",
		],
	];
	for (const [route, category] of routes) {
		const h = await harness();
		h.routes.set(RELEASES_URL, route);
		await h.service.start();
		const snapshot = h.service.snapshot()!;
		assert.equal(snapshot.state, "failed", category);
		assert.equal(snapshot.errorCategory, category);
		assert.equal(snapshot.latest, undefined);
		assert.deepEqual(h.events.at(-1), {
			event: "update.failed",
			installed: "v1.2.0",
			phase: "check",
			errorCategory: category,
		});
		assert.equal(h.execs.length, 0);
	}
	const slow = await harness();
	slow.routes.set(
		RELEASES_URL,
		(init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
	);
	const started = slow.service.start();
	while (!slow.requests.length) await new Promise((resolve) => setImmediate(resolve));
	slow.clock.advance(9999);
	assert.equal(slow.service.snapshot()!.state, "checking");
	slow.clock.advance(1);
	await started;
	assert.equal(slow.service.snapshot()!.errorCategory, "network");
});

test("the GitHub request carries no user data", async () => {
	const storage = new MemoryStorage();
	storage.global = { schemaVersion: 2, language: "ru", updates: { autoCheck: true } };
	const h = await harness({ storage });
	await h.service.start();
	assert.equal(h.requests[0]!.url, RELEASES_URL);
	assert.equal(h.requests[0]!.init.method, "GET");
	assert.deepEqual(h.requests[0]!.init.headers, { accept: "application/vnd.github+json" });
	assert.equal(h.requests[0]!.init.body, undefined);
	assert.ok(!JSON.stringify(h.requests).includes(syntheticToken));
	assert.ok(!JSON.stringify(h.events).includes("<script>"));
});

test("start check, 24 h timer, joined checks and disabled automatic checks", async () => {
	const h = await harness();
	await h.service.start();
	assert.equal(h.requests.length, 1);
	h.clock.advance(86400000 - 1);
	assert.equal(h.requests.length, 1);
	h.clock.advance(1);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.requests.length, 2);
	const pending = deferred<void>();
	h.routes.set(RELEASES_URL, async () => {
		await pending.promise;
		return new Response(JSON.stringify(release()));
	});
	const first = h.service.check();
	const second = h.service.check();
	assert.equal(first, second);
	assert.equal(h.service.snapshot()!.state, "checking");
	pending.resolve();
	await Promise.all([first, second]);
	assert.equal(h.requests.length, 3);
	await h.service.setAutoCheck(false);
	h.clock.advance(86400000 * 3);
	assert.equal(h.requests.length, 3);
	await h.service.setAutoCheck(true);
	h.clock.advance(86400000);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.requests.length, 4);
	h.service.dispose();

	const off = await harness({ global: { schemaVersion: 2, language: "en", updates: { autoCheck: false } } });
	await off.service.start();
	off.clock.advance(86400000 * 3);
	assert.equal(off.requests.length, 0);
	assert.equal(off.service.snapshot()!.state, "idle");
	assert.equal(off.service.snapshot()!.autoCheck, false);
	await off.service.check();
	assert.equal(off.requests.length, 1);
	assert.equal(off.service.snapshot()!.state, "available");
	assert.equal(off.execs.length, 0, "no notification while automatic checks are off");
	await assert.rejects(off.service.setAutoCheck("yes"), /validation/);
});

test("notification is sent once per tag with argv text, across Later and restart, and exec failure is ignored", async () => {
	const h = await harness();
	await h.service.start();
	assert.deepEqual(h.execs, [
		{
			file: "/usr/bin/osascript",
			args: [
				"-e",
				"on run argv",
				"-e",
				"display notification (item 1 of argv) with title (item 2 of argv)",
				"-e",
				"end run",
				"MeRGBW 1.3.0 is available",
				"MeRGBW",
			],
		},
	]);
	assert.deepEqual((h.storage.global as { updates: unknown }).updates, { autoCheck: true, notifiedVersion: "v1.3.0" });
	await h.service.check();
	h.service.dismiss("v1.3.0");
	await h.service.check();
	assert.equal(h.execs.length, 1);
	const restarted = await harness({ storage: h.storage });
	await restarted.service.start();
	assert.equal(restarted.service.snapshot()!.state, "available");
	assert.equal(restarted.execs.length, 0);

	const ru = await harness({ global: { schemaVersion: 2, language: "ru" } });
	ru.failing.add("/usr/bin/osascript");
	await ru.service.start();
	assert.equal(ru.execs[0]!.args[6], "Доступна MeRGBW 1.3.0");
	assert.equal(ru.service.snapshot()!.state, "available");
	assert.equal((ru.storage.global as { updates: { notifiedVersion: string } }).updates.notifiedVersion, "v1.3.0");
});

test("Later hides the offer until restart and a newer tag shows it again", async () => {
	const h = await harness();
	await h.service.start();
	assert.throws(() => h.service.dismiss("v1.2.9"), /validation/);
	h.service.dismiss("v1.3.0");
	assert.equal(h.service.snapshot()!.state, "dismissed");
	await h.service.check();
	assert.equal(h.service.snapshot()!.state, "dismissed");
	assert.equal(h.events.at(-1)?.result, "dismissed");
	h.routes.set(RELEASES_URL, json(release("v1.4.0")));
	await h.service.check();
	assert.equal(h.service.snapshot()!.state, "available");
	assert.equal(h.service.snapshot()!.latest, "v1.4.0");
	const restarted = await harness({ storage: h.storage });
	await restarted.service.start();
	assert.equal(restarted.service.snapshot()!.state, "available");
});

test("install verifies the streamed installer before opening it", async () => {
	const h = await harness();
	await mkdir(join(h.root, "mergbw-update", "v0.9.0"), { recursive: true });
	await writeFile(join(h.root, "mergbw-update", "v0.9.0", "left.part"), "old");
	await h.service.start();
	assert.equal(existsSync(join(h.root, "mergbw-update", "v0.9.0")), false, "leftovers are removed on start");
	assert.throws(() => h.service.install("v1.2.9"), /validation/);
	const done = h.service.install("v1.3.0");
	assert.equal(h.service.snapshot()!.state, "downloading");
	assert.throws(() => h.service.install("v1.3.0"), /validation/);
	await done;
	const target = join(h.root, "mergbw-update", "v1.3.0", INSTALLER);
	assert.deepEqual(h.execs.at(-1), { file: "/usr/bin/open", args: [target] });
	assert.deepEqual(await readdir(join(h.root, "mergbw-update", "v1.3.0")), [INSTALLER]);
	assert.equal(h.service.snapshot()!.state, "handed");
	assert.ok(h.requests.slice(1).every((request) => request.init.headers === undefined));
	await h.service.check();
	assert.equal(h.requests.length, 3, "checks are skipped after hand-off");
	await h.service.install("v1.3.0");
	assert.equal(h.service.snapshot()!.state, "handed", "a cancelled prompt can be reopened");
	assert.equal(h.execs.filter((exec) => exec.file === "/usr/bin/open").length, 2);
	await rm(h.root, { recursive: true, force: true });

	const failures: [string, () => Route, string][] = [
		[INSTALLER, () => async () => new Response(Buffer.alloc(payload.length, 1)), "checksum"],
		[CHECKSUMS, () => async () => new Response(`${digest(payload)}  other-file\n`), "checksum"],
		[INSTALLER, () => async () => new Response(Buffer.concat([payload, Buffer.from("x")])), "size"],
		[INSTALLER, () => async () => new Response(payload.subarray(1)), "size"],
		[
			INSTALLER,
			() => async () => {
				throw new TypeError("fetch failed");
			},
			"network",
		],
		[INSTALLER, () => json({}, 404), "http"],
		[CHECKSUMS, () => json({}, 500), "http"],
	];
	for (const [asset, route, category] of failures) {
		const f = await harness();
		await f.service.start();
		f.routes.set(assetUrl("v1.3.0", asset), route());
		await f.service.install("v1.3.0");
		const snapshot = f.service.snapshot()!;
		assert.equal(snapshot.state, "failed", category);
		assert.equal(snapshot.errorCategory, category);
		assert.equal(snapshot.latest, "v1.3.0");
		assert.equal(snapshot.installable, true);
		assert.equal(existsSync(join(f.root, "mergbw-update", "v1.3.0")), false);
		assert.ok(!f.execs.some((exec) => exec.file === "/usr/bin/open"));
		assert.deepEqual(f.events.at(-1), {
			event: "update.failed",
			installed: "v1.2.0",
			phase: "install",
			errorCategory: category,
		});
		await rm(f.root, { recursive: true, force: true });
	}

	const blocked = await harness();
	blocked.failing.add("/usr/bin/open");
	await blocked.service.start();
	await blocked.service.install("v1.3.0");
	assert.equal(blocked.service.snapshot()!.state, "failed");
	assert.equal(blocked.service.snapshot()!.errorCategory, "open_failed");
	await rm(blocked.root, { recursive: true, force: true });
});
