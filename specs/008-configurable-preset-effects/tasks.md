# Tasks: configurable preset effects

**Scale note:** Four areas share protocol and runtime contracts. Shared execution and wire code belongs to Foundational; mode stories then prove each effect independently. UI editing and key ownership have disjoint file ownership and can proceed together.

## Phase 1: Setup

Files: `specs/008-configurable-preset-effects/tasks.md`

**Wave 1:**
- [x] **T001** Record approved plan, ownership and requirement mapping before implementation · specs/008-configurable-preset-effects/tasks.md

## Phase 2: Foundational

Files: `internal/protocol/protocol.go`, `internal/protocol/effects.go`, `internal/protocol/effects_test.go`, `internal/config/config.go`, `internal/config/managed_config.go`, `internal/config/managed_import.go`, `internal/config/effects_test.go`, `internal/controller/controller.go`, `internal/controller/transition.go`, `internal/controller/effects.go`, `internal/controller/effects_test.go`, `internal/bridge/http.go`, `internal/bridge/effects.go`, `internal/bridge/effects_test.go`, `internal/bridge/mock_effect_controller_test.go`, `cmd/sunset/main.go`, `Taskfile.yml`, `internal/managed/control.go`, `internal/managed/dispatch.go`, `internal/managed/presets.go`, `internal/managed/presets_test.go`, `cmd/sunset/supervisor/main.go`, `streamdeck/src/preset-effects.ts`, `streamdeck/src/bridge-client.ts`, `streamdeck/src/operation-store.ts`, `streamdeck/tests/effect-contract.test.ts`

**Wave 1:**
- [x] **T002** Define strict optional tagged effects, resolution, cloning and compatible config decoding/import/proposal preservation; test invalid fields and zero brightness · internal/protocol/protocol.go, internal/protocol/effects.go, internal/protocol/effects_test.go, internal/config/config.go, internal/config/managed_config.go, internal/config/managed_import.go, internal/config/effects_test.go

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2: independent (different files):**
- [x] **T003** [P] Implement all four effect algorithms in one root-owned controller job lifecycle shared with transitions; test draining, endpoints, cancellation and no uncertain-write retry · internal/controller/controller.go, internal/controller/transition.go, internal/controller/effects.go, internal/controller/effects_test.go
- [x] **T004** [P] Add compatible dynamic preset 202 receipts and exact-ID status/cancel HTTP routes, CLI send/dry-run handling and generated interface mocks; test method/auth/receipt contracts · internal/bridge/http.go, internal/bridge/effects.go, internal/bridge/effects_test.go, internal/bridge/mock_effect_controller_test.go, cmd/sunset/main.go, Taskfile.yml
- [x] **T005** [P] Add generation-bound bounded preset list/read/create/update/delete proposals using existing Apply and private settings preservation; test stale/oversize/last-delete boundaries · internal/managed/control.go, internal/managed/dispatch.go, internal/managed/presets.go, internal/managed/presets_test.go, cmd/sunset/supervisor/main.go
- [x] **T006** [P] Add strict TypeScript preset/effect definitions, accepted receipts and status/cancel client methods without weakening transitions or static receipts · streamdeck/src/preset-effects.ts, streamdeck/src/bridge-client.ts, streamdeck/src/operation-store.ts, streamdeck/tests/effect-contract.test.ts

**Checkpoint:** Shared definitions, execution and management contracts exist; old preset/transition behavior remains valid. All stories consume this shared implementation rather than owning competing schedulers.

## Phase 3: US1 - Edit and save presets

Files: `streamdeck/src/managed-controller.ts`, `streamdeck/src/inspector-messages.ts`, `streamdeck/src/ui/inspector.ts`, `streamdeck/src/i18n.ts`, `streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html`, `streamdeck/com.obalunenko.mergbw.sdPlugin/ui/inspector.css`, `streamdeck/tests/preset-editor.test.ts`, `streamdeck/tests/inspector-ui.test.ts`

**Goal:** Create/edit/delete all five preset types in EN/RU without file editing, secret exposure or automatic playback.

### Tests

Add boundary cases in `streamdeck/tests/preset-editor.test.ts` and update the real inspector fixtures in `streamdeck/tests/inspector-ui.test.ts` for draft preservation, generation conflicts, save review and type-specific fields.

### Implementation

**Wave 1:**
- [x] **T007** [US1] Add private editor reads/proposals, exact PI payload allowlists, safe snapshots and existing uncertain-save reconciliation · streamdeck/src/managed-controller.ts, streamdeck/src/inspector-messages.ts, streamdeck/tests/preset-editor.test.ts

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2:**
- [x] **T008** [US1] Implement New/Edit/Delete, stable IDs, palette order, selected-kind fields, repeat/duration, effect status/stop and visible save interruption notice in EN/RU; test actual panel behavior · streamdeck/src/ui/inspector.ts, streamdeck/src/i18n.ts, streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html, streamdeck/com.obalunenko.mergbw.sdPlugin/ui/inspector.css, streamdeck/tests/inspector-ui.test.ts

**Checkpoint:** Each preset type can be saved and reopened; rename retains assignment and failed save preserves the catalog. Opening/editing/saving never starts playback.

## Phase 4: US2 - Smooth color palette

Files: `internal/controller/palette_effect_test.go`

**Goal:** Independently verify the palette behavior delivered by the shared engine.

