# Feature 008 validation

This home-use feature adds palette pulse, strobe, breathing and candle presets. Feature 007 is committed as `8a38bac`; these changes remain a separate working-tree increment. No physical waveform or lamp readback is claimed by software tests.

## Focused implementation evidence

Protocol/config tests pass with compatible static JSON, zero brightness, strict variant fields, null/missing rejection and captured deep copies. Controller tests pass with shared transition/effect admission, separate latest snapshots, native-write draining, uncertain-write no-retry and root shutdown. Bridge tests pass for static 200/dynamic 202, authenticated methods, exact-ID status/cancel and compile-only CLI compatibility. Management tests pass for generation checks, bounded pages/entry reads, private settings preservation, duplicate/missing IDs and last-entry deletion rejection.

Mode-specific mocked-link tests prove three-color endpoints and loop closure, asymmetric strobe phases and finite Off, breathing through zero and peak without RGB changes, and deterministic bounded candle targets/deadlines with no redundant zero-depth writes. They use generated mocks and virtual time, without native initialization.

US1 workers passed five editor-protocol tests and all 26 actual-panel tests, including create/reorder/reopen, each mode, dirty drafts, stale generations, captured deletion and explicit stop. All 25 US6 action/catalog cases pass, including recovery after an uncertain admission followed by a different preset’s terminal run. The resolving press is read-only; the next explicit press can start. Final join typecheck and lint pass; the integrated gate below checks the corrected tree again.

## Requirement coverage

| Requirements | Tests |
| --- | --- |
| FR-001–004, FR-014–016 | `internal/config/effects_test.go`, `internal/managed/presets_test.go`, `streamdeck/tests/preset-editor.test.ts`, `streamdeck/tests/inspector-ui.test.ts` |
| FR-005–006 | `internal/protocol/effects_test.go`, `internal/controller/palette_effect_test.go` |
| FR-007–008 | `internal/controller/strobe_effect_test.go`, `internal/controller/breathing_effect_test.go`, `internal/controller/candle_effect_test.go` |
| FR-009–012, FR-019 | `internal/controller/effects_test.go`, `internal/bridge/effects_test.go`, `streamdeck/tests/preset-effects.test.ts` |
| FR-013 | `streamdeck/tests/effect-contract.test.ts`, `streamdeck/tests/preset-editor.test.ts`, `streamdeck/tests/inspector-ui.test.ts` |
| FR-017 | `internal/protocol/effects_test.go`, `internal/controller/breathing_effect_test.go` |
| FR-018 | `internal/protocol/effects_test.go`, `internal/controller/candle_effect_test.go` |

## Integrated gate and local installation

The corrected source tree passes `task test:core`, `task test:race`, `task vet`, `task build` and `task plugin:check:software`. Each actual command and exit code is recorded by the Companion writer. The plugin software gate includes types, lint/format, **254/254 Node tests**, build/schema/inventory and **27 native-payload fixtures**. Builds and fixture tests do not prove physical lamp state.

The fresh 39-file arm64 spike was compiled and inspected without shell execution of its native binaries, then linked at `dist/plugin-local-effects-20261024/com.obalunenko.mergbw.sdPlugin`. The established update procedure captured a private backup and waited for the previous plugin and owned native processes to exit before changing the installed link. Stream Deck was restarted through its pinned CLI.

| Provenance | Value |
| --- | --- |
| Source revision | `8a38bacbb264ef91e8368be83a45d51f72885c50`, with the feature working tree explicitly dirty |
| Native source SHA256 | `f206027f8e7c23e18794446a542ad402c8a70c6cdfd2fc8189da767cebc8546a` |
| Artifact tree SHA256 | `c39d63bb3351fcbcbc251ec0c6e0c0eacea2e3e4685fea61efb474ed61c34edf` |
| Payload | Current-Mac `spike`, arm64, macOS 13.5 minimum; local ad-hoc signatures verified |

Read-only installed-host checks pass: one supervisor, one worker owned by it, TCC attribution to `com.obalunenko.mergbw.controller` without permission error, compatible health and Bluetooth connected. Private configuration and all **20 current MeRGBW assignment records** remain unchanged against the update backup; managed file modes remain private. These checks sent no lighting commands. The new editor was exercised through its real-panel software fixture, not visually inspected in the installed host. No new physical effect observation is claimed or required to close this software/home-install milestone.

No additional Developer ID, downloaded installer, other-Mac execution, crash/permission/sleep/stress or clean-install qualification is required by the accepted home-use scope. New physical effect observation remains distinct from the existing feature 007 owner confirmations.

## Continuation verification (2026-10-25)

The current working tree includes the preset-group and stock-preset-copy UI cases, bringing the Node suite to **257/257 passing tests**. The inspector's catalog filtering and group selection were simplified to resolve conflicting Prettier/ESLint indentation requirements without changing behavior.

Fresh runs of `task test:core`, `task test:race`, `task vet`, `task build` and `task plugin:check:software` all exit 0. The plugin gate also passes type checking, lint/format, bundle validation, the 30-file software inventory and all **27 native-payload fixtures**. The initial sandboxed plugin run could not open synthetic local sockets (`listen EPERM`); the authorized rerun with local socket access passes.

