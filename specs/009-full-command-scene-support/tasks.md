---
description: "Task list for full command and built-in scene support"
---

# Tasks: full command and built-in scene support

**Input**: Design documents from `/specs/009-full-command-scene-support/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/scenes.md](contracts/scenes.md),
[quickstart.md](quickstart.md).

**Organization**: Phase 2 builds the scene catalog that all three stories
share. US1 makes scenes runnable from CLI and HTTP. US2 adds the Stream Deck
action and links. US3 adds documentation and the verification record.

**Tests**: The spec's Verification Evidence asks for automated frame,
validation, HTTP, preemption, URL and plugin tests, so they are included. Go
tests use Testify; bridge/controller tests reuse the existing generated GoMock
mocks (no interface changes, no `task mocks:generate`).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Feature Preparation

- [x] T001 Read `specs/009-full-command-scene-support/contracts/scenes.md` and
      `internal/protocol/protocol.go` `Resolve`/`packet`. Confirm that
      `packet(0x06, 0x87)` yields `55 06 FF 06 87 17` (matches the contract),
      so no checksum change is needed. Go/plugin dependencies stay as they are.

## Phase 2: Shared Prerequisites (scene catalog)

**Purpose**: The catalog and selector parsing are used by US1 (Resolve), US2
(URLs) and US3 (docs). Blocks all stories.

- [x] T002 Create `internal/protocol/scenes.go`. Define an exported `Scene`
      struct {`Slug string`, `Label string`, `ID byte`, `ReferenceVerified bool`,
      `DuplicateOf string`} and `func Scenes() []Scene`, which returns a fresh copy of
      the 20 entries in the exact order, labels and IDs of the catalog table in
      `contracts/scenes.md`. `ReferenceVerified` is true only for greenprairie,
      ghost, disco, alarm and savanah. `DuplicateOf` is "sunset" for forest and
      "rubyglow" for aurora (the first reference name is primary). Also define unexported constants
      `sceneCommand = 0x06`, `minSceneID = 0x80` and `maxSceneID = 0x93`. Add a
      package comment line noting that the IDs come from the King1704G
      reference and are unverified on LT-06.
- [x] T003 In `internal/protocol/scenes.go`, add
      `func parseScene(selector string) (route string, id byte, err error)`.
      An exact slug match returns `scene/<slug>`. Otherwise strip one optional
      `0x`/`0X` prefix; the remainder must be exactly two hex digits
      (case-insensitive) with a value from `0x80` to `0x93`, which returns
      `scene/<UPPER-HEX>` (e.g. `scene/8A`). On any other input, return a
      Russian error matching existing style. It lists the slugs in catalog
      order and says "или ID 80–93".
- [x] T004 [P] Create `internal/protocol/scenes_test.go` (Testify, table-driven).
      (a) `Scenes()` has 20 entries with unique slugs. Each slug matches
      `^[a-z]+$` and contains a non-hex letter. IDs and flags equal the
      contract table. Mutating the returned slice does not affect the next call.
      (b) `parseScene` accepts every slug, plus `80`, `8a`, `8A`, `0x8A`, `0X92`
      and `93`. (c) It rejects `""`, `Disco`, `green prairie`, `green-prairie`,
      `7F`, `94`, `FF`, `8`, `8G`, `0x`, `0x080` and ` disco`.

**Checkpoint**: `go test ./internal/protocol/` passes.

## Phase 3: User Story 1 - Run a built-in lamp scene (Priority: P1) 🎯 MVP

**Goal**: `sunset send|dry-run scene <slug|HEX>` and
`GET|POST /<token>/scene/<slug|HEX>` send power-on then the scene frame, and
running effects stop first.

**Independent Test**: `./sunset dry-run scene disco` prints
`55 01 FF 06 01 A2` and `55 06 FF 06 87 17`. A `GET /<token>/scene/8a` test
returns 200 with `"action":"scene/8A"` and `physical_state_verified: false`.

### Behavioral Verification

- [x] T005 [P] [US1] In `internal/protocol/protocol_test.go`, add a table test
      `TestResolveScenePackets` with 42 rows: the 20 catalog slugs (route
      `scene/<slug>`) and the 22 hex IDs `80`–`93` (route `scene/<HEX>`). For
      each row, `Resolve([]string{"scene", sel}, nil)` returns exactly
      `[55 01 FF 06 01 A2, <scene frame from contract>]` and the expected route.
      Add `0x8a` → route `scene/8A`. sunset/forest and rubyglow/aurora return identical frames.
      Extend `TestInvalidCommandProducesNoPackets` with `scene` (no arg),
      `scene disco extra`, `scene 94` and `scene Disco`: each returns an error
      and zero packets.
- [x] T006 [P] [US1] In `internal/bridge/http_test.go`, extend
      `TestRoutesPassExpectedPackets` with GET and POST for `scene/disco`,
      `scene/8a` and `scene/0x8A`. Assert the mock `Execute` receives 2 packets
      and the response has `"action":"scene/disco"` / `"scene/8A"` (the same
      canonical route for both hex forms) and
      `physical_state_verified: false`. Extend `TestRejectedRequestsNeverExecute`
      with HEAD `scene/disco` (405), `scene/94`, `scene/Disco`,
      `scene/green%20prairie` (400), `scene/disco/extra` (404) and a bad token
      (403). Assert `Execute` is never called for any of them.
- [x] T007 [P] [US1] In `internal/bridge/logging_test.go`, add a scene case to
      the existing log-capture test. A `GET /<token>/scene/disco` request emits
      `command.received` with `command=scene/disco` and `packet_count=2`. The
      access token and full URL appear in no log record (FR-007).
- [x] T008 [P] [US1] In `internal/controller/effects_test.go`, add
      `TestSceneCommandCancelsRunningEffectBeforeWrite`, modelled on
      `TestOrdinaryCommandDrainsStartedEffectWriteBeforeExecuting`. Start an
      effect, then `Execute` the `Action` from `protocol.Resolve({"scene","disco"})`.
      Assert the effect snapshot ends `cancelled`, no effect frame is written
      after the scene frame, and the last two written frames are on + scene.
      This gives traceability for FR-005 and SC-003.

### Implementation

- [x] T009 [US1] In `internal/protocol/protocol.go` `Resolve`, add
      `case "scene"` to the two-argument switch. It calls `parseScene(value)`
      (T003) and returns `Action{Route: route, Packets: [][]byte{on, packet(sceneCommand, id)}}`.
      Update the error strings "нужна команда: …", "команды color, brightness и
      preset принимают один параметр" and "неизвестная команда; допустимы …"
      to include `scene`. Update the package doc comment to mention scenes as
      unverified. Depends on T002–T003.
- [x] T010 [US1] In `cmd/sunset/main.go` `usage()`, add the lines
      `./sunset [--data-dir PATH] send scene disco` and `|scene NAME|ID` to
      the dry-run line. Add one line: `Сцены: <slugs joined by ", ">, или ID 80–93`,
      built from `protocol.Scenes()`. No other CLI change is needed:
      `send`/`dry-run` already call `Resolve`, and `internal/bridge/http.go`
      already accepts 3-segment paths. Confirm both by T005/T006 passing.

**Checkpoint**: `task test:core` passes. `./sunset dry-run scene disco`,
`./sunset dry-run scene 0x8A` and `./sunset dry-run scene 94` behave as in
`quickstart.md`. Physical effect is not verified.

## Phase 4: User Story 2 - Assign a scene to a Stream Deck key (Priority: P2)

**Goal**: A seventh action Scene with a persisted selection, and
`streamdeck-buttons.txt` lines for every catalog scene.

**Independent Test**: The plugin test suite covers the Scene route and
assignment. `./sunset urls` lists 20 `Сцена …` blocks after the brightness
lines, and all earlier lines are byte-identical.

### Behavioral Verification

- [x] T011 [P] [US2] In `internal/config/config_test.go`, add
      `TestURLsListScenesAfterExistingLines`. The output of `URLs(settings, presets)`
      starts with exactly the previous text (on, off, presets, brightness 25/50/100)
      and then contains, in catalog order, `Сцена <Label>\n<base>/scene/<slug>\n\n`
      for all 20 scenes. It contains no raw-ID links.
- [x] T012 [P] [US2] Create `streamdeck/tests/scenes.test.ts`. (a) `SCENES`
      from `src/scenes.ts` equals the contract table: slug, label, id, duplicateOf
      and order. (b) `assignment("scene", {})` returns `{schemaVersion: 1, sceneId: "disco"}`.
      It canonicalizes `{schemaVersion:1, sceneId:"0x8a"}` and `"8a"` to `"8A"`,
      and rejects `"94"`, `"Disco"`, `"green prairie"` and a non-string.
      (c) `BridgeClient.command` accepts `scene/disco` and `scene/8A` and rejects
      `scene/94` and `scene/Disco` with `errorCategory: "validation"`.
      (d) `parseConnectionLink` accepts `http://127.0.0.1:18765/<token>/scene/disco`
      and `…/scene/8a`, and rejects `…/scene/Disco` and `…/scene/94`.
      Follow the helpers in `streamdeck/tests/helpers.ts` and the style of
      `power-actions.test.ts`.

