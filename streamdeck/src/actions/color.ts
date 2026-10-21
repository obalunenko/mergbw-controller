import { action } from "@elgato/streamdeck";

import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.color" })
export class Color extends BaseAction {
	constructor(services: ActionServices) {
		super("color", services);
	}
	protected override route(value: Assignment): string {
		return `color/${assignment("color", value).rgb!}`;
	}
}
