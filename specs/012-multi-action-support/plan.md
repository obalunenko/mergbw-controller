# Implementation Plan: MeRGBW actions in Multi Action

**Feature Directory**: `specs/012-multi-action-support` | **Branch**: `master` (no feature branch)

**Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-multi-action-support/spec.md`

## Summary

All seven plugin actions declare `"SupportedInMultiActions": false`, so Stream
Deck hides the MeRGBW category in the Multi Action and Multi Action Switch
editors. This feature sets the flag to `true` on all seven actions and turns
the package check around so it rejects a build where any action is hidden.

Stream Deck 7.1 already sends Multi Action steps their own `willAppear`,
`didReceiveSettings`, `keyDown` and `willDisappear` events with
`isInMultiAction: true` (SDK `MultiActionPayload`). The existing key path
handles the settings, the panel, presets, transitions and effects without
changes. The plugin changes only three behaviors for steps: it writes no
runtime title or icon (a step must not change the Multi Action key), it
keeps the "Accepted" title off the key, and it flags step events in
diagnostics.

Ordering stays with the owner: the plugin dispatches each step immediately,
like a key, with no queue (spec clarification). The controller already admits
one command at a time before it connects, so a step that arrives after a
short Delay waits for the earlier command, even during a reconnect.
`cmd/sunset` and `internal/` are untouched.

## Technical Context

**Language/Version**: TypeScript on Node 24 for the Stream Deck plugin. Go
1.27.0+ for the controller is unchanged by this feature.

**Primary Dependencies**: `@elgato/streamdeck` 3.0.3 and `@elgato/cli` 1.10.3,
both already locked. No new dependency.

**Storage**: N/A. Stream Deck stores a step's assignment the same way as a
key's. Global settings, presets and the managed configuration are unchanged.

**Testing**: `node:test` with `node:assert/strict`, key facades from
`streamdeck/tests/helpers.ts` and the synthetic loopback bridge
`streamdeck/scripts/mock-bridge.mjs`. No Go tests change.

**Target Platform**: macOS 13.5+ with Stream Deck 7.1+. Multi Action step
events require Stream Deck 6.5+, which is already covered.

**Project Type**: Stream Deck plugin over the existing loopback HTTP-to-BLE
controller.

**Performance Goals**: N/A. A step costs the same as a key press.

**Constraints**: No plugin-side ordering or queue. Serialized whole BLE
actions, cooperative cancellation, secret redaction and
`physical_state_verified: false` are preserved. A step must not write a title
or icon.

**Scale/Scope**: Seven actions, one manifest flag each, a small step branch
in `BaseAction`, a diagnostics field, the package check, tests and both
READMEs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Changes stay within the documented package/module responsibilities:
      only `streamdeck/` changes; no Go interface, package or dependency
      change.
- [x] CLI/HTTP, configuration, token, and URL compatibility are addressed:
      all unchanged; a step calls the same routes as a key.
- [x] BLE ordering, retry, cancellation, and device-verification effects are
      addressed: ordering relies on the existing controller gate and the
      owner's Delay (research R4); retries and cancellation are unchanged;
      device rows go to `hardware-verification.md`, and unobserved rows stay
      accepted gaps.
- [x] Diagnostic changes preserve request context and secret redaction: the
      new `multiAction` field is a fixed literal and passes the existing
      allowlist in `Diagnostics.emit`.
- [x] Validation matches the affected code and platform:
      `task plugin:check:software` on macOS; Go checks are not required
      because Go code is unchanged; Spec Kit checks stay local.

Principle V (Testify, GoMock) governs Go tests only. Plugin tests keep the
existing `node:test` convention.

**Post-design re-check (after Phase 1)**: all five gates still pass. The
design adds no package, dependency or HTTP change; see
[contracts/multi-action.md](contracts/multi-action.md).

## Project Structure

### Documentation (this feature)

```text
specs/012-multi-action-support/
├── plan.md                    # This file
├── research.md                # Phase 0 decisions R1–R10
├── data-model.md              # Step, operation flag, diagnostic field
├── quickstart.md              # Automated and owner validation
├── contracts/multi-action.md  # Manifest, events, feedback, diagnostics, packaging
├── hardware-verification.md   # Created during implement: owner observations
└── tasks.md                   # Phase 2 ($speckit-tasks)
```

### Source Code (repository root)

```text
streamdeck/com.obalunenko.mergbw.sdPlugin/manifest.json  SupportedInMultiActions: true on all seven actions
streamdeck/scripts/check-package.mjs                     require SupportedInMultiActions === true
streamdeck/src/actions/base-action.ts                    track steps; no runtime title/icon for steps; flag step operations
streamdeck/src/feedback.ts                               result(): no Accepted title for a step
streamdeck/src/operation-store.ts                        optional multiAction flag on OperationRecord
streamdeck/src/diagnostics.ts                            Diagnostic.multiAction → field multiAction: "true"
streamdeck/tests/multi-action.test.ts                    NEW step behavior for all seven actions
streamdeck/tests/package.test.ts                         hidden action (false or missing flag) is rejected
streamdeck/tests/diagnostics.test.ts                     multiAction field emitted only as the literal
README.md, README_RU.md                                  Multi Action usage, Delay guidance
specs/006-streamdeck-control-plugin/contracts/plugin.md  note: Multi Action ban superseded by 012
```

**Structure Decision**: Plugin changes stay in `streamdeck/`. No new module
or class: steps are the same `BaseAction` instances with a step flag per
context, following the existing `visible` map pattern. `Preset`, `Transition`,
`Brightness`, `PresetRuns`, `DialBrightness`, `InspectorController` and
`Settings` need no change because they already work per context.

## Calls

```text
Stream Deck Multi Action press
  ├▶ keyDown(step A, payload.isInMultiAction=true)
  │    └▶ BaseAction.onKeyDown ─▶ settings.getAction(A) ─▶ operations.acquire({…, multiAction: true})
  │         └▶ BridgeClient.command ─▶ sunset HTTP ─▶ Controller.Execute: admit (gate) ─▶ Connect ─▶ Write
  ├▶ Delay d (owner-configured, Stream Deck timing)
  └▶ keyDown(step B) ─▶ … ─▶ Controller.Execute: waits on the gate until A returns

