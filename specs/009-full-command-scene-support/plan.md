# Implementation Plan: full command and built-in scene support

**Feature Directory**: `specs/009-full-command-scene-support` | **Branch**: `master` (no feature branch created)

**Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-full-command-scene-support/spec.md`

**Scale note:** About 15 source/test files. This is a new absolute command
through existing paths; no controller, BLE, config-format or managed-process
changes.

## Summary

The reference `control.py` adds one capability missing here: built-in scenes,
command `0x06` with a one-byte ID. Add a fixed 20-entry scene catalog and raw
IDs `80–93` to `protocol.Resolve` as `scene <slug|HEX>`. This produces
`[power-on, scene]` frames and runs through the unchanged `Controller.Execute`,
whose `admit` already cancels running effects and transitions. The existing
HTTP handler, CLI `send`/`dry-run` and Stream Deck POST path pick it up
through `Resolve`. Add scene links to `streamdeck-buttons.txt`, a seventh
Stream Deck action Scene, and catalog/verification tables in both READMEs.
White remains `color FFFFFF` (see [research.md](research.md) R1).

## Technical Context

**Language/Version**: Go 1.27.0+ for the controller and the separate
`tools/task/` and `tools/mockgen/` modules; TypeScript for `streamdeck/`.

**Primary Dependencies**: Standard library plus `tinygo.org/x/bluetooth v0.16.0`;
Task 3.54.0 in the separate tools module. No dependency changes.

**Storage**: `settings.json` and `presets.json` unchanged. Generated
`streamdeck-buttons.txt` gains scene lines.

**Testing**: Go `testing` + Testify; table-driven protocol tests;
`httptest` for the bridge; existing Stream Deck test suite
(`streamdeck/tests/`). Pure protocol functions need no mocks; bridge tests
reuse existing generated `Controller` mocks, so no new interfaces and no new
mock generation.

**Target Platform**: macOS/CoreBluetooth primary; Linux for automated tests.

**Project Type**: Single-process CLI and loopback HTTP-to-BLE service with a
Stream Deck plugin.

**Performance Goals**: N/A. Two frames per action, same as `color`.

**Constraints**: Serialized whole actions; cooperative cancellation; preserved
tokens/URLs; `physical_state_verified: false`; no claim that a scene is
visible without a hardware record.

**Scale/Scope**: One lamp, 20 named scenes plus 2 unnamed IDs, one new action.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package boundaries: catalog and validation in `internal/protocol`
      (stdlib only); `bridge`/`cmd` consume `Resolve` unchanged; `config` only
      formats URLs from the exported catalog. No interface changes.
- [x] CLI/HTTP/config compatibility: additive route `scene/…`; GET/POST/HEAD,
      Host, token and body rules reused; existing URLs and settings untouched.
- [x] BLE: absolute 2-frame action via `Execute`; existing retry (absolute
      command, safe to repeat) and cancellation unchanged. Device effect is
      pending manual LT-06 verification.
- [x] Diagnostics: existing `command.received`/`command.failed` events with
      `command=scene/…`; token redaction unchanged.
- [x] Validation: `task test:core`, `task test:race`, `task vet`, `task build`,
      `task plugin:check:software`; no Spec Kit checks added to CI.

Post-design re-check: still passes. Contracts add no new endpoint shape beyond
the existing `/<token>/<command>/<param>` form.

## Project Structure

### Documentation (this feature)

```text
specs/009-full-command-scene-support/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/scenes.md
├── hardware-verification.md   # created during implementation, rows pending
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
internal/protocol/scenes.go            NEW catalog, selector parsing
internal/protocol/scenes_test.go       NEW frames for all 22 IDs, rejection table
internal/protocol/protocol.go          Resolve: "scene" branch, messages
internal/protocol/protocol_test.go     Resolve round-trip, no-packet errors
internal/bridge/http_test.go           GET/POST/HEAD scene routes, 400/404, Execute packet count
internal/bridge/logging_test.go        command=scene/…, packet_count=2, token redacted
internal/controller/effects_test.go    running effect cancelled before scene write
internal/config/config.go              URLs(): scene lines
internal/config/config_test.go         URL lines, existing lines unchanged
cmd/sunset/main.go                     usage(): scene examples
streamdeck/src/scenes.ts               NEW static catalog mirror
streamdeck/src/actions/scene.ts        NEW Scene action (BaseAction)
streamdeck/src/plugin.ts               register Scene
streamdeck/src/validation.ts           ActionKind "scene", assignment, link parsing
streamdeck/src/bridge-client.ts        accepted route pattern
streamdeck/src/i18n.ts                 EN/RU labels
streamdeck/src/ui/inspector.ts         scene-controls select, settings-save branch
streamdeck/src/feedback.ts             key title = scene label / "ID 8A"
streamdeck/src/diagnostics.ts          "scene" in action-kind allowlist
streamdeck/com.obalunenko.mergbw.sdPlugin/manifest.json   7th action
streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html   scene-controls
streamdeck/com.obalunenko.mergbw.sdPlugin/imgs/scene{,@2x}.png
streamdeck/tests/scenes.test.ts        NEW catalog pin, route, assignment
streamdeck/tests/feedback-scene.test.ts NEW key title for scenes
README.md / README_RU.md
```

**Structure Decision**: Existing packages only. `scenes.go` is a new file in
`internal/protocol`. No changes to
`internal/controller`, `internal/ble`, `internal/managed`, `internal/logging`.

## Implementation by Affected Boundary

1. **Protocol**: Add `Scene{Slug, Label, ID, ReferenceVerified, DuplicateOf}`
   and an ordered `Scenes()` catalog per [contracts/scenes.md](contracts/scenes.md).
   Add `resolveScene(selector)`: exact slug match, otherwise optional `0x`
   + two hex digits in `0x80–0x93`. Route `scene/<slug>` or `scene/<HEX>`.
   `Resolve` gets a `case "scene"` in the 2-argument switch. Update the
   "нужна команда…" and "неизвестная команда…" messages to list `scene`.
   Tests: exact frames for all 22 IDs, duplicates map to the same frame,
   rejection table (empty, `Disco`, `green prairie`, `7F`, `94`, `8G`, `8`,
   `0x`, extra arg) yields zero packets.
2. **Controller and BLE**: No code change. Add a bridge-level test that a
   scene request calls `Execute` with exactly two packets. Preemption is
   covered by existing `admit` tests; add one controller test that a running
   effect is cancelled before a scene `Action` is written, for FR-005
   traceability.
3. **HTTP, CLI and logging**: The handler already accepts 3-part paths and
   delegates to `Resolve`; add `httptest` cases for GET/POST 200 with
   `action`, HEAD 405, invalid selector 400, bad token 403. CLI: usage lines
   for `send scene disco` / `dry-run scene 8A`. `config.URLs` appends
   `Сцена <Label>` lines for catalog slugs after brightness lines.
4. **Stream Deck**: `scenes.ts` mirrors the catalog (slug, label, id,
   duplicateOf) and exports the contract's route patterns:
   `SCENE_ROUTE_SOURCE`, an unanchored fragment for link parsing, and
   `SCENE_ROUTE`, the anchored canonical form for `bridge-client`. The key title is the scene label or `ID 8A`, and diagnostics
   accept `actionKind: "scene"`. The `Scene` action builds `scene/<sceneId>`. `assignment("scene")`
   validates `sceneId` and defaults to `disco`. Route regexes in
   `bridge-client.ts` and `parseConnectionLink` accept scene routes with the
   `80–93` range check. Inspector `scene-controls` has a `<select>` with an
   optgroup for named scenes and one for raw IDs. Add the manifest entry and
   icon. EN/RU strings. Tests pin the mirror against the contract table and
   cover routes and assignments.
5. **Documentation**: In both READMEs add the scene command, the full table
   with ID and LT-06 status (all "not verified" initially), the duplicates,
   and a note that white is `color FFFFFF`. Create `hardware-verification.md`
   with pending rows `80`–`93`.

## Validation Plan

- Core checks on macOS: `task test:core`, `task test:race`.
- Static/build: `task vet`, `task build`.
- Stream Deck: `task plugin:check:software`.
- Linux full validation: `task check`.
- Go formatting: `gofmt -l internal/protocol internal/bridge internal/config internal/controller cmd/sunset`.
- Device checks (pending, owner's LT-06, macOS): [quickstart.md](quickstart.md)
  steps 2–5. For each ID record observed effect and name match; check effect
  preemption, brightness after scene, and Stream Deck persistence. Results go
  to `hardware-verification.md`; README statuses change only from it.

Full tests and CLI execution can initialize CoreBluetooth on macOS. A build
or fake-backed test does not verify physical lamp behavior.

## Complexity Tracking

No constitution violations.
