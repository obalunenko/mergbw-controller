# Managed runtime contract v1

## Current-host TCC correction (2026-10-24)

Actual local launch through Stream Deck -> Node -> directly spawned supervisor -> worker aborts in TCC because the responsible app is Stream Deck and lacks a Bluetooth purpose string. Embedding a valid purpose in the worker was tested and did not fix attribution. This evidence supersedes the earlier direct-spawn/no-LaunchServices implementation choice below. Never modify Elgato's app, reset TCC data, rely on Terminal permission or introduce a permanent service.

Launch the checked helper app through the fixed `/usr/bin/open -n -g -W <helper.app> --args --control-socket <socket>` command, with shell:false and detached:false. No unref, app/worker PID file or arbitrary PID killing. `open -W` is an owned launcher handle and waits for this new app instance. Keep exactly the same v1 private NDJSON/session protocol and worker child/descriptor/lock/listener handling.

Node creates a fresh private 0700 temporary directory and a 0600 Unix-domain `control.sock` before launch. On Darwin use a short path under `/private/tmp` to respect Unix socket length. The socket path contains no token, identity or configuration values and is the only bootstrap CLI argument. The supervisor validates the absolute clean endpoint, directory/socket kinds, exact modes and current-user ownership, connects with a bounded timeout before reading session.open, and exits without starting a worker on any failure. No private state is written to the endpoint directory. Node accepts one connection only, bounds pre-connection output to the existing 16-frame/64-KiB limits, and rejects extra peers.

The accepted Unix connection replaces the old helper stdin/stdout pipe only. Keep host lease, session/generation/launch checks, HTTP transport revocation and cooperative worker cancellation unchanged. Before a live-parent shutdown, Node must still invalidate capabilities, drain HTTP and acknowledge runtime.revoked before ending the control connection. The supervisor closes its control connection only after runSupervisor has stopped/reaped its worker and released owned reservations/lock. Node waits for both connection closure and its `open -W` handle to exit before cleanup/recovery. Launcher failure before connection closes the listening endpoint; any late app must fail its dial and start zero workers. Node process loss closes the accepted socket; a loss before connection makes dial fail. Unlike FIFO redirection, no blocking endpoint open may leave a launcher waiting for a dead parent. Normal cleanup removes only this run's socket/directory.

Software tests use non-BLE app/process fixtures and injected launchers only. Test bounded early output, launch error/early exit, connection loss, orderly close, parent-before-connect loss, private endpoint validation and cleanup. Actual TCC attribution and permission/runtime outcomes remain installed-host observations, recorded separately.


Applies to the plugin-owned mode only. Existing standalone CLI and HTTP command contracts remain unchanged. Related: [model](../data-model.md), [configuration/UI](configuration-ui.md), [distribution](distribution.md).

## Executables and ownership

```text
Stream Deck Node backend
  -> /usr/bin/open -n -g -W [checked MeRGBW Controller.app]
       -> Contents/MacOS/mergbw-supervisor [private Unix control socket]
            -> Contents/Helpers/sunset [managed worker mode]
```

One management helper and at most one native BLE worker. Supervisor has no native BLE dependency and may run while configuration is incomplete; it starts no native worker then. It exposes no HTTP service of its own and exits when its parent lifetime ends after child cleanup. The fixed LaunchServices command above is the only launcher. No shell, `detached`, `unref`, daemonization or LaunchAgent.

The supervisor owns one fixed-root `flock(LOCK_EX|LOCK_NB)` through its lifetime. A child inherits a duplicate lock descriptor and does not explicitly unlock it. A second helper fails with `instance_busy`, regardless of configuration port. Lock-file presence/PID contents are not proof of ownership. Native worker additionally inherits the already bound listener, retaining both until exit. Keep the supervisor listener copy through active operation and cleanup.

For a new launch bind `tcp4` at `127.0.0.1:<configured port>` before starting the worker. On conflict return `port_conflict`, with zero native-worker starts, no health/catalog requests and no credentials sent to the port. No automatic port change or adoption of an existing server. This ordering also covers a competing bind after a preflight check; there is no bind-and-close preflight.

