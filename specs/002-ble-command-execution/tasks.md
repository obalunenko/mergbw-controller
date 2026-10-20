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

**H01**: Physical Go-path/RGB/brightness verification is pending. ON/OFF packet
verification in the README is not upgraded into device evidence for this code.

All 26 historical tasks are checked because their code/test/doc artifacts exist.
G01-G03 and H01 remain unresolved; no checked item represents fixing them.

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
