---
status: migrated
---

# Feature Specification: Configuration, Presets, and CLI

**Feature Directory**: `specs/003-config-presets-cli`

**Feature Branch**: Existing `develop`; migration creates no branch.

**Created**: 2026-10-20

**Status**: migrated

**Input**: Reverse-engineer detected feature 3: existing settings/presets,
initialization, generated URLs, CLI dispatch, and macOS setup/run wrappers.
This records built behavior rather than requesting implementation changes.

## Project Scope and Compatibility

Primary code is `internal/config/config.go` and the CLI portions of
`cmd/sunset/main.go`, supported by `setup.command`, `run.command`, and the public
bundled `presets.json`. Existing config tests are colocated in
`internal/config/config_test.go`. Complete main.go also contains transport and
server integration owned by earlier migrations; its full line count is not
attributed exclusively to this feature.

The [HTTP bridge](../001-streamdeck-http-bridge/spec.md) defines request/response
contracts. [BLE command execution](../002-ble-command-execution/spec.md) defines
packet validation, native connection, sequencing, and cancellation. This feature
selects and dispatches those capabilities and owns file/bootstrap behavior.
The broader logging subsystem and developer-tool installation are dependencies.
There is no database, schema migration, or frontend in scope.

Compatibility preserves existing JSON files byte-for-byte on repeated init,
access tokens, port, preset slugs/values, and generated action paths. A missing
file can be initialized independently; the entire init operation is not a
multi-file transaction. CLI/setup prompts and diagnostic text are predominantly
Russian, with English and Russian README documentation.

## User Scenarios & Testing

### User Story 1 - Initialize a New Lamp Configuration (Priority: P1)

A user supplies the lamp's explicit manufacturer identity on first setup and
receives local settings, default presets, and button URLs.

**Independent Test**: Call config.Init in t.TempDir and inspect returned data
and generated files; no native Bluetooth is imported by config tests.

1. Given missing settings, when identity is absent or malformed, then Init
   returns an error without creating settings.json.
2. Given a lowercase valid identity, when Init runs, then returned identity is
   uppercase, port defaults to 18765, a new token is generated, and six presets
   are available.
3. Given successful init through the CLI, then WriteURLs is requested and the
   data directory and URL file path are printed. This CLI path is code-derived,
   not independently exercised by existing main-package tests.

Evidence: TestFirstInitRequiresExplicitIdentity, TestInitAndMissingBrightness,
and run in main.go.

### User Story 2 - Preserve Existing Settings and Custom Presets (Priority: P1)

A user repeats setup or reuses a Python-era configuration without rotating the
token, replacing custom presets, or silently switching the lamp identity.

**Independent Test**: Seed temporary JSON files, invoke Init, and compare bytes,
returned settings/presets, and generated URLs.

1. Given existing valid settings and presets, when Init runs without identity,
   then the files retain their original bytes and the custom label/value remain.
2. Given a different supplied identity, when existing files load successfully,
   then Init rejects the conflict without rewriting the existing settings.
3. Given repeated successful init, then returned settings remain identical and
   the previously generated token and URLs remain compatible.

Evidence: TestInitPreservesPythonSettingsAndURLs,
TestFirstInitRequiresExplicitIdentity, and TestInitAndMissingBrightness.

### User Story 3 - Load Presets and Regenerate Stream Deck URLs (Priority: P1)

A user edits preset data with the server stopped, then reloads valid data and
regenerates URLs for the configured token and preset slugs.

**Independent Test**: Load fixture presets and call URLs/WriteURLs in a temporary
directory; compare expected routes and count links.

1. Given a preset with missing/null brightness or out-of-range RGB, then loading
   fails. Explicit zero brightness is distinct from missing/null in the parser;
   a dedicated positive config test for zero remains part of G01.
2. Given six defaults, then WriteURLs produces eleven links: on, off, six
   alphabetically ordered presets, and brightness 25/50/100.
3. Given existing custom presets/settings, then generated links retain their
   token, port, slug, and display labels. Direct color URLs are not generated,
   even though color is a supported CLI/HTTP command.

Evidence: the three config tests, URLs/WriteURLs, LoadPresets, and the preset
validator in protocol. Existing tests assert route membership/count; complete
ordering, permissions, and failure-path coverage remain limited (G01/G02).

