---
status: migrated
---

# Implementation Plan: Structured Logging

**Feature Directory**: `specs/004-structured-logging`

**Branch**: Existing `develop`; no branch creation or application changes.

**Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

Reconstruct the existing standard-library slog integration. internal/logging
owns context propagation and literal-secret filtering; HTTP, controller, BLE,
and main own event emission at their existing boundaries. The migration records
cross-cutting diagnostics for the already migrated [HTTP](../001-streamdeck-http-bridge/spec.md),
[BLE](../002-ble-command-execution/spec.md), and
[CLI/config](../003-config-presets-cli/spec.md) capabilities.

## Technical Context

- **Language/Version**: Application Go 1.25.0+; standard-library context, slog,
  strings, atomic, time, net/http, and error handling. No logging library added.
- **Integration**: Bridge and controller depend on logging, not each other’s
  concrete transports; main configures the process handler and composes native BLE.
  tinygo.org/x/bluetooth v0.16.0 remains the existing transport dependency.
- **Storage**: No logging database or built-in file output. stderr is the sink;
  users may explicitly append combined shell output to an ignored *.log file.
- **Testing**: Go testing, JSONHandler record capture, httptest, fake Link,
  delayed writes and controlled errors. BLE tests compile on macOS but are not
  executed because importing the native package can initialize CoreBluetooth.
- **Constraints**: Keep tokens/full URLs out of diagnostics, preserve safe
  metadata, keep callback work independent of the command mutex, and never
  claim physical state from a write or connection log.
- **Performance**: No logging throughput, file size, latency, or retention SLO
  exists. Info-level packet events are the observed default, not sampled telemetry.

## Constitution Check

| Principle | Evidence |
|-----------|----------|
| Boundaries | logging helpers import only context/slog/strings; event producers remain in their own packages |
| HTTP compatibility | X-Request-ID is allocated before validation; existing action/status/body contracts remain those of 001 |
| BLE effects | packet.sent follows Write completion; requested disconnect, observed connection, and physical state are distinct |
| Secrets | Token-aware ReplaceAttr plus avoiding raw request values; exact supported value types and load timing are explicit |
| Verification | Three non-native packages executed; BLE tests compiled only; G01-G03 separate missing coverage from implemented code |
| Tooling/CI | No Go/module/Taskfile/workflow changes; no Spec Kit checks added to CI |

No constitution exception is introduced. This migration preserves current
behavior and documents the limitations of evidence and literal redaction.

## Project Structure and Scope Metrics

| Scope | Files | Lines | Interpretation |
|-------|-------|-------|----------------|
| Dedicated helper source | 2 | 55 | context.go 24; redact.go 31 |
| Shared event-emitter source | 4 | 1186 | main.go 321; bridge/http.go 148; controller.go 153; backend.go 564 |
| Dedicated logging tests | 2 | 226 | logging/logging_test.go 58; bridge/logging_test.go 168; six Test functions |
| Shared controller/BLE tests | 2 | 610 | controller_test.go 375; backend_test.go 235; eleven Test functions, not all exclusively logging |
| Additional HTTP contract tests | 1 | 136 | bridge/http_test.go; three Test functions also run with the bridge package |
| Database migrations | 0 | 0 | None |

Counts include comments/blank lines and complete shared files, not exclusive
logging ownership. Total scoped test files contain twenty Test functions;
fifteen belong to the three executed packages, five to compile-only BLE.

```text
internal/logging/context.go
internal/logging/redact.go
internal/logging/logging_test.go
internal/bridge/http.go
internal/bridge/logging_test.go
internal/bridge/http_test.go
internal/controller/controller.go
internal/controller/controller_test.go
internal/ble/backend.go
internal/ble/backend_test.go
cmd/sunset/main.go
README.md
README_RU.md
.gitignore
```

Only spec.md, plan.md, and tasks.md under this feature directory are proposed
project writes. No source, runtime token file, branch, active-feature pointer,
or previous migration artifact is changed.

## Reconstructed Implementation by Boundary

### 1. Handler configuration and reusable helpers

main first installs a TextHandler on stderr at Info level. After successful
settings/preset loading, run reinstalls it with the loaded access token.
RedactSecrets builds a strings.Replacer from nonempty secrets. ReplaceAttr
resolves the slog.Value, replaces literal occurrences in KindString, and turns
KindAny errors into redacted strings. Handler traversal applies it to messages,
bound attributes, and group leaves; non-error arbitrary Any objects are unchanged.

WithLogger uses a private context key; FromContext preserves the stored non-nil
logger or returns slog.Default. It does not impose HTTP/BLE dependencies or
support a nil context. Production text output is distinct from test JSON output.

### 2. HTTP correlation and result events

ServeHTTP increments an atomic per-Handler counter, binds its numeric request_id,
and writes the decimal X-Request-ID header before validation. A derived logger
adds component http; the context passed to Execute carries the request logger,
not an HTTP dependency. Accepted commands use canonical action.Route only.

The failure helper chooses WARN rejected below 500 or ERROR failed otherwise;
fields include status/error/duration and command only after successful Resolve.
It intentionally avoids raw URL/path/query/Host/rejected values. Response helpers
log serialization/write failures, and a successfully written command result
emits completed. Healthy /health bypasses normal command/request completion logs.

