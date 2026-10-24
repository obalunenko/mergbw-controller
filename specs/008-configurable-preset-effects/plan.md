# Plan: configurable preset effects

**Scale note:** Approximately 30 source/test files across protocol/controller, configuration/management, HTTP/CLI and Stream Deck UI. Watch the shared active-job gate and configuration generation boundary; four effects must not become four competing command loops.

## Summary

Add an editor for static presets and the four selected effects to the existing preset panel. Extend the existing controller-owned transition lifecycle to run one effect at a time, with ordinary commands interrupting it. Preserve legacy preset JSON and assignments; save one edited entry through the existing atomic configuration transaction, keeping private settings unchanged.

## Project Structure

Changes stay in the existing packages. New effect files keep the finite-transition compatibility adapter separate from effect definitions and sampling.

```text
cmd/sunset/main.go                         CLI acceptance and dry-run
cmd/sunset/supervisor/main.go              management handler registration
internal/protocol/{protocol,effects}.go    compatible definitions and sampling
internal/controller/{controller,transition,effects}.go
internal/config/{config,managed_config,managed_import}.go
internal/managed/{control,configuration,presets}.go
internal/bridge/{http,presets,transitions,effects}.go
streamdeck/src/actions/{base-action,preset}.ts
streamdeck/src/{bridge-client,operation-store,managed-controller,inspector-messages}.ts
streamdeck/src/{preset-effects,i18n,validation}.ts
streamdeck/src/ui/inspector.ts
streamdeck/com.obalunenko.mergbw.sdPlugin/ui/{index.html,inspector.css}
README.md / README_RU.md
```

Colocated Go tests and the existing Stream Deck test directory cover the corresponding contracts. Regenerate affected GoMock collaborators through `task mocks:generate`; adjust Taskfile only when a changed interface requires a generation command.

**Structure Decision:** Reuse package boundaries, the owned runtime and the current preset action UUID. No new service, dependency, BLE interface or per-effect Stream Deck action.

## Calls

Starting a preset follows the existing capability checks and local HTTP route. Status and cancellation never select an arbitrary replacement job.

```text
Preset key -> BaseAction/ownership check -> BridgeClient -> authenticated preset/<id>
  -> protocol.Resolve -> static Execute OR StartEffect
  -> shared admission -> cancel/drain previous job -> publish one root-owned job
  -> sample -> changed packets -> synchronous Link.Write

Editor -> PI v2 session -> managed-controller -> configuration.presetRead/presetList
Draft -> configuration.preparePreset -> captured full-pair proposal
Review -> configuration.apply -> revoke/drain -> stop/reap -> atomic commit
  -> start configured runtime -> refresh current-generation catalog (no lighting command)
  -> on confirmed create only: assignment.save(new stable ID) for the current key
```

## States and screens

The 2026-10-25 owner-approved UX revision uses separate views within the same Property Inspector. No external app or new action UUID is introduced.

- **Key settings (default after setup):** one selector groups built-in and personal presets. Valid color, brightness, preset and transition assignments save on change without a Save button or lighting command. Preset description reads are generation-bound and cannot open the editor or overwrite a newer selection.
- **Library:** automatically loads personal presets when opened; editing, deletion, refresh and bounded pagination remain explicit.
- **Editor:** a new preset/copy is separate from the selected key assignment. Show only fields for its effect, a visual color picker, percentages, seconds with millisecond precision, and a repeat checkbox. Switching kinds preserves all fields. Shared edits explicitly affect all referencing keys.
- **Review:** capture parameters through the existing prepare RPC, show only the relevant preset summary/scope, then confirm one apply. Explain controller restart and interruption before confirming. Returning to parameters cancels the captured proposal and retains the draft.
- **Saving / unknown:** retain the existing full-pair transaction, generation fences and read-only recovery. Unknown applies never replay and never automatically assign, including after a later recovery check. On known successful creation, refresh the current catalog and assign only if it contains the created stable ID. A failed refresh or changed generation keeps the old assignment.
- **Lamp and connection:** first-run view; later opened from key settings. Preserve manual identity, transient file import, migration guidance, captured setup review and secret handling. Language is configured here.
- **Diagnostics:** controller/service/authorization/Bluetooth, explicit restart/check, effect and transition status/exact-ID stop. An active effect also exposes a Stop control in key settings. Feedback reports commanded execution rather than physical lamp readback.

Follow [Elgato Plugin Guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/#property-inspectors-ui) for automatic action-setting persistence, checkbox/select semantics, validation and compact forms. Keep the locally bundled SDPI library and transient file component; do not change the custom session protocol or delegate validated assignment storage to unvalidated component writes.

## Constitution Check

All six principles pass before research and after reviewing the final data model and contracts. No constitution amendment is needed.

| Principle | Assessment |
| --- | --- |
| I. Package/module boundaries | PASS: protocol validates/samples, controller sequences, bridge routes, management persists, cmd composes. No dependency additions. |
| II. Local command contract | PASS: static GET/POST receipts stay unchanged; dynamic receipts use 202; HEAD has no side effects; status/cancel are explicit. |
| III. BLE effects/cancellation | PASS: one active job and shared gate; cooperative native drain; no retry after uncertain writes; no readback claim. |
| IV. Configuration/secrets | PASS: stable IDs and full-catalog validation; server-side one-entry merge preserves settings/token; PI receives no credentials. |
| V. Boundary verification | PASS: pure sampling, Testify and generated GoMock; synthetic HTTP/process/PI tests without native initialization. |
| VI. Hardware isolation | PASS: software checks never execute the native worker; optional short owner observation remains distinct from tests. |

## Delivery and validation

Implement shared definitions and job admission first, then configuration editing and HTTP contracts, then key ownership and the editor. Each effect uses the same scheduler and has deterministic software tests; candle randomness is injected for tests. Finish with paired documentation, software checks and a fresh local development payload.

Run `task test:core`, `task test:race`, `task vet`, `task build` and `task plugin:check:software` after integration; use focused suites during changes. Keep the existing 220-case plugin baseline passing. Build and inspect a fresh current-Mac spike without executing its native worker from the shell. A local update preserves profiles and private configuration, using the established backup/link procedure. No additional signing, download, clean-install or fault-injection acceptance series is required for this home-use feature.

The implementation handoff uses [research](research.md), [data model](data-model.md) and [contracts](contracts/). No implementation or task completion is claimed by this planning step.
