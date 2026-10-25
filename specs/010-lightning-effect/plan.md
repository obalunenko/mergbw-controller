# Implementation Plan: lightning effect

**Feature Directory**: `specs/010-lightning-effect` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

## Summary

Add a fifth preset effect kind, `lightning`, next to palette, strobe, breathing
and candle. The controller runs it like the others: a cancellable job that
writes through the shared 80 ms packet gap. It starts on a dim background,
waits a random pause, then fires a strike of 1..N short flashes with random
lengths and gaps, and returns to the background. Each flash and each return is
a single color packet: the lamp's brightness register stays at the flash
brightness, and the background is sent as its RGB scaled by
background brightness ÷ flash brightness. That keeps a flash near the packet
gap instead of twice it. The Stream Deck preset editor gets a Lightning form,
and the effect is documented in both READMEs. The owner's LT-06 observation
settles the flash timing constants.

## Project Structure

```text
internal/protocol/effects.go              Effect fields, JSON, Validate, DurationMS, ClonePreset
internal/protocol/effects_test.go         round trip, rejection table
internal/controller/effects.go            start on background; lightning runner case
internal/controller/effects_test.go       testEffectAction case; finite-effect endpoint check
internal/controller/lightning_effect_test.go  NEW strike/pause/flash bounds, stop, deadline
internal/bridge/effects_test.go           lightning row in the effect table
streamdeck/src/preset-effects.ts          EffectDefinition, presetKinds, validation, defaults, effectSnapshot
streamdeck/src/ui/inspector.ts            editorFields, loadDraft, readDraft, review pre-checks
streamdeck/src/i18n.ts                    kind.lightning, field labels, errors (EN/RU)
streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html  editor-lightning-controls; shared duration block
streamdeck/tests/*.test.ts                kind lists, contract cases, editor round trip
README.md, README_RU.md                   effect table row and notes
specs/010-lightning-effect/hardware-verification.md  NEW owner observations
```

**Structure Decision**: Existing packages only. Lightning is one more case in
the existing effect switches. No new interface, package or dependency.

## Calls

```text
Stream Deck Preset key ─▶ bridge POST /<token>/preset/<id>
  └▶ protocol.Resolve ─▶ EffectAction.Validate ─▶ Effect.Validate(brightness)
  └▶ Controller.startJob ─▶ runEffect
        ├─ InitialPackets(scaled background RGB, flash brightness)   on + 0x03 + 0x05
        └─ case "lightning": loop
              pause(random min..max, clipped to deadline)
              strike: 1..maxFlashes × { write 0x03 flash ─ pause flash ─ write 0x03 background ─ pause gap }
CLI `sunset send preset <id>` ─▶ same HTTP route
Editor save ─▶ presetDefinition (TS) ─▶ managed PreparePreset ─▶ config.DecodePresets ─▶ Effect.Validate (Go)
```

## Constitution Check

| Principle | Assessment |
|---|---|
| I. Package and module boundaries | PASS. Validation stays in `internal/protocol`, scheduling in `internal/controller`, UI in `streamdeck/`. |
| II. Local command contract | PASS. Preset routes, GET/POST, token and response shape unchanged. |
| III. BLE effects and cancellation | PASS. Writes go through `writeJobFrame` and the 80 ms gap; every pause and write returns on cancellation; no overdue bursts; `physical_state_verified` stays false. |
| IV. Configuration and secrets | PASS. `presets.json` gains an additive effect kind; existing presets decode unchanged; no secrets touched. |
| V. Verify at the right boundary | PASS. Fake-clock controller tests with injected randomness; Go and TS validation tables; plugin checks. |
| VI. Hardware integration tests | PASS. No hardware-tag test. Flash timing is settled by owner observation, recorded separately; tests never claim physical effect. |

Re-checked after Phase 1 design: still PASS.

## Validation

- `task test:core`, `task test:race`, `task vet`, `task build`.
- `task plugin:check:software`.
- On the LT-06 (owner): run the default Lightning preset; judge naturalness
  (SC-001) and whether the shortest flashes are visible (SC-006); record in
  `hardware-verification.md`. Linux checks are skipped by owner decision.
