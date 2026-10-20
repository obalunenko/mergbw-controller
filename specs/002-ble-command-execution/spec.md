---
status: migrated
---

# Feature Specification: BLE Connection and Command Execution

**Feature Directory**: `specs/002-ble-command-execution`

**Feature Branch**: Existing `develop`; migration creates no branch.

**Created**: 2026-10-20

**Status**: migrated

**Input**: Reverse-engineer detected feature 2: existing LT-06 packet resolution,
BLE connection, serialized execution, retry, cancellation, and inspection.
This describes built behavior; it does not change source or promise unverified
hardware results.

## Project Scope and Compatibility

Primary code is `internal/protocol/protocol.go`,
`internal/controller/controller.go`, and `internal/ble/backend.go`, with transport
semantics documented in `internal/ble/doc.go`. Each package has a colocated test
file. Production composition and retry classification are in
`cmd/sunset/main.go`; context logging is supplied by `internal/logging/`.

This feature supplies complete actions and the transport used by the
[HTTP bridge](../001-streamdeck-http-bridge/spec.md). That feature owns HTTP
methods, routing, tokens, and response status semantics. This migration owns
protocol and native-operation behavior; general configuration, CLI setup,
Stream Deck configuration, and the broader logging subsystem are dependencies.
There is no database or schema migration.

Compatibility includes existing packet bytes/checksum, manufacturer identity,
service/characteristic selection, action ordering, limited retries, cooperative
cancellation, and the distinction between link state and physical lamp state.

## User Scenarios & Testing

### User Story 1 - Resolve a Validated Lighting Sequence (Priority: P1)

A caller resolves an absolute action before touching Bluetooth, so malformed
parameters do not produce a partially valid lighting sequence.

**Independent Test**: Call protocol.Resolve and ValidatePresets without native
Bluetooth; compare canonical routes and packet bytes.

1. Given on/off, a valid RGB, brightness 0-100, or a configured valid preset,
   when Resolve succeeds, then it produces the complete action. RGB and
   brightness begin with power-on; presets contain power-on, RGB, brightness.
2. Given malformed arguments or invalid RGB/brightness values, when resolution
   fails, then it returns no packets. Known vectors include OFF
   `5501FF0600A3` and ON `5501FF0601A2`.

Evidence: `TestResolveKnownPackets`, `TestInvalidCommandProducesNoPackets`,
and `TestInvalidPresetProducesNoPackets`; all executed during preparation.

### User Story 2 - Select and Connect the Intended Lamp (Priority: P1)

A caller supplies an explicit six-byte manufacturer identity so discovery
selects the intended LT-06 rather than relying on the advertised name or
manufacturer Company ID.

**Independent Test**: Synthetic advertisements exercise the match function;
native connection/GATT behavior requires separate transport or device evidence.

1. Given advertised service 3519 and matching first six manufacturer payload
   bytes, when optional device-type/model metadata is compatible, then the
   advertisement matches regardless of Company ID or local name.
2. Given a discovered device, when native connection and discovery succeed,
   then exactly one FFF0 service and one FFF3 characteristic are accepted, and
   the backend retains the connection for later operations.
3. Given a missing identity or mismatched advertisement, then construction or
   matching fails. A canceled context or sticky fatal error is checked before
   starting application-managed adapter work.

Evidence: five functions in `internal/ble/backend_test.go`, connectLocked,
matchAdvertisement, and scanLocked. BLE test source was inspected and its
binary compiled; native tests were not executed during migration.

### User Story 3 - Execute Complete Actions Without Interleaving (Priority: P1)

Concurrent callers share one connection, with each complete packet sequence
kept together and paced by the controller.

**Independent Test**: Inject fake Link implementations and run concurrent
Execute calls; inspect write ordering and the maximum number of active writes.

1. Given two concurrent actions, when they execute, then either complete
   sequence may go first, but packets from the two actions do not interleave
   and at most one write is active.
2. Given a successful write, then packet metadata is logged only after Write
   returns nil; the command is logged as sent only when the action succeeds.
3. Given a native write request, then the backend checks current link readiness
   and uses WriteWithoutResponse. A return value is not a lamp-state readback.

Evidence: `TestConcurrentCommandsKeepWholeSequencesTogether` and
`TestLogsPacketsOnlyAfterSuccessfulWrites`, both executed; Backend.Write is
code-derived beyond its existing early-cancellation test.

### User Story 4 - Recover Once or Cancel Safely (Priority: P1)

A transient failure may reconnect and repeat an absolute action once. Queued
cancellation prevents transport work, while an already-started native operation
is allowed to return before the caller completes.

**Independent Test**: Inject failing and blocked fake Link writes; assert attempt
counts, complete replay, cancellation, and event order.

