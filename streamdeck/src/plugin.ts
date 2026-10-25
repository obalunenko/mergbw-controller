import streamDeck from "@elgato/streamdeck";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Brightness } from "./actions/brightness.js";
import { Color } from "./actions/color.js";
import { PowerOff } from "./actions/power-off.js";
import { PowerOn } from "./actions/power-on.js";
import { Preset } from "./actions/preset.js";
import { Scene } from "./actions/scene.js";
import { Transition } from "./actions/transition.js";
import { BridgeClient } from "./bridge-client.js";
import { Diagnostics, type ErrorCategory } from "./diagnostics.js";
import { HostProbeBroker } from "./host-liveness.js";
import { InspectorController } from "./inspector-messages.js";
import { bundledSupervisorSpawn, ManagedController, runtimeError, shutdownOnSignal } from "./managed-controller.js";
import { OperationStore } from "./operation-store.js";
import { Settings } from "./settings.js";

streamDeck.logger.setLevel("info");
const diagnostics = new Diagnostics((fields) => streamDeck.logger.info(fields));
const host = new HostProbeBroker(() => streamDeck.settings.getGlobalSettings());
const settings = new Settings(
	{
		getGlobal: () => host.probe(),
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
const runtime = new ManagedController(
	bundledSupervisorSpawn(resolve(dirname(fileURLToPath(import.meta.url)), "..")),
	settings,
	client,
	host,
);
const inspector = new InspectorController(
	settings,
	operations,
	client,
	async (reply, context) => {
		if (streamDeck.ui.action?.id === context) await streamDeck.ui.sendToPropertyInspector(reply);
	},
	diagnostics,
	runtime,
);
const services = { settings, operations, client, inspector, diagnostics, runtime };
streamDeck.actions.registerAction(new PowerOn(services));
streamDeck.actions.registerAction(new PowerOff(services));
streamDeck.actions.registerAction(new Color(services));
streamDeck.actions.registerAction(new Scene(services));
streamDeck.actions.registerAction(new Brightness(services));
streamDeck.actions.registerAction(new Preset(services));
streamDeck.actions.registerAction(new Transition(services));
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
	await runtime.open();
	diagnostics.emit("plugin.ready");
}
void start().catch((error: unknown) => {
	runtime.startupFailed(error);
	diagnostics.emit("runtime.failed", {
		errorCategory: runtimeError(error, "storage_unavailable") as ErrorCategory,
		phase: "startup",
	});
});

const stop = shutdownOnSignal(runtime, (code) => process.exit(code));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);

process.once("exit", () => runtime.exit());