The HTTP fixture uses a real controller with a fake Link: it verifies the six
event sequence, expected preset bytes, request association, and next-request ID.
No native Bluetooth package is needed for these package tests.

### 3. Controller packet and retry events

Execute adds component controller and command to the context logger. Each
attempted packet binds attempt, packet_index, packet_count and uppercase HEX.
Write returns before packet.sent/failed is logged. Action success records count
and duration; the deferred error record includes early/queued/canceled failure.
Retry records the next attempt/reason before Close and the 200ms pause, with
at most one repeat of the whole absolute action.

This is host-side result reporting: a successful write returning after context
cancellation can produce packet.sent followed by command.failed. The native
backend does not duplicate controller packet events. Command/request durations
include their respective waiting/work time; no per-packet latency field exists.

### 4. BLE lifecycle and callback safety

| Event | Level | Principal fields/condition |
|-------|-------|----------------------------|
| bluetooth.scan_started | INFO | identity, advertising_uuid, scan_timeout_ms before scan |
| bluetooth.device_found | INFO | selected device fields after matching scan returns |
| bluetooth.connecting | INFO | device fields, connect_timeout_ms before native connect |
| bluetooth.connected | INFO | device fields, service_uuid, write_uuid, write_mode after GATT readiness |
| bluetooth.connect_failed | WARN/ERROR | identity/error; WARN for context cancellation/deadline, otherwise ERROR |
| bluetooth.disconnected | WARN | native ready-target loss; identity/address, reason link_lost |
| bluetooth.disconnect_requested | INFO | device fields, reason requested after accepted disconnect request from a ready link |
| bluetooth.disconnected | INFO | device fields, reason already_disconnected for tolerated not-connected close result |
| bluetooth.disconnect_failed | ERROR | device fields/error when disconnect returns another error |

deviceLogAttrs includes identity, device_name, device_address, model, rssi.
Synchronous operations use FromContext. The native link-loss callback uses the
process logger and only immutable target/config plus atomic connection state;
it avoids b.mu and request logger retention. Repeated loss callbacks log once
per observed ready-to-disconnected transition. A new ready transition can log
another loss. Normal requested disconnect and unexpected link loss differ.

Existing BLE log tests cover canceled Connect/Inspect, sticky backend failure,
and a synthetic disconnect callback while the mutex is held. Native discovery,
GATT, and close outcomes are not covered by those tests (G02). GATT-ready logging
precedes the final context check and does not guarantee a successful caller result.

### 5. CLI and service lifecycle

send logs http.command.sending, then a deferred completed/failed event with
duration and any returned response ID. That ID is a string in CLI logs whereas
the server's value is numeric. The first event cannot yet have a response ID.
Logging uses the local address and route; url.Error is unwrapped so its full
secret-bearing URL is not used as the returned connection error.

serve routes standard HTTP ErrorLog through the process slog handler at Error
with component http. INFO service.started/instructions report configured target
and user guidance; WARN bluetooth.unavailable reports healthy-context preconnect
failure with retry/restart hints. Shutdown logs service.stopping, WARN
http.shutdown.failed, ERROR http.close.failed, ERROR bluetooth.shutdown.failed,
or WARN bluetooth.shutdown.timeout as applicable. Ordinary final termination
logs service.stopped; returned application errors log application.failed at ERROR.
service.stopped can follow a logged BLE close problem; it does not mean confirmed
device disconnect. No cmd/sunset logging test currently covers these paths (G03).

## Complexity Assessment

The dedicated helper package is small and standard-library only. The feature
crosses four existing producer files and uses contexts rather than a new
transport abstraction. Its sensitive interactions are handler traversal and
secret-load timing, per-request identity versus process callbacks, synchronous
write ordering under cancellation, bounded retry reporting, and configured versus
observed device metadata. No new dependency, schema, frontend, or collector exists.

## Validation Evidence and Remaining Work

- **Executed**: `go test ./internal/logging ./internal/bridge ./internal/controller`
  passed on 2026-10-20 (controller reused Go's successful test cache). Fifteen
  existing top-level Test functions belong to these packages; no tests were added.
- **Compile only**: `go test -c -o <temporary-directory>/ble.test ./internal/ble`
  passed. The binary was not executed; five BLE Test functions, including three
  focused logging tests, were inspected rather than run.
- **Not executed**: CLI, server, shell wrappers, native scan/connect/write/close,
  or physical lamp operations. Runtime settings/button files were not read.
- **Artifact checks**: Before approval, validate sequential IDs, checked
  historical task count, cited test names, source paths/links, immutable source
  hashes, unchanged branch/HEAD, and applicability of the full add-only diff.
- **Future relevant checks**: task test:core and task test:race for non-native
  regressions; task vet/build where applicable; full task check on Linux.
  Keep Spec Kit checks local and outside CI.

G01 covers helper/text-output edges; G02 native lifecycle coverage; G03
CLI/process integration. These remain open, with no coverage percentage or
unverified hardware success inferred from compilation or checked tasks.

## Testing Policy Alignment (2026-10-20)

Existing log assertions use Testify; HTTP/controller/BLE collaborators and the
failed response writer use mockgen-generated GoMock interfaces. Taskfile core
and race checks include the native-free BLE backend. Native hardware execution
is isolated behind the hardware tag and a local-only task; no native log or
physical-state verification is inferred from the migration. Earlier source
counts and compile-only BLE evidence describe the historical snapshot.
