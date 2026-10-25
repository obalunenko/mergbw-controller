import { translate } from "./i18n.js";
import { type InspectorController, presetOptions } from "./inspector-messages.js";
import type { OperationRecord } from "./operation-store.js";
import { sceneLabel } from "./scenes.js";
import type { Settings } from "./settings.js";
import type { ActionKind } from "./validation.js";

export type KeyView = {
	showAlert: () => Promise<void>;
	showOk: () => Promise<void>;
	setTitle: (title?: string) => Promise<void>;
	setImage: (image?: string) => Promise<void>;
};
export class Feedback {
	constructor(
		private readonly settings: Settings,
		private readonly inspector?: InspectorController,
	) {}
	public async ready(key: KeyView, kind: ActionKind, context?: string): Promise<void> {
		let title = translate(this.settings.getLanguage(), kind);
		if (context) {
			try {
				const value = this.settings.getAction(context);
				if (kind === "color") title = value.rgb!;
				if (kind === "brightness") title = `${value.percent!}%`;
				if (kind === "scene") title = sceneLabel(value.sceneId!) ?? title;
				if (kind === "preset" && value.presetId && this.inspector?.isSafePresetId(value.presetId) !== false)
					title =
						presetOptions(this.inspector?.catalog.entries ?? []).find((entry) => entry.id === value.presetId)?.label ??
						value.presetId;
			} catch {
				/* Invalid assignments keep their action name until corrected. */
			}
		}
		const lifecycle = this.inspector?.lifecycleState();
		if (lifecycle && lifecycle !== "ready") title = translate(this.settings.getLanguage(), lifecycle);
		// Runtime defaults let Stream Deck's user title and image overrides retain precedence.
		await Promise.all([key.setTitle(title), key.setImage(`imgs/${kind}.png`)]);
	}
	public async invalid(key: KeyView): Promise<void> {
		await key.showAlert().catch(() => {});
	}
	public async result(key: KeyView, record: OperationRecord): Promise<void> {
		if (record.status === "accepted") {
			await key.setTitle(translate(this.settings.getLanguage(), "accepted")).catch(() => {});
			return;
		}
		if (record.status === "sent") await key.showOk().catch(() => {});
		else await key.showAlert().catch(() => {});
	}
}