## Private protocol

The Node/supervisor private Unix connection uses UTF-8 NDJSON, not Node-specific IPC framing. Supervisor/worker have their own private stdin/stdout framing plus inherited descriptors. stderr is diagnostic-only, bounded and continuously drained. No control traffic passes through logs or an HTTP admin route.

Common frame: `{v:1, session, requestId, type, payload}`. `session` is a fresh random ID from a private bootstrap; requests have unique opaque IDs, allowlisted types/keys and one bounded JSON object per line. Maximum frame 64 KiB, max 16 outstanding control requests. Invalid protocol/version/session fails closed and stops an active worker; safe error codes are returned if framing permits. Truncated input/EOF triggers lifetime shutdown, never replay. No secret in argv or environment variables. Data-root/generation paths are local configuration, not credentials; they are never accepted from a profile.

| Direction/type | Payload/meaning |
| --- | --- |
| Node -> helper `session.open` | Protocol version and session; valid legacy configuration, if any, may travel only privately for prepare; no worker start until lease and config are valid |
| Node -> helper `host.alive` | Renew lease after a fresh successful Stream Deck round trip; an ordinary config/request message alone does not renew it |
| Node -> helper `configuration.prepareManual/prepareImport/apply/cancel` | See configuration contract; serialized with start/restart/stop, watch/lease read path stays independent |
| Node -> helper `configuration.read` | Current generation, safe summary and backend-only connection data; never copy that full reply to PI/logger |
| Node -> helper `controller.start/restart` | Expected config generation on a live session; backend recreates an exited helper/session through the explicit recovery procedure below before sending start |
| Node -> helper `controller.stop` | Reason; cancel admissions and begin cleanup without Off |
| Helper -> Node `controller.state` | Safe state, config generation, launch ID and error category; no raw imported/native errors |
| Helper -> Node `controller.bootstrap` | Current launch/generation, bound port and compatible protocol/build metadata after matching worker.ready; permits provisional health/catalog reads, not lamp commands |
| Node -> helper `runtime.authorized` | Matching launch after current private ready + successful compatible authenticated read; completes plugin readiness |
| Node -> helper `runtime.revoked` | Matching launch whose capabilities are disabled and transports aborted/drained; allows release/replacement of reserved old listener |
| Helper -> Node `result` | Matching request ID with safe status, including committed generation or commit-unknown; no action replay |

The backend-only credentials response is a private data response, not a diagnostic or PI snapshot. Never spread whole IPC payloads into logging. Response caches are bounded, per-session and expire with session. Applying the same transaction/request twice is idempotent; a new process must read authoritative disk state instead of replaying a previous session's request.

## Worker bootstrap (additive CLI)

Private flags are additive before the subcommand, for example `--managed --listener-fd 3 --lock-fd 4 --data-dir <generation-dir> serve`. Standalone behavior without managed flags is unchanged. Managed invocation must receive a valid private stdin bootstrap `{v,session,launchId,configurationGeneration}` and inherited descriptors; malformed managed startup fails instead of falling back to normal `serve`.

Supervisor validates/stages config and reserves listener before spawn. Worker main validates the inherited descriptor types/address, loads that exact generation, configures redaction and uses `net.FileListener`. No rebind or data-root fallback. It skips `config.Init`/URL-file generation in managed mode; configuration is already complete and immutable. Backend construction, root context, HTTP handling and serialized controller stay at the existing native composition root.

Worker emits `worker.ready` only after HTTP serving is installed, including current session/generation/launch ID, port and protocol/build/bridge version. It emits no token. Supervisor accepts only its currently live child and exact IDs. Parent then performs existing health compatibility and authorized catalog reads on the reserved listener. Public health alone is insufficient. BLE preconnect is read/connect only; readiness does not require a successful physical lamp verification and disconnected BLE remains separately visible.