### Implementation

- [x] T013 [P] [US2] In `internal/config/config.go` `URLs`, after the brightness
      loop, add one block per `protocol.Scenes()` entry:
      `add("Сцена "+s.Label, "scene/"+s.Slug)`. Depends on T002.
- [x] T014 [P] [US2] Create `streamdeck/src/scenes.ts`, exporting
      `SCENES: readonly {slug, label, id: number, duplicateOf?: string}[]`,
      a mirror of `contracts/scenes.md`, plus `RAW_SCENE_IDS` (0x80–0x93) and
      `sceneSelector(value: string): string | undefined`, which applies the rules
      from data-model.md "Scene selector". The value is "Slug: exact lowercase
      match. Raw ID: two hex digits, case-insensitive, value 0x80–0x93 (CLI
      and HTTP also accept 0x prefix)". It returns the canonical slug, or uppercase hex
      without `0x`. Also export two route patterns from `contracts/scenes.md`:
      - `SCENE_ROUTE_SOURCE = "scene\\/(?:[a-z]{1,40}|[0-9A-Fa-f]{2})"`, an
        unanchored string with case-insensitive hex, for embedding as an
        alternative in other regexes (T015);
      - `SCENE_ROUTE = /^scene\/([a-z]{1,40}|[0-9A-F]{2})$/`, the anchored
        canonical form with uppercase hex only, for `bridge-client` (T016).
