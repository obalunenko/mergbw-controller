---
status: migrated
---

# Feature Specification: Stream Deck HTTP Bridge

**Feature Directory**: `specs/001-streamdeck-http-bridge`

**Feature Branch**: Existing `develop`; migration creates no branch.

**Created**: 2026-10-20

**Status**: migrated

**Input**: Reverse-engineer detected feature 1, the existing Stream Deck HTTP
bridge, using the current code and tests. This records implemented behavior;
it does not introduce new runtime requirements or claim hardware verification.

## Project Scope and Compatibility

The feature lets Stream Deck and the CLI submit absolute lighting actions to
a local controller over HTTP. It also reports service/link status and provides
correlated diagnostics without putting command URLs into logs.

Primary ownership is `internal/bridge/http.go` and its two test files.
`cmd/sunset/main.go` supplies the listener, server lifecycle, HTTP client, and
concrete controller. `internal/config/` supplies validated startup settings,
presets, and generated URLs; `internal/protocol/` supplies validated actions;
`internal/controller/` and `internal/logging/` are supporting dependencies.

Preserve existing CLI commands, token-bearing Stream Deck URLs, preset slugs,
port selection, and JSON response semantics. BLE discovery, native connection
management, packet encoding internals, general configuration initialization,
and the broader logging subsystem are dependencies rather than separate
features being migrated here. There is no database or frontend in this scope.

Automated tests prove request handling and dispatched packets. They do not
prove that an LT-06 reached a requested physical state.

## User Scenarios & Testing

### User Story 1 - Submit a lighting action (Priority: P1)

As a Stream Deck user, I use a generated Website action with background GET,
or a compatible HTTP client, to submit on/off, RGB, brightness, and preset
commands to the already-running controller.

**Independent Test**: Use `httptest` and a fake `bridge.Controller`; inspect
HTTP responses, the number of Execute calls, and the dispatched packet sequence.

**Acceptance Scenarios**:

1. Given valid startup settings and an allowed Host, when GET requests
   `/<token>/off`, then exactly one action is dispatched with packet
   `5501FF0600A3`, and successful execution returns HTTP 200.
2. Given the same conditions, when POST requests `/<token>/on` with no body,
   then the dispatched packet is `5501FF0601A2` and the response reports
   `sent: true` and `physical_state_verified: false`.
3. Given a configured sunset preset, when GET requests
   `/<token>/preset/sunset`, then one whole action contains power-on, RGB,
   and brightness packets in that order.
4. Given a valid RGB or brightness route, when resolution succeeds, then the
   action uses the protocol's canonical route. Existing protocol unit tests
   cover these values; direct positive HTTP cases remain a coverage gap (G01).

Evidence: `TestRoutesPassExpectedPackets`,
`internal/protocol/protocol.go`, and `TestResolveKnownPackets`.

### User Story 2 - Reject an invalid command safely (Priority: P1)

As a user, I receive a clear HTTP failure for invalid requests without sending
an unintended lighting action.

**Independent Test**: Submit invalid requests to the handler and assert both
status and zero calls to the fake controller's Execute method.

**Acceptance Scenarios**:

1. Given an allowed Host and correctly shaped route, when the token differs
   from the configured token, then the request returns HTTP 403 without Execute.
2. Given a command URL, when the method is HEAD or PUT, then it returns HTTP
   405 with `Allow: GET, POST`; HEAD returns no response body or lighting action.
3. Given a token-bearing command URL, when the input includes an invalid color,
   out-of-range brightness, unknown preset, query, alternate encoded path, or
   command body, then the handler rejects it before Execute.
4. Given a Host other than the configured loopback address or localhost with
   the configured port, when any route is requested, then it returns HTTP 403.

Evidence: `TestRejectedRequestsNeverExecute` and `Handler.ServeHTTP`.

### User Story 3 - Inspect service/link status (Priority: P2)

As a user, I check the controller without triggering a lighting action or
mistaking a connected Bluetooth link for confirmed physical lamp state.

**Independent Test**: Request `/health` and inspect JSON and Execute call count.

**Acceptance Scenarios**:

1. Given an allowed Host, when GET requests `/health` without a token, then it
   returns HTTP 200 with `ok`, `version`, `bluetooth_connected`, and
   `physical_state_verified: false`, without Execute.
2. Given a successful health response, when it is written successfully, then no
   routine request log is emitted; a response write failure is logged.
3. Given `/health`, when POST or HEAD is used, then the current method gate
   accepts it; HEAD has no response body. These variants are code-derived and
   are not individually asserted by the current bridge tests (G02).

Evidence: `TestHealthAndErrorsDoNotClaimPhysicalState`,
`TestHealthIsQuietButResponseWriteFailuresAreLogged`, and `Handler.ServeHTTP`.

### User Story 4 - Diagnose command outcomes (Priority: P2)

