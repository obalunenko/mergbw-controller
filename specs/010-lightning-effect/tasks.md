---
description: "Task list for the lightning effect"
---

# Tasks: lightning effect

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/lightning-effect.md](contracts/lightning-effect.md).

**Tests**: The constitution asks for Testify and fake-clock controller tests,
and SC-002–SC-005 need automated evidence, so tests are included and written
to fail first.

## Phase 1: Setup

- [x] **T001** Create branch `feature/lightning-effect` from the current
      `feature/missed-scenes` HEAD (scenes touch the same plugin files and
      READMEs; PR #3 is not merged yet). · git

## Phase 2: Foundational (effect model)

Files: `internal/protocol/effects.go`, `internal/protocol/effects_test.go`

**Wave 1:**

- [x] **T002** Add `lightning` to the `Effect` model per the contract: fields
      `BackgroundRGB []int`, `BackgroundBrightness`, `MinPauseMS`, `MaxPauseMS`,
      `MaxFlashes` (reuse `DurationMS`); JSON keys `backgroundRgb`,
      `backgroundBrightness`, `minPauseMs`, `maxPauseMs`, `maxFlashes`,
      `durationMs` only when `loop` is false, in `fields()`, the kind
      allow-list and the decode struct; a `Validate` case with the R5 ranges,
      `rgbBytes` on the background and `BackgroundBrightness < brightness`;
      every other case also requires the lightning fields to be zero;
      `DurationMS()` returns `DurationMS` for a finite run; `ClonePreset`
      deep-copies `BackgroundRGB`. · internal/protocol/effects.go

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T003** Extend `TestEffectVariantsRoundTripAndResolve` with a loop and
      a finite lightning variant, and the rejection tables with: missing,
      null and foreign keys, `durationMs` with `loop: true` and without it on
      `loop: false`, min pause > max, pause 499 and 120001, `maxFlashes` 0 and
      6, background brightness equal to the flash brightness, flash
      brightness 0, a background channel 256, and a strobe carrying a
      lightning field. Assert `ClonePreset` isolates `BackgroundRGB`.
      · internal/protocol/effects_test.go

**Checkpoint**: `go test ./internal/protocol/` passes.

## Phase 3: User Story 1 - Run a storm on the lamp (Priority: P1) 🎯 MVP

Files: `internal/controller/effects.go`, `internal/controller/effects_test.go`,
`internal/controller/lightning_effect_test.go`, `internal/bridge/effects_test.go`

**Goal**: A lightning preset run from Stream Deck, CLI or HTTP shows the
background, random strikes of 1..N single-packet flashes, and stops on any
other command.

**Independent Test**: `go test ./internal/controller/ ./internal/bridge/`
with the fake clock and injected randomness.

### Tests

**Wave 1 — independent (different files):**

- [x] **T004** [P] [US1] Create `lightning_effect_test.go` using
      `fastTransitionController`, scripted `c.random` and the mock link:
      (a) start writes on, the scaled background color and the flash
      brightness; (b) with scripted randoms, pauses fall in
      `[minPauseMs, maxPauseMs]`, each strike has 1..`maxFlashes` flashes,
      every flash edge is exactly one `0x03` packet, flash RGB is scaled
      70–100 %, holds and gaps stay within the controller constants;
      (c) a 100-strike run (SC-002) with scripted r gives every pause as
      `min + r·(max−min)`, at least two distinct pauses and 1..`maxFlashes`
      flashes per strike; (d) cancelling during a pause and during a strike,
      and shutting the controller down mid-effect, send no further packet; (e) a finite run whose deadline lands inside a
      strike finishes the flash, writes the background last and ends
      `completed`; a deadline shorter than the first pause ends on the
      background with no flash. · internal/controller/lightning_effect_test.go
- [x] **T005** [P] [US1] Add a `lightning` case to `testEffectAction` and to
      `TestFiniteEffectsCompleteWithHonestSnapshotsAndEndpoints`, where the
      last frame is the scaled background color. · internal/controller/effects_test.go
- [x] **T006** [P] [US1] Add a lightning row to the effect table in the
      bridge tests: the preset route returns the dynamic-preset response with
      `kind: "lightning"` and `physical_state_verified: false`.
      · internal/bridge/effects_test.go

### Implementation

**⟶ Wait for the tests above, then:**

- [x] **T007** [US1] In the runner, start lightning on `InitialPackets`
      built from the scaled background RGB and the flash brightness, and add
      the `lightning` case: named constants for flash hold 100–180 ms, inner
      gap 60–250 ms and intensity 70–100 %; pause drawn from `c.random()` and
      clipped to the deadline; strike of 1..`maxFlashes` flashes, each one
      `0x03` write of the scaled flash RGB, a hold, one `0x03` write of the
      background and a gap; return on any failed pause or write; after the
      deadline, finish the current flash on the background and end.
      · internal/controller/effects.go

**Checkpoint**: `task test:core` passes; `./sunset send preset <lightning id>`
runs the effect through the existing route.

## Phase 4: User Story 2 - Configure lightning in Stream Deck (Priority: P2)

Files: `streamdeck/src/preset-effects.ts`, `streamdeck/src/i18n.ts`,
`streamdeck/src/ui/inspector.ts`,
`streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html`,
`streamdeck/tests/effect-contract.test.ts`, `streamdeck/tests/preset-effects.test.ts`,
`streamdeck/tests/preset-editor.test.ts`, `streamdeck/tests/inspector-ui.test.ts`

**Goal**: The preset editor creates, edits, copies and deletes lightning
presets in EN and RU with the contract defaults and validation.

**Independent Test**: `task plugin:check:software`.

### Tests

**Wave 1 — independent (different files):**

- [x] **T008** [P] [US2] Add lightning to the boundary cases: defaults pass
      `presetDefinition`; the same rejections as T003.
      · streamdeck/tests/effect-contract.test.ts
- [x] **T009** [P] [US2] Add `lightning` to the hard-coded kind lists and
      snapshot cases. · streamdeck/tests/preset-effects.test.ts
- [x] **T010** [P] [US2] Add `lightning` to the "all definition kinds" list.
      · streamdeck/tests/preset-editor.test.ts
- [x] **T011** [P] [US2] Inspector cases: selecting Lightning shows only
      `editor-lightning-controls`; unchecking loop shows the shared
      `editor-duration-controls`; a draft round-trips its fields; review
      rejects min pause > max and a background not below the flash.
      · streamdeck/tests/inspector-ui.test.ts

### Implementation

**⟶ Wait for the tests above, then:**

- [x] **T012** [US2] Add the lightning member to `EffectDefinition`, append
      it to `presetKinds`, validate it in `presetDefinition()` with `exact()`
      keys, `integer()` ranges, min ≤ max pause and background below
      brightness, add `defaultPreset()` defaults (`E8F0FF` at 100, background
      `1A2A6C` at 15, 2–15 s, 3 flashes, loop), and accept `lightning` in
      `effectSnapshot()`. · streamdeck/src/preset-effects.ts

**⟶ Wait for T012, then:**

**Wave 2 — independent (different files):**

- [x] **T013** [P] [US2] Add `editor-lightning-controls` with a background
      color and hex pair, background brightness, min and max pause in
      seconds and max flashes; move `editor-duration-controls` out of the
      candle block. · streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html
- [x] **T014** [P] [US2] Add EN and RU strings: `kind.lightning`, the field
      labels with ranges, and the two review errors.
      · streamdeck/src/i18n.ts

**⟶ Wait for Wave 2, then:**

- [x] **T015** [US2] Wire the editor: `editorFields()` shows the lightning
      block and the shared duration block for candle and lightning when loop
      is off; `loadDraft()` and `readDraft()` map the fields (seconds to ms,
      `maxFlashes` as a count, background hex to RGB); the review handler
      pre-checks pause order and background brightness. · streamdeck/src/ui/inspector.ts

**Checkpoint**: `task plugin:check:software` passes.

## Final Phase: Polish

**Wave 1 — independent (different files):**

- [x] **T016** [P] Add a Lightning row to the effects table and a note that
      the computer drives it and that flash timing is tuned on the LT-06.
      · README.md
- [x] **T017** [P] The same in Russian. · README_RU.md
- [x] **T018** [P] Create the verification record with pending rows:
      naturalness vs Strobe (SC-001), shortest flash visible and the chosen
      timing constants (SC-006), background looks dim (else the two-packet
      fallback), background brightness 0 looks lit or off, another key stops
      it, a finite run ends on the background.
      · specs/010-lightning-effect/hardware-verification.md

**⟶ Wait for Wave 1 and all stories, then:**

- [x] **T019** Run `gofmt -l internal`, `task test:core`, `task test:race`,
      `task vet`, `task build` and `task plugin:check:software`. · repo
- [x] **T020** Rebuild the spike plugin, relink it, create the Lightning
      preset on the "Scenes 4" key with the owner, observe on the LT-06,
      fix the final timing constants, switch to the two-packet fallback if
      the scaled background looks wrong (then also update the contract,
      `data-model.md` and the T004 packet assertions), and fill
      `hardware-verification.md`.
      A constant change reopens US1's file after its phase is done, then
      reruns T019. Stays open until done on the device.
      · specs/010-lightning-effect/hardware-verification.md

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002 → T003) → US1 and US2 in parallel → Polish.
- US1: tests T004, T005, T006 together, then T007.
- US2: tests T008–T011 together, then T012, then T013 and T014 together, then T015.
- Polish: T016–T018 together, then T019, then T020 on the device.
- US2 does not need US1 code, but T020 needs both.
