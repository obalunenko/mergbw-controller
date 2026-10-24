# Implementation evidence

Feature: [bundled controller](spec.md). Baseline recorded 2026-10-22.

## Current home-use acceptance

The owner stopped additional manual rounds and accepted a home-use milestone. The installed numeric-dial fixture is working on the current Apple Silicon Mac/LT-06. The recorded software gates and positive owner observations below support this milestone. Unperformed extended scenarios are [deferred, not passed](deferred-validation.md). Historical baseline tables and earlier pending/failed checkpoints are retained as history, not current completion gates. Existing runtime protections and automated regression requirements are unchanged.

### Current evidence by requirement area

| Area | Home evidence | Deferred limits |
| --- | --- | --- |
| Setup/import/data, FR-001–009/020–021; SC-001–003/008–009 | Actual local first import/link, private config/source preservation, complete current assignment comparisons across updates, saved copy/base isolation; software manual/import/storage/export fixtures pass | Additional clean-user/manual-first-setup, EN/RU picker/export and systematic constant-fixture retention rounds |
| Ownership/recovery/compatibility, FR-010–019/022–025; SC-004–007 | Real helper TCC attribution, one owned runtime, active-transition host quit releases processes/lock/port, relaunch with saved data/BLE and no replay; process/fault/auth/unknown-result suites pass | Installed deny/re-enable, forced death/socket/sleep-wake, foreign-port/host-timeout injection and raw native packet capture |
| Controls/dials/transitions, FR-013/029–033; SC-010–012 | Owner baseline On/Off/orange/25–75/forest, dial direction/reversal/limits/Off/ceiling/reactivation/readability, 1/60-second RGB fades, direct cancel, button/dial interruption and preserved light across quit/relaunch; latest 220 Node cases pass | Calibrated readback/timing and additional fault/stress rounds; physical_state_verified remains false |
| Build/distribution/docs, FR-001/025–028; SC-009 | Inspected 39-file arm64 spike locally linked; native hashes/modes/privacy/licenses/signatures and data preservation pass; packaging/release/workflow software fixtures pass; paired docs match current controls | Universal installer/other-Mac execution and Developer ID/download/quarantine qualification are not claimed or required for this home milestone |

The final code gate is the recorded **Numeric dial display complete plugin gate**: 220/220 Node tests, types/lint/format/build/schema/software inventory and 27 native-payload fixtures. Earlier complete core/race/vet/build and release/workflow gates passed; subsequent changes were TypeScript/UI/docs only. These recorded runs are not described as newly executed at closure. The current linked fixture and exact provenance remain in the numeric-display section.

## Baseline

- Branch: `develop`; commit `b57139f7c0f0e51c9b11a07999d55f266105df9e`.
- Initial working tree: only this untracked feature directory. No application changes existed at implementation start.
- Initial host: Darwin arm64, macOS 27.0.1. Subsequent Linux arm64 container evidence is recorded below; Intel Mac execution remains unobserved.
- Existing `cmd/sunset/main.go` binds `tcp4` using `Settings.Address()`, and composes shutdown with a root cancellation context.
- `internal/bridge/http.go` validates Host, token and parameters; lighting commands accept GET/POST, HEAD cannot execute them. Health is not authorization or physical-state evidence.
- `internal/controller/controller.go` serializes whole actions through `Link`; `bridge.Controller` and `controller.Link` remain the compatibility boundaries.
- `internal/config/config.go` requires an explicit identity, creates only missing files and preserves existing tokens/catalogs on repeated initialization. Current flat CLI files remain supported.
- `internal/ble/doc.go` documents import-time CoreBluetooth initialization and cooperative cancellation. Ordinary verification must not execute the native worker, including help/version commands.
- No private settings, presets, identifiers or access tokens were read. No native controller, host install or lamp operation was executed.

## Historical baseline requirement matrix (superseded by home acceptance below)

`Software pass` refers to the executed macOS/Linux suites recorded below. It does not close required installed-host, signed-distribution or physical gates. `Pending` identifies missing actual observations. The original smooth-transition prerequisite is superseded by the implemented 1–60-second increment recorded below. Test filenames are under `streamdeck/tests`, `internal/config`, `internal/managed` or their named package; detailed scenarios remain in [spec.md](spec.md), [tasks.md](tasks.md) and [quickstart.md](quickstart.md).

| Requirement | Behavior to verify | Planned tasks | Evidence |
| --- | --- | --- | --- |
| FR-001 | One installer, both Mac architectures, no developer/runtime download requirement | T024, T062–T073 | Software pass: `package.test.ts`, `test_plugin_native.py`; actual signed universal installer and both Mac first runs pending T072–T073. |
| FR-002 | Only the owned bundled controller | T014, T017, T041, T052 | Software pass: `managed-controller.test.ts`, `managed-errors.test.ts`, supervisor foreign-port/ownership fixtures. No external plugin mode. |
| FR-003 | Shared manual/import setup and command gate | T015, T020–T022, T028–T035 | Software pass: `manual-setup.test.ts`, `configuration-import.test.ts`, `inspector-ui.test.ts`; actual picker/setup pending T025/T073. |
| FR-004 | Identity validation and preserved repeated setup | T003, T007, T015, T020 | Software pass: `managed_config_test.go`, `configuration_test.go`, `manual-setup.test.ts` preserve repeated settings/token/catalog. |
| FR-005 | Validated complete import, unchanged source files | T026, T028–T031 | Software pass: `managed_import_test.go`, `configuration-import.test.ts` capture/validate sources without changing them. |
| FR-006 | Whole-file preset preservation/default rules | T007, T026, T029 | Software pass: canonical config/default and whole-catalog fixtures in `managed_config_test.go`, `managed_import_test.go`. |
| FR-007 | Pre-commit preservation, post-commit read-back, no automatic retry | T015, T020–T021, T026, T030, T033, T050 | Software pass: all pair/pointer failpoints in `managed_store_failure_test.go`, lost-confirmation and read-only recovery in `configuration-import.test.ts`/`inspector-ui.test.ts`. |
| FR-008 | Confirmed replacement after old-work cleanup | T026–T031 | Software pass: `configuration_test.go`, `configuration-import.test.ts`, `managed-controller.test.ts` confirm before replacement and join revocation/reaping. |
| FR-009 | Identity-required migration preserving assignments | T027, T032–T037 | Software pass: `migration.test.ts`, `assignment-lifecycle.test.ts`, `managed-upgrade.test.ts`; actual host artwork/migration pending T073. |
| FR-010 | One worker/connection for every button/profile | T011–T014, T017–T019, T046–T048 | Software pass: `supervisor_baseline_test.go`, `managed-lifecycle.test.ts`, `host-liveness.test.ts`; installed lifetime pending T048/T058. |
| FR-011 | Private ownership proof and distinct authorization/BLE | T014, T017, T019, T051–T052 | Software pass: exact descriptor/bootstrap and capability fixtures, shared payload tamper tests and `managed-errors.test.ts`; installed TCC pending. |
| FR-012 | Setup/check writes zero lamp commands; permission guidance | T015, T023, T025, T054, T058 | Software pass: manual/import/PI/read-only/catalog fixtures assert zero control writes; actual Bluetooth permission/setup pending T025/T058. |
| FR-013 | Five actions, EN/RU and user artwork retained | T023, T036, T056, T061 | Software pass: `action-values.test.ts`, `activation-series.test.ts`, `power-actions.test.ts`, `inspector-ui.test.ts`, `managed-upgrade.test.ts`; host retention pending T073. |
| FR-014 | Plugin/host shutdown, cancellation and no extra Off | T038–T048 | Software pass: process/supervisor lifecycle, Node shutdown/lease and controller cancellation fixtures; installed quit/disable pending T048. |
| FR-015 | Parent-loss cleanup without competing worker | T011–T013, T038–T048 | Software pass: actual non-BLE pre-main/EOF/TERM/KILL/Wait and inherited FD/lock fixtures; installed native/simultaneous-loss boundary pending T048. |
| FR-016 | Honest cooperative cancellation and unknown effects | T045, T048, T054, T056, T078 | Software pass: generated-Link cancellation, unknown HTTP results and EN/RU guidance; physical effects pending T078, smooth-fade scope unresolved. |
| FR-017 | Full-chain explicit recovery without probe/command accumulation | T039, T042, T046, T050, T053–T058 | Software pass: host broker, failed/exited-helper recovery and stale-session tests; explicit recovery maps held installation lock to cleanup_blocked. Installed T058 pending. |
| FR-018 | Foreign-port conflict, no probe/adoption/kill | T008, T011, T049–T052, T058 | Software pass: real temporary foreign listener, new-port reservation and zero-launch/no-probe fixtures in supervisor/configuration tests; installed T058 pending. |
| FR-019 | Distinct errors, next steps and unknown outcomes | T050–T058 | Software pass: `managed-errors.test.ts`, `worker_status_test.go`, `inspector-ui.test.ts` and diagnostics distinguish safe causes/outcomes. |
| FR-020 | Persistent data and unknown-version preservation | T009, T032, T061, T073 | Software pass: immutable store/current-pointer and `managed-upgrade.test.ts`/`migration.test.ts`; actual installed update pending T073. |
| FR-021 | Secret-free logs, errors and exported profiles | T027, T036, T055–T056, T061, T066, T073 | Software pass: Go logging/HTTP hostile-error tests, `diagnostics.test.ts`, export/upgrade and private-content package fixtures; installed export pending T073. |
| FR-022 | Loopback/Host/auth/GET/POST/HEAD and standalone CLI retained | T012, T056, T070–T071 | Software pass: bridge Host/auth/GET/POST/HEAD tests, canonical CLI config/workflow/archive fixtures and native composition builds. CLI/native worker was not executed. |
| FR-023 | Whole-action serialization, no uncertain retry | T045–T047, T056 | Software pass: controller whole-action serialization/cancellation and mocked BLE retry/backend tests; no detach/retry/replay added. |
| FR-024 | No claim of verified physical state | T023, T051, T054, T056, T078 | Software pass: HTTP, catalog, client, action and PI fixtures retain physical_state_verified=false and unknown outcomes; no readback claim. |
| FR-025 | No permanent service or independent autostart | T024, T048, T074 | Software pass: finite payload/release fixtures and paired lifetime documentation; no service/autostart installer. Installed lifetime pending T048. |
| FR-026 | Complete package/release with four standalone archives | T059–T072 | Software pass: two-slice/artifact/package/release gates retain four CLI archives; actual signed installer pending T072. |
| FR-027 | Paired README and release setup/migration instructions | T071, T074, T079 | Paired README and generated release setup/migration instructions reviewed; all release fixtures pass. Final hardware-dependent reconciliation T079 pending. |
| FR-028 | BLE-free software checks and separate real-hardware acceptance | T013, T025, T037, T047–T048, T057–T058, T072–T079 | Mac/Linux software suites pass without native Bluetooth; installed/signing/physical gates remain explicit and unchecked. |
| SC-001 | Clean no-Terminal setup on each Mac architecture | T025, T072–T073 | Pending T025/T072/T073: no actual no-Terminal downloaded first run on either Mac architecture. |
| SC-002 | Import preservation and accurate uncertain-save read-back | T015, T026, T030, T033, T037 | Software pass: Go failpoints/captured import plus Node confirmation/read-back fixtures; no source mutation, key merging or repeat apply. |
| SC-003 | Ten assignments and config retained through three restarts | T036–T037, T061, T073 | Software pass: ten five-kind SDK assignments/artwork plus disk config across three replacements/restarts; installed T073 pending. |
| SC-004 | At most one owned controller, no pre-ready/foreign commands | T013–T014, T046–T048, T057–T058 | Software pass: single ownership, exact readiness, inherited orphan locks, foreign port and stale capability tests; installed T048/T058 pending. |
| SC-005 | Confirmed cleanup/full-chain recovery, zero Off/replay | T038–T048, T050, T053, T058 | Software pass: actual non-BLE reaping plus Node lease/drain/recovery/no-Off/no-replay fixtures; installed native lifetime pending T048/T058. |
| SC-006 | Zero setup/check/recovery writes, one command per normal press | T015, T025, T036, T056, T058, T078 | Software pass: setup/check/recovery zero-write assertions and 100 single-activation SDK dispatches; physical/installed observations pending. |
| SC-007 | Distinct actionable failures and unverified physical state | T049–T058 | Software pass: safe actionable categories, unknown outcomes and physical-state warnings in backend/DOM tests; actual permission attribution pending. |
| SC-008 | Secret-free diagnostics/export and local-setup gate | T036, T055–T056, T061, T066, T073 | Software pass: hostile redaction, secret-free assignments/profile and local-setup gates; actual host export/import pending T073. |
| SC-009 | Complete offline installer, retained CLI archives and paired docs | T059–T074 | Software/tooling and paired instructions pass; complete signed offline installer and actual downloaded installation pending T072/T073. |
| SC-010 | Observed LT-06 effects and interrupted transition | T078–T079 | Partial: owner-observed On/Off, orange Color and corrected key feedback. On/Off, orange Color, brightness 25/75 and forest green are owner-observed; active-transition host quit/relaunch without Off or continuation is owner-observed; aggregate setup/recovery acceptance remains pending; transition software is implemented. |

