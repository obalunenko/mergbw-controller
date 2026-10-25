import { action } from "@elgato/streamdeck";

import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.scene" })
export class Scene extends BaseAction {
	constructor(services: ActionServices) {
		super("scene", services);
	}
	protected override route(value: Assignment): string {
		return `scene/${assignment("scene", value).sceneId!}`;
	}
}
