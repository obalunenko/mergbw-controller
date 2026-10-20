---
status: migrated
---

# Tasks: BLE Connection and Command Execution

**Input**: [spec.md](spec.md) and [plan.md](plan.md)

**Feature Directory**: `specs/002-ble-command-execution`

**Status**: migrated

This checklist reconstructs implemented code and tests. Checked test tasks mean
the test code exists, not that native tests or hardware verification ran.
Nine protocol/controller tests executed; five BLE tests were compiled/inspected
only. Known gaps remain separately open and no new code is requested here.

## Phase 1: User Story 1 - Validated Absolute Actions (P1)

- [x] T001 [US1] Encode frame header/length and folded one's-complement checksum
  in `internal/protocol/protocol.go`.
- [x] T002 [US1] Resolve on/off/color/brightness/preset arguments into canonical
  complete actions in `internal/protocol/protocol.go`.
- [x] T003 [US1] Validate preset map, slug, label, RGB, and brightness in
  `internal/protocol/protocol.go`.
- [x] T004 [US1] Implement exact-vector/canonical-route tests in
  `internal/protocol/protocol_test.go::TestResolveKnownPackets`.
- [x] T005 [US1] Implement invalid-command/no-packets tests in
  `internal/protocol/protocol_test.go::TestInvalidCommandProducesNoPackets`.
- [x] T006 [US1] Implement invalid-preset/no-packets tests in
  `internal/protocol/protocol_test.go::TestInvalidPresetProducesNoPackets`.

## Phase 2: User Story 2 - Identify and Connect the Lamp (P1)

- [x] T007 [US2] Parse explicit identity and default/validate timeouts in
  `internal/ble/backend.go`.
- [x] T008 [US2] Match service/manufacturer identity and optional type/model in
  `internal/ble/backend.go`.
- [x] T009 [US2] Implement one-match scan with an owned/joined StopScan goroutine
  and timeout/error handling in `internal/ble/backend.go`.
- [x] T010 [US2] Reuse valid link state, connect, and require unique FFF0/FFF3
  discovery before readiness in `internal/ble/backend.go`.
- [x] T011 [US2] Implement the missing-identity constructor test in
  `internal/ble/backend_test.go::TestNewRequiresExplicitIdentity`.
- [x] T012 [US2] Implement eleven synthetic advertisement cases in
  `internal/ble/backend_test.go::TestMatchUsesManufacturerIdentityNotNameOrCompanyID`.

## Phase 3: User Story 3 - Serialize and Pace Complete Actions (P1)

- [x] T013 [US3] Define Link and the exclusive controller permit, including
  empty-action/closed checks, in `internal/controller/controller.go`.
- [x] T014 [US3] Pace packet starts relative to the previous completed write
  using the 80ms default gap in `internal/controller/controller.go`.
- [x] T015 [US3] Validate/clone native packet input, check link state, write
  synchronously without response, and classify uncertain results in
  `internal/ble/backend.go`.
- [x] T016 [US3] Implement whole-sequence exclusivity assertions in
  `internal/controller/controller_test.go::TestConcurrentCommandsKeepWholeSequencesTogether`.
- [x] T017 [US3] Implement packet success-timing/metadata and early-failure logs
  tests in `internal/controller/controller_test.go::TestLogsPacketsOnlyAfterSuccessfulWrites`
  and `TestLogsFailuresBeforeAnyPacket`.

## Phase 4: User Story 4 - Bounded Recovery and Cancellation (P1)

- [x] T018 [US4] Implement at most one close/wait/reconnect/replay and production
  typed-error filtering in `internal/controller/controller.go` and
  `cmd/sunset/main.go::lampLink.CanRetry`.
- [x] T019 [US4] Respect canceled permit waits, join started write outcomes,
  suppress later packets/retry, and preserve errors in
  `internal/controller/controller.go`.
- [x] T020 [US4] Preserve sticky Darwin discovery failure and wrap permission
  errors in `internal/ble/backend.go`.
- [x] T021 [US4] Implement transient/persistent/non-retryable fake-Link cases in
  `internal/controller/controller_test.go::TestRetryOnceAndRespectNonRetryableErrors`.
- [x] T022 [US4] Implement queued and in-progress cancellation assertions in
  `internal/controller/controller_test.go::TestCanceledQueuedCommandNeverTouchesLink`
  and `TestCancellationWaitsForStartedWriteAndStopsRemainingPackets`.

## Phase 5: User Story 5 - Inspection, Link Release, and Diagnostics (P2)

- [x] T023 [US5] Expose Connect/Inspect/Connected and copied Info metadata
  without readback/notification claims in `internal/ble/backend.go`.
- [x] T024 [US5] Implement reusable backend close/drain/cleanup and distinct
  terminal controller close in `internal/ble/backend.go` and
  `internal/controller/controller.go`.
