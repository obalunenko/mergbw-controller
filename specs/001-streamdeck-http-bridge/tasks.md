---
status: migrated
---

# Tasks: Stream Deck HTTP Bridge

**Input**: [spec.md](spec.md) and [plan.md](plan.md)

**Feature Directory**: `specs/001-streamdeck-http-bridge`

**Status**: migrated

This checklist reconstructs implemented work. Every checked item has source or
existing-test evidence; checkmarks do not imply a known gap has been fixed or
hardware has been verified. No new implementation is requested here.

## Phase 1: Existing HTTP Boundary

- [x] T001 Define Handler startup settings, presets, injected Controller, atomic
  request IDs, and New constructor in `internal/bridge/http.go`.

## Phase 2: User Story 1 - Submit a Lighting Action (P1)

- [x] T002 [US1] Resolve validated route arguments into canonical complete
  protocol.Actions using `internal/protocol/protocol.go` from `internal/bridge/http.go`.
- [x] T003 [US1] Execute synchronously with a request-derived 35s context and
  map ordinary/cancellation/deadline errors in `internal/bridge/http.go`.
- [x] T004 [US1] Encode success/failure JSON, no-store/nosniff/content-length
  headers, and HEAD body suppression in `internal/bridge/http.go`.
- [x] T005 [US1] Verify GET off, POST on, and GET preset dispatch exact packet
  sequences in `internal/bridge/http_test.go::TestRoutesPassExpectedPackets`.

## Phase 3: User Story 2 - Reject Invalid Commands (P1)

- [x] T006 [US2] Check allowed Host and URL fields before dispatch in
  `internal/bridge/http.go`.
- [x] T007 [US2] Enforce methods, command HEAD rejection, body/transfer-encoding
  rejection, and path shape in `internal/bridge/http.go`.
- [x] T008 [US2] Compare route tokens and reject protocol validation errors
  without dispatch in `internal/bridge/http.go`.
- [x] T009 [US2] Verify fourteen rejected-request cases and zero Execute calls
  in `internal/bridge/http_test.go::TestRejectedRequestsNeverExecute`.

## Phase 4: User Story 3 - Inspect Service/Link Status (P2)

- [x] T010 [US3] Provide token-free health metadata without Execute or physical
  verification claims in `internal/bridge/http.go`.
- [x] T011 [US3] Verify GET health and ordinary/deadline execution error
  response semantics in `internal/bridge/http_test.go::TestHealthAndErrorsDoNotClaimPhysicalState`.

## Phase 5: User Story 4 - Diagnose Outcomes (P2)

- [x] T012 [US4] Propagate request IDs in context loggers using
  `internal/bridge/http.go` and `internal/logging/context.go`.
- [x] T013 [US4] Log command receipt/outcomes and response failures, omit raw
  request inputs, and redact configured secrets using `internal/bridge/http.go`
  and `internal/logging/redact.go`.
- [x] T014 [US4] Verify cross-layer ID/event/packet correlation and distinct
  later request IDs in `internal/bridge/logging_test.go::TestRequestIDConnectsReceivedCommandPacketsAndResult`.
- [x] T015 [US4] Verify failure status/duration/command/error logs and redaction
  in `internal/bridge/logging_test.go::TestRequestFailureLogsStatusErrorAndDuration`.
- [x] T016 [US4] Verify rejected requests omit tokens, URLs, and private raw
  inputs in `internal/bridge/logging_test.go::TestRejectedRequestsDoNotLogSecretURLOrRawParameters`.
- [x] T017 [US4] Verify successful health checks are quiet and response
  write errors are logged in `internal/bridge/logging_test.go::TestHealthIsQuietButResponseWriteFailuresAreLogged`.

## Phase 6: Existing Integration and Documentation

- [x] T018 Connect the handler to the loopback listener, production controller,
  HTTP client, and server lifecycle in `cmd/sunset/main.go`.
- [x] T019 Generate compatible button URLs in `internal/config/config.go` and
  verify legacy settings/URL behavior in `internal/config/config_test.go`.
- [x] T020 Document local HTTP methods/routes, Stream Deck background GET,
  token privacy, and physical-state limits in `README.md` and `README_RU.md`.

## Dependencies and Traceability

T001 supplies the boundary for all stories. T002-T004 use existing protocol,
config, and controller interfaces; T005 verifies the supported HTTP success
cases. T006-T009 enforce the request gates independently of actual BLE. T010-
T011 cover service inspection/error semantics. T012-T017 depend on existing
logging helpers and fake transport integration. T018-T020 expose and document
the feature through the application. This is reconstructed dependency order,
not a claim about the historical sequence of commits.

FR-001 and FR-018 map to T018-T020; FR-002 through FR-007 and FR-014 map to
T002/T006-T009; FR-008 through FR-011 map to T003-T005/T011; FR-012 maps to
T010/T011/T017; FR-013 and FR-015 through FR-017 map to T004/T012-T017.

## Known Gaps (Not Completed Tasks)

| Gap | Missing evidence | Suggested follow-up |
|-----|------------------|---------------------|
| G01 | Direct positive HTTP color/brightness routes and complete response-header assertions | Extend TestRoutesPassExpectedPackets in http_test.go |
| G02 | Explicit HTTP context/deadline/cancellation assertions and health POST/HEAD cases | Add focused fake-controller cases in http_test.go |
| G03 | CLI send and live listener/server lifecycle integration | Add cmd/sunset tests with a fake BLE boundary |

All 20 historical tasks are completed. The three gaps above remain open as
follow-up work, not checked-off fixes. Physical verification remains limited to
the evidence documented in the README; migration performs no lamp operation.

## Verification Record

`go test ./internal/bridge` passed during preparation on 2026-10-20. The scope
contains seven existing Test functions in two files. No tests, application
source, configuration, CI jobs, or branch are modified by this migration.

## Phase 7: Testing Policy Migration

- [x] T021 Migrate the existing HTTP and logging test assertions to Testify
  while preserving all seven Test functions and their existing cases.
- [x] T022 Replace handwritten Controller, Link, and failed ResponseWriter
  doubles with mockgen-generated mocks and explicit call expectations; preserve
  zero-dispatch rejection checks and cross-layer log correlation.

These tasks align Constitution V without closing G01-G03.
