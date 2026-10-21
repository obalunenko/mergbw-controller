---
status: migrated
---

# Implementation Plan: Stream Deck HTTP Bridge

**Feature Directory**: `specs/001-streamdeck-http-bridge`

**Branch**: Existing `develop`; no branch creation or source modification.

**Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

Reconstructed implementation of the existing local Stream Deck/CLI HTTP bridge.
The standard-library HTTP handler validates requests, resolves an absolute
protocol.Action, and synchronously calls an injected Controller. Configuration,
protocol, controller, native BLE, and logging remain in their existing packages.
This is a record of built work, not a proposal to rebuild it.

## Technical Context

- **Language/Version**: Go 1.27.0+ application and separate tooling modules.
- **Dependencies**: Handler uses net/http, context, encoding/json, crypto/subtle,
  log/slog, and sync/atomic, plus internal config/protocol/logging. Native
  Bluetooth is supplied at the composition root through tinygo.org/x/bluetooth
  v0.16.0, not imported by the bridge.
- **Storage**: Startup settings, presets, and generated URLs in files; no schema
  or database migration is required by this documentation-only migration.
- **Testing**: testing, httptest, table-driven cases, fake Controller, and real
  controller plus fake Link for cross-layer logging checks.
- **Platform**: Primary macOS/CoreBluetooth with CGO; Linux CI test/build target.
- **Project type**: One local CLI/HTTP process and one injected BLE controller.
- **Performance**: No throughput or response-latency SLO is established. The
  controller serializes whole actions; native operations may exceed deadlines.
- **Constraints**: Loopback binding, GET/POST compatibility, preserved URL/token
  semantics, synchronous dispatch, redacted logs, and honest physical-state
  metadata.

## Constitution Check

| Principle | Assessment and evidence |
|-----------|-------------------------|
| Package/module boundaries | Bridge imports config, protocol, logging and defines Controller; native composition remains in cmd/sunset |
| Local command contract | Host, token, URL, method, body, and argument gates precede dispatch in http.go |
| BLE effects/cancellation | Execute is synchronous under a request context; controller owns native semantics; all normal payloads disclaim physical-state verification |
| Config/secrets | Startup config is reused, generated URLs remain compatible, and request logs use logging.RedactSecrets |
| Appropriate verification | Fake-backed tests are distinguished from device evidence; G01-G03 state untested paths |
| Tooling/CI | Existing Taskfile and CI remain unchanged; no Spec Kit checks are added to CI |

No architectural exception is introduced by the migration. Existing coverage
limitations are recorded in spec.md rather than represented as completed tests.

## Project Structure and Scope Metrics

| Scope | Files | Lines | Interpretation |
|-------|-------|-------|----------------|
| Primary implementation | 1 | 148 | internal/bridge/http.go |
| Primary tests | 2 | 304 | http_test.go and logging_test.go; seven Test functions |
| Supporting implementation | 6 | 859 | Complete files listed below; not all lines implement HTTP behavior |
| Supporting tests | 4 | 621 | Complete dependency test files; not all assertions are HTTP-specific |
| Database migrations | 0 | 0 | None in scope |

Line counts include comments and blank lines and reflect the current snapshot.
They describe scope; they are not performance or quality scores.

```text
cmd/sunset/main.go                # composition, serve, send
internal/bridge/http.go          # primary handler
internal/bridge/http_test.go     # routing, rejection, health/errors
internal/bridge/logging_test.go  # correlation, redaction, response errors
internal/config/config.go        # Address, BaseURL, URLs, startup data
internal/config/config_test.go   # URL/settings compatibility
internal/protocol/protocol.go    # Resolve and Action
internal/protocol/protocol_test.go
internal/controller/controller.go
internal/controller/controller_test.go
internal/logging/context.go
internal/logging/redact.go
internal/logging/logging_test.go
```

The migrated artifacts are only `spec.md`, `plan.md`, and `tasks.md` in this
feature directory. No source files, branch, settings, or active-feature pointer
are created or changed by migration.

## Reconstructed Implementation by Boundary

### 1. HTTP adapter and request validation

Handler owns immutable startup settings/presets, an injected Controller, and
an atomic request counter. Validation order is Host, URL flags, method, health,
command HEAD, request body/transfer encoding, segment count, token, then Resolve.
Token comparison is constant-time. This order explains why malformed routes
can return 400/404 before a token comparison.

