---
status: migrated
---

# Feature Specification: Structured Logging

**Feature Directory**: `specs/004-structured-logging`

**Branch**: Existing `develop`; no branch creation.

**Created**: 2026-10-20 | **Status**: migrated

**Input**: Reverse-engineer existing request correlation, command/packet events,
BLE/process diagnostics, and access-token redaction. This records built behavior;
it introduces no runtime change or new observability service.

## User Scenarios and Testing

### User Story 1 - Follow One Command Across Layers (Priority: P1)

As a local controller operator, I can follow an accepted HTTP command through
packet writes and the HTTP result without confusing it with another request.

**Independent Test**: Capture JSON slog records while an httptest request uses
the real controller with a fake Link; compare the response X-Request-ID with
the request_id attached to each command/packet/result record.

**Acceptance Scenarios**:

1. **Given** a valid sunset preset request, **When** its three fake writes
   succeed, **Then** command.received, three packet.sent records, command.sent,
   and http.request.completed share the request ID and canonical preset/sunset
   command; packet records contain the expected uppercase HEX frames.
2. **Given** a later request on the same Handler, **When** it is handled,
   **Then** its response uses a different increasing request ID.
3. **Given** a logger associated with a non-nil context, **When** another layer
   retrieves it, **Then** existing bound fields remain; an absent or stored-nil
   logger falls back to slog.Default().

Evidence: TestRequestIDConnectsReceivedCommandPacketsAndResult and
TestContextLoggerPreservesRequestFields. The stored-nil branch exists in code
but lacks a focused assertion (G01).

### User Story 2 - Diagnose Failure and Retry (Priority: P1)

As an operator, I can distinguish rejected input, failed writes, retries, and
successful transport completion without treating a log as physical lamp state.

**Independent Test**: Capture HTTP/controller records with controlled fake
errors, cancellation, and delayed writes; verify event order, level, and fields.

**Acceptance Scenarios**:

1. **Given** an invalid request, **When** validation rejects it, **Then** a WARN
   http.request.rejected record includes status/error/duration without raw
   request parameters and the controller is not called.
2. **Given** a valid command whose execution fails, **When** the HTTP handler
   responds with 503 or cancellation/deadline 504, **Then** an ERROR
   http.request.failed record includes canonical command, status, error, duration,
   and the request ID.
3. **Given** a fake write that is still running, **When** logs are inspected,
   **Then** packet.sent has not appeared; after a nil write result it appears
   with one-based attempt/index, count, and packet_hex.
4. **Given** a retryable write failure, **When** the one permitted retry occurs,
   **Then** packet.failed precedes WARN command.retry with next attempt 2 and
   reason; later success or final failure is logged accordingly.
5. **Given** cancellation during a write that eventually returns nil, **When**
   control returns, **Then** packet.sent may precede command.failed; subsequent
   packets do not run. The emitted packet event does not acknowledge lamp state.

Evidence: TestRequestFailureLogsStatusErrorAndDuration,
TestLogsPacketsOnlyAfterSuccessfulWrites, TestLogsFailuresBeforeAnyPacket,
TestCanceledQueuedCommandNeverTouchesLink,
TestCancellationWaitsForStartedWriteAndStopsRemainingPackets, and
TestRetryOnceAndRespectNonRetryableErrors.

### User Story 3 - Keep Tokens Out of Diagnostic Logs (Priority: P1)

As an operator sharing diagnostic output, I can retain useful command and device
details while configured access-token literals are removed from supported log
values and raw command URLs are avoided at the logging call sites.

**Independent Test**: Configure a handler with a synthetic secret; emit messages,
bound attributes, errors, and grouped string values; inspect captures for the
secret, redaction marker, and preserved non-secret metadata.

**Acceptance Scenarios**:

1. **Given** a configured nonempty secret, **When** it occurs in a message,
   bound string field, error text, or grouped string field, **Then** it becomes
   [REDACTED] while packet counts and safe command/group values remain useful.
2. **Given** an empty secret argument, **When** the replacement hook is built,
   **Then** it is ignored instead of replacing empty substrings.
3. **Given** an invalid URL/path/query containing private values, **When** the
   HTTP request is rejected, **Then** the diagnostic record excludes the raw
   values and full URL, even before a canonical command exists.
4. **Given** a CLI HTTP connection error wrapped by url.Error, **When** send
   reports it, **Then** it uses the underlying cause instead of logging the
   secret-bearing request URL. This path is inspected, not integration-tested.

Evidence: TestRedactionCoversMessagesBoundFieldsErrorsAndGroups and
TestRejectedRequestsDoNotLogSecretURLOrRawParameters; cmd/sunset/main.go::send.
Redaction is literal replacement in resolved string/error values. It is not a
recursive arbitrary-object sanitizer, URL encoder/decoder, or metadata anonymizer.

### User Story 4 - Understand Service and BLE Lifecycle (Priority: P2)

As an operator, I can see startup, discovery, connection, disconnection, and
shutdown diagnostics in Terminal while routine successful health polling stays
quiet and configured identity remains distinct from observed device identity.