- [x] T015 [US2] In `streamdeck/src/validation.ts`, add `"scene"` to `ActionKind`.
      In `assignment`, give empty settings the default
      `{schemaVersion: 1, sceneId: "disco"}`. Add `case "scene"`: require a
      string `sceneId` and canonicalize it via `sceneSelector`; otherwise throw
      `"validation"`. In `parseConnectionLink`, rebuild both route regexes
      (URL at line ~127 with `/i`, route at line ~132 without it) with
      `new RegExp(…)`, adding `SCENE_ROUTE_SOURCE` (T014) as one more
      alternative. Because that fragment has case-insensitive hex, `…/scene/8a`
      passes both regexes. For a `scene/` route, then require
      `sceneSelector(param) !== undefined`. This is the only step that checks
      the `80–93` range and rejects an uppercase slug such as `Disco`, which the
      `/i` URL regex lets through (see `contracts/scenes.md`, "Route pattern").
      Depends on T014.
- [x] T016 [US2] In `streamdeck/src/bridge-client.ts` `command`, accept routes
      matching `SCENE_ROUTE` (imported from `streamdeck/src/scenes.ts`, T014)
      only when `sceneSelector(param) === param`, alongside the existing pattern
      and `transitionRoute`. Only the canonical form passes: `scene/0x8A` and
      `scene/8a` are rejected. Depends on T014.