- [x] T025 [US5] Implement synthetic callback isolation/one-event assertions,
  early-cancellation logs, and sticky-error logs in
  `internal/ble/backend_test.go::TestDisconnectCallbackLogsOnceWithoutCommandMutex`,
  `TestCancelledOperationsLogWithoutStartingBLE`, and
  `TestStickyConnectionFailureLogsErrorWithRequestContext`.
- [x] T026 [US5] Compose the production backend/Link and document native lifetime
  and hardware limits in `cmd/sunset/main.go`, `internal/ble/doc.go`,
  `README.md`, and `README_RU.md`.

## Dependencies and Traceability

T001-T003 define the actions consumed by the controller; T004-T006 are their
existing tests. T007-T010 implement the native connection boundary and T011-
T012 are its constructor/matcher tests. T013-T015 combine complete actions with
exclusive paced execution, verified by T016-T017. T018-T020 implement recovery
and failure semantics; T021-T022 cover fake-backed retry and cancellation.
T023-T026 expose and document inspection/cleanup and its existing early-path
and callback tests. This is reconstructed dependency order, not commit chronology.

FR-001-FR-004 map to T001-T006; FR-005-FR-010 to T007-T012; FR-011-FR-014 to
T013-T017; FR-015-FR-020 to T018-T022/T024; FR-021-FR-024 to T017/T023-T026.

## Known Gaps (Not Completed Tasks)

| Gap | Missing evidence | Follow-up |
|-----|------------------|-----------|
| G01 | Native connection/GATT success, scan-stop races, short/uncertain writes, failed disconnect cleanup | Controlled transport/device cases for backend.go; an injectable seam if needed |
| G02 | Invalid identities, timeout defaults/bounds, invalid packet lengths and early-error precedence | Table-driven backend constructor/Write validation tests |
| G03 | Production CanRetry typing, Connect/Close failures, default gap, Close under load/canceled wait | Extend controller tests and add production classifier tests with a fake boundary |

**H01**: Verified on one LT-06 in the subsequent 2026-10-21 local hardware
session; see [hardware-verification.md](hardware-verification.md). The original
migration's ON/OFF packet evidence alone did not establish Go-path verification.

All 26 historical tasks are checked because their code/test/doc artifacts exist.
At that migration snapshot, G01-G03 and H01 remained unresolved; no historical
checked item represents fixing them. Later results are recorded below.

## Verification Record

`go test ./internal/protocol ./internal/controller` passed during preparation on
2026-10-20. The BLE test binary compiled into a temporary directory and was not
executed. No scan, connection, lamp command, source/configuration change, feature
001 edit, or branch creation is part of migration.

## Phase 6: Testing Policy Migration

- [x] T027 Extract synchronous Adapter/Address/Device/Service/Characteristic
  interfaces and advertisement snapshots in internal/ble/transport.go; move
  TinyGo wrapping to internal/ble/native/adapter.go and inject it in cmd/sunset.
- [x] T028 Migrate existing protocol/controller/BLE tests to Testify and
  generated GoMock collaborators, retaining the prior Test functions and cases.
- [x] T029 Add TestConnectInspectAndWriteThroughAdapter to verify the extracted
  boundary with generated mocks, including cached inspection and copied Info.
- [x] T030 Include BLE unit tests in core/race workflows; add a separate
  hardware-tagged, local-only Inspect test and task without claiming execution
  or physical-effect verification.
- [x] T031 Pin Testify/GoMock test libraries in the root module and mockgen in
  tools/mockgen; add task mocks:generate and bilingual workflow documentation.

These tasks align Constitution V-VI. The existing G01-G03 reports and H01 stay
open; successful mock-backed lifecycle coverage is not native/device evidence.

## Phase 7: Bugfix Verification

The completed T027-T031 migration is a prerequisite, including generated mocks
and the successful adapter lifecycle test. Existing checked tasks remain valid;
no false completion has been established. Task status below is materialized
from the Companion finish journal.

### BUG-001 - Remaining Controlled Lifecycle Coverage

- [x] T032 [US2] Add connection/GATT failure, readiness-loss, empty/wrong-device,
  missing/duplicate FFF0/FFF3, and inter-stage cancellation tables in
  internal/ble/backend_test.go per SC-010 and FR-008/FR-010/FR-021 (BUG-001;
  depends on T027-T029); retain the existing success/reuse/Info-copy baseline.
- [x] T033 [US2] Add controlled first-match, startup/stop/match cancellation race,
  StopScan retry/join, scan-only expiry, and parent/native error-precedence
  tests in internal/ble/backend_test.go per SC-011 and FR-009/FR-010 (BUG-001;
  depends on T027-T028).
