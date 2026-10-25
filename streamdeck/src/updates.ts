import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Diagnostics, UpdateErrorCategory, UpdateResult } from "./diagnostics.js";
import type { Clock } from "./operation-store.js";
import type { Settings } from "./settings.js";
import { object, STABLE_TAG } from "./validation.js";

export const RELEASES_URL = "https://api.github.com/repos/obalunenko/mergbw-controller/releases/latest";
export const RELEASE_PAGE = "https://github.com/obalunenko/mergbw-controller/";
export const INSTALLER = "com.obalunenko.mergbw.development.streamDeckPlugin";
export const CHECKSUMS = "SHA256SUMS";
export const LIMITS = {
	api: 1024 * 1024,
	checksums: 64 * 1024,
	installer: 256 * 1024 * 1024,
	requestMs: 10000,
	// simplified: one 10-minute ceiling for the whole installer download, raise it if slow links time out.
	downloadMs: 600000,
	intervalMs: 86400000,
	notes: 2000,
};
const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);
const IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const TAG = new RegExp(`^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`);

export type ReleaseStamp = { tag: string; build: number };
export type UpdateState =
	"available" | "checking" | "dismissed" | "downloading" | "failed" | "handed" | "idle" | "up_to_date";
export type UpdateSnapshot = {
	state: UpdateState;
	installed: string;
	latest?: string;
	autoCheck: boolean;
	lastCheckedAt?: string;
	notes?: string;
	releaseUrl?: string;
	installable?: boolean;
	errorCategory?: UpdateErrorCategory;
};
export type Asset = { url: string; size: number };
export type Release = { tag: string; htmlUrl: string; notes: string; installer?: Asset; checksums?: Asset };
export type UpdateFetch = (url: string, init: RequestInit & { signal: AbortSignal }) => Promise<Response>;
export type UpdateExec = (file: string, args: string[]) => Promise<unknown>;
export type UpdateOptions = {
	fetch: UpdateFetch;
	exec: UpdateExec;
	clock: Clock;
	tmpRoot: string;
	settings: Pick<Settings, "getUpdates" | "saveUpdates">;
	readStamp: () => unknown;
	diagnostics?: Diagnostics;
	// Open Stream Deck's install prompt when a check finds an update (default true).
	prompt?: boolean;
};
class UpdateError extends Error {
	constructor(public readonly category: UpdateErrorCategory) {
		super(category);
	}
}
const category = (error: unknown, fallback: UpdateErrorCategory): UpdateErrorCategory =>
	error instanceof UpdateError ? error.category : fallback;

function parts(tag: unknown): { core: string[]; pre: string[] } | undefined {
	if (typeof tag !== "string" || tag.length > 128) return undefined;
	const match = TAG.exec(tag);
	return match ? { core: [match[1]!, match[2]!, match[3]!], pre: match[4]?.split(".") ?? [] } : undefined;
}
const digits = (value: string): boolean => /^\d+$/.test(value);
const numeric = (a: string, b: string): number => Math.sign(a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
// Semver precedence (§11). Undefined when either tag does not parse.
export function compareTags(a: string, b: string): number | undefined {
	const x = parts(a),
		y = parts(b);
	if (!x || !y) return undefined;
	for (let i = 0; i < 3; i++) {
		const order = numeric(x.core[i]!, y.core[i]!);
		if (order) return order;
	}
	if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
	for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
		const p = x.pre[i]!,
			q = y.pre[i]!;
		const order = digits(p) && digits(q) ? numeric(p, q) : digits(p) ? -1 : digits(q) ? 1 : p < q ? -1 : p > q ? 1 : 0;
		if (order) return order;
	}
	return Math.sign(x.pre.length - y.pre.length);
}
export function releaseStamp(value: unknown): ReleaseStamp | undefined {
	if (!object(value) || Object.keys(value).length !== 2 || !parts(value.tag)) return undefined;
	if (typeof value.build !== "number" || !Number.isSafeInteger(value.build) || value.build < 0) return undefined;
	return { tag: value.tag as string, build: value.build };
}
// A release is (tag, 0); an equal tag never beats any installed build.
export function newer(latest: string, installed: ReleaseStamp): boolean {
	return STABLE_TAG.test(latest) && (compareTags(latest, installed.tag) ?? 0) > 0;
}
function safeUrl(value: unknown, hosts: Set<string>): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && hosts.has(url.hostname) && !url.port && !url.username && !url.password;
	} catch {
		return false;
	}
}
export function parseRelease(value: unknown): Release {
	if (
		!object(value) ||
		typeof value.tag_name !== "string" ||
		!Array.isArray(value.assets) ||
		(value.body !== undefined && value.body !== null && typeof value.body !== "string") ||
		!safeUrl(value.html_url, new Set(["github.com"])) ||
		!value.html_url.startsWith(RELEASE_PAGE)
	)
		throw new UpdateError("malformed");
	const release: Release = {
		tag: value.tag_name,
		htmlUrl: value.html_url,
		notes: ((value.body as string | null | undefined) ?? "").slice(0, LIMITS.notes),
	};
	for (const asset of value.assets) {
		if (!object(asset) || typeof asset.name !== "string") throw new UpdateError("malformed");
		const key = asset.name === INSTALLER ? "installer" : asset.name === CHECKSUMS ? "checksums" : undefined;
		if (!key) continue;
		if (
			typeof asset.size !== "number" ||
			!Number.isSafeInteger(asset.size) ||
			asset.size <= 0 ||
			asset.size > (key === "installer" ? LIMITS.installer : LIMITS.checksums) ||
			!safeUrl(asset.browser_download_url, DOWNLOAD_HOSTS)
		)
			throw new UpdateError("malformed");
		release[key] = { url: asset.browser_download_url, size: asset.size };
	}
	return release;
}
export function decide(
	installed: ReleaseStamp | undefined,
	release: Release,
	dismissed?: string,
): UpdateResult | undefined {
	if (!installed) return undefined;
	if (!newer(release.tag, installed)) return "up_to_date";
	if (!release.installer || !release.checksums) return "no_asset";
	return release.tag === dismissed ? "dismissed" : "available";
}