1. Given one retryable failure, when retry is allowed and Close succeeds, then
   the controller waits 200ms and restarts the whole action from packet one.
   Persistent failure stops after the second attempt.
2. Given a canceled queued action, then it returns cancellation without
   touching Link. Given cancellation during an active write, then Execute waits
   for that write, skips later packets, and does not retry.
3. Given a production permission/incompatibility/restart/uncertain-write/input
   error, then the adapter classifier prevents retry. A sticky Darwin discovery
   timeout remains fatal across Backend.Close and requires process restart.

Evidence: `TestRetryOnceAndRespectNonRetryableErrors`,
`TestCanceledQueuedCommandNeverTouchesLink`, and
`TestCancellationWaitsForStartedWriteAndStopsRemainingPackets`, all executed;
production classifier and fatal-state installation are code-derived (G01/G03).

### User Story 5 - Inspect or Release a Link Honestly (Priority: P2)

A caller inspects connection/GATT information without sending lighting commands
and can release resources without claiming confirmed physical lamp state.

**Independent Test**: Existing tests inspect canceled/no-device paths and the
native callback with synthetic device information. Native lifecycle and real
inspection remain separately limited evidence.

1. Inspect follows the same connection/discovery path as Connect but performs
   no characteristic write, read, or notification subscription. Returned Info
   reports link/device metadata, with StateReadback and
   WritePropertiesVerified remaining false.
2. Backend.Close invalidates its write handle, drains recent host writes for
   up to the remaining 80ms interval, and requests disconnect. It can be reused
   by a later Connect unless sticky fatal state prevents it.
3. Controller.Close marks that controller terminal before waiting for its gate;
   later Connect/Execute calls are rejected. This differs from reusable
   Backend.Close, including when a Close context expires while waiting.
4. A target disconnect callback clears observed link readiness and logs once
   without taking the command mutex or retaining a completed request's logger.

Evidence: Inspect, infoLocked, closeLocked, Controller.Close,
`TestDisconnectCallbackLogsOnceWithoutCommandMutex`, and backend cancellation
and sticky-state tests. These BLE tests were compiled and inspected, not run.

### Edge Cases

- Backend's mutex does not provide context-aware waiting; direct calls can wait
  for an earlier native operation before checking cancellation. Controller's
  gate is context-aware and rechecks cancellation after acquiring its permit.
- There is no documented FIFO scheduling guarantee. Existing concurrency tests
  accept either whole-action order.
- Backend.Write validates length before checking context and fatal state. An
  invalid packet can therefore return ErrInvalidPacket even with cancellation.
- Cancellation after native WriteWithoutResponse returns joins the context
  error, ErrWriteUncertain, and any native error. An error-free short write joins
  io.ErrShortWrite and ErrWriteUncertain. A non-nil native error is otherwise
  wrapped before the error-free short-write check; do not infer stronger
  acknowledgement guarantees.
- Connect checks the returned device address before calling methods on it,
  handling the documented upstream empty/wrong-device result.
- Scan joins its owned stop goroutine; it can exceed its configured timeout
  while native Scan/StopScan returns. Parent cancellation takes precedence;
  after an error-free Scan return, scan-only expiry is reported as ErrNotFound.
  A native scan error otherwise keeps its friendlyError classification.
- Darwin discovery errors whose lowercased text contains `timeout` install a
  sticky ErrNeedsRestart. This is text-based classification, not a guarantee
  that every possible upstream timeout spelling is recognized.
- Controller.Close marks closed even if its wait expires. The current operation
  and native link are not thereby forcibly stopped; cleanup may require a later
  Close or process exit. Backend.Close itself has no context parameter.

## Requirements

### Functional Requirements

- **FR-001**: Resolve supports absolute on, off, color, brightness, and preset
  commands, rejecting wrong arity, unknown commands/presets, malformed colors,
  and out-of-range or non-ASCII-decimal brightness without returning packets.
- **FR-002**: ValidatePresets requires a nonempty map, valid lower-case ASCII
  slug, nonblank single-line label, exactly three RGB integers 0-255, and
  brightness 0-100. Resolve separately checks preset RGB/brightness; it does not
  itself repeat the complete slug/label validation of the startup map.
- **FR-003**: Frames contain `55`, command byte, `FF`, total-length byte, payload,
  and one's-complement checksum with end-around carry, not plain sum modulo 256.
- **FR-004**: Power commands produce one packet; color/brightness prefix
  power-on; presets produce power-on/RGB/brightness. Canonical routes use
  uppercase color HEX and the parsed brightness integer. Color Resolve accepts
  one optional leading `#`; HTTP-specific URL constraints are defined in 001.
