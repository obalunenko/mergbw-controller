import { action } from "@elgato/streamdeck";

import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.preset" })
export class Preset extends BaseAction {
	constructor(services: ActionServices) {
		super("preset", services);
	}
	protected override route(value: Assignment): string {
		const id = assignment("preset", value).presetId;
		if (!id || !this.services.inspector.presetAvailable(id)) throw new Error("preset");
		return `preset/${id}`;
	}
}