The Spec Kit convergence prerequisite cannot resolve the existing `configurable-preset-effects.spec.md` because it expects the literal filename `spec.md`; no complete automated convergence result is claimed. The continuation changed inspector source and rebuilt the software bundles; it did not update the installed plugin or perform physical lamp verification.

## Requested installed-plugin update (2026-10-25)

Following the owner's explicit update request, a fresh current-Mac arm64 fixture was built and inspected, then installed at `dist/plugin-local-effects-20261025/com.obalunenko.mergbw.sdPlugin`. The previous plugin and owned native processes drained before replacement. Private backup `20261024T204744Z` retains profiles, plugin data, standalone/managed configuration and the previous plugin link; the pinned Stream Deck CLI linked and restarted the replacement successfully.

All 39 installed payload files match artifact-tree SHA256 `0dc7324ba19ba4db90782b13b5067c08b25992698060aae9e170d7722f1e95b4`; only the expected runtime log was added after startup. Native source SHA256 is `6e2c80f6bbe833a861378f95420022ec94b291ed94e960716d20359eb39caed7`. Software assets match the build that passed the 257-case gate. Plugin manifest version remains `0.2.0.0`.

Post-update checks pass: exactly one supervisor and its one owned worker, correct controller-bundle TCC attribution without permission error, compatible health and Bluetooth connected. All **20 MeRGBW assignment records**, standalone source bytes, active managed generation/settings/token/presets and private modes match the update backup. These checks sent no lighting commands and make no new physical-state claim.

## Owner-approved inspector UX implementation (2026-10-25)

The approved “key and library” design is implemented in the existing inspector: separate key/library/editor/review/setup/diagnostics views, one grouped preset selector, valid action settings saved on change, and an explicit shared-preset transaction. The editor uses a color picker, percentages, seconds with millisecond precision and a repeat checkbox. Changing effect kind preserves all draft fields. The create-and-assign follow-up requires known successful commit, a refreshed same-generation catalog containing the captured ID, and an unchanged assignment. A newer local choice or external assignment wins. Unknown commits retain the draft and require read-only recovery, without replay or automatic assignment.

FR-020–025 are covered by the updated streamdeck/tests/inspector-ui.test.ts, including grouped selection/autosave, captured create-and-assign, unknown-save recovery, delayed description replies, parameter preservation, failed refresh, generation change and newer assignments. Existing tests retain coverage of queued saves, invalid/stale drafts, deletion, transient imports, session isolation and exact-run cancellation.

The final task plugin:check:software exits **0**: lint/format, type checking, **265/265 Node tests**, both bundles, manifest validation, the **30-file software inventory**, and **27/27 native-payload fixtures**. The final git diff --check exits 0. The sandboxed suite initially rejected local HTTP sockets; the authorized rerun passes. No Go source was changed for this UX revision, so the earlier core/race/vet/build results above remain historical evidence rather than newly rerun checks.

A fresh **39-file arm64 spike** was built, ad-hoc signed and inspected without invoking native binaries from the shell. Installed link: dist/plugin-local-ux-20261025/com.obalunenko.mergbw.sdPlugin. Source revision is 8a38bacbb264ef91e8368be83a45d51f72885c50 with the feature working tree dirty; native-source SHA256 is 6e2c80f6bbe833a861378f95420022ec94b291ed94e960716d20359eb39caed7. Artifact-tree SHA256 (sorted relative filename, NUL, bytes, NUL; excluding runtime logs) is 4902f7de0b8fe576ad95b99d2bdb9e222c9aecf6f012209353080e8751919afd.

Before replacement, profiles, preferences, managed/standalone configuration and the previous link target were copied to the private local backup /private/tmp/mergbw-ux-backup-119eb5nx. The pinned CLI stopped the old plugin; its supervisor/worker exited before unlink/link/restart. After updating, all **20 MeRGBW assignment records**, managed configuration bytes, standalone source bytes and current software assets match their expected snapshots. Read-only checks report exactly one plugin, one supervisor and its one worker, successful health, Bluetooth connected and an authenticated six-entry preset catalog. No lighting commands were sent. These checks do not establish physical lamp state or a visual inspection of the installed Property Inspector; interactive UI behavior was exercised through the actual-entry-point automated facade.

## Commit and PR preparation (2026-10-25)

Fresh pre-commit runs of task test:core, task test:race, task vet and task build all exit 0; cached Go test results are reported as cached. Changed Go files are gofmt-clean and git diff --check passes. The unchanged final inspector source retains the 265-test/27-fixture software-gate result recorded above.

The owner's subsequent explicit update request reloaded the already-current linked UX build through the pinned Stream Deck CLI. A fresh private backup was captured before restart. Read-only post-restart checks again confirm preservation of all 20 assignments, managed configuration and standalone source bytes, current installed software assets, one plugin/supervisor/owned worker, compatible health and authenticated catalog. No lighting commands or physical-state verification were performed.
