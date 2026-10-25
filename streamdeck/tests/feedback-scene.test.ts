import assert from "node:assert/strict";
import { test } from "node:test";

import { Feedback } from "../src/feedback.js";
import { Settings } from "../src/settings.js";
import { KeyFacade, MemoryStorage } from "./helpers.js";

test("scene key title shows the catalog label, raw ID, or action name when invalid", async () => {
	const settings = new Settings(new MemoryStorage());
	await settings.load();
	for (const [value, title] of [
		[{ schemaVersion: 1, sceneId: "disco" }, "Disco"],
		[{ schemaVersion: 1, sceneId: "8A" }, "ID 8A"],
		[{ schemaVersion: 1, sceneId: "94" }, "Scene"],
	] as const) {
		settings.receiveAction("key", "scene", value);
		const key = new KeyFacade();
		await new Feedback(settings).ready(key, "scene", "key");
		assert.deepEqual(key.titles, [title], JSON.stringify(value));
		assert.deepEqual(key.images, ["imgs/scene.png"]);
	}
});
