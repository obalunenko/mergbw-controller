---
status: migrated
---

# Tasks: Configuration, Presets, and CLI

**Input**: [spec.md](spec.md) and [plan.md](plan.md)

**Feature Directory**: `specs/003-config-presets-cli`

**Status**: migrated

This is a checklist of built code, existing tests, and documentation. Checked
items do not mean missing tests were added or CLI/wrappers/hardware exercised.
All three config tests ran; wrapper syntax and public default-data consistency
were checked. Known gaps remain separately open.

## Phase 1: User Story 1 - Initialize Configuration (P1)

- [x] T001 [US1] Define Settings fields, port default, and identity/port/token
  validation in `internal/config/config.go`.
- [x] T002 [US1] Implement exclusive JSON creation and requested private/public
  modes in `internal/config/config.go::createJSON`.
- [x] T003 [US1] Require first identity, create the data directory, and generate
  the random URL-safe token/default settings in `internal/config/config.go::Init`.
- [x] T004 [US1] Normalize supplied identity and return validated initialized
  settings/presets in `internal/config/config.go`.
- [x] T005 [US1] Implement first-init/malformed-identity/no-settings and conflict
  preservation assertions in `internal/config/config_test.go::TestFirstInitRequiresExplicitIdentity`.

## Phase 2: User Story 2 - Preserve Existing Data (P1)

- [x] T006 [US2] Preserve existing JSON and fill only missing defaults through
  O_EXCL creation in `internal/config/config.go`.
- [x] T007 [US2] Load/validate settings and normalize returned identity in
  `internal/config/config.go::Load`.
- [x] T008 [US2] Reject a differing supplied identity after successful load
  without rewriting existing settings in `internal/config/config.go::Init`.
- [x] T009 [US2] Implement exact-byte legacy settings/preset and URL compatibility
  assertions in `internal/config/config_test.go::TestInitPreservesPythonSettingsAndURLs`.

## Phase 3: User Story 3 - Presets and Button URLs (P1)

- [x] T010 [US3] Define the six default presets in `internal/config/config.go`
  and ship matching public data in `presets.json`.
- [x] T011 [US3] Distinguish missing/null brightness from valid zero using the
  raw pointer representation in `internal/config/config.go::LoadPresets`.
- [x] T012 [US3] Delegate complete preset validation to the existing
  `internal/protocol/protocol.go::ValidatePresets` from config loading.
- [x] T013 [US3] Render stable token-bearing URLs in on/off, sorted-preset, and
  brightness order in `internal/config/config.go::URLs`.
- [x] T014 [US3] Replace URL output using a same-directory temp file, checked
  write/close, rename, and deferred cleanup in `internal/config/config.go::WriteURLs`.
- [x] T015 [US3] Implement repeated-init/token/default-count, eleven URL links,
  and invalid-preset loading assertions in
  `internal/config/config_test.go::TestInitAndMissingBrightness`.

## Phase 4: User Story 4 - Existing CLI Commands (P2)

- [x] T016 [US4] Resolve executable-relative/explicit data scope, parse global
  flags, and validate command/arity restrictions in `cmd/sunset/main.go::run`.
- [x] T017 [US4] Dispatch init/urls with appropriate config loads, output, and
  secret-aware logging setup in `cmd/sunset/main.go`.
- [x] T018 [US4] Implement the early dry-run branch with preset-only loading
  when required and packet preview in `cmd/sunset/main.go`.
- [x] T019 [US4] Compose the existing HTTP send client with config/action
  resolution and error handling in `cmd/sunset/main.go`.
- [x] T020 [US4] Dispatch inspect/serve to existing native/server boundaries,
  expose help/version, and handle main errors in `cmd/sunset/main.go`.

## Phase 5: User Story 5 - macOS Setup and Run (P2)

- [x] T021 [US5] Implement script-local setup, first-run identity prompting, and
  Darwin/Go/Xcode/clang/SDK preflight checks in `setup.command`.
- [x] T022 [US5] Download modules, build a CGO Darwin executable with the selected
  local Go, and forward arguments to init with failure handling in `setup.command`.
- [x] T023 [US5] Check the local executable and exec the foreground service
  with terminal guidance in `run.command`.
- [x] T024 [US5] Document setup/CLI/URL/privacy/device limits in `README.md` and
  `README_RU.md`, with root runtime-file exclusions in `.gitignore`.

## Dependencies and Traceability

T001-T004 supply the config model and initialization behavior tested by T005.
T006-T008 preserve/load existing data, with legacy fixtures in T009. T010-T014
supply presets and generated URLs, with repeated-init/output cases in T015.
T016-T020 expose the existing application through CLI dispatch; T021-T024
orchestrate and document its macOS installation/run workflow. This is a
reconstructed dependency order, not a claim about commit chronology.

FR-001-FR-006 map to T001-T009; FR-007-FR-010 to T010-T015; FR-011-FR-020 to
T016-T020; FR-021-FR-024 to T021-T024. HTTP and native internals remain linked
to features 001/002 rather than represented as newly implemented work here.

## Known Gaps (Not Completed Tasks)

| Gap | Missing evidence | Follow-up |
|-----|------------------|-----------|
| G01 | Settings bounds/JSON, remaining preset format cases, zero brightness through LoadPresets, complete URL order | Add focused config fixtures to config_test.go |
| G02 | File modes, filesystem failure/cleanup paths, partial-init outcomes | Controlled filesystem tests; separately specify any desired transactional changes |
| G03 | CLI flags/data scope/dispatch and wrapper prompts/preflight/execution | Main-package tests behind a fake native boundary and a shell fixture harness |

All 24 historical tasks are checked because the corresponding artifacts exist.
The three gaps remain open. Existing init is not a multi-file transaction and
migration does not change that contract or verify physical device behavior.

## Verification Record

`go test ./internal/config` passed on 2026-10-20. Both wrappers passed native
Bash syntax checking. Public presets.json matched all six Go defaults. No actual
runtime settings/button file was read or changed; no CLI/server/wrapper/lamp
operation or branch creation was performed.

## Phase 6: Testing Policy Migration

- [x] T025 Migrate all three existing configuration Test functions to Testify
  while preserving first-init validation, exact-byte settings/preset retention,
  stable tokens/URLs, link count, and invalid-preset cases.
- [x] T026 Document Testify/GoMock dependencies, pinned mockgen generation,
  native adapter ownership, and local hardware-test usage in both READMEs.

These tasks align Constitution V-VI without closing G01-G03 or adding CLI tests.
