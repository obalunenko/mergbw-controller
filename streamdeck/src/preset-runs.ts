import type { ActionServices } from "./actions/base-action.js";
import type { ReadResult } from "./bridge-client.js";
import type { OperationRecord, OperationResult } from "./operation-store.js";
import { type EffectEnvelope, type EffectSnapshot } from "./preset-effects.js";

type Owner = { record: OperationRecord; presetId: string; id?: string };
type Flight = { record: OperationRecord; epoch: number; prior?: Owner; mode: "cancel" | "check" | "start" };
const active = (effect: EffectSnapshot): boolean => effect.state === "running" || effect.state === "cancelling";

// One controller has one active effect. Ownership is memory only and outlives a key's visibility receipt.
export class PresetRuns {
	private owner?: Owner;
	private epoch = 0;
	private readonly flights = new Map<string, Flight>();
	private readonly raw = new Set<string>();
	constructor(private readonly services: ActionServices) {
		services.operations.subscribe((record) => this.observe(record));
		const prune = (): void => {
			if (this.owner && !this.bindingCurrent(this.owner.record)) this.owner = undefined;
		};
		services.settings.subscribe(prune);
		services.runtime?.subscribe(prune);
	}
	public pending(context: string): boolean {
		return this.raw.has(context);
	}
	private bindingCurrent(record: OperationRecord): boolean {
		const { settings, runtime } = this.services;
		const capability = record.snapshot.capability;
		return (
			record.settingsRevision === settings.revision(record.context) &&
			record.connectionRevision === settings.connectionRevision &&
			(runtime ? !!capability && runtime.current(capability) && !!runtime.capability() : !capability)
		);
	}
	private current(flight: Flight, pending = true): boolean {
		return (
			flight.epoch === this.epoch &&
			this.bindingCurrent(flight.record) &&
			(!pending || flight.record.status === "pending")
		);
	}
	private observe(record: OperationRecord): void {
		if (record.status === "pending" && this.bindingCurrent(record)) {
			const prior =
				this.owner?.record.context === record.context && this.bindingCurrent(this.owner.record)
					? this.owner
					: undefined;
			this.epoch++;
			this.owner = undefined;
			if (record.actionKind === "preset" && /^preset\/[a-z0-9_-]{1,40}$/.test(record.snapshot.route))
				this.flights.set(record.operationId, { record, epoch: this.epoch, prior, mode: "start" });
		} else if (record.status === "unknown") {
			const flight = this.flights.get(record.operationId);
			if (flight?.mode === "start" && this.current(flight, false))
				this.owner = { record, presetId: record.snapshot.route.slice("preset/".length) };
		}
	}
	private publish(flight: Flight, result: ReadResult<EffectEnvelope>): void {
		if (!this.current(flight)) return;
		this.services.inspector.publishEffect(
			flight.record.context,
			result.value?.effect ?? null,
			result.value ? undefined : (result.errorCategory ?? "protocol"),
			flight.record.snapshot.capability,
		);
	}
	private failure(result: ReadResult<EffectEnvelope>): OperationResult {
		return { status: "unknown", errorCategory: result.errorCategory ?? "protocol", requestId: result.requestId };
	}
	public async command(record: OperationRecord): Promise<OperationResult> {
		const flight = this.flights.get(record.operationId);
		if (!flight || !this.current(flight)) return { status: "rejected", errorCategory: "service" };
		this.raw.add(record.context);
		try {
			if (flight.prior) {
				this.owner = flight.prior;
				flight.mode = "check";
				const capability = record.snapshot.capability;
				const read = await this.services.client.effect(record.snapshot.connection, capability?.signal, capability);
				if (!this.current(flight)) return { status: "rejected", errorCategory: "service" };
				this.publish(flight, read);
				if (!read.value) return this.failure(read);
				const effect = read.value.effect;
				if (!flight.prior.id) {
					// A status read never grants ownership after a lost admission receipt.
					// Present an explicit inspector Stop choice; this press does not replay the start.
					if (!effect || !active(effect)) this.owner = undefined;
					return {
						status: "accepted",
						...(effect ? { effect } : {}),
						requestId: read.requestId,
					};
				}
				if (effect?.id !== flight.prior.id || effect.presetId !== flight.prior.presetId) {
					this.owner = undefined;
					return { status: "rejected", errorCategory: "protocol", requestId: read.requestId };
				}
				if (active(effect)) {
					flight.mode = "cancel";
					const stopped = await this.services.client.cancelEffect(
						record.snapshot.connection,
						effect.id,
						capability?.signal,
						capability,
					);
					if (!this.current(flight)) return { status: "rejected", errorCategory: "service" };
					if (
						stopped.value?.effect &&
						(stopped.value.effect.id !== effect.id || stopped.value.effect.presetId !== effect.presetId)
					) {
						const invalid: ReadResult<EffectEnvelope> = { errorCategory: "protocol", requestId: stopped.requestId };
						this.publish(flight, invalid);
						return this.failure(invalid);
					}
					this.publish(flight, stopped);
					if (!stopped.value?.effect) return this.failure(stopped);
					if (!active(stopped.value.effect)) this.owner = undefined;
					return { status: "accepted", effect: stopped.value.effect, requestId: stopped.requestId };
				}
				this.owner = undefined;
			}
			flight.mode = "start";
			let result: OperationResult;
			try {
				result = await this.services.client.command(record);
			} catch {
				result = { status: "unknown", errorCategory: "service" };
			}
			if (!this.current(flight)) return { status: "rejected", errorCategory: "service" };
			const presetId = record.snapshot.route.slice("preset/".length);
			if (result.status === "accepted" && result.effect) this.owner = { record, presetId, id: result.effect.id };
			else if (result.status === "unknown") this.owner = { record, presetId };
			return result;
		} finally {
			this.raw.delete(record.context);
			this.flights.delete(record.operationId);
		}
	}
}
