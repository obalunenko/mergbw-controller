---
description: "Task list for MeRGBW actions in Multi Action"
---

# Tasks: MeRGBW actions in Multi Action

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/multi-action.md](contracts/multi-action.md),
[quickstart.md](quickstart.md).

**Prerequisites**: plan.md and spec.md; research.md, data-model.md, and contracts/.

**Organization**: Grouped by the spec's user stories in priority order. Only
`streamdeck/`, both READMEs and feature artifacts change. `cmd/sunset/` and
`internal/` stay untouched.

**Tests**: The spec's Verification Evidence lists the automated cases. Plugin
tests use `node:test` with `node:assert/strict`, `KeyFacade`, `MemoryStorage`,
`ControlledClock`, `deferred` and `syntheticToken` from
`streamdeck/tests/helpers.ts`. Follow the event-facade pattern in
`streamdeck/tests/action-values.test.ts`: `{ action: { id, isKey: () => true,
...key }, payload: { settings } }`. For a step, add `isInMultiAction: true`
to `payload`. Write each story's tests first and confirm they fail before the
implementation.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: a different file with no unresolved dependency. It does not request
  extra agents.
- `[US1]`–`[US3]`: the spec user story.

## Phase 1: Setup

- [x] T001 Install locked plugin dependencies with `task plugin:deps` and run `task plugin:check:software` on `master` (`136e224`) before any change under `streamdeck/` (the untracked `specs/012-multi-action-support/` does not matter) to record a green baseline. Note any pre-existing failure here before changing code in `streamdeck/`.

## Phase 2: Foundational

None. US2 and US3 build on the step tracking that US1 adds in
`streamdeck/src/actions/base-action.ts` (T006).

## Phase 3: User Story 1 - Собрать Multi Action из команд лампы (Priority: P1) 🎯 MVP

**Goal**: The MeRGBW category with all seven actions appears in the Multi
Action and Multi Action Switch editors. A step is configured in the key panel
and sends the same command as a key. A step never writes a title or icon.

**Independent Test**: A one-step Multi Action with Color `FF0000` turns the
lamp red, and the editor lists all seven actions (quickstart rows 1–2). In
automated tests, every step kind sends its key route and records no
title or image writes.

### Behavioral Verification

- [x] T002 [P] [US1] Add a test to `streamdeck/tests/package.test.ts` named "every action is available in Multi Action". Steps:
  1. Assert that each of the seven actions in the copied fixture manifest has `SupportedInMultiActions === true`, and that `checkRuntime(directory, { softwareOnly: true })` passes.
  2. Use the existing `runtime()` fixture helper and the `for (const fault of …)` loop pattern from the Encoder test. For faults `"false"` (`manifest.Actions[3].SupportedInMultiActions = false`) and `"missing"` (`delete manifest.Actions[3].SupportedInMultiActions`), rewrite `manifest.json` and assert that `checkRuntime` throws `/action paths or behavior/`.

  The test must fail until T004 and T005 land.
- [x] T003 [P] [US1] Create `streamdeck/tests/multi-action.test.ts`.
  - **Helpers**: a `services()` helper with `Settings(new MemoryStorage())`, `saveConnection(18766, syntheticToken)`, `OperationStore`, `BridgeClient` with `command` overridden to push `record.snapshot.route` and return `{ status: "sent" }`, `InspectorController(settings, operations, client, () => {}, diagnostics)` and `Diagnostics` writing to a `logs` array. Add a `step(id, key, settings)` facade with `payload: { settings, isInMultiAction: true }` and a `keyEvent` facade without the flag.
  - **Test "each step kind sends its key route"**: a table of the seven actions, with raw settings and the expected route:

    | Action | Settings | Route |
    | --- | --- | --- |
    | `PowerOn` | `{}` | `on` |
    | `PowerOff` | `{}` | `off` |
    | `Color` | `{schemaVersion:1, rgb:"00ff80"}` | `color/00FF80` |
    | `Scene` | `{schemaVersion:1, sceneId:"disco"}` | `scene/disco` |
    | `Brightness` | `{schemaVersion:1, percent:30}` | `brightness/30` |
    | `Preset` | `{schemaVersion:1, presetId:"sunset"}` | `preset/sunset` |
    | `Transition` | `{schemaVersion:1, fromRGB:"FF0000", fromPercent:10, toRGB:"0000FF", toPercent:80, durationSeconds:5}` | `transition/FF0000/10/0000FF/80/5` |

    For each row: `onWillAppear(step)`, then `onKeyDown(step)`. Assert one new route equal to the key route and `key.oks === 1`.
  - **Test "a step writes no title or image"**: check the step's `KeyFacade.titles` and `KeyFacade.images` after each of these calls:
    - `onWillAppear`;
    - `onKeyDown`;
    - `settings.receiveAction(id, kind, <changed valid settings>)`;
    - `await settings.saveLanguage("ru")`.

    Both notify `settings.subscribe`, which drives `refreshDefaults`. Flush with `await new Promise((resolve) => setImmediate(resolve))` before asserting that both arrays are empty. The same calls on a `keyEvent` still record titles, as a regression guard.
  - Call `inspector.dispose()` in `finally`. The test must fail until T006 lands.