As an operator, I correlate receipt, packet writes, and request completion or
failure using a request ID without exposing tokens or complete command URLs.

**Independent Test**: Capture structured logs for requests through a real
controller backed by a fake Link, and for injected controller failures.

**Acceptance Scenarios**:

1. Given a successful preset request, when logs are captured, then receipt,
   packet events, controller completion, and HTTP completion share the response's
   `X-Request-ID`; a subsequent request gets a different ID.
2. Given a controller failure, when execution returns an ordinary error or a
   deadline error, then HTTP 503 or 504 is returned and failure logs include
   status, duration, command, and a redacted error.
3. Given rejected input containing token-like or private values, when logs are
   captured, then raw URLs and rejected parameters are not present.

Evidence: the four tests in `internal/bridge/logging_test.go` and the
request-context/redaction helpers in `internal/logging/`.

### Edge Cases

- Validation order is observable: Host, URL fields, allowed method, health
  handling, command HEAD, body/transfer encoding, path shape, token, then action
  resolution. Do not replace it with an assumed uniform error for all bad URLs.
- A command path must have two or three segments after removing one leading
  slash. Other segment counts return 404; a valid shape with invalid action
  arguments returns 400. A trailing slash can therefore return 400.
- `/health` is processed before command token/body validation: the current
  handler ignores health request bodies. This is observed behavior, not a new
  recommendation to change the API.
- `context.Canceled` and `context.DeadlineExceeded`, including wrapped errors,
  map to 504. Ordinary controller errors map to 503.
- Request timeouts are cooperative. Execute remains synchronous; the handler
  does not abandon a native operation or guarantee completion within 35 seconds.
- A client may fail to receive the response after packets were sent. The
  response write failure is logged; it does not undo the action.

## Requirements

### Functional Requirements

- **FR-001**: The server binds TCP4 to the configured IPv4 loopback address;
  the default is `127.0.0.1:18765`.
- **FR-002**: Lighting routes accept GET and POST. Other methods are rejected
  with 405; command HEAD is rejected and never writes a response body.
- **FR-003**: The Host, lowercased for comparison, must equal the configured
  loopback address or `localhost:<configured-port>`; otherwise return 403.
- **FR-004**: Nonempty RawQuery, RawPath, or Fragment, and ForceQuery, cause 400
  before dispatch.
- **FR-005**: Command requests with nonzero ContentLength or any transfer
  encoding are rejected with 400 before dispatch.
- **FR-006**: Correctly shaped lighting routes compare the leading token with
  the configured token using constant-time comparison; a mismatch returns 403.
- **FR-007**: Supported actions are on, off, color, brightness, and configured
  presets; protocol.Resolve validates arguments and provides the canonical route
  and ordered packet sequence before dispatch.
- **FR-008**: A valid lighting request calls Execute once with the complete
  action. Whole-action serialization and retry semantics belong to the injected
  controller, not the HTTP handler.
- **FR-009**: Execution uses a request-derived context with a 35-second timeout,
  calls Execute synchronously, and does not detach in-progress operations.
- **FR-010**: Controller cancellation/deadline errors return 504; other execution
  errors return 503. Failure responses do not report successful transmission.
- **FR-011**: Successful execution returns 200 with `sent: true`, the canonical
  `action`, and `physical_state_verified: false`.
- **FR-012**: `/health` accepts GET, POST, and HEAD after Host/URL/method checks,
  needs no token, never calls Execute, and reports service version and current
  Connected state without claiming physical-state verification.
- **FR-013**: Responses use JSON with a trailing newline, `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff`, computed Content-Length, and a
  per-handler monotonically increasing `X-Request-ID`. HEAD emits no body.
- **FR-014**: Validation failures use the statuses defined by the validation
  order and the interface table below, with an error message and
  `physical_state_verified: false` in non-HEAD JSON bodies.
- **FR-015**: Request IDs flow through the request context to command/packet
  logs. Command logs identify the canonical command, outcome, and duration.
- **FR-016**: Logs omit raw paths, query strings, Host values, full URLs, and
  rejected parameters; configured secret redaction also covers error strings.
  This requirement concerns logs, not a claim that every response error is
  separately redacted.
- **FR-017**: Successful health checks are quiet; response write errors produce
  `http.response.failed` diagnostics.
- **FR-018**: Generated button URLs and the CLI HTTP client retain compatible
  token-bearing routes and stable settings/preset behavior. Server/client
  integration is documented from code, with the test limitation in G03.

### Interfaces and Device Effects

