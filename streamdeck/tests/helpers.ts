import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";

import type { Clock } from "../src/operation-store.js";
import type { Assignment, GlobalSettings } from "../src/validation.js";

export const syntheticToken = "mock_access_token_1234567890123456";
export class MemoryStorage {
	public global: unknown = {};
	public actions = new Map<string, Assignment>();
	public fail = false;
	public getGlobal = async (): Promise<unknown> => structuredClone(this.global);
	public setGlobal = async (value: GlobalSettings): Promise<void> => {
		if (this.fail) throw new Error("synthetic failure");
		this.global = structuredClone(value);
	};
	public setAction = async (context: string, value: Assignment): Promise<void> => {
		if (this.fail) throw new Error("synthetic failure");
		this.actions.set(context, structuredClone(value));
	};
}
export class ControlledClock implements Clock {
	private time = 0;
	private next = 0;
	private readonly timers = new Map<number, { at: number; callback: () => void }>();
	public now = (): number => this.time;
	public setTimeout = (callback: () => void, delay: number): unknown => {
		const id = ++this.next;
		this.timers.set(id, { at: this.time + Math.max(0, delay), callback });
		return id;
	};
	public clearTimeout = (id: unknown): void => {
		this.timers.delete(id as number);
	};
	public advance(ms: number): void {
		const end = this.time + ms;
		while (true) {
			const next = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!next) break;
			this.time = next[1].at;
			this.timers.delete(next[0]);
			next[1].callback();
		}
		this.time = end;
	}
}
export async function fixture(handler: RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const port = (server.address() as AddressInfo).port;
	if (port === 18765) {
		server.close();
		throw new Error("unsafe test port");
	}
	return {
		port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
export class KeyFacade {
	public alerts = 0;
	public oks = 0;
	public titles: unknown[] = [];
	public images: unknown[] = [];
	public showAlert = async (): Promise<void> => {
		this.alerts++;
	};
	public showOk = async (): Promise<void> => {
		this.oks++;
	};
	public setTitle = async (value?: string): Promise<void> => {
		this.titles.push(value);
	};
	public setImage = async (value?: string): Promise<void> => {
		this.images.push(value);
	};
}
