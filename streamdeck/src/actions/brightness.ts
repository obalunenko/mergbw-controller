import { action } from "@elgato/streamdeck";

import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.brightness" })
export class Brightness extends BaseAction {
	constructor(services: ActionServices) {
		super("brightness", services);
	}
	protected override route(value: Assignment): string {
		return `brightness/${assignment("brightness", value).percent!}`;
	}
}