### Implementation

- [x] T004 [P] [US1] In `streamdeck/com.obalunenko.mergbw.sdPlugin/manifest.json`, change `"SupportedInMultiActions": false` to `true` on all seven actions: `on`, `off`, `color`, `scene`, `brightness`, `preset`, `transition`. Use an explicit `true`, not a removed field. Change nothing else.
- [x] T005 [P] [US1] In `streamdeck/scripts/check-package.mjs`, change `action.SupportedInMultiActions !== false` to `action.SupportedInMultiActions !== true` in the per-action check, so the error stays `action paths or behavior`. Makes T002 pass.
- [x] T006 [US1] In `streamdeck/src/actions/base-action.ts`, track Multi Action steps separately from visible keys:
  - Add `private readonly steps = new Map<string, KeyView>()`.
  - Add a module-level helper `function isStep(ev: { payload: unknown }): boolean`, returning `(ev.payload as { isInMultiAction?: boolean }).isInMultiAction === true`. A missing field means a key. T012 reuses this helper; do not repeat the cast.
  - In `onWillAppear`: still call `settings.receiveAction` and `operations.appear`. When `ev.action.isKey()`, a step (`isStep(ev)`) goes into `steps` without `feedback.ready`. A key keeps today's `visible.set` and `feedback.ready`.
  - In `onWillDisappear`: delete the id from both maps.
  - In the `operations.subscribe` listener: resolve the target with `this.visible.get(record.context) ?? this.steps.get(record.context)` before the `canRender` check.
  - Keep `refreshDefaults` iterating `visible` only.
  - Do not change `Brightness`, `Preset`, `Transition`, `PresetRuns` or `DialBrightness`.

  Depends on T003. Makes T003 pass.

**Checkpoint**: T002 and T003 pass, and all existing suites pass. On the device, quickstart rows 1–2 can be observed after `task plugin:link`.

## Phase 4: User Story 2 - Порядок шагов через Delay (Priority: P2)

**Goal**: A step dispatches immediately, with no plugin queue. The owner's
Delay sets the order, and the controller gate keeps a later arrival behind an
admitted command. Steps that start an effect or transition leave the Multi
Action key's title alone.

**Independent Test**:
- **Automated**:
  - a second step's request is sent while the first is still pending;
  - an accepted Transition step writes no title;
  - a dynamic preset step writes no title and follows the key's stop rule on a repeated press.
- **On the device**, quickstart rows 4, 5 and 9a–9b apply:
  - Scene → short Delay → Off ends off;
  - Transition 5 s → Delay 5 s → Off completes, then turns off;
  - the effect started by a preset step keeps running, and the step panel shows its status and Stop;
  - a repeated press of a preset-only Multi Action stops the run.

### Behavioral Verification

- [x] T007 [US2] Add three tests to `streamdeck/tests/multi-action.test.ts`.
  - **"a step dispatches without waiting for another step"**: a `Color` step's `client.command` returns a `deferred()` promise that stays unresolved. A `PowerOff` step `onKeyDown` pushes `off` while Color is still pending. Then resolve Color and assert that both records finished.
  - **"an accepted step writes no title"**: a `Transition` step whose `client.command` returns `{ status: "accepted" }`. Assert that `titles` stays empty. The same assignment on a `keyEvent` still gets the Accepted title, matching `translate(language, "accepted")`.
  - **"a dynamic preset step starts its effect like a key and writes no title"**: a `Preset` step (`{schemaVersion:1, presetId:"candle"}`) whose `client.command` returns `{ status: "accepted", effect: { id: "a".repeat(32), presetId: "candle", kind: "candle", state: "running", elapsedMs: 0, durationMs: null, physical_state_verified: false } }`. The request goes through `PresetRuns`.
    - Assert one `preset/candle` route and that the step's `titles` stay empty.
    - A second `onKeyDown` on the same step, with no other step in between, must follow the key's stop rule from `streamdeck/tests/preset-effects.test.ts`: an effect status read, then a cancel for the same effect id, and no second `preset/candle` start. Stub `client.effect` and `client.cancelEffect` the way that file does.
    - The same second press on a `keyEvent` gives the same request sequence, as a regression guard.

  Depends on T006. The second and third tests must fail until T008.