## Historical baseline execution gates

| Gate | Current evidence |
| --- | --- |
| Toolchain/dependency prerequisites, T002 | Go 1.27.3, isolated Node 24.22.1, Task 3.54.0, mockgen v0.6.0; all 16 installed direct JS dependencies match package.json pins |
| Foundations, T003–T013 | Core/race, vet, native compile and 13 Task workflow fixtures pass; plugin UI implementation is next |
| Current-Mac TCC fixture, T025 | Pending; separate test user and actual Stream Deck observations required |
| Installed lifetime/recovery, T048/T058 | Pending; synthetic results alone cannot close these tasks |
| Signed universal installer, T072 | Pending; both source-matched native slices and external signing/notarization prerequisites required |
| Actual downloaded install/upgrade, T073 | Pending separately on Apple Silicon and Intel |
| Linux full checks, T076 | Pass in isolated Linux arm64 container; final task check, plugin software, release/workflow/native fixtures exit 0; details below |
| LT-06 physical effects, T078 | Pending; actual local observations required |

Connection, packet-write success and build success cannot close physical acceptance. Required unavailable observations leave their tasks unchecked and prevent feature completion.

## Prerequisite checks

- `task test:core` passed against the unchanged application baseline. Companion captured the command, exit code and result.
- Go 1.27.3 satisfies all three module directives (`go 1.27.0`). Task 3.54.0 and mockgen v0.6.0 match their separate tool-module pins. Existing tools did not need reinstalling.
- The login shell uses Node 26.8.1. A separate Node 24.22.1 was installed under `/private/tmp/mergbw-feature007-node24-native`; plugin checks use its `node-bin-darwin-arm64/bin` directory at the front of PATH. No project dependency pin or global Node installation was changed.
- The first generic npm Node installer stalled in its architecture-install subprocess; the architecture-specific package installed successfully. npm's script approval was scoped to that disposable installer directory. This is a developer prerequisite only, not a runtime download in the plugin.
- Installed TypeScript 5.9.3, SDK 3.0.3, Elgato CLI 1.10.3 and the other 13 direct package versions exactly match `streamdeck/package.json`. Xcode command-line tools are selected; SDK reports 27.0. Native output must still explicitly target macOS 13.5.

## Foundation checks

T003–T013 add canonical settings/catalog APIs, a private immutable-generation store, bounded private framing/dispatch, exact-child process adapters, inherited lock/listener ownership, a BLE-free supervisor and additive managed worker composition.

Passed on the recorded Darwin arm64 host:

- `task mocks:generate`: pinned GoMock generation includes the new filesystem and process boundaries.
- `task test:core` and `task test:race`: include `internal/managed`. Tests cover strict framing, bounded requests, sanitized errors, independent revocation dispatch, private storage modes, invalid/unknown pointers, symlink rejection, atomic active pairs and retained generations.
- Supervisor fixtures cover no host proof, foreign port with zero launches, parent loss while spawn is still in progress, exact-handle signal/reaping and retained reservation until a live parent acknowledges transport revocation. Process handles are generated mocks. Actual non-BLE child-process/FD integration remains T040.
- `task workflows:test`: 13 fixtures pass. No Task workflow starts native Bluetooth during these checks.
- `task vet` and `task build`: pass. The native worker is compiled, never executed.
- `CGO_ENABLED=0 go build -buildvcs=false -o /private/tmp/mergbw-feature007-supervisor ./cmd/sunset/supervisor`: passes without executing the helper.
- `go list -deps ./cmd/sunset/supervisor`: 209 packages; inspected closure excludes `internal/ble`, `internal/ble/native`, TinyGo Bluetooth and cbgo.

Sandbox initially denied Go cache access and a test-only loopback bind. The approved rerun passed; those failures were environment restrictions, not accepted failing tests. A separate temporary Go cache is also available for checks that need no loopback socket.

These results are partial requirement evidence. They do not complete plugin setup/import, installed-process lifetime, two-architecture distribution or physical LT-06 acceptance. No Stream Deck install, signing, native execution or lamp command occurred.


## US1 software and early-host gate (T014–T025)

The software path now uses one shared managed runtime, with v2 language-only globals, retained pending v1 source, v1 per-key assignments, manual manufacturer-data identity Prepare/Apply/Confirm/Cancel and read-only configuration checking. No external-server choice remains. Owned bootstrap permits only health/catalog reads; command capability requires current session/generation/launch, current private connection and the exact AbortSignal. Revocation aborts and drains transports before the live helper receives acknowledgment and its stdin closes.

Focused automated evidence uses synthetic identities/tokens, SDK/process/DOM facades and temporary generation stores. It covers all five action contexts, zero setup/check control writes, one command per explicit normal press, strict v2 payload allowlists, stale session/read rejection, equal-save preservation, private candidate IDs, before-commit failure versus lost confirmation, unknown-state blocking/read-only recovery, and a committed save remaining applied when SDK legacy-global cleanup fails. The Go transaction test composes a generated-mock worker with real private storage and confirms the old generation remains active until worker exit and runtime.revoked. These are software observations, not lamp or installed-host evidence.

The standalone `scripts/plugin-native.py spike --output-root <absolute-directory>` builds only the current Mac payload, stages allowlisted built JS/UI/privacy resources, applies ad-hoc signatures and inspects architecture/macOS minimums without invoking either native executable. Eight fixture tests verify finite contents, exact metadata/hashes/modes, no native/host execution, symlink rejection, overwrite rejection, missing JS/architecture/minimum failures and full-package rejection of a spike. The complete package/release workflow remains a later phase.