### Tests / Implementation

**Wave 1:**
- [x] **T009** [US2] Prove ordered three-color endpoints, finite final color, smooth loop closure and cancellation with deterministic mocked-link execution · internal/controller/palette_effect_test.go

**Checkpoint:** Palette cycles retain order and terminate or loop as selected.

## Phase 5: US3 - Strobe

Files: `internal/controller/strobe_effect_test.go`

**Goal:** Independently verify explicit On/Off phase timing.

### Tests / Implementation

**Wave 1:**
- [x] **T010** [US3] Prove separate On/Off intervals, one-cycle Off endpoint, repeat interruption and retained last state · internal/controller/strobe_effect_test.go

**Checkpoint:** Strobe alternates and stops without a delayed continuation.

## Phase 6: US4 - Breathing

Files: `internal/controller/breathing_effect_test.go`

**Goal:** Independently verify a fixed-color brightness cycle.

### Tests / Implementation

**Wave 1:**
- [x] **T011** [US4] Prove minimum-to-peak-to-minimum interpolation, finite endpoint and repeated-cycle cancellation · internal/controller/breathing_effect_test.go

**Checkpoint:** Breathing keeps RGB and honors both brightness bounds.

## Phase 7: US5 - Candle

Files: `internal/controller/candle_effect_test.go`

**Goal:** Independently verify bounded irregular flickering.

### Tests / Implementation

**Wave 1:**
- [x] **T012** [US5] Prove injected irregular targets, depth/brightness bounds, speed, finite deadline and no redundant writes at zero depth · internal/controller/candle_effect_test.go

**Checkpoint:** Candle respects its parameters and never creates an unbounded pending sequence.

## Phase 8: US6 - Predictable key control and lifecycle

Files: `streamdeck/src/actions/base-action.ts`, `streamdeck/src/actions/preset.ts`, `streamdeck/src/preset-runs.ts`, `streamdeck/tests/preset-effects.test.ts`, `streamdeck/tests/preset-catalog.test.ts`

**Goal:** Start/repeat-stop the exact owned run and preserve ordinary command behavior.

### Tests

Add focused cases in `streamdeck/tests/preset-effects.test.ts` and preserve static/missing/renamed catalog cases in `streamdeck/tests/preset-catalog.test.ts`.

### Implementation

**Wave 1:**
- [x] **T013** [US6] Add ephemeral key ownership and guarded repeat-press status/exact-ID stop, retaining pending/revision/runtime fences and static behavior · streamdeck/src/actions/base-action.ts, streamdeck/src/actions/preset.ts, streamdeck/src/preset-runs.ts, streamdeck/tests/preset-effects.test.ts, streamdeck/tests/preset-catalog.test.ts

**Checkpoint:** Another command, runtime change or stale response cannot accidentally stop a new run or replay an old one. Disappear/reappear retains only valid ephemeral ownership.

## Phase 9: Polish

Files: `README.md`, `README_RU.md`, `specs/008-configurable-preset-effects/validation.md`

**Wave 1: independent (different files):**
- [x] **T014** [P] Document four effect settings, editor/save behavior, repeat stop, nominal timing and home-use scope in both languages · README.md, README_RU.md
- [x] **T015** [P] Reconcile cross-worker API seams; delegate defined typecheck/lint, inspect the final diff and record requirement/test evidence · specs/008-configurable-preset-effects/validation.md

**⟶ Wait for Wave 1 to finish, then:**

**Wave 2:**
- [x] **T016** Run integrated core/race/vet/build and plugin software checks once, fix introduced failures, record actual exit codes · specs/008-configurable-preset-effects/validation.md

**⟶ Wait for Wave 2 to finish, then:**

**Wave 3:**
- [x] **T017** Build/inspect a fresh current-Mac payload and update the local linked installation using the established private backup procedure; preserve profiles/config and leave physical observation explicit · specs/008-configurable-preset-effects/validation.md

## Dependencies & Execution Order

Setup → Foundational Wave 1 → Foundational Wave 2 → stories → Polish. Foundational Wave 2 has four independent areas and is dispatched through the Companion wave briefs. US1 and US6 each own at least five files and go to separate workers after foundation joins; US2–US5 stay inline, one focused mode test phase at a time. Story source/test paths do not overlap.

US1 Wave 1 gates its UI Wave 2. Each remaining story has one wave. Polish documentation/reconciliation join before the single integrated suite; passing software gates precede payload build and local update. Additional extended hardware/signing/fault rounds remain outside the home-use scope.

## Owner-approved UX revision (2026-10-25)

- [x] **T018** Separate key settings, shared library/editor/review, setup and diagnostics within the existing inspector; group preset choices and autosave valid action settings without dispatching lamp commands · streamdeck/src/ui/inspector.ts, streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html, streamdeck/com.obalunenko.mergbw.sdPlugin/ui/inspector.css
- [x] **T019** Preserve effect drafts, show seconds/color/percentage/repeat controls, and assign new presets only after known commit plus current-generation catalog validation; retain unknown-save recovery · streamdeck/src/ui/inspector.ts, streamdeck/tests/inspector-ui.test.ts
- [x] **T020** Update EN/RU copy and documentation, align UX requirements/design and record actual software validation separately from installed-host/hardware evidence · streamdeck/src/i18n.ts, README.md, README_RU.md, specs/008-configurable-preset-effects/validation.md