### User Story 4 - Use the CLI With Explicit Data Scope (Priority: P2)

A user selects the data directory and runs init, urls, send, dry-run, inspect,
serve, help, or version using the existing command semantics.

**Independent Test**: Current evidence is main.go inspection; there are no
cmd/sunset test files. Future tests should use temporary data and fake native
boundaries rather than initializing real CoreBluetooth.

1. Global flags precede the subcommand. The default data directory is beside
   the resolved executable, while a relative --data-dir becomes absolute from
   the current working directory.
2. Non-preset dry-run resolves and prints packets without loading settings;
   preset dry-run loads only presets. It performs no explicit connection/write.
3. send loads settings/presets and uses the running HTTP service. inspect loads
   config and uses the BLE inspection path. serve initializes/loads config,
   writes URLs, and starts the service defined by migrations 001/002.
4. No arguments or help prints usage and succeeds; --version prints the bridge
   version. Invalid flags, command/arity, configuration, or operation errors
   return through main's error log and nonzero exit.

Import-time native initialization is a separate caveat: even help, init, or
otherwise non-connecting commands may create CoreBluetooth managers on macOS.

### User Story 5 - Build and Run Through macOS Wrappers (Priority: P2)

A user launches setup.command to check prerequisites, build locally, and run
init, then launches run.command to keep the service in the terminal.

**Independent Test**: Bash syntax was checked. Prompt/preflight/build/run behavior
is code-derived; there is no automated wrapper behavior suite.

1. With no script arguments and no settings.json in the script directory,
   interactive setup prompts for identity; noninteractive setup fails with an
   instruction to supply it. Existing settings suppress that prompt.
2. Setup requires Darwin, project sources, a stable suitable Go executable,
   Xcode command-line tools, clang, and a macOS SDK, then downloads dependencies,
   builds a CGO Darwin binary, and forwards arguments to `sunset ... init`.
3. Run requires Darwin and an executable sunset beside the wrapper, changes
   to that directory, and execs `./sunset serve`. No background service or
   automatic Go/Xcode/Task/Spec Kit installation is performed.

Evidence: setup.command, run.command, both READMEs; Bash syntax checks passed.

### Edge Cases

- Init normalizes its identity argument by trimming whitespace and uppercasing.
  Load validates a stored identity before uppercasing and does not silently
  rewrite its JSON representation.
- Exclusive creation protects existing files, but no multi-file transaction,
  fsync durability, rollback, or repair of a partially written new file is
  implemented. Missing defaults can be created before a later validation error.
- A conflicting identity is checked after Load succeeds. If presets were missing,
  default presets can be created before that conflict is returned; existing
  settings are still preserved.
- URL regeneration replaces only the URL file using a same-directory temporary
  file and rename; it does not replace settings/presets. Existing file modes are
  not retroactively hardened by repeated init.
- urls/send/inspect load both settings and presets. An unrelated malformed
  preset can therefore prevent send on/off or inspect from proceeding.
- Serve writes URLs before entering the server/listener path; a later startup
  failure does not undo URL generation. Startup snapshots config; hot reload
  is not implemented.
- setup's automatic prompt checks script-local settings and zero arguments; it
  does not parse --data-dir itself. Passing arguments suppresses that prompt,
  so callers must supply any required first-init identity explicitly.
- urls intentionally prints token-bearing URLs to stdout for copying. Token
  redaction of logs does not mean all CLI output hides these requested URLs.

## Requirements

### Functional Requirements

- **FR-001**: Settings contain device_identity, port, access_token. Validation
  requires six colon-separated HEX bytes, port 1024-65535, and a 24-128 character
  token containing only ASCII letters, digits, underscore, or hyphen.
- **FR-002**: First init requires an explicit identity if settings.json is
  missing. Init trims/uppercases the argument and rejects malformed input before
  creating settings; missing first identity is rejected before MkdirAll.
- **FR-003**: New settings use port 18765 and 24 random bytes encoded as unpadded
  base64 URL text, yielding a 32-character token.
- **FR-004**: JSON creation requests O_CREATE|O_EXCL and preserves an existing
  file; new settings request mode 0600 and presets 0644, subject to umask. Data
  directories are created with requested mode 0755.
- **FR-005**: Init creates only missing settings/default presets. Repeated init
  neither rotates tokens nor rewrites existing settings/presets. It validates
  loaded data rather than silently repairing malformed existing files.