| Interface | Current behavior |
|-----------|------------------|
| GET/POST `/<token>/on`, `/off` | One power packet |
| GET/POST `/<token>/color/<HEX>` | Power-on followed by validated RGB |
| GET/POST `/<token>/brightness/<N>` | Power-on followed by integer brightness 0-100 |
| GET/POST `/<token>/preset/<slug>` | Power-on, configured RGB, configured brightness |
| GET/POST/HEAD `/health` | Service/link metadata; no Execute; HEAD has no body |
| Invalid Host or token | 403, subject to validation order |
| Forbidden URL fields, body, or bad action arguments | 400 |
| Invalid command segment count | 404 |
| Unsupported method or command HEAD | 405; Allow advertises GET, POST |
| Execute cancellation/deadline error | 504 |
| Other Execute error | 503 |

Color routes are canonicalized to uppercase HEX; brightness routes use the
parsed integer. Invalid parameters produce no dispatched action. Power-on
prefixing and exact packets are supplied by protocol.Resolve; no physical
readback is performed by this feature.

### Key Entities

- **Startup settings**: Device identity, TCP port, and token supplied by config.
- **Preset**: Named RGB/brightness values supplied by the loaded preset map.
- **Action**: Canonical route and ordered packets returned by protocol.Resolve.
- **Request context**: Cancellation/deadline and correlated logger.
- **Response**: Transmission result or service/link metadata, not physical state.

### Verification Evidence

Seven test functions in two bridge test files cover successful off/on/preset
routes, fourteen invalid request cases, health and execution errors, request/log
correlation, redaction, and response write failures. Supporting protocol and
configuration tests cover direct color/brightness packet vectors and legacy
URL/settings compatibility.

`go test ./internal/bridge` passed during migration preparation on 2026-10-20.
The earlier bootstrap validation also passed core tests, race checks, and vet;
those earlier runs are contextual evidence, not new hardware verification.

## Success Criteria

- **SC-001**: Existing positive HTTP cases each dispatch one action with the
  asserted packet bytes and return 200 (FR-007, FR-008, FR-011).
- **SC-002**: Every case in the fourteen-case rejection table returns its
  expected status and zero Execute calls (FR-002 through FR-007, FR-014).
- **SC-003**: Health checks execute no lighting action and do not claim physical
  state; successful GET checks remain quiet (FR-012, FR-017).
- **SC-004**: Injected ordinary/deadline failures return 503/504 without a
  successful transmission claim (FR-009, FR-010).
- **SC-005**: The tested preset's receipt, packets, and outcome share the
  response request ID, and a later request uses a different ID (FR-013, FR-015).
- **SC-006**: Captured rejection and execution-error logs contain neither the
  configured token nor the tested private input (FR-016).
- **SC-007**: Response write failure is recorded as `http.response.failed`
  (FR-017), and legacy generated routes are preserved by config tests (FR-018).

## Assumptions and Verification Limits

- Settings and presets are validated before the handler is constructed; New
  itself does not validate or reload configuration.
- Presets remain unchanged during handler use; request IDs are local to each
  Handler and restart with a new instance, not globally unique across processes.
- Stream Deck runs on the same host, uses the generated URL, and enables
  background GET. The server is already running for CLI send commands.
- Native BLE transport and real lamp effects are outside fake-backed HTTP
  test evidence. ON/OFF packet hardware verification is recorded in the README;
  RGB, brightness, and the Go BLE path still require physical verification.
- No general latency/throughput SLO, numeric test coverage threshold, or strict
  TDD policy is inferred from this migration.

## Identified Gaps

- **G01 - Positive HTTP route/metadata coverage**: The HTTP success table covers
  GET off, POST on, and GET preset, but not direct successful color/brightness
  routes or all response headers. Protocol tests cover color/brightness packets.
  Follow-up: extend `TestRoutesPassExpectedPackets` with direct routes,
  canonical action values, and complete header assertions.
- **G02 - Context and health variants**: No dedicated bridge test asserts
  propagation of the request deadline, a canceled request's 504 path, or health
  POST/HEAD variants. Supporting controller cancellation tests do not replace
  these HTTP-level cases. Follow-up: add fake-controller context assertions and
  separate health method cases to `internal/bridge/http_test.go`.
- **G03 - CLI/server integration**: Existing bridge tests call ServeHTTP through
  recorders. No `cmd/sunset/*_test.go` covers the actual listener lifecycle or
  CLI send integration. Follow-up: test composition/lifecycle and the HTTP
  client with a fake BLE boundary, avoiding native Bluetooth in core tests.

These are observed coverage gaps, not evidence that the implemented behavior
is incorrect. Hardware verification remains a separately stated limitation.

## Testing Policy Alignment (2026-10-20)

Existing HTTP contracts remain unchanged. The seven bridge test functions now
use Testify assertions and mockgen-generated Controller, Link, and ResponseWriter
mocks. Rejection tests install no Execute expectation; any unexpected dispatch
fails the mock. Cross-layer logging tests still exercise the real controller
with a mocked Link. G01-G03 remain open; this migration adds no CLI/server or
new route coverage.