- [x] T017 [US2] Create `streamdeck/src/actions/scene.ts`. It contains
      `@action({ UUID: "com.obalunenko.mergbw.scene" }) export class Scene extends BaseAction`
      with `super("scene", services)` and
      `route(value) => \`scene/${assignment("scene", value).sceneId!}\``,
      mirroring `actions/color.ts`. Add `sceneId?: string` to the `Assignment`
      type if needed. Register it in `streamdeck/src/plugin.ts` next to `Color`.
      Depends on T015.
- [x] T018 [US2] Add the action to `streamdeck/com.obalunenko.mergbw.sdPlugin/manifest.json`.
      Copy the `color` entry, then set UUID `com.obalunenko.mergbw.scene`, Name
      `Scene`, Tooltip `Run a built-in lamp scene / Встроенная сцена лампы`,
      Icon `imgs/scene`, Keypad only, and matching `States` image. Create
      `imgs/scene.png` (144×144) and `imgs/scene@2x.png` (288×288) in the same
      style as `imgs/preset*.png`; the sizes match the existing icons.
- [x] T019 [US2] Add the Stream Deck inspector UI. In
      `streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html`, add
      `<div id="scene-controls" hidden>` with a `<select id="scene-select">`.
      In `streamdeck/src/ui/inspector.ts`:
      - Add `"scene"` to the accepted `actionKind` list (line ~404), the
        has-settings condition (~407) and the controls loop (~411).
      - Fill the select with an optgroup of `SCENES` (label, plus
        "= <duplicateOf>" for duplicates) and an optgroup "ID" with
        `RAW_SCENE_IDS` as `8A` etc.
      - Save `{schemaVersion: 1, sceneId}` on change, using the same message
        path as the preset/color controls. Add an `actionKind === "scene"`
        branch to the settings-save path (~line 1049, next to the `transition`
        branch) that calls `validateAssignment("scene", …)`.
      - `streamdeck/src/inspector-messages.ts`: no change required. It has no
        action-kind allowlist; line 165 is the `ActionKind` type and line 427 is
        a transition-only check (verified 2026-10-25).
      Add EN and RU strings to `streamdeck/src/i18n.ts`: `scene`, `sceneSelect`,
      `sceneRawIds` and `sceneDuplicateOf`. Depends on T014–T015.