- **FR-006**: Load validates settings and normalizes returned identity to
  uppercase. A differing supplied Init identity is rejected after successful
  load without rewriting existing settings.
- **FR-007**: Preset JSON distinguishes absent/null brightness from valid zero
  using a pointer; map/slug/label/RGB/brightness validity is delegated to
  protocol.ValidatePresets. Invalid data returns an error.
- **FR-008**: Missing preset data is initialized with the six defaults sunset,
  night, alarm, magic, forest, and white. Public presets.json matches the defaults
  in config.go; white is an RGB mixture, not a separate white-channel command.
- **FR-009**: URLs use configured loopback address/token. Output order is on,
  off, sorted preset slugs, brightness 25/50/100, with setup instructions and
  display labels. Six default presets produce eleven links.
- **FR-010**: WriteURLs writes and closes a private CreateTemp file in the same
  directory, renames it to streamdeck-buttons.txt, and removes leftover temporary
  output on return. Write/close/rename failures are returned; this is not a
  promise of fsync durability or whole-init rollback.
- **FR-011**: CLI data defaults beside os.Executable, using EvalSymlinks when it
  succeeds. --data-dir is resolved to an absolute path from the invocation CWD.
- **FR-012**: Global flags precede the subcommand; nonempty --identity is allowed
  only with init/serve. Only send and dry-run accept extra positional arguments;
  their action arity/value checks belong to protocol.Resolve.
- **FR-013**: init calls config.Init, configures secret-aware logging after
  successful load, writes URLs, and prints the data-directory/URL-file locations.
- **FR-014**: urls requires loaded settings/presets, regenerates the URL file,
  and prints the complete URL instructions to stdout.
- **FR-015**: dry-run resolves and prints canonical route and HEX packets without
  explicit BLE connection/write; only a preset action loads preset data, and
  settings are not required by that branch. Import-time native caveats remain.
- **FR-016**: send loads config, resolves the action, and uses an HTTP client
  with 75s timeout, no proxy, and no redirect following. It reads at most 64 KiB,
  reports non-200 responses, carries response request ID into logs, and unwraps
  url.Error to avoid including its secret-bearing URL in the connection error.
- **FR-017**: inspect loads config, uses a request-timeout context, delegates to
  Backend.Inspect, defers backend close, and prints indented JSON device/link
  information, not physical readback.
- **FR-018**: serve calls Init and WriteURLs before entering the already-migrated
  HTTP/controller lifecycle. It does not add config hot reload.
- **FR-019**: Help/no-command usage succeeds without loading configuration;
  --version prints bridge.Version before command dispatch.
- **FR-020**: CLI failures are logged to stderr and main exits 1. Loaded tokens
  configure log redaction; explicit urls output still includes the user's URLs.
- **FR-021**: setup.command checks Darwin, project sources, stable numeric Go
  version suitable for Go 1.25+, Xcode tools, clang, and SDK. Its first-run
  identity prompt is limited to no arguments plus missing script-local settings;
  failures report guidance and wait for Enter only when stdin is a terminal.
- **FR-022**: Setup uses GOTOOLCHAIN=local, downloads modules, builds sunset with
  CGO_ENABLED=1, GOOS=darwin and GOHOSTARCH, then runs `./sunset "$@" init`.
  It forwards user arguments and preserves existing config through Init.
- **FR-023**: run.command requires Darwin and executable ./sunset, changes to
  its own directory, prints foreground-running guidance, and execs serve.
- **FR-024**: Both READMEs describe compatible setup/CLI/Stream Deck use and
  physical-state limits. Root settings.json, streamdeck-buttons.txt, and binary
  sunset are ignored; custom data locations need their own exclusion. Wrappers
  do not install Go, Xcode, Task, Spec Kit, or a background service.

### Interfaces and Effects

| Interface | File/network/device effect |
|-----------|----------------------------|
| config.Init / Load / LoadPresets | Create missing defaults or load/validate JSON; no native dependency |
| config.URLs / WriteURLs | Render button text or replace only its output file |
| init / urls | Local config and URL operations; import-time CoreBluetooth caveat |
| dry-run | Packet preview; preset-only data read when applicable; no explicit lamp operation |
| send | HTTP request to the existing server; eventual device effect belongs to 001/002 |
| inspect | Native connection/discovery without lighting writes, as specified in 002 |
| serve | URL generation and HTTP/BLE lifecycle, as specified in 001/002 |
| setup.command | Dependency download, local build, and init; not run during migration |
| run.command | Foreground service execution; not run during migration |

