import { action } from "@elgato/streamdeck";

import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.off" })
export class PowerOff extends BaseAction {
	constructor(services: ActionServices) {
		super("off", services);
	}
}
