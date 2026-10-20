---
status: migrated
---

# Tasks: Structured Logging

**Input**: [spec.md](spec.md) and [plan.md](plan.md)

**Feature Directory**: `specs/004-structured-logging`

**Status**: migrated

This checklist reconstructs implemented code, existing tests, and documentation.
Checked tasks mean the artifacts exist; they do not mean gaps were fixed or
native/CLI/hardware paths were executed. BLE test tasks are source evidence and
compile-only on this macOS host.

## Phase 1: User Story 1 - Request Correlation (P1)

- [x] T001 [US1] Carry a logger using a private context key with process fallback
  in `internal/logging/context.go`.
- [x] T002 [US1] Allocate atomic request IDs, set X-Request-ID, bind the request
  context, and pass it to Execute in `internal/bridge/http.go`.
- [x] T003 [US1] Emit canonical command receipt and successful HTTP result events
  with HTTP component/fields in `internal/bridge/http.go`.
- [x] T004 [US1] Implement bound-field propagation and missing-context-value
  fallback assertions in `internal/logging/logging_test.go::TestContextLoggerPreservesRequestFields`.
- [x] T005 [US1] Implement full fake-Link preset event/HEX/request-ID sequence
  and next-request-ID assertions in `internal/bridge/logging_test.go::TestRequestIDConnectsReceivedCommandPacketsAndResult`.

## Phase 2: User Story 2 - Results and Failures (P1)

- [x] T006 [US2] Log packet result only after Write returns with one-based
  attempt/index, count, and HEX in `internal/controller/controller.go`.
- [x] T007 [US2] Log command success/failure with duration and retry intent/reason
  at existing retry boundaries in `internal/controller/controller.go`.
- [x] T008 [US2] Emit differentiated HTTP rejection/failure and response failure
  records without raw request data in `internal/bridge/http.go`.
- [x] T009 [US2] Implement delayed-write logging and early failure assertions in
  `internal/controller/controller_test.go::TestLogsPacketsOnlyAfterSuccessfulWrites`
  and `TestLogsFailuresBeforeAnyPacket`.
- [x] T010 [US2] Implement queued/in-progress cancellation log assertions in
  `internal/controller/controller_test.go::TestCanceledQueuedCommandNeverTouchesLink`
  and `TestCancellationWaitsForStartedWriteAndStopsRemainingPackets`.
- [x] T011 [US2] Implement retry/nonretryable event order, levels and attempt
  metadata assertions in `internal/controller/controller_test.go::TestRetryOnceAndRespectNonRetryableErrors`.
- [x] T012 [US2] Implement 503/504 status, error, duration and redacted error
  assertions in `internal/bridge/logging_test.go::TestRequestFailureLogsStatusErrorAndDuration`.

## Phase 3: User Story 3 - Secret Handling (P1)

- [x] T013 [US3] Build nonempty literal-secret replacements and resolve/filter
  slog string/error values in `internal/logging/redact.go`.
- [x] T014 [US3] Configure Info text stderr output and reconfigure with loaded
  token; unwrap CLI url.Error in `cmd/sunset/main.go`.
- [x] T015 [US3] Implement message/bound/error/group redaction and safe-field
  preservation assertions in `internal/logging/logging_test.go::TestRedactionCoversMessagesBoundFieldsErrorsAndGroups`.
- [x] T016 [US3] Implement raw private parameter/URL exclusion assertions in
  `internal/bridge/logging_test.go::TestRejectedRequestsDoNotLogSecretURLOrRawParameters`.

## Phase 4: User Story 4 - Lifecycle Diagnostics (P2)

- [x] T017 [US4] Keep successful health requests quiet while logging failed
  response writes, with assertions in `internal/bridge/logging_test.go::TestHealthIsQuietButResponseWriteFailuresAreLogged`.
- [x] T018 [US4] Emit scan/match/connect/ready/failure metadata and distinguish
  requested/already-disconnected/failed-close events in `internal/ble/backend.go`.
- [x] T019 [US4] Emit one process-level ready-target link-loss event without
  mutex/request-logger retention in `internal/ble/backend.go::handleConnect`.
- [x] T020 [US4] Implement canceled/sticky Connect request-field assertions in
  `internal/ble/backend_test.go::TestCancelledOperationsLogWithoutStartingBLE`
  and `TestStickyConnectionFailureLogsErrorWithRequestContext` (compile only).
- [x] T021 [US4] Implement synthetic callback deduplication/no-mutex assertions in
  `internal/ble/backend_test.go::TestDisconnectCallbackLogsOnceWithoutCommandMutex`
  (compile only).
- [x] T022 [US4] Log CLI sending/result/duration/response ID and service
  startup/preconnect/shutdown outcomes; route HTTP ErrorLog through slog in
  `cmd/sunset/main.go`.
- [x] T023 [US4] Document structured stderr output, optional file capture,
  retained identifiers and physical-state limits in `README.md` and
  `README_RU.md`; retain root log-file exclusions in `.gitignore`.

## Dependencies and Traceability

T001 supplies the context transport used by T002-T003 and downstream controller/
BLE emitters. T006-T008 define result reporting exercised by T005/T009-T012.
T013-T014 supply filtering/configuration exercised in supported-value captures
by T015-T016. T017-T023 implement/document lifecycle output and existing tests.
This is reconstructed dependency order, not commit chronology.

FR-001-FR-002 map to T001/T004/T014; FR-003-FR-005 to T002-T005;
FR-006-FR-008 to T006-T007/T009-T011; FR-009-FR-011 to T008/T012/T017;
FR-012-FR-014 to T008/T013-T016; FR-015 to T022;
FR-016-FR-019 to T018-T021; FR-020-FR-021 to T022;
FR-022 to T023. Source behavior is shared with features 001-003, whose contracts
remain unchanged.

## Known Gaps (Not Completed Tasks)

| Gap | Missing evidence | Follow-up |
|-----|------------------|-----------|
| G01 | Stored-nil logger, multiple/overlapping literals, resolved LogValuer, production text output | Focused helper/handler cases within the supported string/error contract |
| G02 | Native discovery/GATT readiness and close-path event fields/results | Controlled transport tests; separately record any physical device checks |
| G03 | Token-load timing, CLI result/ID logs, HTTP ErrorLog and service lifecycle logs | Fake native/process boundary and focused integration capture tests |

All 23 historical tasks are checked because corresponding code/tests/docs exist.
The three gaps remain open. No arbitrary-object sanitation or physical lamp
verification is implied by these task statuses.

## Verification Record

On 2026-10-20, logging/bridge/controller package tests passed (controller cached).
The BLE test binary compiled to a temporary path and was not executed. No
CLI/server/native operation was run; no runtime token files were inspected.
Migration previews live outside the repository until approval, with source
snapshot hashes and an add-only diff for review.

## Phase 5: Testing Policy Migration

- [x] T024 Migrate existing helper, HTTP, controller, and BLE log assertions to
  Testify and generated interface mocks, retaining event order/metadata,
  request IDs, redaction, response-write failure, and callback-isolation cases.
- [x] T025 Execute BLE log unit tests through the native-free adapter boundary
  in core/race workflows; document the separate local hardware-test path.

These tasks align Constitution V-VI; G01-G03 remain open.