- [x] T020 [P] [US2] In `streamdeck/src/feedback.ts` `ready`, add a branch
      for `kind === "scene"`. The title is the `SCENES` label for a catalog slug,
      or `ID <HEX>` for a raw ID; an invalid assignment keeps the action name, as
      in the existing `catch`. Cover the cases `disco` → "Disco", `8A` → "ID 8A"
      and invalid → "Scene" in a new file `streamdeck/tests/feedback-scene.test.ts`
      (kept separate from T012's `scenes.test.ts`). Depends on T014–T015.
- [x] T021 [P] [US2] In `streamdeck/src/diagnostics.ts:107`, add `"scene"` to
      the accepted action-kind list. Extend `streamdeck/tests/diagnostics.test.ts`
      so a Scene record keeps `actionKind: "scene"`. Depends on T015.
- [x] T022 [US2] Run `task plugin:check:software` (lint, typecheck, tests,
      build, validate). Fix any failures, including updates to
      `streamdeck/tests/package.test.ts` or other existing tests that pin
      the action count (6 → 7) or the manifest contents.

**Checkpoint**: The plugin checks pass, and `./sunset urls` shows the scene
lines. Stream Deck install and key press are manual and pending.

## Phase 5: User Story 3 - Understand which scenes are verified (Priority: P3)

**Goal**: Both READMEs and a verification record show each scene's ID,
duplicate status and LT-06 status.

**Independent Test**: The scene tables in both READMEs list 20 slugs plus
`8A` and `92`, all with status "not verified" / "не проверено".
`hardware-verification.md` has 22 pending rows.

- [x] T023 [P] [US3] Create `specs/009-full-command-scene-support/hardware-verification.md`
      with columns ID | Slug(s) | Observed effect | Matches name | Date | Notes.
      Add one row per ID `80`–`93`, all `pending`. Add separate pending rows
      for: effect preemption (quickstart step 3), brightness after a scene
      (FR-012, step 4), and Stream Deck Scene key persistence (step 5). State
      that an HTTP 200 or `sent: true` is not a pass.
- [x] T024 [P] [US3] In `README.md`, add a "Scenes" section. It covers
      `send scene <slug|ID>`, `/<token>/scene/<slug|ID>`, the Stream Deck Scene
      action, and the 20-row table from `contracts/scenes.md`, with columns
      slug, label, ID, reference-verified, "LT-06: not verified" and duplicates.
      Also cover raw IDs `80–93` including `8A`/`92`, a note that white is
      `color FFFFFF`, and that scenes are not part of presets. In the
      compatibility section, add that scenes are unverified on LT-06 and link
      to `specs/009-full-command-scene-support/hardware-verification.md`.
- [x] T025 [P] [US3] Apply the same changes in Russian to `README_RU.md`
      ("Сцены" section, same table, "LT-06: не проверено"), consistent with T024.

**Checkpoint**: The README tables match each other and the contract.

## Final Phase: Integration and Validation

- [x] T026 Run `gofmt -l internal/protocol internal/bridge internal/config internal/controller cmd/sunset`
      and expect no output. Then run `task test:core`, `task test:race`,
      `task vet` and `task build`.
- [x] T027 Run the "Without a lamp" commands from `quickstart.md` and confirm
      the frames match `contracts/scenes.md`.
- [x] T028 (Linux, where available) Run `task check`.
- [x] T029 Manual LT-06 checks: follow `quickstart.md` "With the LT-06" steps 2–5
      and fill in `hardware-verification.md`. Update README statuses only for
      rows with observations. This task stays open until it is done on the device;
      a build or mock test does not close it.

## Dependencies and Execution Order

- T001 → T002 → T003 → T004.
- US1: T005, T006, T007 and T008 can be written in parallel after T003. T009 depends
  on T003, and T010 on T009. T005–T008 pass only after T009.
- US2: T011 and T013 depend on T002. The plugin chain is T014 → T015 → (T016,
  T017, T019, T020, T021) → T018 → T022; T012 can be written after T014.
  US2 does not need US1 in Go, but the end-to-end key press needs T009.
- US3: T023–T025 depend only on the contract and can run any time after T002.
- Final: T026–T028 after all stories; T029 last, on the device.

## Parallel Examples

- After T003: T005 (`protocol_test.go`), T006 (`http_test.go`),
  T007 (`logging_test.go`), T008 (`effects_test.go`), T011 (`config_test.go`), T014 (`scenes.ts`) and
  T023–T025 (docs) touch different files.
- In US2: T016 (`bridge-client.ts`), T017 (`actions/scene.ts`, `plugin.ts`),
  T019 (`inspector.ts`, `index.html`, `i18n.ts`), T020 (`feedback.ts`,
  `feedback-scene.test.ts`) and
  T021 (`diagnostics.ts`) after T015.

## Implementation Strategy

1. **MVP**: Phases 1–3 (T001–T010). Scenes work from the CLI, HTTP and Website
   buttons. Stop and run the quickstart dry-runs.
2. **Increment 2**: Phase 4 for the Stream Deck action and generated links.
3. **Increment 3**: Phase 5 for documentation and the verification record.
4. **Close-out**: the Final Phase. T029 remains pending until the owner checks
   the lamp.

## Phase 6: Convergence

- [x] T030 In `cmd/sunset/main.go` `usage()`, show in the scenes line that no scene is verified on the LT-06, and mark duplicates with their shared ID (e.g. `forest=sunset`, `aurora=rubyglow`) per US3 Independent Test (partial)
- [x] T031 In `internal/bridge/http_test.go` `TestRejectedRequestsNeverExecute`, add a `POST /TOKEN/scene/disco` case with a non-empty body that returns 400 without calling `Execute` per Verification Evidence: HTTP body (partial)
