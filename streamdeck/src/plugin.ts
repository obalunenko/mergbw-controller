import streamDeck from "@elgato/streamdeck";

import { Brightness } from "./actions/brightness.js";
import { Color } from "./actions/color.js";
import { PowerOff } from "./actions/power-off.js";
import { PowerOn } from "./actions/power-on.js";
import { Preset } from "./actions/preset.js";
import { BridgeClient } from "./bridge-client.js";
import { Diagnostics } from "./diagnostics.js";
import { InspectorController } from "./inspector-messages.js";
import { OperationStore } from "./operation-store.js";
import { Settings } from "./settings.js";

streamDeck.logger.setLevel("info");
const diagnostics = new Diagnostics((fields) => streamDeck.logger.info(fields));
const settings = new Settings(
	{
		getGlobal: () => streamDeck.settings.getGlobalSettings(),
		setGlobal: (value) => streamDeck.settings.setGlobalSettings(value),
		setAction: async (context, value) => {
			const target = streamDeck.actions.getActionById(context);
			if (!target) throw new Error("storage");
			await target.setSettings(value);
		},
	},
	diagnostics,
);
const operations = new OperationStore();
const client = new BridgeClient();
const inspector = new InspectorController(
	settings,
	operations,
	client,
	async (reply, context) => {
		if (streamDeck.ui.action?.id === context) await streamDeck.ui.sendToPropertyInspector(reply);
	},
	diagnostics,
);
const services = { settings, operations, client, inspector, diagnostics };
streamDeck.actions.registerAction(new PowerOn(services));
streamDeck.actions.registerAction(new PowerOff(services));
streamDeck.actions.registerAction(new Color(services));
streamDeck.actions.registerAction(new Brightness(services));
streamDeck.actions.registerAction(new Preset(services));
settings.subscribe(() => {
	try {
		diagnostics.setCurrent(settings.getConnection()?.accessToken);
	} catch {
		diagnostics.setCurrent();
	}
});
async function start(): Promise<void> {
	await streamDeck.connect();
	await settings.load();
	diagnostics.emit("plugin.ready");
}
void start().catch(() => {
	streamDeck.logger.error({ event: "plugin.start.failed", errorCategory: "validation" });
});