step willAppear ─▶ settings.receiveAction ─▶ operations.appear ─▶ steps.set(id, key)   (no setTitle/setImage)
step result      ─▶ diagnostics action.<status> {multiAction:"true"} ─▶ feedback.result(step):
                      sent ─▶ showOk · rejected/unknown ─▶ showAlert · accepted ─▶ nothing on the key
step willDisappear ─▶ steps.delete ─▶ operations.disappear ─▶ inspector.close
```

## Implementation by Affected Boundary

1. **Manifest and package check**: Set `"SupportedInMultiActions": true` on
   all seven actions. Use an explicit `true`, not the schema default, so the
   check asserts intent. In `check-package.mjs`, replace
   `action.SupportedInMultiActions !== false` with `!== true`. Add fault cases
   to `package.test.ts` for `false` and for a missing field.
2. **Step behavior in `BaseAction`**: In `onWillAppear`, read
   `ev.payload.isInMultiAction === true` (R2). Steps go into a separate
   `steps` map instead of `visible`, still call `settings.receiveAction` and
   `operations.appear`, and skip `feedback.ready`. The settings/catalog
   refresh loop iterates `visible` only, so steps never get a title or icon.
   In `onKeyDown`, pass `multiAction: true` to `operations.acquire` for a
   step and add the flag to `action.rejected` and `action.started`. The
   operation listener looks up `visible` or `steps` and passes the step flag
   to `feedback.result`.
3. **Feedback**: `Feedback.result(key, record, step)` keeps `showOk` for sent
   and `showAlert` for rejected or unknown. For a step it skips the
   `accepted` title write. `Feedback.invalid` is unchanged.
4. **Operation record and diagnostics**: `OperationRecord` gains optional
   `readonly multiAction?: true`, copied through `acquire`. `Diagnostic`
   gains `multiAction?: boolean`. `emit` writes `multiAction: "true"` only for
   `true`, and the listener in `BaseAction` passes `record.multiAction`.
   Events still carry the flag if the step disappeared before completion.
5. **Tests**: New `multi-action.test.ts`, using the facade and mock-bridge
   patterns from `action-values.test.ts` and `activation-series.test.ts`:
   - each of the seven step kinds sends the same route as the key;
   - a step gets no `setTitle` or `setImage` on appear, on an assignment
     change or on a language change (both drive `refreshDefaults`), and no
     Accepted title, including a dynamic preset step whose repeated press
     follows the key's stop rule;
   - a step with corrupt settings, a deleted preset or no connection sends
     nothing and calls `showAlert`;
   - a repeated press while pending sends no duplicate;
   - after readiness is lost, a step is rejected without a request;
   - diagnostics contain `multiAction: "true"` and no token.

   Existing suites must pass unchanged.
6. **Documentation**: Both READMEs, in the native plugin section: all seven
   actions in Multi Action and Multi Action Switch; a 0.5 s Delay between
   ordinary MeRGBW steps for order (a recommendation, not a measured
   minimum); a Delay as long as a Transition or effect so it can
   play; no Delay means no order guarantee; a failed step does not stop the
   others; a repeated press skips steps still running; a step does not change
   the Multi Action key title. Add a one-line "superseded by 012" note to
   the 006 plugin contract.

## Validation Plan

- Plugin software checks on macOS: `task plugin:check:software` (lint,
  typecheck, tests, build, CLI validate).
- Installer check before owner testing: `task plugin:package` (or
  `task plugin:link` for a local link).
- Go: no Go files change, so `task test:core`, `task test:race`, `task vet`
  and `task build` are not required; run them only if a Go file changes.
  Linux `task check` is optional for this owner and is marked as not run.
- Go formatting: N/A.
- Local Spec Kit checks: N/A.
- Device checks on the owner's Stream Deck with the LT-06, recorded in
  `hardware-verification.md` (rows from spec Verification Evidence 1–9):
  - editor visibility;
  - step panel and persistence;
  - Color → Delay → Brightness;
  - Scene → 0.5 s Delay → Off;
  - Transition 5 s → Delay 5 s → Off;
  - where the deleted-preset alert shows;
  - Multi Action Switch alternation;
  - an unchanged Multi Action key title;
  - a dynamic preset step: the effect continues, the step panel shows status and Stop, and a repeated press of a preset-only Multi Action stops the run.

  The file states the device used: the Stream Deck model, app, macOS and plugin versions, and the LT-06. It never contains the lamp identity, the token or URLs. Unobserved rows are recorded as accepted gaps, not as passed.

A mock-backed test or a build does not verify physical lamp behavior.

## Complexity Tracking

No constitution violations.
