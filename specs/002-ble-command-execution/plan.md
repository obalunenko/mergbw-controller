---
status: migrated
---

# Implementation Plan: BLE Connection and Command Execution

**Feature Directory**: `specs/002-ble-command-execution`

**Branch**: Existing `develop`; no branch creation.

**Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

Reconstruct the existing three-boundary implementation: pure protocol validation
and encoding; controller serialization/retry over Link; native BLE connection,
discovery, and writes. The production adapter lives in cmd/sunset. The
[HTTP bridge](../001-streamdeck-http-bridge/spec.md) consumes these boundaries
and retains its separately migrated request/response contract.

This is documentation of implemented behavior, not a plan to reimplement the
transport or to treat pending hardware verification as complete.

## Technical Context

- **Language/Version**: Go 1.25.0+ application; Go 1.27.0 for separate tooling.
- **Primary dependency**: tinygo.org/x/bluetooth v0.16.0; standard-library
  context, synchronization, timers, errors, encoding, and log/slog.
- **Storage**: In-memory connection/controller state and externally supplied
  config/presets; no database or new persistent schema.
- **Testing**: Go testing; table-driven vectors and advertisements; fake Link
  for deterministic command ordering, failures, cancellation, and log events.
- **Platform**: darwin/linux backend build constraint; macOS CoreBluetooth
  needs CGO and Xcode tools; Linux uses the upstream backend documented in doc.go.
- **Scale**: One process, one DefaultAdapter/Backend, one persistent lamp link,
  one controller permit for complete actions.
- **Timing**: Defaults: scan 12s, connect 12s, packet gap 80ms, retry pause 200ms,
  backend drain 80ms. Native calls can exceed context deadlines.
- **Performance goals**: No project throughput/latency SLO is established.

## Constitution Check

| Principle | Implementation evidence |
|-----------|-------------------------|
| Package boundaries | protocol uses standard library; controller imports protocol/logging and depends on Link; ble imports native Bluetooth and logging |
| Local contract | Canonical absolute actions preserve existing packet/HTTP compatibility; 001 defines HTTP behavior |
| Effects and cancellation | Native calls are synchronous; request cancellation is checked between stages; uncertain outcomes suppress production retry |
| Configuration and secrets | Explicit identity; logs use request context and global redaction configuration; source config is not rewritten |
| Verification | Native-test compilation, fake-backed execution, and device evidence are distinguished; G01-G03/H01 remain explicit |
| Tooling | No CI or Taskfile change; Spec Kit tasks remain local |

No new architecture exception is introduced. Code-derived behavior without test
execution is not represented as demonstrated native or physical behavior.

## Project Structure and Scope Metrics

| Scope | Files | Lines | Interpretation |
|-------|-------|-------|----------------|
| Primary implementation | 3 | 850 | protocol.go 133, controller.go 153, backend.go 564 |
| Transport documentation | 1 | 36 | internal/ble/doc.go |
| Primary tests | 3 | 697 | protocol 87, controller 375, BLE 235; fourteen Test functions |
| Supporting implementation | 3 | 376 | Complete main.go and two logging helper files; only relevant sections support this feature |
| Database migrations | 0 | 0 | None |

Counts include comments/blank lines and describe the snapshot, not a quality
score. The nine protocol/controller test functions ran; the five native BLE
functions were inspected and compiled only.

```text
internal/protocol/protocol.go       # Action/Preset, validation, checksum/packets
internal/protocol/protocol_test.go
internal/controller/controller.go   # Link and whole-action gate
internal/controller/controller_test.go
internal/ble/backend.go             # identity, scan, GATT, Write, Close, callback
internal/ble/backend_test.go
internal/ble/doc.go                 # audited native/cancellation limits
cmd/sunset/main.go                  # lampLink, CanRetry, newBackend, lifecycle
internal/logging/context.go
internal/logging/redact.go
specs/001-streamdeck-http-bridge/    # consuming HTTP feature; unchanged
```

Migration creates only spec.md, plan.md, and tasks.md in this feature directory.
It does not change source, branch, settings, active-feature pointer, or feature
001 artifacts.

## Reconstructed Implementation by Affected Boundary

### 1. Protocol and action integrity

Resolve validates arity/value ranges, canonicalizes routes, and creates absolute
packet sequences. The frame header is 55/command/FF/length; checksum repeatedly
folds carry into an 8-bit sum and complements the result. Commands use 01 for
power, 03 for RGB, and 05 for brightness. ValidatePresets additionally checks
map/slugs/labels; Resolve's preset branch validates RGB and brightness rather
than redoing startup-map checks.

Evidence: protocol.go and its three test functions. This package has no HTTP,
configuration, native Bluetooth, or controller import.

### 2. Identity, discovery, and persistent link

New parses explicit identity and validates/defaults timeout values. Matching
requires service 3519 and six manufacturer payload bytes, then optional type 5
and empty/LT-06 model checks. Company ID is separate metadata and local name is
not an identity key.

Backend.connectLocked checks context/fatal state, reuses a currently ready link,
or closes stale state and enables the adapter once. It scans, bounds the native
Connect timeout by remaining request time, rejects an empty/wrong device, and
requires exactly one FFF0 service and one FFF3 characteristic. The GATT
characteristic list is sorted for Info; write mode is without_response, with
property verification/readback flags left false.