**T025 remains Pending and unchecked.** No isolated separate macOS test user or actual Stream Deck/TCC session was provided for this run. The implementation has not created a user, replaced a live same-UUID installation, linked the spike, launched the native worker, requested Bluetooth permission, read private lamp settings or sent a real lamp command. The parent agent ran the standalone spike CLI successfully against `/private/tmp/mergbw-feature007-spike-review-1` after the owned JS build. It compiled both Darwin arm64 executables, verified their actual macOS 13.5 load commands, applied/verified ad-hoc signatures and accepted the finite hashed payload inventory. This 8.7-second build/inspection run executed neither native executable and is not TCC or installed-host evidence.

Required missing host observations are: actual prompt owner/text; first allow, deny and re-enable without a prior Terminal Bluetooth grant; manual setup in the isolated Stream Deck user; one shared native worker; cleanup on plugin/host exit; and zero setup/check lighting-control writes. They must originate from Stream Deck using the early quickstart steps. Host/plugin restart may be used for permission re-enable until panel recovery is implemented. Other architecture, import, actual downloaded installer/distribution and physical lamp effects remain separate pending acceptance. Software tests or ad-hoc signing cannot close this gate.


US1 verification results: the final targeted Node 24 union of `managed-controller`, `managed-settings`, `manual-setup`, `inspector-messages` and `inspector-ui` passed (39 cases: 12 + 3 + 6 + 6 + 12). The eight spike fixture tests passed. The five focused `TestManualConfiguration*` Go cases passed with approved test-only loopback access. Defined `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build` passed. An initial lint run found sortable unions and nested-fixture indentation warnings; those were fixed and the recorded final lint is clean. Sandbox-only loopback denials were rerun under existing authorization and are not accepted failing tests.

## US2 import and migration software (T026–T037)

The importer captures selected regular, non-executable JSON sources read-only during Prepare. It bounds each absolute path to 4096 UTF-8 bytes and each file to 1 MiB. Settings retain the complete imported identity, port and secret. A selected custom-only catalog remains custom-only; omitted presets preserve the whole active catalog or initialize defaults when there is no active catalog. Confirmation uses captured canonical values, without reading sources again. Synthetic tests compare source bytes, mutate/delete sources after review, and reject malformed, missing, empty, oversized, unreadable and unsafe selections.

Pure config proposals allocate one private candidate generation and transaction ID, retain an immutable deep copy, require an explicit null-or-ID expected generation, and bind one pending review to a distinct PI owner session for five minutes. The pending review is invalidated by replacement/cancel/session change, while bounded completed-attempt records support private read-back. Concurrent panels cannot overwrite a newer generation, and repeated or failed attempts cannot apply twice or rotate the token. Equal data preserves the generation and ready capability without revocation or worker restart.

Generated ManagedFiles/ManagedFile GoMocks exercise each settings/presets/pointer open, write, sync and close failure, generation and pointer rename failures, containing-directory durability failures, and pointer rename returning an error after actually replacing it. Read-back distinguishes applied, not_applied, unchanged and commit_unknown. An unreadable authoritative pointer blocks mutations; a successful read-only reload restores knowledge without guessing an unrelated historical attempt's outcome. The previous complete generation remains available. No automatic rollback or second apply occurs.

A changed candidate holds a new-port listener before staging or stopping the old worker. The conflict fixture verifies the old process/configuration remain untouched and no worker is launched on the foreign port. A composed configuration fixture verifies worker exit and private transport-revocation acknowledgment precede pointer commit. The plugin proactively revokes admissions, aborts and drains HTTP transports, and acknowledges the old binding before issuing its mutating RPC. A rejected changed save reports Not saved and failed plugin readiness; it does not claim the old process was stopped. A committed save remains Saved if globals cleanup or runtime launch fails.

The v2 inspector has required-settings/optional-presets vendored sdpi-file controls without SDK auto-persistence. Selection is cleared after prepare/cancel. Review shows safe identity/port/catalog-count transitions and a hidden-secret change flag. EN/RU guidance covers full-import authority, whole-file/no-key-merge catalogs, legacy endpoint/link identity limitations, explicitly preserving valid old port/secret during manual setup, stopping the old external sunset, expiry and read-only outcome checking. Lost supervisor replies are reconciled without replay. A lost PI apply response has an apply-only timeout/send-loss path that permits read-only checking and never resends the write.

Synthetic migration fixtures retain v1 globals until a committed disk read, preserve valid language and ten five-kind assignments across three reloads, and leave host-owned title/image data untouched. Unknown/corrupt globals are retained without reset. A failed SDK cleanup cannot import stale credentials over managed disk on the next load. Missing custom presets remain unavailable without substitution, and clean-profile copies require local setup. Private current-secret safety also rejects secret-bearing preset IDs before readiness and after runtime failure, independently of command capability. Authoritative generation or same-ID connection changes revoke old launch ownership before new private credentials are published; read-only checks perform no foreign health/catalog request or automatic launch.

Recorded software verification on this Darwin arm64 host:

- `task test:core` and `task workflows:test`: pass after the final Go integration.
- Focused `go test -race ./internal/config ./internal/managed` transaction/import/configuration scenarios: pass, including source capture, all storage failpoints, panel ownership/staleness, new-port conflict and the old-worker exit/revocation barrier.
- Node 24 owned union: 67 cases pass across configuration-import, migration, manual-setup, inspector-ui, managed-controller, assignment-lifecycle, diagnostics and settings.
- Project-defined plugin typecheck, lint with zero warnings, and format check: pass.

All runnable evidence was captured with Companion --verify-run and its recorded exitCode inspected. An initial expected-red import check reported the missing CaptureImport function; it is resolved. A cached-commit unreadable-state defect was fixed. Obsolete v1 diagnostic fixtures were moved to v2 with distinct request IDs; their redaction assertions now execute and pass. Sort/indent lint warnings were fixed. Sandbox-only synthetic loopback denials were rerun with authorized access and are not accepted failing tests.

This is software evidence only. No production settings, Stream Deck installation, native worker execution, Bluetooth permission prompt, signing credentials or lamp commands were used. Actual installed file selection/update and observed host artwork persistence remain separate US5 acceptance; T025 and the other manual/signing/architecture/physical gates remain pending.

The final US2 composition check also passes `task vet`, `task build`, and a separate `CGO_ENABLED=0` supervisor build. These commands compiled the changed registration/composition paths without executing either native binary.

## US3 lifetime and recovery software (T038–T047)

The live-parent stop sequence is invalidate admissions, abort and join HTTP transports, receive the matching runtime.revoked acknowledgment, then close supervisor stdin. Host timeout stops renewals immediately; a stalled drain retains the pipe. Shared revocation work always enforces the acknowledgment, including when a weak worker-state callback overlaps a strong shutdown. An acknowledgment failure retains the old binding/pipe; a new explicit recovery can retry that idempotent barrier instead of remaining trapped behind a cached rejected shutdown promise. Signal coordination exits Node after successful cleanup even if the SDK socket keeps its event loop active. A stalled or failed cleanup does not force that exit. The final process-exit hook remains synchronous.

The supervisor reports cleanup_blocked after the ten-second TERM grace, sends KILL through the actual owned handle and still joins Wait. Pending replacement requests fail at that point; they cannot silently resume after a later exit. A separate full-cleanup join keeps signal/protocol-fault control loops and independent revocation watches alive after that early error. Listener/lock ownership remains through actual reaping and the live parent's revocation barrier. Startup failure cannot be overwritten by a late Starting event or Bluetooth telemetry. No unknown PID is adopted or killed.

Actual non-BLE child fixtures exercise init-before-main stalls, ignored TERM, delayed EOF exit, stdout loss, stderr flooding and inherited descriptors. The delayed fixture ignores TERM so its measured EOF delay is actually exercised. The descriptor test closes every parent copy and proves the child's inherited lock/listener still exclude competitors until actual Wait. An independent helper process uses the production supervisor composition with injected temporary paths and pipes: real parent EOF during a pre-main stall reaches independent watches, escalates after the real grace and reaps the worker; free lock/port afterward confirms no synthetic worker survived. A separate independent-helper test rejects the installation lock still inherited by a leftover synthetic worker and announces no competing session/worker. Started fixture handles have failure cleanup; an explicit fixture-only sixty-second failsafe bounds otherwise immortal synthetic orphans. No such failsafe or abandoned native-write goroutine was added to the production worker.

The process-wide public-SDK probe broker retains one observer on the unsettled raw request across helper sessions. Local epoch waiters are removed on stop/timeout. Recovery waits at most five seconds for an expired request, discards its late success or rejection, then requires a fresh five-second reply. Repeated clicks coalesce; an unresolved old call or failed fresh proof starts no replacement. Old epochs cannot renew a lease. Polling replies are never saved or activated as settings.

Synthetic multi-key/profile/last-key and three-restart scenarios retain one shared runtime and private configuration/token. Explicit recovery waits for the old owned helper exit, reads authoritative configuration in a fresh session, rejects a stale requested generation before worker start, and redoes private bootstrap/authenticated reads. Late old session, launch, readiness, catalog and command callbacks cannot restore capability or repaint the new runtime. Old sent/unknown commands still finish bookkeeping. Current Bluetooth telemetry, read-only reloads and language changes notify/repaint without rotating a valid command's connection revision. Changing launch/configuration/private connection or abort signal invalidates it. A real temporary HTTP fixture aborts an accepted command as unknown, joins its transport before revocation and repeats fresh authorization without replay or an extra Off.