- **FR-005**: Backend construction requires six colon-separated HEX bytes,
  normalizes identity to uppercase, defaults zero scan/connect timeouts to 12s,
  rejects scan timeouts below 1ms, and accepts connect timeouts only from 1ms
  through 40s after defaulting.
- **FR-006**: Matching requires advertised service 3519 and the first six bytes
  of a manufacturer payload equal to identity. Company ID and local name do
  not substitute for identity.
- **FR-007**: When byte 8 exists it must equal device type 5; when model bytes
  starting at byte 9 exist, their null-terminated value through at most byte 18
  must be empty or LT-06. Identity-only payloads can match.
- **FR-008**: Backend owns one persistent connection using DefaultAdapter,
  confirms current link status, and requires one matching FFF0 service and
  exactly one FFF3 characteristic before marking the link ready.
- **FR-009**: Scanning uses a child timeout, records only the first match,
  delegates StopScan to one owned goroutine, and joins that goroutine before
  returning. Configured timeouts are not hard native-operation deadlines.
- **FR-010**: Adapter enable/connect, GATT discovery, and writes remain
  synchronous, with context checks between stages. Connect's requested native
  timeout is bounded by the earlier context deadline; Linux/native limitations
  are preserved as documented in internal/ble/doc.go.
- **FR-011**: Backend.Write accepts 1-20 bytes, copies the packet, checks
  cancellation/fatal/link state, and performs no implicit Connect or retry.
- **FR-012**: Writes use FFF3 WriteWithoutResponse. Post-write cancellation and
  error-free short writes report uncertainty as described in Edge Cases;
  success does not acknowledge physical lamp state.
- **FR-013**: Controller serializes Connect, Execute, and Close through one
  permit and rejects empty actions or work on a closed controller. It depends
  on Link rather than the concrete BLE backend.
- **FR-014**: Controller defaults to an 80ms minimum wait after completion of
  the previous write, including failed writes, before starting the next packet.
- **FR-015**: A healthy-context action has at most two attempts. One permitted
  retry closes the link, waits 200ms, reconnects, and replays the complete action;
  a close error ends retry with both failure causes preserved.
- **FR-016**: Production lampLink.CanRetry rejects context cancellation/deadline,
  ErrIncompatible, ErrPermission, ErrNeedsRestart, ErrWriteUncertain, and
  ErrInvalidPacket, including wrapped errors; other errors may be retried once.
- **FR-017**: A canceled gate wait does not touch Link. Cancellation during a
  started operation is reported after it returns, stops later packets, and
  suppresses retry rather than leaving a detached native writer.
- **FR-018**: Controller.Close marks the controller closed before acquiring its
  context-aware gate, then delegates Link.Close after exclusive access. Expiring
  the wait does not forcibly cancel an already-started native operation.
- **FR-019**: Backend.Close clears readiness/write handles, honors the remaining
  80ms drain interval, requests disconnect, tolerates already-disconnected
  responses, and retains a failed-disconnect device handle for later cleanup.
  It does not reset the global adapter or clear sticky fatal state.
- **FR-020**: Darwin discovery timeout text installs ErrNeedsRestart; missing
  discovery results map to incompatibility where classified. Permission-like
  native error text is wrapped with ErrPermission and an actionable message.
- **FR-021**: Inspect only connects/discovers. Info copies exposed slices and
  reports current observed link status; it does not read lamp state or claim
  verified characteristic properties, and does not subscribe to FFF4.
- **FR-022**: The native disconnect callback does not acquire Backend.mu or
  retain request loggers; only a lost ready target link emits one global event.
- **FR-023**: Packet logs follow successful Write returns and include packet
  index/count, attempt, HEX, command, and carried request context. Failures,
  retries, and connection lifecycle events retain their implemented semantics.
- **FR-024**: Existing CLI/HTTP composition consumes these boundaries without
  moving native dependencies into protocol/controller or claiming physical
  readback. No source, HTTP contract, CI, or feature 001 artifact is changed.

### Interfaces and Device Effects

| Interface | Behavior / boundary |
|-----------|---------------------|
| protocol.Resolve / ValidatePresets | Pure validation and packet preparation |
| controller.Link | Connect, Write, Connected, Close, CanRetry dependency boundary |
| Controller.Connect / Execute / Close | Context-aware command gate; terminal controller close |
| ble.New / Config | Explicit identity and timeout configuration |
| Backend.Connect / Inspect | Persistent native link and FFF0/FFF3 discovery; inspection sends no lighting commands |
| Backend.Write | Synchronous write without response; no implicit reconnect |
| Backend.Connected / Info | Last observed link/device metadata, not physical lamp state |
| Backend.Close | Reusable link release; sticky fatal state survives |

