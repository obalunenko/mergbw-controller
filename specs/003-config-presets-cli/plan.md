---
status: migrated
---

# Implementation Plan: Configuration, Presets, and CLI

**Feature Directory**: `specs/003-config-presets-cli`

**Branch**: Existing `develop`; no branch creation or application changes.

**Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

Reconstruct existing local file/bootstrap and command-dispatch behavior.
internal/config owns JSON and generated URL text; cmd/sunset selects data scope
and delegates commands; macOS wrappers check tools, build locally, and run the
foreground application. [HTTP behavior](../001-streamdeck-http-bridge/spec.md)
and [BLE behavior](../002-ble-command-execution/spec.md) remain separately
specified dependencies. This is documentation of built work.

## Technical Context

- **Language/Version**: Go 1.25.0+ application; Bash 3.2-compatible macOS wrappers.
  Development tools use a separate module and do not become runtime dependencies.
- **Dependencies**: Standard-library JSON/filesystem/random/base64/flags/path
  handling; protocol.ValidatePresets/Resolve; native BLE/HTTP composition through
  existing packages. No new library, database, or schema is introduced.
- **Storage**: settings.json, presets.json, streamdeck-buttons.txt in a selected
  directory. Root token-bearing runtime files are ignored by Git.
- **Testing**: Go testing with t.TempDir, file-byte comparisons, URL assertions;
  wrapper syntax checks. CLI has no colocated main-package test file.
- **Platform**: Primary macOS build/launch wrappers; config tests are independent
  of native Bluetooth and can run offline after dependencies are available.
- **Constraints**: Preserve existing files/tokens/slugs; require explicit first
  identity; do not claim init is transactional or native initialization absent.
- **Performance**: No file-size/throughput/latency SLO is established.

## Constitution Check

| Principle | Evidence |
|-----------|----------|
| Code boundaries | Config imports protocol, not native BLE; main composes commands; wrappers are covered by AGENTS Tooling work |
| Compatibility | O_EXCL creation and existing-file loads preserve user bytes, token, preset slugs, and configured URLs |
| Effects | send/inspect/serve delegate to 001/002; dry-run performs no explicit device command, with import-time caveat |
| Secrets | New private settings/URL output, root Git exclusions, and token-aware logging; urls intentionally prints copyable URLs |
| Verification | Three executed config tests, static preset comparison, Bash syntax checks; G01-G03 expose untested behavior |
| Tooling/CI | No module/workflow/CI changes or new Spec Kit gates |

No new architecture exception is introduced. Partial initialization is an
existing behavior, not a claim of conformance to a nonexistent transaction rule.

## Project Structure and Scope Metrics

| Scope | Files | Lines | Interpretation |
|-------|-------|-------|----------------|
| Primary Go files | 2 | 518 | config.go 197; complete main.go 321, including shared lifecycle code |
| Shell wrappers | 2 | 119 | setup.command 95; run.command 24 |
| Primary tests | 1 | 101 | config_test.go; three Test functions |
| Bundled data | 1 | 32 | Public presets.json with six presets |
| Supporting protocol source/tests | 2 | 220 | Validation/packet dependency also specified by feature 002 |
| Database migrations | 0 | 0 | None |

Counts include comments/blank lines and are snapshot metrics, not a quality or
exclusive-ownership score. Portions of main.go implement already-migrated HTTP
and BLE composition; they are not newly attributed to configuration alone.

```text
internal/config/config.go
internal/config/config_test.go
cmd/sunset/main.go
setup.command
run.command
presets.json
internal/protocol/protocol.go       # shared validation dependency
internal/protocol/protocol_test.go
README.md
README_RU.md
.gitignore
specs/001-streamdeck-http-bridge/    # unchanged dependency contract
specs/002-ble-command-execution/     # unchanged dependency contract
```

Only this feature's spec.md, plan.md, and tasks.md are created by migration.
No source, user runtime files, branch, active-feature pointer, or previous
migration artifacts are modified.

## Reconstructed Implementation by Boundary

### 1. Settings initialization and preservation

Settings.Validate checks identity regex, port range 1024-65535, and token regex
length 24-128. Init trims/uppercases supplied identity, rejects missing first
identity before creating the directory, then creates only missing files.
New settings use crypto/rand's 24 bytes, base64.RawURLEncoding, port 18765, and
requested mode 0600. createJSON uses O_EXCL and treats an existing file as
preserved. New presets request 0644; directory creation requests 0755.

Init does not rewrite existing files to normalize their formatting or modes.
It loads and validates existing settings/presets before checking a supplied
identity conflict. Creating missing presets before a later load/conflict failure
is possible. JSON creation is direct-to-new-file, not a transactional temp/rename
operation; no partial-file repair or fsync rollback is implemented.

### 2. Preset loading and URL output

