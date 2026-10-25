import { isDeepStrictEqual } from "node:util";

import type { Diagnostics } from "./diagnostics.js";
import {
	type ActionKind,
	assignment,
	type Assignment,
	connection,
	type Connection,
	globals,
	type GlobalSettings,
	language,
	type Language,
} from "./validation.js";

export type Persistence = {
	getGlobal: () => Promise<unknown>;
	setGlobal: (value: GlobalSettings) => Promise<void>;
	setAction: (context: string, value: Assignment) => Promise<void>;
};
export class Settings {
	public connectionRevision = 0;
	private managed?: () => Connection | null;
	private managedSafe?: (value: string) => boolean;
	private active: GlobalSettings | null = null;
	private fallbackLanguage: Language = "en";
	private queue: Promise<void> = Promise.resolve();
	private readonly actions = new Map<string, { kind: ActionKind; raw: unknown; revision: number }>();
	private readonly listeners = new Set<() => void>();
	constructor(
		private readonly persistence: Persistence,
		private readonly diagnostics?: Diagnostics,
	) {}
	public load(): Promise<void> {
		return this.serial(async () => {
			const raw = await this.persistence.getGlobal();
			try {
				if (typeof raw === "object" && raw !== null && "language" in raw)
					this.fallbackLanguage = language(raw.language);
			} catch {
				/* Invalid language stays inspectable without persistence. */
			}
			let next: GlobalSettings | null;
			try {
				next = globals(raw);
			} catch {
				next = null;
			}
			this.activate(next);
		});
	}
	public get(): GlobalSettings {
		if (!this.active) throw new Error("validation");
		return structuredClone(this.active);
	}
	public getConnection(): Connection | null {
		return this.managed ? this.managed() : (this.get().connection ?? null);
	}
	public useManaged(connection: () => Connection | null, safe?: (value: string) => boolean): void {
		this.managed = connection;
		this.managedSafe = safe;
		this.connectionRevision++;
		this.notify();
	}
	public runtimeChanged(invalidate = true): void {
		if (invalidate) this.connectionRevision++;
		this.notify();
	}
	public migrationStatus(): "invalid" | "legacy" | "ready" {
		return !this.active ? "invalid" : this.active.schemaVersion === 1 ? "legacy" : "ready";
	}
	public legacyConnection(): Connection | null {
		return this.active?.schemaVersion === 1 ? (this.active.connection ?? null) : null;
	}
	public migrateCommitted(): Promise<void> {
		return this.serial(async () => {
			if (!this.active) throw new Error("validation");
			if (this.active.schemaVersion === 1) await this.commit({ schemaVersion: 2, language: this.active.language });
		});
	}
	public getLanguage(): Language {
		return this.active?.language ?? this.fallbackLanguage;
	}
	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	public receiveAction(context: string, kind: ActionKind, raw: unknown): void {
		const previous = this.actions.get(context);
		let next = structuredClone(raw);
		try {
			next = assignment(kind, raw);
		} catch {
			/* Preserve corrupt or future settings until an explicit valid save. */
		}
		if (previous?.kind === kind && isDeepStrictEqual(previous.raw, next)) return;
		this.actions.set(context, { kind, raw: next, revision: (previous?.revision ?? 0) + 1 });
		this.notify();
	}
	public getAction(context: string): Assignment {
		const current = this.actions.get(context);
		if (!current) throw new Error("validation");
		const safe = assignment(current.kind, current.raw);
		if (safe.presetId && !this.isSafePresetId(safe.presetId)) throw new Error("validation");
		return safe;
	}
	public isSafePresetId(id: string): boolean {
		const secret = this.active?.connection?.accessToken;
		return !(secret && id.includes(secret)) && this.managedSafe?.(id) !== false && !this.diagnostics?.hasSecret(id);
	}
	public kind(context: string): ActionKind | undefined {
		return this.actions.get(context)?.kind;
	}
	public revision(context: string): number {
		return this.actions.get(context)?.revision ?? 0;
	}
	public async saveAction(context: string, raw: unknown): Promise<void> {
		const current = this.actions.get(context);
		if (!current) throw new Error("validation");
		const safe = assignment(current.kind, raw);
		if (safe.presetId && !this.isSafePresetId(safe.presetId)) throw new Error("validation");
		try {
			await this.persistence.setAction(context, safe);
		} catch {
			throw new Error("storage");
		}
		this.receiveAction(context, current.kind, safe);
	}
	public saveConnection(port: unknown, replacementToken?: unknown): Promise<void> {
		return this.serial(async () => {
			if (this.managed || !this.active) throw new Error("migration_required");
			const old = this.active;
			const secret =
				replacementToken === "" || replacementToken === undefined ? old?.connection?.accessToken : replacementToken;
			const next = connection({ port, accessToken: secret });
			await this.commit({ schemaVersion: 1, connection: next, language: old?.language ?? "en" });
		});
	}
	public importConnection(value: Connection): Promise<void> {
		return this.serial(async () => {
			if (this.managed || !this.active) throw new Error("migration_required");
			await this.commit({ schemaVersion: 1, connection: connection(value), language: this.active.language });
		});
	}
	public saveLanguage(value: unknown): Promise<void> {
		return this.serial(async () => {
			const old = this.get();
			await this.commit({ ...old, language: language(value) });
		});
	}
	private serial(work: () => Promise<void>): Promise<void> {
		const next = this.queue.then(work);
		this.queue = next.catch(() => {});
		return next;
	}
	private async commit(next: GlobalSettings): Promise<void> {
		try {
			await this.persistence.setGlobal(structuredClone(next));
		} catch {
			throw new Error("storage");
		}
		this.activate(next);
	}
	private activate(next: GlobalSettings | null): void {
		const previous = this.active;
		this.active = structuredClone(next);
		if (!this.managed && JSON.stringify(previous?.connection ?? null) !== JSON.stringify(next?.connection ?? null))
			this.connectionRevision++;
		this.notify();
	}
	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
