# Project Instructions

Read `.specify/memory/constitution.md` for the project's architecture and
behavioral contracts. This repository contains one Go controller and separate
Go modules for Task and mockgen development tooling.

## Work Boundaries

- Application work: `cmd/sunset/`, `internal/`, and root `go.mod`/`go.sum`.
  `cmd/sunset` is the composition root; keep protocol validation, HTTP handling,
  command sequencing, native BLE transport, config, and logging in their
  existing packages.
- Tooling work: `tools/task/`, `tools/mockgen/`, `Makefile`, `Taskfile.yml`, and `scripts/`.
  Tool dependencies belong in their separate module. `make tools` installs
  tools; Taskfile owns the project workflows.
- Spec Kit work: `.specify/`, `.speckit/feature-numbering/`, and generated
  agent skills (`.agents/skills/` for Codex, `.claude/skills/` for Claude Code).
  The local feature-numbering extension source is
  `.speckit/feature-numbering/`. Regenerate skills for every integration in
  `SPECKIT_INTEGRATIONS` through `task speckit:install`; do not edit one agent's
  generated copy alone. Preserve installed hooks and project customizations
  when refreshing tooling.
- User documentation: maintain both `README.md` and `README_RU.md` when
  documented behavior changes.

When work is shared across agents, agree on file ownership and communicate
changes to `controller.Link`, `bridge.Controller`, protocol/configuration types,
and Taskfile commands before dependent work integrates. These boundaries do not
require spawning agents or assigning unrelated changes to this task.

## Validation

- Format changed Go files with `gofmt`; use `task vet` and `task build` where
  applicable.
- On macOS, use `task test:core` and `task test:race` for tests that avoid native
  Bluetooth initialization; both include the mocked BLE backend. Unit tests use
  Testify and mockgen-generated GoMock interfaces; regenerate mocks through
  `task mocks:generate`. CLI execution imports `internal/ble/native` and may
  initialize CoreBluetooth. Hardware integration tests require the `hardware`
  build tag and run only locally through `task test:hardware`, outside CI and
  default checks. Do not substitute a build for device verification.
- `task check` is the Linux full suite: tests, race, vet, and build.
- Spec Kit checks are local tasks; keep them out of CI and `task check`.

## Runtime Contracts

Preserve the loopback HTTP and Stream Deck GET/POST contract, serialized whole
BLE actions, cooperative native-operation cancellation, repeated-init settings
preservation, and secret redaction. Packet transmission and connection status
are not evidence of physical lamp state. Read `internal/ble/doc.go` before
changing native Bluetooth behavior.

## Observed Conventions

Use the existing lowercase Go package names, Go identifier casing, and
underscore-separated multiword Go filenames with colocated `*_test.go` files.
No comprehensive feature-branch naming convention, numeric coverage threshold,
or additional linter configuration has been established. Feature directories
use `specs/NNN-feature-name` through the installed numbering hook.
