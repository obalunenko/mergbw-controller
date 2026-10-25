# Smooth transitions

User decisions, 2026-10-23: add a sixth Keypad action, explicit start/end RGB and brightness, integer duration **1–60 seconds**. A new valid lighting command, including a brightness-dial command or another transition, cancels the current transition and executes only after its current synchronous BLE operation returns. Invalid commands, status/check requests and panel saves do not cancel or control the lamp. No physical readback is introduced.

## Commands and responses

The existing IPv4 loopback, Host/token checks, query/path/body restrictions, safe errors and no-HEAD-effects remain. Existing routes retain their response schema. New routes below require the same token. Status is GET-only; explicit cancellation is POST-only. Transition start accepts GET or POST for the existing URL command convention.

- Start: `/{token}/transition/{fromRGB}/{fromBrightness}/{toRGB}/{toBrightness}/{durationSeconds}`. RGB is exactly six hex digits, canonical uppercase; brightness is integer 0–100; duration is integer 1–60. Validate the whole command before cancellation or BLE activity. CLI grammar: `send transition FROMHEX FROMPERCENT TOHEX TOPERCENT SECONDS`; dry-run validates and prints the schedule description without native execution in tests.
- Successful start returns **202**, `{accepted:true,action:"transition/...",transition:<snapshot>,physical_state_verified:false}`. Accepted means scheduled, not completed or written. Job lifetime belongs to the controller root, not the completed HTTP request. A lost response is unknown to the caller and must not cause automatic resubmission.
- Read: `GET /{token}/transition` returns **200**, `{transition:<snapshot>|null,physical_state_verified:false}`. Null means no transition in this process; only the current/last job is retained. Reading sends no BLE command and does not cancel work.
- Cancel: `POST /{token}/transition/cancel/{id}` returns **200** with the same snapshot envelope after cooperative cancellation completes. IDs are 32 lowercase hex characters. A matching terminal job is an idempotent read, never a new lighting command; an unknown ID returns 404. Cancellation timeout returns a safe 504 without pretending native completion. No Off is appended.

Snapshot is exactly `{id,state,elapsedMs,durationMs,physical_state_verified:false}`. States: `running`, `cancelling`, `completed`, `cancelled`, `failed`, `unknown`. Durations are integer milliseconds, `durationMs` 1000–60000 and `elapsedMs` clamped 0–durationMs. `completed` means all scheduled writes returned successfully, not measured lamp state. Write failure or cancellation during a write is `unknown`; connection failure before writes is `failed`. Cancellation observed between writes is `cancelled`. No raw errors/identity/token/command URL is returned. Stop/restart discards job state; no persistence, continuation or replay.

## Controller behavior

Use existing protocol packets and one controller Link. Start by sending On, the explicit starting RGB and brightness. Linearly interpolate the encoded RGB channels and brightness, rounding to nearest integer, at no more than four scheduled updates per second. Always reach the exact endpoint on successful completion. Skip unchanged channel packets and missed samples; do not produce a catch-up burst. The nominal duration starts after the initial state packets; native connection/write latency can extend wall time. Keep the existing minimum BLE packet gap. A zero-brightness endpoint does not imply Off.

The transition owns the whole existing action gate. A separate context-aware admission gate serializes cancellation/acquisition/publication of new commands, preventing a concurrent transition from being missed by cancellation. A new command requests cancellation and waits for gate ownership; it never abandons an in-progress Write or overlaps another sequence. Transition writes are never automatically retried. Keep the previous retry policy for existing absolute ordinary commands. Parent cancellation and Close stop transitions promptly between native operations; Close cannot claim to have undone a submitted write.

Composition supplies a controller-root context before serving HTTP. Keep `controller.New` for existing callers and use `NewWithContext` in the service. Preserve `controller.Link` and `bridge.Controller`; expose transition support through a separate optional bridge interface using protocol value types, with generated GoMock for tests. Bridge must not import the concrete controller or native BLE.

## Plugin and acceptance

Add action UUID `com.obalunenko.mergbw.transition`, with assignment v1 `{schemaVersion:1,fromRGB,fromPercent,toRGB,toPercent,durationSeconds}`. Defaults: FF5000/100 to FF5000/0 over 30 seconds. Existing action schemas/UUIDs, dial behavior and custom artwork remain. Export contains parameters only, never connection secrets or local paths.

BridgeClient represents 202 as a distinct **accepted** operation outcome, not sent/success/completed. Do not retry start after uncertainty. The EN/RU panel exposes five validated parameters, explicit read-only status refresh and cancel-current-job controls. Status/cancel replies are scoped to the current managed capability and PI session; an old reply cannot repaint another runtime. Status may be checked from any action panel. No periodic poll or persisted job resumption is required. Start is only an explicit key press; setup/import/save/check/startup/restart send no lighting commands.

Automated tests use generated Link/interface mocks, controllable clock/waits and synthetic HTTP/SDK only. Cover endpoints, durations 1/60 and rejection of 0/61/invalid values, linear/descending/equal endpoints, bounded sampling, exact endpoint, no extra On/Off, cooperative blocked write, ordinary/dial replacement, competing starts, read/cancel safety, lost acceptance, stale UI/capability, root stop and no replay. Owner verifies visible smoothness, one-minute duration, dial/button interruption, explicit cancellation and restart on current Mac/LT-06. No Intel/physical evidence is inferred from tests or compilation.

Owner transition checks T093 require current-host setup T025 and integrated transition software T092. The interrupted-transition portion of T078 additionally requires current-host recovery T058 and recorded software checks T075. They may use the current integrated owner-linked fixture, with its exact provenance/mode recorded, while Intel or signed-distribution acceptance remains pending. They do not complete T072/T073; see [distribution acceptance scopes](distribution.md#acceptance-scopes-and-gates).

## Immediate cancellation from accepted start

A strictly validated 202 start response already supplies the admitted job snapshot. Retain it in the backend operation record and expose its ID to that action's inspector, including inspector reopen, without requiring Check transition status. A later explicit status read supplies current progress or final state. Never treat admission as completion.

Only the latest valid lighting operation may seed the cancel target. Assignment/connection revisions and managed capability still fence it. A newer lighting admission prevents a late old acceptance from restoring its target. Acceptance invalidates in-flight older status observations, while an already checked snapshot of that same ID retains its newer progress/state. Cancel remains an explicit POST for the exact known ID; no automatic cancellation or new lighting command occurs on panel open/save/status.