Worker private-pipe loss cancels its root and joins the private reader. Generated Link expectations prove a current synchronous write is joined while queued and remaining action packets cancel, with no Off, retry or replay. These are ordinary existing packet sequences. No smooth-transition API exists in the baseline; no fade implementation or physically observed transition-interruption claim is added by this phase.

Verification on this Darwin arm64 host, recorded through Companion --verify-run with exitCode inspected:

- Focused lifecycle/process/worker-root/controller checks pass, including the independent helper's real EOF/TERM/grace/KILL/reaping path; the focused race run passes all three tested packages.
- Project `task test:core`, `task test:race` and `task workflows:test` pass. CORE_PACKAGES now includes only the BLE-free `./cmd/sunset/supervisor` in addition to existing core packages, so the independent-helper regressions remain in both default macOS suites. A dependency-closure check excludes `internal/ble`, `internal/ble/native`, TinyGo Bluetooth and cbgo; native `cmd/sunset` is never executed. Fourteen Task workflow fixtures include a dry-run assertion for this safe default inclusion.
- The final Node 24 lifecycle/host/managed-runtime/assignment/settings/inspector/catalog union passes all 60 cases. Five older catalog fixtures initially sent obsolete v1 PI envelopes and reused a completed request ID; only their envelopes/IDs were migrated, preserving all catalog, missing-ID, authorization and stale-reply assertions.
- Project plugin typecheck, lint with zero warnings and format check pass. `task vet` and `task build` pass; the native worker was compiled, never run.

Initial sandbox-only loopback denials were rerun with authorized fixture access. A nested callback indentation lint warning was corrected; final checks are clean. This is software/process/descriptor evidence, not installed Stream Deck, native Bluetooth, lamp-state or other-architecture evidence.

**T048 remains Pending and unchecked.** Actual Stream Deck quit, disable/restart, forced Node death, socket loss and sleep/wake observations were not performed. No production settings, host installation, native sunset invocation, permission prompt, signing credentials or lamp commands were used. The required owned-worker disappearance, lease timing and absence of competition on installed hosts remain manual observations.

If the plugin and supervisor are both killed before the worker's own pipe watch can run, no surviving supervisor can promise timely termination of a child blocked in native initialization. Its inherited lock/listener still exclude a competing worker; recovery must report blocked ownership rather than kill/adopt an unknown PID. Confirmed helper exit alone is insufficient evidence of native-worker exit after such a fatal helper loss. Process termination also cannot establish which already-started packet reached the lamp. These simultaneous-loss and physical-effect limits remain explicit; fixtures do not close T048 or the physical acceptance gates.

## US4 actionable errors and explicit recovery software (T049–T057)

The panel now exposes Restart controller in EN/RU. Repeated clicks coalesce into one backend recovery. A live helper uses its reserved-listener restart; a lost helper or closed pipe requires transport drain, lifetime closure, confirmed owned-handle exit, fresh broker host proof, a new session and installation-lock acquisition. Authoritative configuration is reread and the expected generation checked before a worker can start. Retained orphan locks block replacement. An unresolved old SDK promise prevents another probe or helper; its late reply is discarded before fresh proof. Saved secrets, catalogs and assignments are retained. No lighting command, partial sequence or proposal is replayed.

Startup errors distinguish missing/incompatible payload, spawn failure, protocol mismatch, startup timeout, installation ownership, foreign port, storage and host unavailability. Initial fixed-lock rejection returns a safe private session.open error before helper exit, so Node retains instance_busy instead of replacing it with worker_exited. Synthetic inherited-lock checks decode stdout separately from safe stderr. Interleaved worker-failure events arriving before the matching start result preserve their category through revocation. A successful read-only configuration check clears a recovered storage-read error, but preserves an unrelated runtime cause and never launches a worker.

Runtime and packaging share `streamdeck/native/payload-validator.mjs`: unchanged spike schema, exact finite native file inventory, regular/no-symlink entries, exact executable/resource modes and SHA-256 hashes, source/protocol/bridge metadata, app/privacy identity, and Mach-O executable architecture/deployment bytes. Runtime recognizes an explicitly marked current-host spike; full-package mode rejects it. Full modes require both architecture slices. Pure tamper fixtures reject wrong protocol/source/architecture/mode/hash and unexpected symlink entries without executing native code. The generic Go process adapter separately inspects host Mach-O/ELF bytes and executable mode. Production derives its worker path from the running bundled helper. Rollup embeds the shared validator in plugin.js. Signing/notarization and complete universal packaging remain US5 gates.

Private Bluetooth telemetry keeps connectivity `unknown|connected|disconnected` separate from permission_denied, bluetooth_unavailable and backend_restart_required. Only existing typed permission/restart backend outcomes currently supply reasons. Disconnected, discovery failure and arbitrary native text never invent an unavailable-adapter reason. Public health remains unchanged and physical_state_verified remains false. The inspector distinguishes service, authorization, Bluetooth, runtime failure and Saved/Not saved/Save outcome unknown; unknown current Bluetooth cannot inherit an older connected check. Permission guidance names the app actually reported by macOS, without claiming that identity has been observed here.

Private framing now buffers bounded bytes and performs strict UTF-8 decoding per complete line. Tests split UTF-8 characters across chunks, feed valid lines plus oversized residual data, malformed bytes, truncated closure and unknown frame members/types. Stdout end/error fails closed independently of child close, once; transport loss drains HTTP observation before lifetime closure. Native stderr is continuously discarded without retained raw text. Preconfiguration lifecycle diagnostics accept only allowlisted category/phase, bounded duration and generated request IDs. No arbitrary source path, URL, JSON, native error or stderr becomes a PI or diagnostic field.

New hostile-error checks found an existing public HTTP boundary that copied arbitrary Execute errors and preset-validation catalog IDs into error bodies. HTTP failures now use fixed safe validation/backend/timeout messages while retaining loopback/Host/auth/routes, GET/POST behavior, HEAD nonexecution, status codes and JSON shape. Tests cover current-token-looking catalog IDs, untrusted request IDs and native errors containing secret URLs/source paths. Existing controller serialization/cooperative-cancellation fixtures plus strict generated-Link expectations prove no uncertain retry, remaining packet, synthetic Off or command replay.

Recorded on the baseline Darwin arm64 host through Companion --verify-run, with each final exitCode inspected:

- `Managed mocks and core workflows`: `task test:core && task workflows:test`, exit 0; all core packages and fourteen workflow fixtures pass, including the independently spawned BLE-free supervisor and inherited orphan-lock result.
- `US4 corrected core race`: `task test:race`, exit 0. `US4 final typed prelaunch race`: the focused generated-launcher category/no-raw-error race regression, exit 0.
- `US4 final interleaved failure and recovery regressions`: compiled Node 24 union of managed-errors, failures, diagnostics, managed-controller, managed-lifecycle and inspector-ui, 69/69 cases, exit 0. The final readability-only fixture edit was recompiled and its nine managed-errors cases rerun, exit 0.
- Go `task vet` and `task build`, project-defined plugin typecheck/lint/format checks, `npm run build`, and a separate native-validator formatting check pass. The final clean plugin static/bundle join records exit 0. Native binaries were compiled only, never executed.

Initial sandbox-only loopback denials were rerun with authorized synthetic fixture access. The initial orphan-lock fixture mixed diagnostic stderr into its protocol decoder; it now inspects private stdout separately. Hostile HTTP leakage and a state-event category loss were corrected and their regressions pass. Sort/indent lint warnings were resolved; final lint has zero warnings. These earlier failures are not accepted residual defects.

**T058 remains Pending and unchecked.** No installed Stream Deck permission deny/re-enable, panel-only recovery after actual host timeout/helper exit, responsible-app identity, foreign fixture survival or native worker disappearance was observed. No production configuration/credentials were read, no plugin was installed/linked, no native sunset was invoked, and no lamp writes occurred. The early T025 and installed T048 gates also remain pending. Software readiness, authenticated reads, connection status, packet fixtures and compilation do not establish physical lamp state or close hardware acceptance.


## US5 software and distribution boundaries (2026-10-22)

Implemented two-architecture slice/provenance assembly, explicit development/distribution signing pipeline, finite native inventory, linked dependency notices, extracted installer mode/hash/signature/ticket checks, and same-source release transfer. Synthetic fixtures execute no candidate worker or supervisor and do not use Apple secrets. The actual pinned Elgato packer drops ZIP Unix modes; the creation wrapper now sets those metadata fields from verified source in a temporary archive, then inspects extraction before exposing the installer. Read-only checks reject mode loss and never repair downloaded files.

Portable fixture coverage includes ten five-kind host assignments/artwork/language plus synthetic Application Support across three replacements/restarts, disk authority over v1 leftovers, future-version preservation, secret-free profile transfer, same-source slices, missing credentials, signing order, actual plist duplicate/comment spoof, localized privacy strings, system-only library references, exact finite signature/ticket contents and stale staged UI rejection. These fixtures do not replace installed Stream Deck observations.

T072 remains **pending**: no complete same-revision arm64+x86_64 Developer ID-signed/notarized/stapled installer was built in this implementation run; required second-architecture native artifacts and externally configured signing/notarization prerequisites were not supplied or used. The exact ticket path is supported by Apple's local stapler(1) manual; real signed/stapled bytes and extraction remain unobserved.

T073 remains **pending on both architectures**: no downloaded/quarantined installer, separate test-user Stream Deck first run, actual permission/TCC attribution, EN/RU file selection, physical architecture execution, host upgrade/profile isolation or three-restart ten-assignment retention was performed. OS/Stream Deck version, quarantine, no-Terminal/no-download and real installed-byte outcomes therefore remain unobserved. Synthetic retention/configuration tests are software evidence only. No Stream Deck install/link, private production configuration access, signing credential use, native candidate invocation, tag or publication occurred.

