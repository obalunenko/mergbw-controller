---
description: "Task list template for MeRGBW Controller feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[NNN-feature-name]/`

**Prerequisites**: plan.md and spec.md; research.md, data-model.md, and contracts/
when relevant to the feature.

**Organization**: Keep tasks grouped by independently testable user stories,
ordered by their priorities. Within a story, follow the actual package
dependencies. Include only affected boundaries; existing packages and tools do
not need to be recreated for every feature.

**Tests**: Choose behavioral checks appropriate to the change and the spec's
acceptance scenarios. The repository uses Go `testing`, `httptest`, table-driven
cases, and fake interfaces. Do not impose a numeric coverage threshold or strict
TDD process that the feature did not request.

## Format: `[ID] [P?] [Story] Description`

- IDs are sequential (`T001`, `T002`, ...).
- `[P]` means independent files with no unresolved dependencies; it does not
  itself request or authorize spawning additional agents.
- `[US1]`, `[US2]`, etc. link implementation and tests to the feature's stories.
- Include exact paths, observable completion criteria, and prerequisite task IDs
  where needed.

## Path Conventions

- CLI/composition: `cmd/sunset/main.go`.
- HTTP: `internal/bridge/`; command sequencing: `internal/controller/`.
- Packet encoding/validation: `internal/protocol/`; transport: `internal/ble/`.
- JSON configuration/URLs: `internal/config/`; diagnostics: `internal/logging/`.
- Go tests live beside implementation in `*_test.go` files.
- Development tool dependencies: `tools/task/go.mod` and `tools/task/go.sum`.
- Workflows: `Taskfile.yml`; tool bootstrap: `Makefile`.
- Documentation: `README.md` and `README_RU.md`.

<!--
The tasks below are examples. Replace them with tasks derived from spec.md and
plan.md; remove unrelated phases and examples. Never add database, frontend,
or service setup without a feature requirement. No fixed number of stories or
package phases is required.
-->

## Phase 1: Feature Preparation

**Purpose**: Resolve only prerequisites needed for this change.

- [ ] T001 Review affected interfaces, compatibility, and acceptance scenarios
      in `specs/[NNN-feature-name]/spec.md` and `plan.md`
- [ ] T002 Install pinned tools with `make tools` if the development environment
      needs them; change dependencies only when the plan requires it

## Phase 2: Shared Prerequisites (only when required)

**Purpose**: Establish changes required by more than one story.

- [ ] T003 [Define the shared protocol/configuration/interface change, exact
      file under `internal/`, and dependent stories; omit if none]

Do not block independent stories behind unrelated infrastructure work.

## Phase 3: User Story 1 - [Title] (Priority: P1)

**Goal**: [Observable CLI, HTTP/Stream Deck, lamp, or tooling outcome]

**Independent Test**: [Automated scenario and/or separate device check]

### Behavioral Verification

- [ ] T004 [P] [US1] [Relevant packet/validation regression] in
      `internal/protocol/protocol_test.go` (omit if unaffected)
- [ ] T005 [P] [US1] [Relevant request, concurrency, configuration, or logging
      scenario] in the affected package's `*_test.go` file

### Implementation by Affected Boundary

- [ ] T006 [US1] [Protocol or JSON compatibility change] in
      `internal/protocol/protocol.go` or `internal/config/config.go`
- [ ] T007 [US1] [Sequencing or native BLE lifecycle change] in
      `internal/controller/controller.go` or `internal/ble/backend.go`
- [ ] T008 [US1] [HTTP/CLI contract or context/logging change] in
      `internal/bridge/http.go`, `cmd/sunset/main.go`, or `internal/logging/`

Use exact files and task dependencies from the plan; omit unaffected packages.
Do not make packet creation depend on the concrete native backend.

**Checkpoint**: [Acceptance evidence; distinguish automated behavior from
physical lamp verification.]

## Further User Stories

[Repeat the story section for US2, US3, etc., in priority order with unique
sequential task IDs and explicit inter-story dependencies.]

## Final Phase: Integration and Documentation

- [ ] T009 [Update applicable CLI, HTTP, preset, or setup documentation] in
      `README.md` and `README_RU.md`
- [ ] T010 Format changed Go files with `gofmt` and run relevant validation:
      `task test:core`, `task test:race`, `task vet`, and `task build`
- [ ] T011 [On Linux where full validation is required] Run `task check`
- [ ] T012 [If BLE/device behavior changes] Record actual LT-06 verification
      steps/results and remaining limits in the feature's `quickstart.md`

For local Spec Kit tooling changes, include `task speckit:update:test` and
installer syntax checks when relevant. They are not CI or `task check` gates.
macOS full tests and CLI execution can initialize CoreBluetooth; core tests and
a successful build do not prove physical lamp behavior.

## Dependencies and Execution Order

[Record the actual prerequisite task IDs. Implement only the required chain:
protocol/configuration, controller/transport, HTTP/CLI integration, then relevant
validation and documentation. Interface changes must be communicated to their
callers and test doubles before integration.]

Parallel work is appropriate only for independent files and stable interfaces.
Avoid concurrent edits to the same file and preserve unrelated working changes.