### Implementation

- [x] T008 [US2] In `streamdeck/src/feedback.ts`, change the signature to `result(key: KeyView, record: OperationRecord, step = false)`. When `record.status === "accepted"` and `step` is true, return without `setTitle`. `sent` still calls `showOk`; every other status still calls `showAlert`. In `streamdeck/src/actions/base-action.ts`, pass `this.steps.has(record.context)` from the listener. Depends on T006 and T007.

**Checkpoint**: T007 passes. The plugin has no new waiting or queue code
(review `onKeyDown`: the only early return is still the same-context pending
guard).

## Phase 5: User Story 3 - Понятный исход при ошибке шага (Priority: P3)

**Goal**: An invalid step sends nothing and alerts, and other steps still
run. A repeated press does not duplicate a pending step. A step after
readiness loss is rejected. Diagnostics mark step events without secrets.

**Independent Test**: The automated cases below. On the device, quickstart
row 6: a deleted preset in a middle step shows an alert, and the other steps
run.

### Behavioral Verification

- [x] T009 [P] [US3] Add tests to `streamdeck/tests/multi-action.test.ts`:
  1. A `Color` step with corrupt settings (`{schemaVersion: 2}`) sends 0 routes and records `key.alerts === 1`; a following `PowerOff` step still sends `off`.
  2. With a `Settings` that has no saved connection, a step sends 0 routes and alerts.
  3. Two `onKeyDown` calls on the same pending step, where the `command` is a `deferred()` promise, send exactly 1 route.
  4. Loss of readiness rejects the step. Set `services.runtime` to the minimal stub `{ capability: () => undefined, current: () => false, subscribe: () => () => {} } as unknown as ManagedController`, so `onKeyDown` takes its "runtime without capability" branch (the same branch as the "starting" case in `streamdeck/tests/managed-controller.test.ts`, without its full fixture). A `Color` step is rejected with 0 routes and records `key.alerts === 1`.
  5. A deleted preset rejects the step. After `onWillAppear` of a `Preset` step with `presetId: "night"`, set `inspector.catalog = { connectionRevision: settings.connectionRevision, status: "available", entries: [], requestGeneration: 1 }` (the pattern in `streamdeck/tests/activation-series.test.ts`). The step sends 0 routes and records `key.alerts === 1`. A following `PowerOff` step still sends `off`.
  6. The `logs` from a step's `action.started`, `action.sent` and `action.rejected` contain `multiAction: "true"`; the same events for a key omit `multiAction`; `JSON.stringify(logs)` never contains `syntheticToken`.

  Depends on T006. Case 6 must fail until T012.
- [x] T010 [P] [US3] Add a test to `streamdeck/tests/diagnostics.test.ts`, next to the allowlist test: `emit("action.sent", { actionKind: "color", outcome: "sent", multiAction: true })` writes `multiAction: "true"`. `multiAction: false`, `"true"`, `1` and an absent field write no `multiAction` key. Must fail until T011.

### Implementation

- [x] T011 [P] [US3] In `streamdeck/src/diagnostics.ts`, add `multiAction?: boolean` to `Diagnostic`. In `emit`, write `fields.multiAction = "true"` only when `input.multiAction === true`, after the existing allowlisted fields. Change nothing else. Makes T010 pass.
- [x] T012 [US3] Flag step operations and pass the flag to diagnostics:
  - In `streamdeck/src/operation-store.ts`, add `readonly multiAction?: true` to `OperationRecord`, and widen the `acquire` input to `Pick<…> & { multiAction?: true }` so the existing `...input` spread copies it.
  - In `streamdeck/src/actions/base-action.ts` `onKeyDown`, compute `const step = isStep(ev)` (the T006 helper). Pass `...(step ? { multiAction: true as const } : {})` to `operations.acquire`, and `multiAction: step` to the `action.rejected` and `action.started` emits.
  - In the listener's `action.${record.status}` emit, add `multiAction: record.multiAction === true`.

  Depends on T006, T009 and T011. Makes T009 case 6 pass.