US5 software verdict: **pass** for native builder/artifact fixtures (23), Task workflow fixtures (15), release-tool fixtures (7), and package/upgrade fixtures (13). Defined plugin typecheck, lint, formatting, JS build, schema validation and software content checks passed under Node 24; final whitespace consistency passed. Earlier expected missing-implementation failures, a fixture cleanup error, the observed packer mode-loss failure, an authoring test module-path error, mode-recorder scope error and three unused-argument lint errors were corrected and retested. Runnable evidence is recorded by the Companion verification runner; none of these checks invokes a native candidate or closes T072/T073.

## Final macOS integration (T074–T075)

Both READMEs now describe plugin 0.2 setup/import, explicit migration and recovery, persistent data and bundled-only operation. Standalone CLI/Website instructions and earlier physical records remain separate. No physical smooth-fade support was added: the baseline has none. Queue/packet cancellation tests do not prove the smooth-transition observation required by SC-010. The scope clarification remains unanswered; that acceptance item cannot be marked passed.

Final runnable checks recorded by Companion all exit 0:

- `Managed mocks and core workflows`: core tests and 15 Task workflow fixtures.
- `Final reproducible mocks and Go formatting`: pinned mock generation and clean formatting for all application Go files.
- `Final macOS race vet and native compile`: project race, vet and native build, without invoking the native executable.
- `Final corrected complete plugin software and release workflows`: the complete `plugin:check:software` gate, including **167/167 Node tests**, defined lint/type/format/build/schema/content checks and **27 native-tool fixtures**, followed by **7 release** and **15 workflow** fixtures.
- `Final corrected current-Mac native build and inspection`: actual Darwin arm64 worker and CGO-disabled supervisor compile, Mach-O/minimum-macOS inspection and linked Go/native notice generation. Both binaries are mode 0755, notices 0644, target 13.5. Source revision is `b57139f7c0f0e51c9b11a07999d55f266105df9e` with working-tree Go fingerprint `1096dc6727be69aa02734b21bcc3ed0ebc7c55644067ae28d2a5d0cdd3a7431a`. This is one native slice, not a universal or signed distribution installer.
- `Final supervisor dependency and whitespace consistency`: dependency closure excludes pure/native BLE, TinyGo and cbgo; diff whitespace is clean.

The full Node run exposed four older lifecycle fixtures still sending v1 PI envelopes. Only their envelope version changed; pending/error preservation, storage restoration, redaction, hiding/reopening and no-replay assertions remain intact and pass. Actual native notice generation exposed Homebrew's Go-license location outside `libexec`. The builder now permits that exact layout with bounded, regular, no-symlink Go Authors/BSD-license validation; four added fixtures pass. Initial failed checks and sandbox-only loopback denials remain in the run history; the corrected authorized checks above resolve them.

No installed plugin, native candidate execution, Bluetooth permission prompt, signing credential, real lamp command or other-Mac execution was used. T025, T048, T058, T072, T073 and T078 remain pending.

## Final Linux integration (T076)

`Final Linux complete tool-provisioned regression` exits **0**. An isolated Docker Linux arm64 environment used Go **1.27.3**, Node **24.22.1**, Python **3.13.5** and pinned Task **3.54.0**. The Go image was `golang@sha256:f20d83a83e18dbd2a4714b8ffd4b30b287b6243962dd75608e86abcc63ba4efc`; Node came from the previously pulled official Node 24 image. Container-only prerequisites included zip/unzip. No host tool installation was changed.

The snapshot contained 168 tracked/new public source files restricted to application/tooling/plugin/workflow paths and public root build/docs/license files. Ignored dependencies, generated bundles, private settings/presets/URLs/logs/environment files, certificates, production data and Git credentials were excluded. Linux dependencies installed into that disposable snapshot. The source directory was mounted separately; no host Application Support or Bluetooth device was mounted, and no host secret environment was forwarded.

Passed in that environment:

- `task check`: default Go tests, core race tests, vet and Linux controller build. Hardware tags remain absent; native worker execution is excluded.
- `task plugin:check:software`: **168/168 Node tests**, lint/types/format/build/schema/content checks and **27 native-tool fixtures**.
- `task release:test`: **7 fixtures**; `task workflows:test`: **15 fixtures**; direct native-tool regression: **27 fixtures**.

The minimal Go container initially lacked unzip, then zip; those two fixture-environment failures were corrected by provisioning both archive tools inside the disposable container. They were not waived. The final complete check is green, and historical failed checks remain visible.

The final consistency pass also aligned explicit recovery with T053/configuration-ui: fixed installation-lock contention during recovery becomes `cleanup_blocked`, while initial startup retains `instance_busy`. Both paths start zero BLE workers. A new focused fixture preserves the distinction. The latest macOS `Final recovery lock-category software regression` also exits 0 with **168/168 Node tests** and all software gates, replacing the earlier 167-case count after this additional case. No Go/native source changed after the recorded native arm64 build.

These are Linux software observations, not Intel Mac, installed Stream Deck, signed universal package, Bluetooth permission or physical lamp evidence.

## Final requirement audit (T077)

All FR-001–028 and SC-001–010 are mapped above to executed software checks or an explicit missing acceptance gate. The audit compared final source, spec/plan/contracts, both README variants, Task/npm interfaces and release instructions. There is no external-controller mode, new public administration HTTP route, command replay, token-bearing assignment, runtime downloader or system-service installation. Package boundaries and `controller.Link`/`bridge.Controller` signatures are retained. The complete package gate fails closed without both matching native slices and distribution prerequisites.

Changes relative to feature 006 are explicit: shared external endpoint/link setup becomes local identity/full-file migration; globals become language-only v2 while action schemas/UUIDs remain v1/stable; readiness and shutdown use owned sessions/leases/revocation; data moves outside the replaceable directory; native packaging is mandatory for full check/package. Public HTTP error text is now fixed and safe, with the same routes/status/schema. The private managed protocol is new and is not an HTTP administration API.

The recovery-only ownership category was reconciled with the configuration UI contract and is covered by the additional final regression. Initial lock contention remains instance_busy. No further software consistency gap was found in this audit after the recorded checks. This statement does not declare the missing acceptance complete.

