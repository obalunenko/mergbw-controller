import { action } from "@elgato/streamdeck";

import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.transition" })
export class Transition extends BaseAction {
	constructor(services: ActionServices) {
		super("transition", services);
	}
	protected override route(value: Assignment): string {
		const v = assignment("transition", value);
		return `transition/${v.fromRGB}/${v.fromPercent}/${v.toRGB}/${v.toPercent}/${v.durationSeconds}`;
	}
}
