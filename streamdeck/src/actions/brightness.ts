import {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { DialBrightness } from "../dial-brightness.js";
import { assignment, type Assignment } from "../validation.js";
import { type ActionServices, BaseAction } from "./base-action.js";

@action({ UUID: "com.obalunenko.mergbw.brightness" })
export class Brightness extends BaseAction {
	private readonly dial: DialBrightness;
	constructor(services: ActionServices) {
		super("brightness", services);
		this.dial = new DialBrightness(services);
	}
	public override async onWillAppear(ev: WillAppearEvent<Assignment>): Promise<void> {
		const appearance = super.onWillAppear(ev);
		if (!ev.action.isKey() && ev.action.isDial()) this.dial.appear(ev.action);
		await appearance;
	}
	public override onWillDisappear(ev: WillDisappearEvent<Assignment>): void {
		this.dial.disappear(ev.action.id);
		super.onWillDisappear(ev);
	}
	public override onDialDown(ev: DialDownEvent<Assignment>): void {
		this.dial.press(ev.action.id);
	}
	public override onDialRotate(ev: DialRotateEvent<Assignment>): void {
		this.dial.rotate(ev.action.id, ev.payload.ticks);
	}
	protected override route(value: Assignment): string {
		return `brightness/${assignment("brightness", value).percent!}`;
	}
}