The declared macOS 13.5 target is within Go 1.27's supported macOS 13+ floor; the local linker's source and actual load-command inspection agree with the [official Go 1.27 release notes](https://go.dev/doc/go1.27#darwin). This supports the build target, not a claim that execution on macOS 13.5 was observed.

Remaining required tasks are T025, T048, T058, T072, T073, T078 and T079. In addition to missing actual observations, SC-010's smooth-transition requirement has no baseline API/implementation; the unanswered scope question is retained as a real acceptance gap, not renamed to a packet-mock pass. See [hardware-verification.md](hardware-verification.md). Feature status remains implementing; no completion waiver is introduced.

## Resumed implementation: prepared current-Mac fixture

The current host is macOS **27.0.1 / arm64**, with Stream Deck **7.6.0 (23012)** installed. The existing `dist/com.obalunenko.mergbw.streamDeckPlugin` is the earlier **0.1.0.0** package: inspection found no native supervisor/worker entries. It cannot serve as feature 007 installer evidence. No native slice directories were present under `dist/plugin-native`, and no separate test-user directory was found under `/Users`. No private settings or signing credentials were inspected.

Prepared a fresh, isolated **spike** fixture at `/private/tmp/mergbw-feature007-resumed-spike-20261022/com.obalunenko.mergbw.sdPlugin`. `Resumed current-Mac isolated spike preparation` exits **0**: the current JS/UI builds and both native components compile, receive credential-free ad-hoc signatures and are staged without installation or execution. Its source revision is `b57139f7c0f0e51c9b11a07999d55f266105df9e`; native source fingerprint remains `1096dc6727be69aa02734b21bcc3ed0ebc7c55644067ae28d2a5d0cdd3a7431a`.

`Resumed staged spike runtime preflight and signatures` exits **0**. The production runtime validator accepts the staged arm64 payload, verifies its six native file entries and macOS 13.5 target, and rejects the same fixture as a full package. Strict code-signature verification passes for the helper app and worker. These checks inspect bytes and signatures; neither executable was started.

The fixture remains in the current user's temporary directory. Follow the separate-user setup in [quickstart.md](quickstart.md) before host testing; a different test user must prepare or receive an accessible copy rather than assuming access to this private directory. The fixture is single-architecture development evidence, without Developer ID, notarization or downloaded-installer acceptance.

The environment and smooth-transition scope questions have been sent to the user. No Stream Deck linking, Bluetooth prompt, physical lamp command or existing installation change occurred. The same seven acceptance tasks remain open; no completed software checks were rerun solely because implementation resumed.

## User-directed scope expansion (2026-10-23)

The user will perform installed-host and physical tests personally on the current Apple Silicon Mac and LT-06. Preserve working data; a separate test account is optional. Intel execution remains unverified, rather than blocking preparation of current-host tests. Earlier separate-user prerequisites above are historical and superseded by this decision. No owner hardware observations have yet been supplied.

Smooth transitions are now explicitly included in this feature. Earlier unanswered include/defer questions are resolved in favor of implementation. Detailed scope, starting values and conflict policy are awaiting the three current interactive choices. No fade implementation or physical result is claimed yet.

The user also requested Stream Deck+ brightness rotation. US6/FR-029–030 and T080–T085 define one percentage point per tick, 0–100 limits, current-session targets, bounded latest-target coalescing, EN/RU touch feedback and no replay. Software implementation and validation are in progress; owner-run dial/LT-06 evidence remains pending T085.

## Stream Deck+ software integration (T084)

The existing Brightness UUID now supports Keypad and Encoder. Rotation uses one percentage point per tick, clamps the current-session target to 0–100, and exposes the target/status on the built-in `$B1` touch layout. The panel and both READMEs explain the explicit saved starting value, turn-on behavior and lack of physical readback. Existing Keypad behavior and assignment schema are retained.

`Stream Deck+ complete plugin software gate` exits **0** under Node **24.22.1** on the current arm64 Mac: **185/185 Node tests**, type checks, lint, formatting, Rollup builds, pinned Elgato schema validation, 28-file software content inspection and **27 native-builder fixtures** pass. The new owned cases are **16 dial tests plus one package-policy test**; the worker's complete owned run included all 12 package cases, **28/28 passed**. Synthetic cases exercise actual SDK wrappers, signed/multiple/invalid ticks, clamping/no-op, single raw-flight coalescing, timeout fences, discarded epochs, settings/capability loss, independent dials, EN/RU feedback, feedback/client failures and unchanged Keypad behavior. The added rejection test initially used an unavailable test-helper method and lint found an unsorted union; both are corrected and the final owned compile/tests/type/lint checks pass. No failure was waived.

The final source review confirmed no Go/HTTP/BLE change, no new controller process, no dial-settings persistence on rotation, no press/touch side effect and no native execution. Pending targets are discarded on invalidation/failure and the raw-request fence survives local timeout or action reappearance. A new gesture may issue a new deliberate absolute target after the old raw request settles. Source and tests remain within the stated ownership boundary; `base-action.ts` is unchanged by US6.

| Increment requirement | Executed evidence | Remaining observation |
| --- | --- | --- |
| FR-029 | `dial-brightness.test.ts` actual Encoder/Keypad events; `package.test.ts` exact Brightness-only Encoder layout; complete software gate | User-owned Stream Deck+/LT-06 test T085 |
| FR-030 | Synthetic bounded coalescing, errors/uncertainty, revision/capability/profile invalidation, target/status EN/RU and no replay cases | Actual touch strip and visible lamp effect T085 |
| SC-011 | 16 executed dial cases verify ticks/limits/bounds/no appearance/press/touch effects and no replay | Owner physical observation remains pending |

`Stream Deck+ current-Mac spike build` and `Stream Deck+ staged current-Mac preflight` both exit **0**. The fresh fixture is `/private/tmp/mergbw-feature007-dial-spike-20261023/com.obalunenko.mergbw.sdPlugin`. Runtime native validation and strict app/worker ad-hoc signature verification pass; staged JS/UI/manifest bytes equal the current build and its Brightness Encoder metadata is checked. Full package validation correctly rejects this single-arm64 spike. No signing credential was used and no payload was executed, linked or installed.

This fixture supersedes the earlier current-Mac fixture for dial testing. Use the owner-run steps in quickstart.md, preserving working data. It is a development directory for explicit linking, not a universal distribution installer. The older 0.1.0 installer in dist remains unchanged. Manual T025/T048/T058/T072/T073/T078/T079 and new dial T085 remain pending; no owner observations have been received. Smooth-transition implementation remains in scope, awaiting the three already requested semantic choices.

## Smooth-transition integration (T092, 2026-10-24)

The user resolved the earlier scope questions: a sixth Keypad action with explicit RGB/brightness endpoints and cancellation by a new valid lighting command. The later correction limits duration to integer **1–60 seconds**, superseding the suggested one-hour maximum. The shared wire/lifecycle contract is contracts/transitions.md. The existing five action UUIDs, Brightness Encoder behavior, Link and bridge.Controller signatures are preserved; transition support is a separate optional interface.

Implemented pure validation/interpolation, one controller-root job with serialized admission and BLE execution, additive authenticated HTTP/CLI start/status/cancel, and EN/RU action/panel controls. A validated 202 is a distinct accepted outcome, never sent/completed. Status is explicit read-only refresh; cancellation waits cooperatively and never appends Off. A new valid button/dial command cancels the transition before its own execution. There is no persisted job, automatic resubmission/continuation, physical readback, extra process or public configuration-administration endpoint.

Root integration found and corrected cancellation during an ordinary command's packet gap: recheck the worker root immediately before Write and return root cancellation before retry classification. A deterministic regression covers cancellation during the gap and after the first packet with an independent caller context, forbidding later packets and retry. The existing successful-final-packet Close behavior remains covered by the unchanged baseline suite.

Executed final checks, all exit **0**:

- `Transition final reproducible mocks and Go formatting`: pinned mock regeneration including the optional transition interface, followed by gofmt of changed Go source/tests.
- `Transition final macOS core race vet and build`: core and race suites across all mocked packages/supervisor, vet and native macOS compilation. No native executable was run.
- `Transition final complete plugin and workflow gate`: **201/201 Node tests**, types/lint/format/build, pinned manifest schema, strict **30-file/six-action** software payload, **27 native-builder fixtures**, **7 release fixtures** and **15 workflow fixtures**.
- `Transition final Linux complete regression`: isolated public-source Docker snapshot, full `task check` plus the same **201/201 plugin tests**, native/release/workflow fixtures. Host private config/environment/credentials/Bluetooth were not mounted; no native lamp invocation occurred.

Worker-owned backend protocol/controller/HTTP race tests and **44/44** scoped UI/action/client/PI/package cases also pass. Initial endpoint-test/lint/test-helper mistakes were corrected; their failed records are historical rather than waived failures. The final full gates include the corrected cases.

| Increment requirement | Executed coverage | Remaining observation |
| --- | --- | --- |
| FR-031 | protocol/transition_test.go, transition.test.ts, inspector-ui.test.ts: endpoint types, 1/60 bounds, 0/61 rejection, sixth action/export and strict 202 | Owner action/physical effects T093 |
| FR-032 | controller/transition_test.go and bridge/transitions_test.go: exact endpoints, bounded sampling, equal/slow steps, active invalid start, blocked native Write, ordinary brightness replacement, competing start/status/cancel, root/Close and no replay/retry | Owner visual smoothness and button/dial interruption T093 |
| FR-033 | bridge/transitions_test.go and transition.test.ts: auth/read-only status, cancel ID/timeouts, unknown writes, accepted versus completed, current capability/session/revision and raw-request fences | Owner installed panel/uncertain-effect observations T093 |
| SC-012 | Final core/race/HTTP and synthetic SDK tests above | Physical transitions on current Mac/LT-06 remain pending |

The smooth-transition semantic question is resolved and software is implemented. No owner physical observations, Intel execution or signed universal installer evidence has been supplied; those manual/distribution tasks remain open. Feature completion is not claimed.

### Final current-Mac transition fixture

`Transition final current-Mac spike build`, `Transition final native and source payload inspection` and `Transition final dependency formatting and whitespace` all exit **0**. The fresh current-arm64 fixture is `/private/tmp/mergbw-feature007-transition-spike-20261024/com.obalunenko.mergbw.sdPlugin`, superseding the earlier dial-only fixture. Current JS/UI/manifest and both transition images match the staged source bytes; all six actions are present and Brightness retains Keypad+Encoder. Runtime native hashes/modes/minimum-OS checks and strict ad-hoc app/worker signatures pass. Full-package validation correctly rejects this single-architecture spike.

Native source fingerprint is `456b6052c10e97644a00e6c4f985b9eda5e76eba4d60bc82bccf50d38051cf68`, with baseline source revision `b57139f7c0f0e51c9b11a07999d55f266105df9e`, arm64 and deployment target 13.5. The source review confirms the supervisor dependency closure remains BLE-free, **68 application Go source files** are gofmt-clean and whitespace checks pass. No candidate executable was invoked, no installed plugin was replaced/linked, and no signing credentials or private user configuration were used.

The final Linux snapshot contains **181 public source files**, with Go 1.27.3/linux-arm64, Node 24.22.1 and Python 3.13.5. Docker full Go check, **201/201 Node cases**, 27 native fixtures, 7 release fixtures and 15 workflow fixtures pass. See `/private/tmp/mergbw-transition-final-linux.log`; macOS results are in `/private/tmp/mergbw-transition-final-go.log` and `/private/tmp/mergbw-transition-final-plugin.log`.

T086–T092 software/contract work is complete. T025, T048, T058, T072, T073, T078, T079, T085 and T093 still need actual installed-host/distribution/owner hardware evidence. The user will conduct current-Mac/LT-06 tests; Intel execution and signed universal distribution remain pending. No software check substitutes for visible fade/dial effects or permission attribution.

## Implementation resume: acceptance readiness (2026-10-24)

All 84 recorded software/preparation tasks remain complete; the same nine acceptance/reconciliation tasks remain pending. No new owner observations or signed universal installer evidence was available during this resume. Application source was unchanged, so the previously passing macOS/Linux suites were not repeated.

`Resumed transition fixture byte and signature inspection` exits **0**: current staged JS/UI/manifest/transition images match the built source, six actions and Brightness Encoder are present, native hashes/modes pass, strict helper/worker signatures pass, and full-package validation rejects the single-architecture spike. `Resumed native fixture corrected-manifest provenance` exits **0** and confirms the native source fingerprint still matches the prepared transition fixture. The first provenance command used a nonexistent manifest filename; the corrected command reads `controller/payload-manifest.json`. No native executable was invoked or plugin linked.

Corrected the hardware report's obsolete T078 signed-installer dependency and its owner-guide section reference. T078/T085/T093 can use the current integrated fixture after their declared prerequisites; T072/T073 remain separate required distribution gates. T079 and feature completion still wait for all required evidence. Owner testing starts with T025 in the quickstart's Early current-Mac feasibility section, then sections 5–8 as applicable.

## Personal-development scope and local artifact (2026-10-24, T072)

The owner removed Developer ID/notarization/stapling and downloaded-installer/quarantine acceptance: this is personal development, and local installation is sufficient. T072 now inspects a local development artifact; T073 requires actual local installation/link, import/update, EN/RU file selection, profile isolation and retention. Current-Mac acceptance is the working scope; Intel build support remains, with execution explicitly unverified. Earlier signed/distribution gates above are historical and superseded, not passing observations.

Packaging defaults to `development` in Task and direct package/check scripts. Release tooling uses `com.obalunenko.mergbw.development.streamDeckPlugin` and local ad-hoc finalization without Apple secrets. Explicit Developer ID tooling remains optional. Both READMEs, generated release instructions and current contracts/tasks agree. Universal installer checks still require both architecture slices and reject spike; the personal linked fixture has its own inspection/acceptance path.

`Personal-development complete software gate with loopback access` exits **0**: **201/201 Node tests**, types/lint/format/build/schema/software inventory, **27 native-builder fixtures**, **7 release fixtures** and **15 workflow fixtures**. Default development verification and packing omit Developer ID/ticket checks, preserve explicit distribution rejection, and keep the development output filename. The first sandboxed run failed because synthetic loopback listeners were denied (`EPERM`); the complete authorized rerun passed. Worker reconciliation independently passed the defined typecheck and lint checks.

The old fixture lacked Go/native license notices. The spike builder now reuses its existing linked-build-metadata license generator; its allowlist test verifies the project and upstream Go notices and 0644 mode. `Personal-development spike native license regression` exits **0** (15 workflow and 27 native-builder fixtures). No Go runtime code changed, so Go suites were not repeated. The native build below recompiles both roles without execution.

`Personal-development current-Mac fixture build with tool-cache access` and `T072 refreshed personal local artifact inspection` exit **0**. The earlier sandboxed build lacked Go tool-cache access; the authorized build passed. Fresh fixture: `/private/tmp/mergbw-feature007-personal-dev-20261024/com.obalunenko.mergbw.sdPlugin`, **spike / arm64 / macOS target 13.5**, **39 files**. Current public runtime bytes, exact source provenance, finite inventory/no symlinks, native hashes/modes/architecture/minimum OS/system-only libraries, plist identity/localized privacy resources, licenses and strict local app/worker signatures pass. Native executables were not invoked and the fixture was not linked or installed.

- Source revision: `b57139f7c0f0e51c9b11a07999d55f266105df9e`; working tree **dirty**.
- Native source fingerprint: `456b6052c10e97644a00e6c4f985b9eda5e76eba4d60bc82bccf50d38051cf68`.
- Fixture tree SHA-256: `64ac09360d10c5f63ffefc99209100b261e89d109268840bbab9377a7757d361`, computed over sorted relative filenames and file bytes with NUL separators.

T072 passes only the revised local artifact scope. Signed/distribution, Intel execution and downloaded-installer results are not inferred. **85/93 tasks complete; eight remain**: T025, T048, T058, T073, T078, T079, T085 and T093. The owner still needs to perform actual Stream Deck/LT-06 checks; final T079 waits for those observations.

## Local installation and discovered TCC blocker (2026-10-24, T025/T073/T094)

The owner requested continuing with local installation. The checked 0.2.0.0 fixture was copied into ignored `dist/plugin-local` and linked with the pinned Elgato CLI, replacing the installed 0.1.0.0 directory reversibly. Private backups of the original plugin, all ProfilesV3/Data and standalone config were saved under Application Support/MeRGBW Development Backups. The first targeted CLI stop did not end the old backend within ten seconds and changed no installed files; a normal Stream Deck quit allowed the replacement. Stream Deck restarted successfully and registered all six actions. Current host remains arm64/macOS 27.0.1/Stream Deck 7.6.0 (23012).

Using the real Property Inspector on the retained MeRGBW Acceptance copy profile, the agent selected the existing local settings/presets through native file pickers, prepared the six-preset import and applied it. The panel reported Saved. Authoritative managed settings and presets equal their source values, including the existing token. Original source files equal the private pre-install backup. All **17 existing MeRGBW assignment records** across saved profiles still equal the pre-install snapshot, including settings, titles and artwork. No real identity/token/source contents are included in this report.

Worker startup **failed**, so T025/T073 are not complete. macOS recorded sunset SIGABRT before readiness. The crash report attributes responsibility to Stream Deck, and its targeted system log states that NSBluetoothAlwaysUsageDescription is missing for the privacy request. The helper app has a purpose string, but direct spawn from Stream Deck retains the host's TCC responsibility. No permission dialog, successful BLE connection or physical lamp effect was observed. No lighting action was issued by the agent.

A controlled worker-plist experiment was built, inspected and installed into `dist/plugin-local-worker-purpose`, retaining the imported configuration and profiles. CFBundleCopyInfoDictionaryForURL could read its embedded worker identity/purpose, but the real host produced the same TCC abort. Therefore embedding a plist is **not a fix**; that experimental linker change was removed from source. No Elgato app modification, Terminal Bluetooth grant, TCC reset or signed distribution was used.

Pure non-BLE LaunchServices fixtures then checked alternatives. Ordinary app launch works. Redirecting to /dev/fd inherited paths fails. Private FIFO round-trip and EOF app exit work, but FIFO startup can block after parent loss before endpoint opening, so it is not the production correction. The chosen correction is LaunchServices plus a private Unix control connection, specified in the new top section of contracts/managed-runtime.md. Existing frames, host lease, exact owned-worker handles, lock/listener and HTTP revocation remain required. T094 implements/tests this boundary and T095 integrates it and retries installed startup. Permission and physical acceptance remain separate, without inferred passes.

## LaunchServices software integration (2026-10-24, T094/T095)

The helper now connects to a private Unix endpoint instead of inheriting Node stdio. Node launches the checked app with fixed new-instance/background/wait arguments. The endpoint is private to the current user, queued frames are bounded, extra peers are rejected, and cleanup waits for both socket EOF and the owned launcher. The app connection closes only after worker cleanup and reservation release. Non-BLE regressions cover unsafe endpoints, early parent/launcher loss, delayed cleanup and independent revocation handling. Root verified the phase files/tests and an independent worker passed the project's defined typecheck and lint.

Five focused Node transport cases passed. The initial integrated Go run caught an incorrect ACK test assertion expecting an empty data object; the protocol omits it. Root corrected the assertion without changing production behavior and reran the project gate. The corrected integrated gate passed, as recorded below.

### Integrated gate and installed retry

The project gate passed: core Go tests and race tests (including mocked BLE and the supervisor), vet, native build, plugin lint/format/types/build/schema/software inventory, **206/206 Node tests**, **27 native-payload fixtures**, **7 release fixtures** and **15 workflow fixtures**. Full output is local at `/private/tmp/mergbw-launchservices-integrated-gate.log`; runnable exit codes are in the Companion verification log. No real worker was executed by these software checks.

The fresh current-Mac fixture is `/private/tmp/mergbw-feature007-launchservices-20261024/com.obalunenko.mergbw.sdPlugin`. It has 39 inventoried files, buildMode `spike`, arm64, minimum macOS 13.5, source revision `b57139f7c0f0e51c9b11a07999d55f266105df9e` with a dirty worktree, source-tree SHA256 `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647` and artifact-tree SHA256 `e9f7f2bcf1da291499926350fe16c1618fc35671de3d0a0b6214271d6945dfbf`. Public JS/native bytes, privacy resources, licenses, modes, native architecture and ad-hoc signatures passed inspection. The unsuccessful embedded-worker metadata experiment is absent from the source and this fixture.

The fixture was copied to ignored `dist/plugin-local-launchservices/`, linked locally and started by the real Stream Deck 7.6.0 host. A fresh private backup preserved the previous link, profiles, plugin data and both standalone/managed configuration. All **17 full MeRGBW assignment records**, source configuration bytes, imported settings/token/presets and private storage modes remain unchanged.

**Actual launch result**: one LaunchServices-started supervisor and one owned native worker. TCC attributes the worker's Bluetooth request to `com.obalunenko.mergbw.controller`, and its request returns without an error. The prior missing-usage-description abort did not recur. Read-only health returned compatible bridge version 2.0.0-go and initially disconnected BLE. After an ordinary Stream Deck quit/relaunch, health returned **bluetooth_connected: true**, still **physical_state_verified: false**. The agent sent no lighting commands.

**Actual normal host exit**: after Cmd-Q, both owned native processes exited, the installation lock could be acquired and the same configured loopback port could be rebound with Go-compatible SO_REUSEADDR behavior. A first temporary checker omitted that socket option and hit TCP TIME_WAIT; the corrected check passed. A prematurely invoked checker also failed before it had been written; both failed attempts remain visible in the append-only verification history. No runtime change was needed for either checker issue. Relaunch created one new supervisor/worker and reused saved configuration without replay. This is one normal host-exit cycle, not forced-kill, stalled-host or interrupted-transition acceptance.

**Limits**: macOS UI automation returned noWindowsAvailable/ScreenCaptureKit capture errors for coordinate/window operations, so the permission dialog, exact System Settings toggle and private readiness label were not visually confirmed during this retry. System attribution, request result, process ownership, health/BLE connection and preserved data are runnable observations; they do not replace deny/re-enable, first/manual setup, language/file-picker, three-restart retention, dials or physical lamp observations. T094/T095 are complete; the original eight acceptance tasks remain open.

## False pending error overlay (T096/T097)

The owner observed On physically lighting the lamp with an immediate error symbol. The sanitized plugin log shows successful sent receipts (two On and two Off), not a request error. The common key path called showAlert at dispatch, repeated busy presses and busy reappearance. T096 removes those calls and the unused pending feedback method. Pending remains in the inspector; existing request fencing, custom title/image priority and true invalid/rejected/unknown alerts remain. Fourteen focused power/lifecycle cases pass, including no alert before success or on a busy repeat/reappearance, one dispatch and the preserved auth-rejection alert. Independent typecheck and lint pass. A complete plugin software gate and fresh local update follow under T097.

The complete T097 plugin gate passed: lint/format/typecheck, 206/206 Node tests, build/schema/software inventory and 27 native-payload fixtures. A fresh 39-file current-Mac fixture passed artifact inspection and was installed with a private backup into ignored dist/plugin-local-feedback. Its artifact-tree SHA256 is `03c0b9bddf48612e3c1e2cd954a452e1a775d7930cfd923fc982679f58014704`; native source fingerprint remains `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647`. Real startup confirms helper TCC attribution, one owned worker, compatible health and BLE connected. All 17 assignments and imported/source configuration remain unchanged. The owner Off/On and icon retry is pending, so T097 stays open.

T097 owner retry is now confirmed: the explicit Off-then-On/no-error question received «да». Both physical effects and corrected key feedback are observed. Safe logs show sent Off/On and no failure/unknown/rejected events. No new software change or broad test rerun was needed. T097 is complete; the original eight acceptance tasks remain open for their missing scenarios.

## Immediate transition cancellation (T098/T099)

Owner acceptance found Cancel only became usable after **Check transition status**. The bridge client validated the 202 job snapshot but returned only accepted; the inspector therefore knew no cancel ID until a separate GET. Four-file inline T098 carries the validated safe snapshot through OperationStore to PI, retaining strict response validation, latest-lighting-operation and revision/capability guards. A same-job newer checked snapshot wins, while late older status cannot hide the accepted target. No polling or automatic lighting/cancel request was added.

New regressions cover cancellation without a GET, inspector reopen, stale acceptance after another command/settings/connection change, and admission/status races. An initial race test omitted visible-context registration and failed because the store correctly removes invisible completed records; correcting the fixture yields 17/17 focused passes. The initial task finish was recorded before the failed result was inspected; the corrected verified run is the passing evidence. Independent types/lint pass; the complete plugin gate is rerun before installation.

T099 corrected integrated gate passes: 209/209 Node cases, lint/format/types/build/schema/software inventory and 27 native-payload fixtures. The fresh immediate-cancel fixture passed inspection and local installation with private backup. Its exact artifact-tree SHA256 is `7fa0c55f9c0ece857fd713210578517a7ac1342025ebdb3f14b9976301b1f2ab`. Real host startup confirms owned helper/worker, correct TCC attribution and BLE connected. All 20 current assignments and private configuration are preserved relative to this update's backup. The owner unconditional Cancel retry is pending; no pass is inferred from the previous conditional success after Check transition status.

T099 owner retry is confirmed by «да» to direct cancellation without Check transition status: cancel is available immediately after admission and the lamp holds intermediate brightness without Off or continued fade for the next ten seconds. T099 is complete. Transition duration/RGB bounds, dial interruption and runtime interruption remain separately pending.

## Dial press Off and unchanged-boundary reapplication (T100/T101)

The owner confirmed basic dial rotations/reversal/limits, requested explicit press-to-Off, and reported that a clockwise turn at target 100 after Off failed to turn power back on. The old rotate method returned early when clamping left the target unchanged. The five-file US6 phase went to its own worker; root checked its owned files/tests, reviewed the queue and folded only after actual exit-0 evidence. A failed-admission feedback seam was fixed before the final worker run, and a separate Off-key/held-response race regression was added.

The new bounded queue uses exact existing off/brightness routes and capabilities, preserves the target and prioritizes one queued Off over old rotations. Upper/lower boundary gestures can reapply an equal target; ordinary nonboundary coalescing remains deduplicated. Failure/context/raw-flight fences and Keypad behavior remain. EN/RU feedback/help and manifest tooltip describe Off without claiming measured power. All 26 focused cases, independent types/lint and the complete 219-case plugin gate pass, with build/schema/software inventory and 27 native-payload fixtures.

A fresh 39-file arm64 spike fixture passed artifact inspection and local installation with a private backup. Artifact-tree SHA256 `806d605ecb35b82e50f1e26c74a9bd17ff3fa0af199cb5ef33c8716b82a154ae`; native source fingerprint remains `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647`. Real startup and preservation checks pass: one owned worker, helper TCC responsibility, BLE connected and all 20 current assignments/config intact. T101 awaits the owner press-Off and max/outward reactivation observations; no physical pass is inferred from software success.

T101 physical retry is confirmed: user reports all requested press-Off, preserved-100, outward-turn On and separate Off-key/outward-turn On cases work. The new display-readability request is separate. No device state readback is claimed.

## Compact numeric dial feedback (T102/T103)

The owner requested a readable current value above the dial. T102 renders only the per-dial target percentage in B1's supported Text feedback styling, with separate short localized status, and retains no-readback/Off/queue behavior. Source support was checked in the installed SDK layout types and schema. Existing feedback assertions were updated; a regression confirms numeric/language-invariant target display after Off with separate localized status. All 27 dial cases and the complete 220-case plugin software gate pass, with independent types/lint and 27 native fixtures.

The fresh numeric-dial fixture passed inspection and was locally installed with backup. Artifact-tree SHA256 is `f4ab001efc01e2f5a8d9c59469995a292c6b14abede3b25420b37cfaa49e56c4`. Real startup and preservation checks pass: helper TCC attribution, one worker, BLE connected and all 20 current assignments/config intact. The optional shared-source choice is pending; no shared state behavior was invented. Actual display legibility is awaiting owner feedback under T103.

T103 readability is confirmed by the owner: numeric value is clear and fits completely on the actual display. The stated current source is this dial's target. No shared last-command synchronization or physical readback is claimed.

## Final home acceptance reconciliation

### T025: current-Mac startup

Accepted for home use: real local installation/import, corrected helper TCC responsibility, one owned supervisor/worker, compatible authenticated startup and BLE connection. Source configuration and private stored values were preserved. Native launch occurred through Stream Deck, not direct worker invocation. Clean-user/manual-first-setup and additional permission deny/re-enable rounds were not completed and are deferred by the owner. The last pending Bluetooth-toggle instruction is withdrawn; the owner need not perform it.

### T048: normal home lifetime

Accepted: during a real transition the owner quit Stream Deck; read-only checks found no owned native processes and confirmed lock/port release. The pinned CLI reopened the stopped host, with one fresh owned runtime, compatible health/BLE and no action events after startup. The owner confirmed preserved light without Off or continuation. Disable, forced Node/host death, socket-loss and sleep/wake rounds remain deferred; automated process/lease/reaping fixtures remain passing evidence at their software boundary.

### T058: home recovery evidence

The executed software suites cover permission/backend categories, reserved-port conflicts without adoption/probe, private capability/revocation checks, stale helper/session handling, unknown results and bounded host-probe recovery. Actual ordinary host restart/relaunch recovered the saved configuration and one owned BLE runtime without command replay. This is the accepted home evidence. Installed permission-denial, foreign-port and host-timeout fault-injection rounds, and a new raw-packet audit, remain deferred rather than claimed.

### T073: local home installation and data retention

Accepted: first local link/import on the current Mac, then repeated backed-up development replacements and actual host/plugin starts. Runnable preservation checks recorded unchanged private source/imported config and complete assignment records, initially 17 and later all 20 current records after the owner's deliberate test edits/additions. Saved-profile inspection confirms the edited copy has 25 while the base retains 15. The latest installed fixture is the 39-file arm64 numeric-dial payload with artifact-tree SHA256 f4ab001efc01e2f5a8d9c59469995a292c6b14abede3b25420b37cfaa49e56c4.

This accepts observed home retention, not an unperformed clean-install/constant-fixture three-restart protocol. Further EN/RU picker, transferred-profile/export and systematic clean-user/retention qualification are deferred. Another Mac architecture, Developer ID and downloaded/quarantine journeys are outside this milestone.

### T079: home milestone reconciliation

The owner home-use decision is now reflected in spec, plan, model, tasks, quickstart, distribution evidence boundary and both READMEs. Original extended task definitions are retained in deferred-validation.md. The historical baseline tables remain explicitly historical. Current requirement-area evidence distinguishes actual software runs, actual host/lamp observations and unperformed extended cases. Generated release setup/import/data instructions remain valid and introduce no further manual completion gate.

No source/runtime protection was removed for this scope change. No new manual test, code build or lamp command is needed for documentary closure; the last applicable executed code gates remain green. The installed numeric-dial home version remains linked with its private data intact. This completes the home milestone, not a distribution or exhaustive reliability certification.