export class UpdateService {
	private stamp?: ReleaseStamp;
	private state: UpdateState = "idle";
	private release?: Release;
	private offer?: Release;
	private dismissedTag?: string;
	private promptedTag?: string;
	private lastCheckedAt?: number;
	private error?: UpdateErrorCategory;
	private inFlight?: Promise<void>;
	private timer?: unknown;
	private started?: Promise<void>;
	private readonly listeners = new Set<() => void>();
	constructor(private readonly options: UpdateOptions) {}
	public start(): Promise<void> {
		return (this.started ??= this.boot());
	}
	public dispose(): void {
		this.disarm();
		this.listeners.clear();
	}
	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public snapshot(): UpdateSnapshot | undefined {
		if (!this.stamp) return undefined;
		const value: UpdateSnapshot = { state: this.state, installed: this.stamp.tag, autoCheck: this.autoCheck() };
		if (this.release && STABLE_TAG.test(this.release.tag)) value.latest = this.release.tag;
		const shown = this.offer ?? (this.error === "no_asset" ? this.release : undefined);
		if (shown) {
			value.notes = shown.notes;
			value.releaseUrl = shown.htmlUrl;
			value.installable = !!shown.installer && !!shown.checksums;
		}
		if (this.lastCheckedAt !== undefined) value.lastCheckedAt = new Date(this.lastCheckedAt).toISOString();
		if (this.error) value.errorCategory = this.error;
		return value;
	}
	public check(): Promise<void> {
		if (!this.stamp || this.state === "downloading") return this.inFlight ?? Promise.resolve();
		return (this.inFlight ??= this.runCheck().finally(() => {
			this.inFlight = undefined;
		}));
	}
	public dismiss(tag: unknown): void {
		if (!this.offer || this.offer.tag !== tag || this.state === "downloading") throw new Error("validation");
		this.dismissedTag = tag;
		this.state = "dismissed";
		this.notify();
	}
	// Validates synchronously, then returns the running download.
	public install(tag: unknown): Promise<void> {
		const offer = this.offer;
		if (!offer || offer.tag !== tag || !["available", "dismissed", "handed"].includes(this.state))
			throw new Error("validation");
		this.state = "downloading";
		this.error = undefined;
		this.notify();
		return this.runInstall(offer);
	}
	public async setAutoCheck(value: unknown): Promise<void> {
		if (typeof value !== "boolean") throw new Error("validation");
		await this.options.settings.saveUpdates({ ...this.options.settings.getUpdates(), autoCheck: value });
		if (value && this.stamp) this.arm();
		else this.disarm();
		this.notify();
	}
	private async boot(): Promise<void> {
		await rm(join(this.options.tmpRoot, "mergbw-update"), { recursive: true, force: true }).catch(() => {});
		try {
			this.stamp = releaseStamp(await this.options.readStamp());
		} catch {
			this.stamp = undefined;
		}
		this.notify();
		if (!this.stamp || !this.autoCheck()) return;
		this.arm();
		await this.check();
	}
	private autoCheck(): boolean {
		return this.options.settings.getUpdates().autoCheck;
	}
	private arm(): void {
		this.disarm();
		this.timer = this.options.clock.setTimeout(() => {
			this.timer = undefined;
			if (!this.autoCheck()) return;
			this.arm();
			void this.check();
		}, LIMITS.intervalMs);
	}
	private disarm(): void {
		if (this.timer !== undefined) this.options.clock.clearTimeout(this.timer);
		this.timer = undefined;
	}
	private installed(): string {
		return this.stamp!.build ? `${this.stamp!.tag}+${this.stamp!.build}` : this.stamp!.tag;
	}
	private async runCheck(): Promise<void> {
		this.state = "checking";
		this.notify();
		let release: Release;
		try {
			const { body } = await this.get(RELEASES_URL, LIMITS.api, LIMITS.requestMs, "malformed", true);
			let parsed: unknown;
			try {
				parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
			} catch {
				throw new UpdateError("malformed");
			}
			release = parseRelease(parsed);
		} catch (error) {
			this.lastCheckedAt = this.options.clock.now();
			if (!this.offer) this.release = undefined;
			this.fail("check", category(error, "network"));
			return;
		}
		const result = decide(this.stamp, release, this.dismissedTag)!;
		this.lastCheckedAt = this.options.clock.now();
		this.release = release;
		this.offer = result === "available" || result === "dismissed" ? release : undefined;
		this.error = result === "no_asset" ? "no_asset" : undefined;
		this.state = result === "no_asset" ? "up_to_date" : result;
		this.options.diagnostics?.emit("update.checked", { installed: this.installed(), latest: release.tag, result });
		this.notify();
		if (result === "available") this.prompt(release.tag);
	}
	// Stream Deck shows its own install confirmation; Cancel keeps the banner until the next plugin start.
	private prompt(tag: string): void {
		if (this.options.prompt === false || !this.autoCheck() || this.promptedTag === tag) return;
		this.promptedTag = tag;
		void this.install(tag).catch(() => {});
	}
	private async runInstall(offer: Release): Promise<void> {
		const dir = join(this.options.tmpRoot, "mergbw-update", offer.tag);
		const target = join(dir, INSTALLER);
		try {
			await rm(dir, { recursive: true, force: true });
			await mkdir(dir, { recursive: true });
			const sums = await this.get(offer.checksums!.url, LIMITS.checksums, LIMITS.requestMs, "size");
			let expected: string | undefined;
			for (const line of new TextDecoder().decode(sums.body).split(/\r?\n/)) {
				const match = /^([0-9a-f]{64}) [ *](?:\.\/)?(.+)$/.exec(line.trimEnd());
				if (match?.[2] === INSTALLER) expected = match[1];
			}
			if (!expected) throw new UpdateError("checksum");
			const hash = createHash("sha256");
			const file = await open(`${target}.part`, "wx");
			let length: number;
			try {
				({ length } = await this.get(
					offer.installer!.url,
					Math.min(LIMITS.installer, offer.installer!.size),
					LIMITS.downloadMs,
					"size",
					false,
					async (chunk) => {
						hash.update(chunk);
						await file.write(chunk);
					},
				));
			} finally {
				await file.close();
			}
			if (length !== offer.installer!.size) throw new UpdateError("size");
			if (hash.digest("hex") !== expected) throw new UpdateError("checksum");
			await rename(`${target}.part`, target);
		} catch (error) {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
			this.fail("install", category(error, "network"));
			return;
		}
		try {
			await this.options.exec("/usr/bin/open", [target]);
		} catch {
			this.fail("install", "open_failed");
			return;
		}
		this.state = "handed";
		this.notify();
	}
	private fail(phase: "check" | "install", errorCategory: UpdateErrorCategory): void {
		this.error = errorCategory;
		// A failed check keeps a known offer; only an install failure shows "failed" with it.
		this.state =
			phase === "check" && this.offer ? (this.offer.tag === this.dismissedTag ? "dismissed" : "available") : "failed";
		this.options.diagnostics?.emit("update.failed", { installed: this.installed(), phase, errorCategory });
		this.notify();
	}
	private async get(
		url: string,
		cap: number,
		timeoutMs: number,
		over: UpdateErrorCategory,
		api = false,
		sink?: (chunk: Uint8Array) => Promise<void>,
	): Promise<{ body: Buffer; length: number }> {
		const controller = new AbortController();
		const timer = this.options.clock.setTimeout(() => controller.abort(), timeoutMs);
		try {
			let response: Response;
			try {
				response = await this.options.fetch(url, {
					method: "GET",
					redirect: "follow",
					signal: controller.signal,
					...(api ? { headers: { accept: "application/vnd.github+json" } } : {}),
				});
			} catch {
				throw new UpdateError("network");
			}
			if (api && (response.status === 403 || response.status === 429)) throw new UpdateError("rate_limited");
			if (!response.ok) throw new UpdateError("http");
			if (response.url && !response.url.startsWith("https:")) throw new UpdateError(api ? "malformed" : "network");
			if (Number(response.headers.get("content-length") ?? 0) > cap) throw new UpdateError(over);
			const chunks: Uint8Array[] = [];
			let length = 0;
			const reader = response.body?.getReader();
			try {
				while (reader) {
					const { done, value } = await reader.read();
					if (done) break;
					length += value.byteLength;
					if (length > cap) throw new UpdateError(over);
					if (sink) await sink(value);
					else chunks.push(value);
				}
			} catch (error) {
				await reader?.cancel().catch(() => {});
				throw error instanceof UpdateError ? error : new UpdateError("network");
			}
			return { body: Buffer.concat(chunks), length };
		} finally {
			this.options.clock.clearTimeout(timer);
			controller.abort();
		}
	}
	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
