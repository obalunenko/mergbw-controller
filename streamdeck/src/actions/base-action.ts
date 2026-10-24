import {
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type PropertyInspectorDidDisappearEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { BridgeClient } from "../bridge-client.js";
import type { Diagnostics } from "../diagnostics.js";
import { Feedback, type KeyView } from "../feedback.js";
import type { InspectorController } from "../inspector-messages.js";
import type { OperationStore } from "../operation-store.js";
import type { Settings } from "../settings.js";
import type { ActionKind, Assignment } from "../validation.js";

export type ActionServices = {
	settings: Settings;
	operations: OperationStore;
	client: BridgeClient;
	inspector: InspectorController;
	diagnostics: Diagnostics;
	runtime?: import("../managed-controller.js").ManagedController;
};
export class BaseAction extends SingletonAction<Assignment> {
	private readonly visible = new Map<string, KeyView>();
	private readonly feedback: Feedback;
	constructor(
		public readonly kind: ActionKind,
		protected readonly services: ActionServices,
	) {
		super();
		this.feedback = new Feedback(services.settings, services.inspector);
		const refreshDefaults = (): void => {
			for (const [context, key] of this.visible) void this.feedback.ready(key, kind, context);
		};
		services.settings.subscribe(refreshDefaults);
		services.inspector.subscribeCatalog(refreshDefaults);
		services.operations.subscribe((record) => {
			if (record.actionKind !== kind || record.status === "pending") return;
			services.diagnostics.emit(`action.${record.status}`, {
				actionKind: kind,
				outcome: record.status,
				operationId: record.operationId,
				requestId: record.requestId,
				errorCategory: record.errorCategory,
				durationMs: record.durationMs,
			});
			const key = this.visible.get(record.context);
			if (
				key &&
				services.operations.canRender(
					record,
					services.settings.revision(record.context),
					services.settings.connectionRevision,
					services.runtime ? (capability) => services.runtime!.current(capability) : undefined,
				)
			)
				void this.feedback.result(key, record);
		});
	}
	public override async onWillAppear(ev: WillAppearEvent<Assignment>): Promise<void> {
		const { settings, operations } = this.services;
		settings.receiveAction(ev.action.id, this.kind, ev.payload.settings);
		operations.appear(ev.action.id);
		if (ev.action.isKey()) {
			this.visible.set(ev.action.id, ev.action);
			await this.feedback.ready(ev.action, this.kind, ev.action.id);
		}
	}
	public override onWillDisappear(ev: WillDisappearEvent<Assignment>): void {
		this.visible.delete(ev.action.id);
		this.services.operations.disappear(ev.action.id);
		this.services.inspector.close(ev.action.id);
	}
	public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Assignment>): void {
		this.services.settings.receiveAction(ev.action.id, this.kind, ev.payload.settings);
	}
	public override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<Assignment>): void {
		this.services.inspector.close(ev.action.id);
	}
	public override async onSendToPlugin(
		ev: SendToPluginEvent<import("@elgato/utils").JsonValue, Assignment>,
	): Promise<void> {
		await this.services.inspector.receive(ev.action.id, ev.payload);
	}
	public override async onKeyDown(ev: KeyDownEvent<Assignment>): Promise<void> {
		const { settings, operations, client, diagnostics } = this.services;
		const startedAt = operations.clock.now();
		const context = ev.action.id;
		if (operations.get(context)?.status === "pending") return;
		let record;
		try {
			const assignment = settings.getAction(context);
			const capability = this.services.runtime?.capability();
			if (this.services.runtime && !capability) throw new Error("validation");
			const connection = capability?.connection ?? settings.getConnection();
			if (!connection) throw new Error("validation");
			const route = this.route(assignment);
			this.services.inspector.explain(context);
			record = operations.acquire({
				context,
				actionKind: this.kind,
				settingsRevision: settings.revision(context),
				connectionRevision: settings.connectionRevision,
				snapshot: { connection, route, ...(capability ? { capability } : {}) },
			});
		} catch (error) {
			const errorCategory = error instanceof Error && error.message === "preset" ? "preset" : "validation";
			this.services.inspector.explain(context, errorCategory);
			diagnostics.emit("action.rejected", {
				actionKind: this.kind,
				outcome: "rejected",
				errorCategory,
				durationMs: Math.max(0, operations.clock.now() - startedAt),
			});
			await this.feedback.invalid(ev.action);
			return;
		}
		if (!record) return;
		const release = diagnostics.retain(record.snapshot.connection.accessToken);
		diagnostics.emit("action.started", { actionKind: this.kind, operationId: record.operationId, outcome: "pending" });
		// Pending is shown in the inspector. Reserve key alerts for failures.
		try {
			const result = await client.command(record);
			operations.finish(record, { ...result, requestId: diagnostics.id(result.requestId) });
		} catch {
			operations.finish(record, { status: "unknown", errorCategory: "service" });
		} finally {
			release();
		}
	}
	protected route(assignment: Assignment): string {
		void assignment;
		if (this.kind !== "on" && this.kind !== "off") throw new Error("validation");
		return this.kind;
	}
}