**Independent Test**: Check quiet health and response-write failures with
httptest; inspect existing BLE log tests and process call sites. Full native
lifecycle and CLI integration remain coverage gaps, not verified hardware paths.

**Acceptance Scenarios**:

1. **Given** a healthy /health response, **When** it is written successfully,
   **Then** there is no routine request log; an unsuccessful write produces
   ERROR http.response.failed with the request ID and error.
2. **Given** startup and a later matching GATT connection, **When** events are
   emitted, **Then** service.started names the configured target whereas
   bluetooth.connected includes observed name/address and service/write UUIDs.
3. **Given** an already-ready target link, **When** its native loss callback is
   delivered repeatedly, **Then** only the first transition emits WARN
   bluetooth.disconnected with reason link_lost; it uses the process logger
   without retaining a request logger or acquiring the command mutex.
4. **Given** a canceled or sticky-failed Connect, **When** it returns before
   adapter work, **Then** bluetooth.connect_failed includes identity/error and
   any context request fields, using WARN for context cancellation/deadline and
   ERROR for other failures.
5. **Given** normal foreground operation, **When** events are logged, **Then**
   the configured text handler writes timestamps, levels, and fields to stderr;
   any optional file append is performed by the documented shell pipeline.

Evidence: TestHealthIsQuietButResponseWriteFailuresAreLogged,
TestCancelledOperationsLogWithoutStartingBLE,
TestStickyConnectionFailureLogsErrorWithRequestContext, and
TestDisconnectCallbackLogsOnceWithoutCommandMutex. BLE tests were compiled only
on this macOS host; process/native lifecycle claims otherwise derive from code.

## Requirements

### Functional Requirements

- **FR-001**: The application MUST configure standard-library slog text output
  on stderr at Info threshold, with handler-provided timestamp/level metadata.
- **FR-002**: WithLogger/FromContext MUST carry a logger through a non-nil
  context and use the process default if the stored logger is absent or nil.
- **FR-003**: Each Handler MUST allocate an atomic increasing uint64 request ID
  at request entry, set its decimal X-Request-ID header, and bind the numeric
  request_id in the context before validation or response handling.
- **FR-004**: HTTP execution MUST propagate that context to the controller and
  its Link so synchronous downstream diagnostics can retain request fields.
- **FR-005**: Accepted commands MUST emit INFO command.received with canonical
  command, method, packet_count, configured identity, and component http.
- **FR-006**: Controller write results MUST emit INFO packet.sent only after
  Write returns nil, or ERROR packet.failed after an error, with canonical
  command, component controller, one-based attempt/index, count, and uppercase HEX.
- **FR-007**: Whole-action success MUST emit INFO command.sent with count and
  duration_ms; a returned execution error MUST emit ERROR command.failed with
  error, count, and duration_ms, including failures before the first write.
- **FR-008**: A permitted retry MUST emit WARN command.retry with the next
  attempt and reason before reconnect cleanup; at most two attempts are used.
- **FR-009**: HTTP validation failures below 500 MUST emit WARN
  http.request.rejected; failure responses at or above 500 MUST emit ERROR
  http.request.failed, with status/error/duration and canonical command when known.
- **FR-010**: A successfully written command response MUST emit INFO
  http.request.completed with command, http_status 200, and duration_ms;
  response serialization/write errors MUST emit ERROR http.response.failed.
- **FR-011**: Successful health responses MUST omit routine request events;
  the request ID header and response-error diagnostics MUST still apply.
- **FR-012**: HTTP diagnostic call sites MUST omit raw paths, query strings,
  Host, rejected parameters, access-token fields, and full command URLs.
- **FR-013**: RedactSecrets MUST ignore empty secrets, resolve slog values,
  and replace configured literal occurrences in strings and error text with
  [REDACTED], including handler-processed messages/bound/group leaf attributes.
- **FR-014**: The process MUST install token-aware redaction after successful
  configuration loading; send MUST unwrap url.Error before returning its cause.
  Initial logging before token loading has no configured secret to redact.
- **FR-015**: CLI send MUST emit INFO http.command.sending with component cli,
  command and local address, then INFO http.command.completed or ERROR
  http.command.failed with duration and any response X-Request-ID as a string.
- **FR-016**: BLE discovery/connection diagnostics MUST describe scan identity,
  advertised UUID and timeout, selected device fields, connection timeout, and
  ready GATT service/write UUIDs and write mode at their respective event sites.
- **FR-017**: BLE Connect failures MUST emit bluetooth.connect_failed with
  identity/error and context fields, at WARN for cancellation/deadline or ERROR
  otherwise; Write packet events MUST remain owned by controller.
- **FR-018**: An observed ready-target link loss MUST emit a single process-level
  WARN bluetooth.disconnected with identity/address and reason link_lost without
  acquiring the backend mutex or retaining an ended request's logger.
- **FR-019**: Close MUST distinguish INFO disconnect_requested (requested),
  INFO disconnected (already_disconnected), and ERROR disconnect_failed when
  their code conditions apply; a requested disconnect MUST NOT imply confirmation.
- **FR-020**: Process diagnostics MUST cover service startup/instructions,
  optional preconnect unavailability, stopping, HTTP/BLE shutdown failures or
  timeout, ordinary service termination, and application errors at existing levels.