**Checkpoint**: T009 and T010 pass. Diagnostics carry only the literal flag.

## Final Phase: Documentation and Validation

- [x] T013 [P] Update `README.md`, section "Native Stream Deck plugin":
  - At line 94, state that the seven actions are also available in Multi Action and Multi Action Switch.
  - After the action table, add a **Multi Action** paragraph matching [contracts/multi-action.md](contracts/multi-action.md):
    - every step uses the key panel and sends the same command;
    - order is set with Stream Deck Delay: put a Delay of 0.5 s between ordinary MeRGBW steps (a recommendation, not a measured minimum), because the controller runs one command at a time and only needs the earlier request to arrive first; put a Delay as long as a Transition or effect after it to let it play;
    - without a Delay, order is not guaranteed;
    - a failed step does not stop the others;
    - a repeated press skips steps still running;
    - a dynamic preset step follows the key's start/stop rules;
    - steps never change the Multi Action key's title or icon, and Accepted status shows in the step panel.
- [x] T014 [P] Update `README_RU.md`, section "Плагин Stream Deck", line 95, and the paragraph after the «Действие | Назначение» table, with the same content in Russian as T013, including the recommended 0,5 с Delay.
- [x] T015 [P] In `specs/006-streamdeck-control-plugin/contracts/plugin.md`, after the paragraph at line 17, append one line: "Superseded in part by `specs/012-multi-action-support/contracts/multi-action.md`: all seven actions declare `SupportedInMultiActions:true`." Leave the rest of the 006 contract unchanged.
- [x] T016 Run `task plugin:check:software` (lint and format check, typecheck, all plugin tests, build, CLI validate). All must pass. Go files are unchanged, so record `task test:core`, `task test:race`, `task vet` and `task build` as not required, and Linux `task check` as not run. Depends on T002–T015.
- [x] T017 Create `specs/012-multi-action-support/hardware-verification.md` with quickstart rows 1–9.
  - **Header**: the device actually used: the Stream Deck model, the Stream Deck app version, the macOS version, the lamp model `LT-06` and the plugin version.
  - **Per row**: setup, which includes the exact steps and commands; expected result; the physical effect actually observed on the lamp or the key; date; status (`observed` or `accepted gap`).
  - **Excluded**: never write the lamp identity, the access token or full command URLs into this file.

  Build with `task plugin:package` or `task plugin:link`, then fill the observed results from the owner's LT-06 session. A row the owner did not observe stays an accepted gap, never a pass. A sent command is not lamp-state evidence. Depends on T016.

## Dependencies and Execution Order

```text
T001
 ├▶ US1: T002 ─┐   T003 ─▶ T006
 │          T004, T005 ─┘ (T002 passes)
 ├▶ US2: T006 ─▶ T007 ─▶ T008
 ├▶ US3: T006 ─▶ T009 ─┐
 │          T010 ─▶ T011 ─┴▶ T012
 └▶ Final: T013, T014, T015 (any time) ─▶ T016 (after T002–T015) ─▶ T017
```

- US1 is the MVP and has no story dependency.
- US2 and US3 depend only on T006 from US1. They are independent of each
  other, except that both edit `streamdeck/src/actions/base-action.ts` (T008
  and T012) and `streamdeck/tests/multi-action.test.ts` (T007 and T009), so
  run those edits one after another.
- `streamdeck/tests/multi-action.test.ts` is shared by T003, T007 and T009.
  These tasks are sequential edits to one file, even when marked `[P]`
  against other files.

## Parallel Examples

- **US1**: T002 (`package.test.ts`), T003 (`multi-action.test.ts`), T004
  (`manifest.json`) and T005 (`check-package.mjs`) touch different files and
  can proceed together; T006 follows T003.
- **US3**: T009 (`multi-action.test.ts`), T010 (`diagnostics.test.ts`) and
  T011 (`diagnostics.ts`) can proceed together; T012 follows.
- **Final**: T013, T014 and T015 touch different files.

## Implementation Strategy

1. **MVP (US1)**: T001–T006. The owner can already build Multi Actions from
   all seven actions and order them with Delay. Validate with T016 and
   quickstart rows 1–3.
2. **US2**: T007–T008. This keeps effect and transition steps from writing
   the Accepted title on the Multi Action key, and pins down that steps
   dispatch without a queue.
3. **US3**: T009–T012. This covers failure isolation and the diagnostics
   flag.
4. **Final**: T013–T017. Both READMEs, the 006 contract note, the full
   plugin check, then the owner's device rows.
