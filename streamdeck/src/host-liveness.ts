import { type Clock, systemClock } from "./operation-store.js";

// One instance belongs to the backend process, including initial settings load.
// Local deadlines never cancel or discard the unsettled raw SDK request.
type Probe = { expired: boolean; settled: boolean; waiters: Set<(ok: boolean, value: unknown) => void> };
export class HostProbeBroker {
	private pending?: Probe;
	constructor(
		private readonly getGlobal: () => Promise<unknown>,
		private readonly clock: Clock = systemClock,
	) {}
	private wait(probe: Probe, signal?: AbortSignal): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const finish = (ok: boolean, value: unknown): void => {
				this.clock.clearTimeout(timer);
				probe.waiters.delete(finish);
				signal?.removeEventListener("abort", cancel);
				if (ok) resolve(value);
				else reject(new Error("host_unavailable"));
			};
			const cancel = (): void => {
				probe.expired = true;
				finish(false, undefined);
			};
			const timer = this.clock.setTimeout(() => {
				probe.expired = true;
				finish(false, undefined);
			}, 5000);
			probe.waiters.add(finish);
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
		});
	}
	public async probe(signal?: AbortSignal): Promise<unknown> {
		if (signal?.aborted) throw new Error("host_unavailable");
		if (this.pending) {
			const old = this.pending;
			let result: unknown;
			try {
				result = await this.wait(old, signal);
			} catch (error) {
				if (old.expired && old.settled && !signal?.aborted) return this.probe(signal);
				throw error;
			}
			// Timed out raw requests retain exactly one observer; their late result
			// only drains the old probe and never proves liveness for a new session.
			return old.expired ? this.probe(signal) : result;
		}
		const probe: Probe = { expired: false, settled: false, waiters: new Set() };
		this.pending = probe;
		const result = this.wait(probe, signal);
		const settle = (ok: boolean, value: unknown): void => {
			probe.settled = true;
			if (this.pending === probe) this.pending = undefined;
			for (const waiter of [...probe.waiters]) waiter(ok, value);
		};
		void Promise.resolve()
			.then(this.getGlobal)
			.then(
				(value) => settle(true, value),
				() => settle(false, undefined),
			);
		const value = await result;
		return probe.expired ? this.probe(signal) : value;
	}
	public get hasPending(): boolean {
		return this.pending !== undefined;
	}
	public get timedOut(): boolean {
		return this.pending?.expired === true;
	}
}
export class HostLiveness {
	private epoch = 0;
	private timer?: unknown;
	private abort?: AbortController;
	constructor(
		private readonly broker: HostProbeBroker,
		private readonly alive: () => Promise<unknown>,
		private readonly lost: () => Promise<unknown>,
		private readonly clock: Clock = systemClock,
	) {}
	public async start(): Promise<void> {
		this.stop();
		const epoch = this.epoch;
		const abort = new AbortController();
		this.abort = abort;
		const poll = async (): Promise<void> => {
			try {
				await this.broker.probe(abort.signal);
				if (epoch !== this.epoch) return;
				await this.alive();
			} catch {
				if (epoch === this.epoch) {
					this.stop();
					await this.lost();
				}
				return;
			}
			if (epoch === this.epoch)
				this.timer = this.clock.setTimeout(() => {
					void poll();
				}, 2000);
		};
		await poll();
	}
	public stop(): void {
		this.epoch++;
		this.abort?.abort();
		this.abort = undefined;
		this.clock.clearTimeout(this.timer);
	}
}