- **FR-021**: The HTTP server's standard ErrorLog MUST use the configured slog
  handler at Error level with component http, without an invented request ID.
- **FR-022**: Documentation MUST explain terminal/file capture, token handling,
  retained device/history metadata, and that transport events do not verify
  physical lamp state. Existing root *.log Git exclusions MUST be retained.

### Data and Event Model

- **Context logger**: A private context key holding *slog.Logger; no separate
  trace registry, database, global request map, or new network endpoint.
- **Request correlation**: Counter local to a Handler lifetime, starting at 1;
  numeric server log value and decimal HTTP/header value, copied as a string by
  CLI send. No process-restart persistence or distributed uniqueness guarantee.
- **Command/packet**: Canonical route, total count, one-based attempt/index,
  uppercase packet_hex, duration_ms for terminal command/request events.
- **Observed device**: identity, device_name, device_address, model and rssi;
  connection adds service_uuid, write_uuid, write_mode. These are not anonymized.
- **Secret filter**: Nonempty configured literals, replacing supported resolved
  values; arbitrary Any maps/structs, keys/group names, unconfigured secrets and
  encoded variants are outside its transformation contract.

## Assumptions and Edge Cases

- Production uses TextHandler; JSONHandler is used by tests to inspect fields.
  No output format/level flag, built-in file sink, rotation, or remote collector
  exists. The shell tee example captures combined stdout/stderr.
- Explicit urls output intentionally contains copyable token-bearing URLs on
  stdout and in the generated button file; it is outside diagnostic redaction.
- Before canonical resolution, rejected requests do not receive a command field.
  Failure records at several layers may describe the same failure; this is useful
  layering, not exactly-once error reporting.
- Context fields reach synchronous BLE work. Startup, shutdown, ErrorLog, and
  native link-loss callbacks need not have a request_id. CLI sending occurs
  before a response ID is available; failed connections may never obtain one.
- bluetooth.connected is emitted after GATT readiness before the final context
  error check; adjacent failure is possible. Cached connections need not emit
  another connected event. Discovery/found/connected events are not one per command.
- Successful packet logs describe returned native writes, including writes that
  finish after cancellation. They do not prove physical power, RGB, brightness,
  or immediate native cancellation. No hardware verification is added here.

## Success Criteria

- **SC-001**: The existing preset HTTP logging fixture associates all six
  expected records with the response ID and verifies distinct later-request IDs.
- **SC-002**: The existing context test preserves bound request fields and
  confirms fallback for a context without a logger.
- **SC-003**: Existing controller tests assert delayed-write ordering, packet
  metadata, early/queued/canceled failure events, and retry/final event sequences.
- **SC-004**: Existing HTTP failure tests assert 503/504 error fields and levels;
  rejected request captures omit synthetic secrets and raw private parameters.
- **SC-005**: Existing redaction tests remove the synthetic token from messages,
  bound/group fields and errors while retaining safe values and numeric counts.
- **SC-006**: Existing health tests capture no record on success and an ERROR
  response-failure record on a failed writer.
- **SC-007**: BLE test source asserts canceled/sticky Connect failure metadata
  and one mutex-independent link-loss event; this migration compiles those tests
  without claiming their execution or native/hardware verification.
- **SC-008**: Both READMEs describe structured stderr output, optional file
  capture, retained metadata and configured-target versus connected-device limits;
  this migration creates only its three specification artifacts after approval.

These criteria describe existing observable evidence rather than new latency,
coverage percentage, hardware, or production reliability targets.

## Known Gaps and Evidence Limits

| Gap | Missing coverage | Follow-up |
|-----|------------------|-----------|
| G01 | Stored-nil logger fallback; multiple/overlapping secrets; resolved LogValuer attributes; production TextHandler assertions | Add focused helper/handler cases for the supported value contract, without promising arbitrary-object sanitization |
| G02 | Native scan/found/connecting/ready and requested/already-disconnected/failed-close log paths are not exercised by current BLE log tests | Controlled transport tests and separately recorded device observations; compilation is insufficient for physical claims |
| G03 | No cmd/sunset tests for log configuration/token-load timing, CLI send ID/results, standard HTTP ErrorLog, or process startup/preconnect/shutdown diagnostics | Add a fake native/process boundary and focused CLI/lifecycle capture tests |

These gaps remain open. Overlap with [HTTP](../001-streamdeck-http-bridge/spec.md),
[BLE execution](../002-ble-command-execution/spec.md), and
[CLI/configuration](../003-config-presets-cli/spec.md) is cross-cutting logging
coverage, not a replacement of those contracts or a claim that gaps were fixed.

## Testing Policy Alignment (2026-10-20)

Existing helper and HTTP/controller/BLE log tests now use Testify assertions
and generated interface mocks. Their request correlation, packet-event order,
retry/failure, redaction, quiet-health, and callback-isolation checks are retained.
BLE log tests now execute without importing the native adapter; the native
wrapper is separately imported by the CLI and hardware-tagged tests. G01-G03
remain open for the additional helper, lifecycle, and CLI cases they enumerate.
