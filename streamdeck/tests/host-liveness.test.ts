import assert from "node:assert/strict";
import test from "node:test";

import { HostLiveness, HostProbeBroker } from "../src/host-liveness.js";
import { ControlledClock, deferred } from "./helpers.js";

const tick = async () => new Promise<void>((done) => setImmediate(done));

test("two-second polls and five-second reply deadline renew only successful host replies", async () => {
	const clock = new ControlledClock(),
		stalled = deferred<unknown>();
	let calls = 0,
		alive = 0,
		lost = 0;
	const broker = new HostProbeBroker(
		() => (++calls === 1 ? Promise.resolve({ schemaVersion: 99 }) : stalled.promise),
		clock,
	);
	const host = new HostLiveness(
		broker,
		async () => {
			alive++;
		},
		async () => {
			lost++;
		},
		clock,
	);
	await host.start();
	assert.equal(alive, 1);
	clock.advance(1999);
	await tick();
	assert.equal(calls, 1);
	clock.advance(1);
	await tick();
	assert.equal(calls, 2);
	clock.advance(4999);
	await tick();
	assert.equal(lost, 0);
	clock.advance(1);
	await tick();
	assert.equal(lost, 1);
	assert.equal(alive, 1);
	clock.advance(10000);
	await tick();
	assert.equal(calls, 2);
	host.stop();
});
test("repeated recovery retains one raw SDK observer and rejects an unsettled old request", async () => {
	const clock = new ControlledClock(),
		old = deferred<unknown>();
	let calls = 0;
	const broker = new HostProbeBroker(() => {
		calls++;
		return old.promise;
	}, clock);
	let request = broker.probe();
	await tick();
	clock.advance(5000);
	await assert.rejects(request, /host_unavailable/);
	for (let attempt = 0; attempt < 3; attempt++) {
		request = broker.probe();
		await tick();
		assert.equal(calls, 1);
		clock.advance(5000);
		await assert.rejects(request, /host_unavailable/);
	}
	assert.equal(broker.hasPending, true);
});
test("late old completion is discarded and a failed fresh round trip cannot renew a lease", async () => {
	const clock = new ControlledClock(),
		old = deferred<unknown>(),
		fresh = deferred<unknown>();
	let calls = 0;
	const broker = new HostProbeBroker(() => (++calls === 1 ? old.promise : fresh.promise), clock);
	const initial = broker.probe();
	await tick();
	clock.advance(5000);
	await assert.rejects(initial);
	const recovery = broker.probe();
	await tick();
	old.resolve({ stale: true });
	await tick();
	assert.equal(calls, 2);
	let settled = false;
	void recovery.catch(() => {
		settled = true;
	});
	await tick();
	assert.equal(settled, false);
	clock.advance(5000);
	await assert.rejects(recovery, /host_unavailable/);
	assert.equal(broker.hasPending, true);
});
test("stopping an epoch removes its local waiter and late success cannot renew the old session", async () => {
	const clock = new ControlledClock(),
		old = deferred<unknown>();
	let alive = 0,
		lost = 0;
	const broker = new HostProbeBroker(() => old.promise, clock);
	const host = new HostLiveness(
		broker,
		async () => {
			alive++;
		},
		async () => {
			lost++;
		},
		clock,
	);
	const starting = host.start();
	await tick();
	host.stop();
	await starting;
	old.resolve({});
	await tick();
	clock.advance(10000);
	await tick();
	assert.equal(alive, 0);
	assert.equal(lost, 0);
});

test("late rejection of an expired SDK request is discarded before a fresh recovery probe", async () => {
	const clock = new ControlledClock();
	let rejectOld!: (reason: Error) => void,
		calls = 0;
	const old = new Promise<unknown>((_, reject) => {
		rejectOld = reject;
	});
	const broker = new HostProbeBroker(() => (++calls === 1 ? old : Promise.resolve({ fresh: true })), clock);
	const initial = broker.probe();
	await tick();
	clock.advance(5000);
	await assert.rejects(initial);
	const recovery = broker.probe();
	await tick();
	rejectOld(new Error("old request failed"));
	assert.deepEqual(await recovery, { fresh: true });
	assert.equal(calls, 2);
});