Worker can emit `worker.bluetooth` with the same binding IDs, `bluetooth: connected|disconnected|unknown` and optional allowlisted `errorCategory: permission_denied|bluetooth_unavailable|backend_restart_required`, never a raw native error. This preserves existing public health JSON while providing actionable private setup status. Unknown reasons remain unknown. Stale telemetry from a prior launch is discarded.

A 15-second bootstrap/readiness deadline changes runtime to failed and invokes cleanup. It does not detach native initialization or promise CoreBluetooth returns by that time.

## Host and parent lifetime

Start independent control-connection/signal/lease monitoring before native worker spawn. Node uses only public pinned SDK `getGlobalSettings()` for host participation: one nonoverlapping request every 2 seconds, 5-second deadline. Only a successful reply renews a 10-second helper lease. Returned settings are not saved/activated by the liveness adapter. First timeout stops polling and lease renewal, invalidates runtime, aborts/drains transports, acknowledges revocation and then closes the lifetime pipe; retry requires an explicit restart. If draining stalls, keep the pipe open without renewing the lease: the supervisor stops the worker but retains the listener until revocation is confirmed. Sleep/wake can expire this lease and therefore stops safely, rather than silently resuming a transition.

One backend-process-wide probe broker owns all backend getGlobalSettings calls, including initial settings load. It retains at most one unsettled raw SDK request across helper sessions; timeout of its local waiter is not SDK cancellation. Recovery waits up to five seconds for a previously timed-out request to settle, without issuing another SDK request. Discard that late result for lease/old-session readiness, then require one fresh five-second round trip for the new recovery epoch. If the old request remains pending or the fresh one times out, return host_unavailable with commands blocked and no duplicate request/new worker. Dispose local waiters after completion/timeout; keep only the single broker observer on the raw request. Coalesce concurrent Restart clicks and use epoch checks to reject obsolete replies. Periodic polling resumes only for the recovered current session after fresh proof.

Node handles SIGINT/SIGTERM and explicit shutdown through the same invalidate -> abort/drain -> runtime.revoked -> half-close-control sequence. A live-parent path must not close the control connection early to bypass this barrier; if it cannot drain, stop lease renewal and retain the pipe until it can acknowledge revocation or the parent actually exits. Node's final process-exit hook performs only synchronous closure, with process teardown closing its transports; cleanup is the independent helper's job. Plugin SIGKILL also closes the pipe through actual process loss. Worker main watches its own helper pipe after initialization. Device unplug, profile change and removal of last key are not host lifetime events.

## Stop/restart timeline

1. Invalidate current launch, block new admissions and abort existing HTTP observation; sent commands with missing result remain unknown. Helper holds its listener reservation while Node drains transports; it does not expose a new endpoint under old credentials.
2. Cancel worker root context through the private channel and send SIGTERM. This cancels queued/remaining action steps; an already synchronous native write may still finish. No Off is sent.
3. Wait up to 10 seconds. Existing worker's 5-second HTTP + 3-second BLE shutdown remain inside this grace. If still live, send SIGKILL using the actual owned child handle.
4. Wait/reap confirmed exit. Signal success is insufficient. While exit is not confirmed, retain lock/listener and report `cleanup_blocked`; never start replacement. No hard kernel-reaping deadline is claimed.
5. Reuse the reservation for a same-port explicit restart. Release an old reservation only after child exit and Node's matching `runtime.revoked` transport-drain acknowledgment. Actual parent-process loss permits release after child exit because its transports are gone; orderly closure by a live parent must already have passed the acknowledgment barrier above. Before a config port change, acquire the new port before releasing the old one.
6. Restart creates fresh launch ID and fresh ready/capability checks. It reuses saved config and never replays previous lamp commands or transition state. After a crash there is no automatic process restart loop.

On helper lease expiry with a still-live/nonresponsive parent, stop the worker and retain the reservation until parent EOF or revocation drain; no native service remains. Fatal helper crash is reported by Node, disables capabilities and requires explicit recovery. Inherited lock/listener keep a leftover worker from being competed with; do not kill or adopt an unknown PID.

## Explicit recovery when the supervisor exited

The PI controller.restart command is a backend operation, not merely an IPC send to a possibly closed helper pipe:

1. Serialize/coalesce recovery; revoke old capabilities and abort/drain transports. For a helper whose lifetime pipe was closed or which is already exiting, finish orderly closure where still possible and wait for its owned handle to exit. Pending cleanup remains cleanup_blocked and blocks replacement; a live usable helper is retained for step 2.
2. If the helper is still live and only its worker failed, follow its normal stop/restart path above and retain its reserved listener. If the helper exited or its lifetime pipe was closed, discard that management session and its proposals; never send restart to the closed pipe.
3. Use the process-wide broker to settle/discard an expired pending probe, if present, then obtain fresh host proof. Failure stops this explicit recovery without automatic retry or a new SDK request while one remains pending.
4. Spawn at most one new BLE-free supervisor/session. It must acquire the fixed installation lock. A lock inherited by an old leftover worker means cleanup_blocked/instance_busy with zero new BLE workers, not permission to adopt or kill a PID. Confirmed helper exit alone does not prove its worker exited after a fatal helper crash; the lock is the additional guard.
5. Read authoritative active configuration through the new helper. Resolve any pending save outcome by read-back; validate the requested expected generation, otherwise return stale_configuration. Preserve settings/token/presets. Renew only the new session's lease and resume its periodic host checks.
6. Start one worker, create a fresh launch ID and perform the private bootstrap plus health/authenticated catalog validation. Only then issue new action capability. No old command, transition, proposal or late callback is replayed. An unreadable config, unavailable host or blocked cleanup remains an actionable error rather than a recovery success.

## State and errors

Allowed transitions:

| From | Event | To |
| --- | --- | --- |
| unconfigured | valid commit + live host lease | starting |
| stopped/failed | initial open or explicit restart with current generation | starting |
| starting | matching worker + authorized read | ready |
| starting | deadline/exit/mismatch | stopping, then failed |
| ready | stop/apply/parent loss/lease expiry | stopping |
| ready | unexpected worker exit | failed, revoke old capability |
| starting/ready/stopping | supervisor exit or completed host-timeout cleanup | failed, invalidate old management session; explicit recovery may recreate it |
| failed | explicit recovery with absent helper, fresh host proof and acquired fixed lock | starting in a new supervisor session; validate config before worker start |
| stopping | exit/revocation drain confirmed | stopped or new starting after explicit requested restart/apply |
| stopping | exit not confirmed | cleanup_blocked |
| cleanup_blocked | confirmed exit and revocation drain | stopped; pending restart requires an explicit current request |

Errors: `instance_busy`, `port_conflict`, `binary_missing`, `binary_incompatible`, `spawn_failed`, `protocol_incompatible`, `startup_timeout`, `host_unavailable`, `permission_denied`, `bluetooth_unavailable`, `backend_restart_required`, `worker_exited`, `cleanup_blocked`, plus config categories. Category/phase/duration/launch and request IDs are safe diagnostics. Never include tokens, full URLs, raw imported content, unfiltered stderr or native error objects in PI/SDK logs.

## Automated contract tests

Use synthetic workers: immediate ready; delayed ready; stall before main; ignore TERM; close stdout; flood stderr; wrong session/version; retain inherited descriptors; exit during request. Check parent EOF and lease, inherited lock/port reservation, actual reaping, startup deadline, stop/restart races, listener revocation barrier, stale messages and zero replay. Specifically stall HTTP transport drain on a live-parent host-timeout/signal path: stdin must remain open without lease renewal, the worker must stop, and its port must stay reserved until revocation acknowledgment. No fixture imports or executes native BLE. Actual Stream Deck quit and OS permission behavior are separate manual proofs.

Also test timeout -> helper exit -> explicit Restart -> one new supervisor/session/worker; unexpected helper exit with retained worker lock; stale config at recovery; repeated Restart while a raw SDK promise remains unresolved; late old probe reply then fresh probe; and failed fresh probe. Assert a maximum of one unsettled SDK getGlobalSettings call across every recovery attempt, no stale lease renewal, token changes or command replay.