Service UUIDs are advertising `00003519-0000-1000-8000-00805F9B34FB`, GATT
`0000FFF0-0000-1000-8000-00805F9B34FB`, and write
`0000FFF3-0000-1000-8000-00805F9B34FB`. The FFF4 constant does not imply an
implemented notification/readback feature.

### Key Entities

Action contains a canonical route and ordered byte slices. Preset contains
label/RGB/brightness. Backend Config contains identity/timeouts. Info contains
identity, device/address/advertisement, GATT UUIDs, write mode, and conservative
verification flags. Controller owns Link, its gate, closed state, and pacing;
Backend owns native handles, observed readiness, last-write time, and sticky
fatal state.

### Verification Evidence

There are fourteen top-level Test functions: three protocol, six controller,
and five BLE tests. The nine protocol/controller tests executed successfully
during migration preparation on 2026-10-20. The native BLE test binary compiled
but was not executed, because package initialization on macOS may create
CoreBluetooth managers. Test-source assertions are not represented as executed
hardware evidence.

## Success Criteria

- **SC-001**: Known packet vectors and canonical routes match exact assertions
  in TestResolveKnownPackets (executed; FR-001, FR-003, FR-004).
- **SC-002**: Invalid commands/presets return no packets in
  TestInvalidCommandProducesNoPackets and TestInvalidPresetProducesNoPackets
  (executed; FR-001, FR-002).
- **SC-003**: The eleven synthetic matching cases in
  TestMatchUsesManufacturerIdentityNotNameOrCompanyID agree with expected
  identity/service/type/model acceptance (inspected/compiled; FR-005-FR-007).
- **SC-004**: Concurrent whole actions never interleave and maxActive remains
  one in TestConcurrentCommandsKeepWholeSequencesTogether (executed; FR-013).
- **SC-005**: Queued cancellation touches no Link; running cancellation waits
  for the started write and prevents later packets/retry in the two controller
  cancellation tests (executed; FR-017).
- **SC-006**: Transient, persistent, and non-retryable fake-Link failures produce
  the asserted replay/attempt/close counts in
  TestRetryOnceAndRespectNonRetryableErrors (executed; FR-015).
- **SC-007**: Success/failure packet logs have the asserted timing, event order,
  request context, HEX, and metadata in the two controller logging tests
  (executed; FR-023).
- **SC-008**: TestCancelledOperationsLogWithoutStartingBLE and
  TestStickyConnectionFailureLogsErrorWithRequestContext assert no adapter work
  and appropriate context logs for early failure (inspected/compiled; FR-010,
  FR-020).
- **SC-009**: TestDisconnectCallbackLogsOnceWithoutCommandMutex asserts the
  target's state clears and logs once even while the command mutex is held
  (inspected/compiled; FR-022).

## Assumptions and Verification Limits

One Backend is used per process because DefaultAdapter and callback registration
are process-global. The caller supplies validated presets and does not mutate
Action packet slices during execution. Absolute actions make a bounded replay
meaningful; toggles and relative commands are not implemented.

macOS needs CGO, Xcode tools, and Bluetooth permission. Linux is a secondary
build target; upstream native calls have platform-specific timeout limitations.
Neither controller cancellation nor scan timeout provides a hard bound on a
native call. Public upstream APIs do not expose characteristic properties used
for runtime property validation.

**H01 - Physical evidence remains pending**: README records ON/OFF packet
verification using nRF Connect. It does not establish successful Go BLE execution,
RGB, or brightness on the device. Migration sends no lamp commands and does not
upgrade this evidence to verified status.

## Identified Gaps

- **G01 - Native lifecycle coverage**: Existing BLE tests cover matching, empty
  identity, early canceled/sticky failures, and a synthetic disconnect callback.
  They do not exercise successful native Connect/GATT, scan-stop races, native
  short/uncertain writes, or failing disconnect cleanup. Follow-up: add controlled
  transport/device tests for those paths, with an injectable boundary if needed;
  record real-device evidence separately (H01).
- **G02 - Boundary-value coverage**: No focused backend test enumerates malformed
  identities, timeout defaults/bounds, 0/21-byte packets, or the precedence of
  invalid packet/context/fatal state. Follow-up: add table-driven constructor and
  early-write validation tests in internal/ble/backend_test.go.
- **G03 - Retry, pacing, and shutdown coverage**: Current fake Link cannot return
  a Close failure, the retry test injects write failures rather than a retryable
  Connect failure, and timing tests disable the default packet gap. Production
  lampLink.CanRetry classification and Controller.Close during a blocked action
  or expired wait lack focused tests. Follow-up: extend controller tests and add
  a production classifier test with explicit typed/wrapped-error cases; assert
  pacing with a controllable clock or bounded timing checks.

These are observed verification gaps, not completed fixes or proof of a runtime
fault. H01 is a separate hardware verification limit.
