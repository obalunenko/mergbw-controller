import { action, type KeyDownEvent } from "@elgato/streamdeck";

import type { OperationRecord, OperationResult } from "../operation-store.js";
import { PresetRuns } from "../preset-runs.js";
import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.preset" })
export class Preset extends BaseAction {
	private readonly runs: PresetRuns;
	constructor(services: ActionServices) {
		super("preset", services);
		this.runs = new PresetRuns(services);
	}
	public override async onKeyDown(ev: KeyDownEvent<Assignment>): Promise<void> {
		if (this.runs.pending(ev.action.id)) return;
		await super.onKeyDown(ev);
	}
	protected override command(record: OperationRecord): Promise<OperationResult> {
		return this.runs.command(record);
	}
	protected override route(value: Assignment): string {
		const id = assignment("preset", value).presetId;
		if (!id || !this.services.inspector.presetAvailable(id)) throw new Error("preset");
		return `preset/${id}`;
	}
}
