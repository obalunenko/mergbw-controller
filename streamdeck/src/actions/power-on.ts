import { action } from "@elgato/streamdeck";

import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.on" })
export class PowerOn extends BaseAction {
	constructor(services: ActionServices) {
		super("on", services);
	}
}