LoadPresets parses brightness with *int to distinguish missing/null from zero,
then calls protocol.ValidatePresets for map/slug/label/RGB/range validation.
Bundled presets.json equals the six defaults in config.go. Manual editing is
supported with the service stopped; hot reload is not implemented.

URLs constructs the configured token-bearing base URL, writes on/off, presets
sorted by slug, and brightness 25/50/100. Six defaults produce eleven links.
WriteURLs uses os.CreateTemp in the destination directory (private initial mode),
writes/closes, then renames into streamdeck-buttons.txt, with deferred removal
of any remaining temp file. Existing settings/presets are not URL-generation
outputs. Error cleanup, permissions, full ordering, and durability are not all
asserted by the existing tests (G01/G02).

### 3. CLI data scope and dispatch

run obtains os.Executable and uses EvalSymlinks when available, then defines
global data-dir, identity, and version flags using flag.ContinueOnError.
Version/help return without config loads; no command prints usage. Relative
data-dir becomes absolute from the invocation directory. Nonempty identity is
limited to init/serve; extra positional arguments are limited to send/dry-run.

init/serve call Init. urls/send/inspect call Load, including both settings and
presets. Loaded tokens configure log redaction. init/urls write button text;
urls also prints it. dry-run is an early branch before normal config loading,
loads only presets when needed, resolves an action, and prints packets.

send uses the existing HTTP client (75s timeout, no proxy/redirect, 64 KiB read
limit) and unwraps url.Error for safer error logging. inspect uses a request
context and deferred backend close, printing indented Info. serve writes URLs
before entering the lifecycle documented by 001/002. main logs failures to
stderr and exits 1. There are no cmd/sunset tests for this dispatch/lifecycle
(G03); import-time CoreBluetooth initialization can occur before run is called.

### 4. macOS setup/run wrappers

Both scripts change to their own physical directory and report failures through
a helper that waits for Enter only when stdin is a TTY. setup first checks
Darwin/source presence, then prompts for identity only when script-local settings
are missing and no arguments were supplied. Argument-bearing invocations bypass
that prompt; --data-dir is not parsed by the shell wrapper.

Setup searches `go`, `/usr/local/go/bin/go`, `/opt/homebrew/bin/go`, and
`/usr/local/bin/go`, accepting numeric stable versions with Go major >1 or major
1/minor >=25. It uses GOTOOLCHAIN=local, verifies Xcode selection, clang and SDK,
downloads modules, builds a CGO Darwin binary for GOHOSTARCH, and forwards all
arguments before appending init. It does not install Go/Xcode or background jobs.
run checks Darwin and executable sunset, prints foreground-running guidance,
and replaces itself with `./sunset serve`.

These runtime paths were inspected, not executed. Wrappers passed native
`/bin/bash -n`; no shell behavior harness exists (G03).

## Complexity Assessment

Configuration has one concrete internal dependency, protocol; the CLI composes
all application boundaries, so its complete file is included as context rather
than treated as a configuration-only module. The critical interactions are
exclusive file creation, independent missing-file recovery, identity checks,
pointer-based optional JSON values, same-directory URL replacement, global flag
ordering, executable-relative data, and shell/toolchain environment selection.
No new abstraction, dependency, frontend, or persistence layer is introduced.

## Validation Evidence and Remaining Work

- **Executed**: `go test ./internal/config` passed on 2026-10-20; all three
  existing config Test functions ran.
- **Static checks**: `/bin/bash -n setup.command run.command` passed. A read-only
  comparison of public presets.json with parsed Go default literals matched all
  six label/RGB/brightness records.
- **Not executed**: CLI commands, setup/run scripts, server, or native BLE
  operations; actual token-bearing runtime files were not inspected or changed.
- **Existing context**: Earlier migrations compiled the application/BLE tests
  and ran protocol/controller/bridge tests. No full-suite rerun is claimed here.
- **Future relevant validation**: task test:core, task test:race, task vet,
  task build; full task check on Linux. Keep Spec Kit checks local.

G01 covers validation/format/ordering cases; G02 filesystem failures/permissions
and partial-init states; G03 CLI/wrapper behavior. These remain open in spec.md
and tasks.md. Desired behavior changes should be specified separately rather
than silently inserted during migration.

## Complexity Tracking

No constitution exception is proposed. Existing nontransactional behavior and
incomplete test coverage are stated explicitly; migration does not repair them.

## Testing Policy Alignment (2026-10-20)

Existing config test assertions are migrated to Testify. Root go.mod/go.sum
own test libraries; mockgen generation is owned by tools/mockgen and the
Taskfile mocks:generate task. The executable now supplies native.DefaultAdapter
to ble.New; CLI commands and wrappers retain their existing behavior. README.md
and README_RU.md describe the new test/tooling workflows. The earlier scope
metrics and validation record remain historical migration evidence.