Decision evidence: `Handler`, `New`, and `ServeHTTP` in http.go. Standard-library
routing logic avoids a web-framework dependency for the small fixed API.

### 2. Action resolution and execution

protocol.Resolve returns a canonical route and complete ordered packet list.
The bridge passes it once to Controller.Execute using a context derived from
the incoming request with a 35-second timeout. The call is synchronous; wrapped
cancellation/deadline errors map to 504, other errors to 503, and successful
execution to 200. Physical state is never inferred from transport success.

Dependency path: bridge -> protocol; bridge -> config -> protocol; bridge ->
logging. Production command execution crosses the Controller interface to
internal/controller, which owns Link and native transport sequencing. Native
BLE is not part of the handler's imports or test setup.

### 3. Response and diagnostics

respond encodes newline-terminated JSON, content type, no-store, nosniff,
Content-Length, and body suppression for HEAD. Request IDs are set before
validation and attached to context loggers. Receipt and outcome diagnostics
omit raw request data; configured redaction also sanitizes error messages.
Successful health checks are quiet; write failures are logged.

Decision evidence: respond, ServeHTTP, logging.WithLogger/FromContext,
logging.RedactSecrets, and all four bridge logging tests.

### 4. Composition and compatibility

serve binds TCP4 loopback before requesting the application-managed BLE
connection, constructs the real backend/controller, and installs bridge.New
as the HTTP handler. Server settings are ReadHeaderTimeout 5s, ReadTimeout 10s,
WriteTimeout 75s, IdleTimeout 60s, and MaxHeaderBytes 8192. Shutdown follows
SIGINT/SIGTERM or server failure with a 5s HTTP shutdown context and 3s bounded
process wait for controller close; native calls themselves remain cooperative.

send uses a 75s HTTP client timeout, disables proxying and redirect following,
reads at most 64 KiB of response, and reports HTTP failures. URLs generated by
config retain the configured token, port, preset slugs, and legacy action paths.
These integration details are code-derived and are not covered by cmd/sunset
unit tests (G03). BLE library initialization can occur before main on macOS.

## Complexity Assessment

The primary adapter is small (148 source lines) and has two colocated test
files. Request ordering and externally visible errors make it more subtle than
the route count alone suggests. The deepest concrete internal import path from
the handler is two edges through config to protocol; production execution also
crosses an injected interface into the controller/BLE lifecycle. Timing,
cancellation, token-bearing URLs, and log correlation are the main complexity
factors. No new module, storage system, or framework is introduced.

## Validation Evidence and Remaining Work

- **Executed during preparation**: `go test ./internal/bridge` passed on
  2026-10-20 (seven top-level test functions plus subtests).
- **Existing session evidence**: brownfield validation passed `task test:core`,
  race checks outside the sandbox, `task vet`, local Spec Kit tests, and a
  controller build into a temporary directory. This migration did not rerun
  all those checks because source code did not change.
- **Future relevant checks**: `task test:core`, `task test:race`, `task vet`,
  `task build`; full `task check` is intended for Linux. No CI change is needed.
- **G01**: Add direct positive HTTP color/brightness cases and complete response
  metadata assertions in http_test.go.
- **G02**: Add request-context/deadline/cancellation and health POST/HEAD tests
  in http_test.go.
- **G03**: Add CLI HTTP-client/listener lifecycle integration tests behind a
  fake native boundary; no cmd/sunset test files currently exist.
- **Hardware limit**: No lamp commands were sent during migration. The README's
  ON/OFF evidence does not establish Go BLE, RGB, or brightness verification.

## Complexity Tracking

No constitution violations or architecture exceptions are proposed. G01-G03
are follow-up verification work and are not completed historical tasks.

## Testing Policy Alignment (2026-10-20)

Use Testify 1.11.1 and GoMock 0.6.0 in existing bridge tests. Generated mocks are
colocated as mock_*_test.go and regenerated with task mocks:generate using the
separate tools/mockgen module. Response-write failure injection now uses a
mockgen-generated http.ResponseWriter. The earlier implementation descriptions
and scope metrics record the historical migration snapshot.