### Key Entities

Settings carries manufacturer identity, port, and token. Preset maps stable slugs
to label, three RGB integers, and brightness. Data directory contains settings,
presets, and generated button text. CLI parses global flags/subcommands and
composes configuration, protocol, HTTP, and BLE. macOS wrappers select a local
Go toolchain and orchestrate setup/run without managing a system service.

### Verification Evidence

Three config Test functions exist and executed successfully during preparation
on 2026-10-20. Both wrappers passed `/bin/bash -n`. A read-only comparison of
public presets.json with all six Go default literals matched. No cmd/sunset
unit tests or wrapper behavior tests were found. The CLI/wrappers were not
executed, so no real settings, server, or lamp state was changed.

## Success Criteria

- **SC-001**: Missing/malformed first identity creates no settings file in
  TestFirstInitRequiresExplicitIdentity (executed; FR-002).
- **SC-002**: That test normalizes lowercase identity and proves a conflict does
  not rewrite existing settings/token bytes (executed; FR-002, FR-006).
- **SC-003**: Repeated Init returns identical settings, a 32-character token,
  and six presets in TestInitAndMissingBrightness (executed; FR-003, FR-005).
- **SC-004**: Seeded Python-era JSON files retain exact bytes and custom preset
  label/brightness in TestInitPreservesPythonSettingsAndURLs (executed; FR-005).
- **SC-005**: Expected legacy on/off/preset/brightness routes retain configured
  token/port in TestInitPreservesPythonSettingsAndURLs (executed; FR-009).
- **SC-006**: Written default button text contains eleven links in
  TestInitAndMissingBrightness (executed; FR-009, FR-010).
- **SC-007**: Missing/null preset brightness and invalid RGB fail loading in
  TestInitAndMissingBrightness (executed; FR-007).
- **SC-008**: Bundled preset values equal all six Go defaults and both wrappers
  pass Bash syntax checks (read-only/static checks; FR-008, FR-021-FR-023).

## Assumptions and Verification Limits

Users supply their own identity; no real device identifier or token is copied
into migrated artifacts. Existing fixture identities/tokens in tests are
synthetic. Data files are intended to be edited while the server is stopped;
custom directories must be consistently selected for each command.

Runtime config/CLI dependencies remain Go 1.25.0+ and, on macOS, CGO/Xcode and
Bluetooth permission. Task/Spec Kit developer-tool installation is a separate
feature, not a prerequisite introduced into user setup by this migration.
CLI import of ble may initialize CoreBluetooth even on help/dry-run. Existing
packet-level ON/OFF hardware evidence does not verify the entire Go path or
RGB/brightness; no new device verification was performed.

## Identified Gaps

- **G01 - Configuration boundary/format coverage**: Current tests do not
  enumerate settings port/token bounds, malformed settings/preset JSON, all
  slug/label edge cases, explicit zero brightness through config.LoadPresets,
  and full URL ordering/metadata. Supporting protocol tests cover some RGB and
  brightness validation, not every configuration-file behavior. Follow-up: add
  focused table-driven fixtures to internal/config/config_test.go.
- **G02 - Filesystem/error/permission coverage**: No focused config tests assert
  creation modes, existing-mode behavior, failed writes/close/rename cleanup,
  or partial-init results. Exclusive creation and temporary rename behavior are
  code-derived. Follow-up: add controlled filesystem-failure and output-mode
  cases; document or separately design any desired transactional changes.
- **G03 - CLI and wrapper behavior coverage**: There are no cmd/sunset test
  files or automated wrapper behavior tests for flag ordering, data-dir rules,
  dry-run/command dispatch, prompt/preflight/failure paths, or execution
  handoff. Follow-up: add a CLI/native seam and shell fixtures with controlled
  Go/system commands, without using real settings or starting BLE. This is
  related to the integration gap recorded by feature 001, not an implemented fix.

These are verification gaps, not evidence that every untested path is faulty.
The current nontransactional init behavior is stated explicitly rather than
silently replaced with stronger guarantees.