- [x] T034 [US3] Add packet-copy/readiness, synchronous canceled-write completion,
  short/uncertain write, and native-error precedence tests with errors.Is in
  internal/ble/backend_test.go per SC-012 and FR-011/FR-012/FR-017 (BUG-001;
  depends on T027-T028).
- [x] T035 [US5] Add backend close/drain, invalidated write handle, tolerated
  already-disconnected result, retained failed-disconnect handle, and later
  cleanup tests in internal/ble/backend_test.go per SC-013 and FR-019 (BUG-001;
  depends on T027-T028).
- [x] T036 [US4] Inject discovery failures and verify permission/incompatibility
  classification and Darwin timeout installation/persistence of ErrNeedsRestart
  across Close in internal/ble/backend_test.go per SC-013 and FR-020 (BUG-001;
  depends on T027-T028); keep platform-specific expectations explicit.

### BUG-002 - Constructor and Early-Write Boundaries

- [x] T037 [US2] Add malformed identity/normalization and zero/default/negative/
  lower/upper timeout boundary tables with zero adapter work in
  internal/ble/backend_test.go per SC-014 and FR-005 (BUG-002;
  depends on T027-T028).
- [x] T038 [US3] Add 0/1/20/21-byte length and combined canceled/fatal/missing-link
  error-precedence tables; assert errors.Is, zero adapter work, and unchanged
  readiness in internal/ble/backend_test.go per SC-015 and FR-011 (BUG-002;
  depends on T027-T028).

### BUG-003 - Production Retry, Pacing, and Close

- [x] T039 [US4] Extract the existing production retry classifier into
  internal/ble/retry.go and delegate lampLink.CanRetry to it from
  cmd/sunset/main.go, preserving every existing typed exclusion and package
  boundary per SC-016 and FR-016 (BUG-003; depends on T027).
- [x] T040 [US4] Test the actual shared production retry helper with direct,
  wrapped, and joined permanent/context errors and retryable ordinary errors
  in internal/ble/retry_test.go per SC-016 and FR-016 (BUG-003;
  depends on T028/T039); do not import native Bluetooth or duplicate the policy.
- [x] T041 [US4] Add ordered transient/persistent Connect retry, at-most-two
  attempts, 200ms retry pause, later-packet whole-action replay, joined cleanup
  errors without reconnect, and canceled retry-wait cases in
  internal/controller/controller_test.go per SC-017 and FR-015/FR-017 (BUG-003;
  depends on T028).
- [x] T042 [US3] Verify the default 80ms completion-relative gap after successful
  and failed writes and across actions in internal/controller/controller_test.go
  per SC-018 and FR-014 (BUG-003; depends on T028); add a minimal controllable
  clock seam in controller.go only if needed for reliable timing observations.
- [x] T043 [US5] Add blocked-operation Close tests for terminal state before gate
  acquisition, exclusive cleanup, post-Close Connect/Execute rejection,
  expired wait, and later cleanup without abandoning a writer in
  internal/controller/controller_test.go per SC-019 and FR-013/FR-017/FR-018
  (BUG-003; depends on T028).

### Shared Validation

- [x] T044 [US5] Validate SC-010-SC-019 with gofmt, task test:core, task test:race,
  task vet, and task build; confirm core/race imports exclude TinyGo/cbgo/native
  and check reproducible generation if mocks change. Record automated results
  separately from hardware evidence; keep hardware execution local and opt-in
  and H01 pending (BUG-001/BUG-002/BUG-003; depends on T032-T043).

T032-T038 and T039/T041-T043 can proceed independently after their completed
migration prerequisites; T040 follows T039 and T044 follows all new tasks.
No Wave DAG existed to regenerate. Shared validation does not require equipment.

**Bugfix**: 2026-10-20 — BUG-001 Updated from bugfix patch: added T032-T036
and shared T044, tracing to SC-010-SC-013; no tasks reopened.

**Bugfix**: 2026-10-20 — BUG-002 Updated from bugfix patch: added T037-T038
and shared T044, tracing to SC-014-SC-015; no tasks reopened.

**Bugfix**: 2026-10-20 — BUG-003 Updated from bugfix patch: added T039-T043
and shared T044, tracing to SC-016-SC-019; no tasks reopened.

## Subsequent Hardware Verification Record (2026-10-21)

The hardware command test and bilingual instructions were extended after the
automated bugfix tasks. Hardware-test compilation, tagged vet, task vet, and task
build passed. Sixteen filtered real-device invocations then passed, transmitting
seventeen actions with user-confirmed effects for white, OFF/ON, RGB, brightness
0/50/100%, all six local presets, and final OFF. H01 is verified for that device
and environment; [hardware-verification.md](hardware-verification.md) records the
scope and limits. Earlier pending H01 statements describe prior phases. No
hardware run was part of T044's automated checks, and no historical task status
was reopened or changed.