scanLocked records only the first match. Its one stopper goroutine responds to
match/cancellation, retries StopScan every 5ms when necessary, and is joined
before the scan method returns. A parent cancellation returns its context error;
scan-only expiry after an error-free native Scan return reports ErrNotFound.
Native scan errors otherwise retain their wrapped classification. Native completion can exceed configured
timeouts. These lifecycle paths are code-derived and retain the G01 limitation.

### 3. Exclusive command execution and recovery

Controller uses a one-permit channel for Connect, Execute, and Close. Acquire
checks cancellation before use even if permit acquisition races cancellation.
Execute rejects empty/closed work, connects, waits for the 80ms write gap, and
writes every packet while holding the permit. It records lastWrite after each
Write return, including errors.

On the first retryable failure with a live context, it closes Link, waits 200ms,
then reconnects and restarts packet one. No third attempt occurs; a Close failure
joins causes and ends retry. lampLink.CanRetry filters cancellation, deadline,
incompatibility, permission, restart-required, uncertain writes, and invalid
packets using errors.Is. Fake-Link tests assert retry mechanics but do not test
that production typed-error classifier (G03).

### 4. Native write and cooperative cancellation

Write validates length 1-20 before locking, clones the bytes, and checks context,
fatal state, handles, and current device readiness. It calls
WriteWithoutResponse synchronously and updates backend lastWrite. Cancellation
after return reports uncertainty; an otherwise error-free short write also
reports uncertainty. Other native errors pass through friendlyError; this is
not a physical acknowledgement or proof that a partial/error write had no effect.

The backend mutex can delay direct canceled calls; the controller gate handles
queued cancellation. No background writer outlives the method. Darwin discovery
errors containing the literal lowercased word fragment `timeout` set sticky
ErrNeedsRestart; permission-like text gets ErrPermission. These are upstream
text heuristics rather than typed native error taxonomies.

### 5. Inspection, close, and callback isolation

Inspect delegates to Connect without adding writes, reads, or notification
subscriptions. infoLocked copies the exposed slices. Backend.Close clears
readiness and the write handle, waits the remaining 80ms drain, then requests
disconnect. Already-disconnected responses are tolerated; other failures retain
a device handle for later cleanup. Sticky fatal state and the process-global
adapter remain intact.

Controller.Close is terminal before gate acquisition; an expired wait does not
make the controller reusable or abort its active native operation. This is a
different lifetime from Backend.Close's reusable link release.

The callback uses atomic target/readiness fields, never Backend.mu or mutable
Info, and logs the first observed loss of a ready target link without a request
logger. Tests assert the callback completes even while the command mutex is held.

## Complexity Assessment

Three primary packages form a small dependency graph: controller -> protocol
and logging, ble -> logging plus native Bluetooth, and protocol -> standard
library. main composes them through lampLink. Within the primary graph, internal
imports are one edge deep; production calls also cross Link into native API
and asynchronous OS callbacks. The 564-line backend owns most platform and
lifetime complexity. Two-layer locking, permit cancellation, replay/uncertainty,
scan stopper ownership, callback isolation, and reusable-versus-terminal close
are the main factors; line count alone does not describe their risk.

## Validation Evidence and Remaining Work

- **Executed**: `go test ./internal/protocol ./internal/controller` passed on
  2026-10-20; nine top-level test functions and their subtests ran.
- **Compiled only**: `go test -c -o <temporary-path>/ble.test ./internal/ble`
  succeeded. The binary was not executed or committed. CoreBluetooth package
  initialization on macOS is not treated as a harmless offline test step.
- **Not performed**: Real scanning, connection, writes, device readback, or new
  RGB/brightness/Go-path physical verification. README evidence remains H01.
- **Existing session evidence**: Earlier brownfield validation passed core/race
  checks, vet, and a controller build. Those checks were not all rerun for this
  documentation-only migration.
- **Future validation when code changes**: task test:core, task test:race,
  task vet, task build; task check is the Linux full suite. Keep Spec Kit out of CI.

G01 covers native lifecycle paths; G02 constructor/write bounds; G03 typed retry,
connection/close errors, pacing, and shutdown. H01 tracks the separate lack of
physical device evidence. None is represented as a checked-off fix.

## Complexity Tracking

No constitution violation or new dependency is proposed. Coverage gaps and
platform limits are explicit rather than resolved by altering the migrated code.

## Testing Policy Alignment (2026-10-20)

New(Config, Adapter) makes the native dependency explicit. transport.go defines
the synchronous interfaces; native/adapter.go owns DefaultAdapter and translates
native handles/results without changing operation ordering or detaching work.
Unit tests use Testify and generated GoMock implementations, including BLE in
Taskfile core/race packages. task mocks:generate uses pinned tools/mockgen.

native/hardware_test.go is guarded by hardware plus platform tags. The separate
local task test:hardware requires MERGBW_DATA_DIR and rejects CI. Its Inspect
case connects/discovers without lamp writes; hardware evidence remains pending.
Historical counts and compile-only evidence above describe the earlier snapshot,
not the current unit-test execution boundary. Remaining G01-G03 work is still
tracked by BUG-001 through BUG-003; this migration does not close those reports.
