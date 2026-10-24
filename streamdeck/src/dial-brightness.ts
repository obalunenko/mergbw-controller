import type { DialAction } from "@elgato/streamdeck";

import type { ActionServices } from "./actions/base-action.js";
import { translate } from "./i18n.js";
import type { Capability } from "./managed-controller.js";
import type { OperationRecord } from "./operation-store.js";
import type { Assignment } from "./validation.js";

type DialView = Pick<DialAction<Assignment>, "id" | "setFeedback">;
type DialState = {
	view: DialView;
	target?: number;
	settingsRevision: number;
	connectionRevision: number;
	capability?: Capability;
	ready: boolean;
	queued?: "boundary" | "brightness" | "off";
	command: "brightness" | "off";
	status: "pending" | "ready" | "rejected" | "sent" | "unknown";
};

// A live target belongs to one visible assignment, never to the physical lamp.
export class DialBrightness {
	private readonly visible = new Map<string, DialState>();
	private readonly flights = new Map<string, { state: DialState; record: OperationRecord }>();
	constructor(private readonly services: ActionServices) {
		services.settings.subscribe(() => {
			for (const [context, state] of [...this.visible]) {
				if (!this.sameAssignment(state) || this.available() !== state.ready) {
					state.queued = undefined;
					this.appear(state.view);
				} else void this.render(context, state);
			}
		});
		services.operations.subscribe((record) => {
			const flight = this.flights.get(record.context);
			if (flight?.record !== record || record.status === "pending") return;
			if (record.status !== "sent") {
				flight.state.queued = undefined;
				flight.state.command = record.snapshot.route === "off" ? "off" : "brightness";
			}
			flight.state.status = flight.state.queued ? "pending" : record.status === "accepted" ? "unknown" : record.status;
			void this.render(record.context, flight.state);
		});
	}
	public appear(view: DialView): void {
		this.disappear(view.id);
		let target: number | undefined;
		try {
			target = this.services.settings.getAction(view.id).percent;
		} catch {
			/* Invalid assignments stay visible without issuing commands. */
		}
		const state: DialState = {
			view,
			target,
			settingsRevision: this.services.settings.revision(view.id),
			connectionRevision: this.services.settings.connectionRevision,
			capability: this.services.runtime?.capability() ?? undefined,
			ready: this.available(),
			command: "brightness",
			status: "ready",
		};
		this.visible.set(view.id, state);
		void this.render(view.id, state);
	}
	public disappear(context: string): void {
		const state = this.visible.get(context);
		if (state) state.queued = undefined;
		this.visible.delete(context);
	}
	public rotate(context: string, ticks: number): void {
		const state = this.visible.get(context);
		if (!state || !Number.isSafeInteger(ticks) || ticks === 0) return;
		if (!this.current(state) || state.target === undefined) {
			state.queued = undefined;
			state.status = "rejected";
			void this.render(context, state);
			return;
		}
		const flight = this.flights.get(context);
		// Off is an explicit barrier: old turns are discarded and new ones wait
		// for a fresh gesture after its raw request has settled.
		if (state.queued === "off" || flight?.record.snapshot.route === "off") return;
		const target = Math.max(0, Math.min(100, state.target + Math.max(-100, Math.min(100, ticks))));
		// A timed-out or obsolete raw request must settle before another can start.
		if (flight && (flight.state !== state || flight.record.status !== "pending")) return;
		state.target = target;
		state.command = "brightness";
		state.queued = target === 0 || target === 100 ? "boundary" : "brightness";
		state.status = "pending";
		void this.render(context, state);
		if (!flight) void this.send(state);
	}
	public press(context: string): void {
		const state = this.visible.get(context);
		if (!state) return;
		if (!this.current(state) || state.target === undefined) {
			state.queued = undefined;
			state.status = "rejected";
			void this.render(context, state);
			return;
		}
		const flight = this.flights.get(context);
		if (flight && (flight.state !== state || flight.record.status !== "pending")) return;
		if (state.queued === "off" || flight?.record.snapshot.route === "off") return;
		state.queued = "off";
		state.command = "off";
		state.status = "pending";
		void this.render(context, state);
		if (!flight) void this.send(state);
	}
	private available(): boolean {
		try {
			return (
				!!this.services.settings.getConnection() && (!this.services.runtime || !!this.services.runtime.capability())
			);
		} catch {
			return false;
		}
	}
	private sameAssignment(state: DialState): boolean {
		return (
			state.settingsRevision === this.services.settings.revision(state.view.id) &&
			state.connectionRevision === this.services.settings.connectionRevision &&
			(!state.capability || this.services.runtime?.current(state.capability) === true)
		);
	}
	private current(state: DialState): boolean {
		return this.visible.get(state.view.id) === state && this.sameAssignment(state) && state.ready && this.available();
	}
	private async send(state: DialState): Promise<void> {
		const { settings, operations, client, diagnostics } = this.services;
		const context = state.view.id;
		if (!this.current(state) || !state.queued || state.target === undefined || this.flights.has(context)) return;
		const capability = this.services.runtime?.capability();
		const connection = capability?.connection ?? settings.getConnection();
		if (!connection) return;
		const target = state.target;
		const off = state.queued === "off";
		const actionKind = off ? "off" : "brightness";
		const record = operations.acquire({
			context,
			actionKind,
			settingsRevision: state.settingsRevision,
			connectionRevision: state.connectionRevision,
			snapshot: { connection, route: off ? "off" : `brightness/${target}`, ...(capability ? { capability } : {}) },
		});
		state.queued = undefined;
		if (!record) {
			state.status = "rejected";
			void this.render(context, state);
			return;
		}
		this.flights.set(context, { state, record });
		this.services.inspector.explain(context);
		const release = diagnostics.retain(connection.accessToken);
		diagnostics.emit("action.started", {
			actionKind,
			operationId: record.operationId,
			outcome: "pending",
		});
		try {
			const result = await client.command(record);
			operations.finish(record, { ...result, requestId: diagnostics.id(result.requestId) });
		} catch {
			operations.finish(record, { status: "unknown", errorCategory: "service" });
		} finally {
			release();
			this.flights.delete(context);
		}
		if (!this.current(state)) return;
		if (record.status !== "sent") state.queued = undefined;
		if (state.queued && (state.queued === "off" || state.queued === "boundary" || state.target !== target))
			void this.send(state);
		else {
			state.queued = undefined;
			state.status = record.status === "pending" || record.status === "accepted" ? "unknown" : record.status;
			void this.render(context, state);
		}
	}
	private async render(context: string, state: DialState): Promise<void> {
		if (this.visible.get(context) !== state || !this.sameAssignment(state)) return;
		const language = this.services.settings.getLanguage();
		const lifecycle = this.services.inspector.lifecycleState();
		const statuses = {
			ready: "dialReady",
			pending: "dialPending",
			sent: "dialSent",
			rejected: "dialRejected",
			unknown: "dialUnknown",
		} as const;
		const title = translate(
			language,
			!state.ready || (lifecycle && lifecycle !== "ready")
				? "dialUnavailable"
				: state.command === "off" && state.status === "pending"
					? "dialOffPending"
					: state.command === "off" && state.status === "sent"
						? "dialOffSent"
						: statuses[state.status],
		);
		try {
			await state.view.setFeedback({
				title,
				icon: "imgs/brightness.png",
				value: {
					value: state.target === undefined ? "—" : `${state.target}%`,
					font: { size: 28, weight: 600 },
					alignment: "center",
				},
				indicator: { value: state.target ?? 0, range: { min: 0, max: 100 } },
			});
		} catch {
			/* A missing host view cannot start or retry a lighting command. */
		}
	}
}
