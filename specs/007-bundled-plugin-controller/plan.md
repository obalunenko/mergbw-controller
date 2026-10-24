# Implementation Plan: Самостоятельный плагин MeRGBW

**Home-use acceptance decision, 2026-10-24**: The owner explicitly stopped further manual qualification: «давай без душных проверок — это пока для домашнего пользования». The installed current-Mac home version is accepted using its executed software gates and recorded lamp/dial/transition observations. Additional permission, crash, sleep/wake, clean-user, installed fault-injection, picker/export and stress rounds are deferred, not passed, and no longer block this milestone. Existing runtime/safety requirements and automated tests are unchanged. Original broader definitions are preserved in [deferred-validation.md](deferred-validation.md). This decision supersedes earlier mandatory manual completion gates in these artifacts.


**Feature Directory**: `specs/007-bundled-plugin-controller` | **Branch**: `develop`

**Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Reconciled**: 2026-10-24 after cross-artifact analysis; retain recorded implementation progress and pending acceptance evidence.

**Input**: Feature specification from `specs/007-bundled-plugin-controller/spec.md`.

## Summary

**Observed startup correction, 2026-10-24**: Direct spawning from Stream Deck retains Stream Deck as TCC responsible app and aborts the worker for a missing usage description. Embedding a valid worker plist did not solve this. Replace only helper transport/launch with a checked app launched via /usr/bin/open -n -g -W and a private bounded Unix control socket. Retain all existing worker, lease, lock/listener, revocation and configuration contracts. This supersedes the earlier no-LaunchServices/direct-helper-pipes choice. See contracts/managed-runtime.md and T094/T095; it is an observed defect repair, not a passing hardware claim.

**Scope update, 2026-10-24**: Personal development and local installation are the acceptance target. Developer ID, notarization, stapling, downloading an installer and quarantine testing are outside the required scope. Existing local ad-hoc helper signing stays credential-free. Universal packaging remains available; current-Mac linked fixtures are accepted for local checks. Preserve earlier results as historical evidence, not new observations.

Ship one Stream Deck installer containing the existing Node plugin and a universal macOS helper app. Its BLE-free Go supervisor manages configuration and exactly one native `sunset` worker, reserves the loopback listener before native initialization, and cleans up the worker independently when the plugin disappears. This extra supervisor is required because importing the current native BLE backend initializes CoreBluetooth before `main`; a watchdog added only to `sunset.main` cannot protect that interval.

Keep settings/presets in immutable generations under Application Support, with one atomic active-generation pointer. Preserve existing action assignments and standalone CLI/HTTP behavior, replace external-connection UI with manual identity/import, and preserve EN/RU. No persistent OS service, external mode, command replay, or runtime component download.

The setup script returned feature context `BRANCH=007-bundled-plugin-controller`; `git branch --show-current` verified the actual Git branch as `develop`. No branch switch is needed or performed.

## Technical Context

**Language/Version**: Go 1.27.0+ for the controller, supervisor and separate Task/mockgen modules; existing TypeScript 5.9.3, Node 24, ESM and Rollup 4.64.12 for the plugin. Python/Bash remain development tooling only.

**Primary Dependencies**: Reuse `tinygo.org/x/bluetooth v0.16.0`, `@elgato/streamdeck 3.0.3`, pinned local Elgato CLI 1.10.3 and vendored SDPI v4. No new runtime module or native Node addon. Supervisor uses Go standard-library process/pipe/listener APIs and platform-specific advisory locking. No import of `internal/ble/native` or upstream Bluetooth in its dependency graph. macOS assembly uses Xcode SDK, `lipo`, `codesign` and, for Developer ID distribution, Apple's notarization tooling.

**Storage**: `os.UserConfigDir()/com.obalunenko.mergbw/`: fixed `runtime.lock`, `CURRENT.json`, `generations/<id>/{settings.json,presets.json}` and transient staging. Directories 0700, secret-bearing files 0600. Existing settings/preset formats remain unchanged. Stream Deck globals become v2 `{schemaVersion:2, language}` after successful migration; action settings stay v1. See [data-model.md](data-model.md).

**Testing**: Go `testing`, Testify and generated GoMock interfaces; Node test runner and existing SDK/UI facades. Supervisor uses mocked process/clock/filesystem boundaries and non-BLE process fixtures for crash/FD tests. Extend `CORE_PACKAGES` and mock generation explicitly. No handwritten Go interface mocks, native executable invocation in CI, or hardware tag in default workflows.

**Target Platform**: Plugin: macOS 13.5+, Stream Deck 7.1+, Apple Silicon and Intel, no Rosetta requirement. Universal supervisor and worker payloads. Standalone controller still targets Darwin/Linux arm64/amd64. Linux runs the existing full checks and BLE-free software/fixture checks; macOS CI compiles native code and inspects packaging without running the native worker.

**Project Type**: Local desktop plugin plus its transient management helper and one existing loopback HTTP/BLE worker; standalone CLI remains available. The management helper is not a second BLE controller or independent service.

**Performance Goals**: Preserve existing 45-second plugin command observation and controller request behavior. New lifecycle budgets: host round trip every 2 seconds, one outstanding request, 5-second reply deadline, supervisor lease 10 seconds; worker bootstrap/readiness deadline 15 seconds; graceful process stop budget 10 seconds before SIGKILL. These are software supervision thresholds, not guarantees of native cancellation or real-time OS scheduling. Never start a replacement without confirmed exit, however long reaping takes.

**Constraints**: One owned worker/connection; whole-action serialization; cancellation remains cooperative; no retry/replay of uncertain commands; fixed configured IPv4 loopback port; no probe with credentials against an occupied foreign port; unknown data versions preserved and rejected. Pending TCC/Gatekeeper/hardware execution is evidence to collect, not an unresolved architecture choice.

**Scale/Scope**: One local plugin instance, one LT-06, five existing Keypad actions plus Transition, Brightness Encoder and shared configuration. Validation includes ten assignments across the original five kinds, three restarts, separate dial/transition checks and all specified faults on the current Mac. Universal packaging retains both architecture slices; Intel execution remains explicitly unverified and is not required for personal-development completion. No percentage coverage target or group usability study is introduced.

## Constitution Check

*Gate checked before Phase 0 against constitution v1.2.0 and rechecked after Phase 1, including the 2026-10-24 acceptance reconciliation.*

- [x] **I, package/module responsibility**: `cmd/sunset/` remains the native composition root; nested `cmd/sunset/supervisor/` is a separate BLE-free entry point. New `internal/managed/` owns process supervision/framing only. JSON parsing, validation and generation transactions remain `internal/config/`; packet validation and BLE behavior remain in existing packages. No tools migrate into the application module.
- [x] **II, compatibility**: Standalone commands and flat data directories remain valid; managed flags are additive. Existing GET/POST/HEAD/Host/token behavior is preserved. Replacing external plugin mode is explicit in spec and migration contracts.
- [x] **III, effects/cancellation**: Existing `controller.Link` and `bridge.Controller` interfaces and packet sequences are retained. Signal/parent loss cancels the worker root context, then process termination bounds an unusable native runtime. A sent signal is never reported as confirmed exit or absence of a lamp effect.
- [x] **IV, configuration/secrets**: Preserve repeated initialization; reject identity conflicts by default. Explicitly confirmed replacement writes a complete new generation, never edits `Init` into a silent overwrite. Tokens remain in private storage/backend memory, outside argv, PI snapshots, action exports and diagnostics.
- [x] **V/VI, verification**: Generated mocks for new/changed Go interface collaborators, native-free core/race tests, macOS compile-only CI for BLE code, local hardware acceptance separately. Both READMEs and release instructions change together. Spec Kit scripts/hooks are not added to CI or `task check`.

**Post-design result**: PASS; no constitutional exception is required. The two-process helper arrangement is justified by native initialization order, not a second controller. OS permission attribution, local installation and real-lamp observations remain explicit acceptance gates. Developer ID and downloaded-installer acceptance are optional.

## Project Structure

### Documentation (this feature)

```text
specs/007-bundled-plugin-controller/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── managed-runtime.md
│   ├── configuration-ui.md
│   ├── distribution.md
│   └── transitions.md
├── tasks.md
└── checklists/requirements.md
```

The existing `tasks.md` retains its task IDs, checkboxes and recorded progress. This planning revision synchronizes only acceptance dependencies and explanatory ordering text; it does not regenerate tasks or record implementation finishes.

### Source Code (repository root)

```text
cmd/sunset/
├── main.go                         # existing standalone composition + additive managed worker
├── managed_worker.go               # inherited listener, root cancellation, bootstrap reporting
└── supervisor/main.go              # new BLE-free composition root
internal/
├── managed/                        # new supervision, framing, clocks/process/lock interfaces
│   ├── supervisor.go
│   ├── control.go
│   ├── lock_unix.go
│   └── *_test.go                    # generated mocks + non-native subprocess fixtures
├── config/
│   ├── config.go                    # reusable decoding/defaults, unchanged standalone Init
│   ├── managed_config.go            # generation store, proposals, pointer transactions
│   └── *_test.go
├── controller/                     # preserve Link and action gate
├── bridge/                         # preserve HTTP contract and Controller
├── ble/                            # preserve native behavior, update lifecycle docs if needed
├── protocol/                       # unchanged packet encoding and preset rules
└── logging/                        # allowlisted managed events/redaction reuse
streamdeck/
├── src/
│   ├── plugin.ts
│   ├── managed-controller.ts       # supervisor facade and owned-runtime state
│   ├── host-liveness.ts            # public SDK round trips, not socket internals
│   ├── settings.ts / validation.ts # globals v2 migration, action v1 unchanged
│   ├── inspector-messages.ts       # prepare/apply/cancel/restart and safe snapshots
│   ├── bridge-client.ts            # acquire only current owned ready connection
│   ├── actions/base-action.ts      # lifecycle gate, generation invalidation
│   ├── feedback.ts / i18n.ts
│   └── ui/inspector.ts
├── native/
│   ├── Info.plist                  # helper app template, stable identity and usage text
│   └── {en,ru}.lproj/InfoPlist.strings
├── com.obalunenko.mergbw.sdPlugin/
│   ├── ui/index.html / inspector.css
│   └── controller/MeRGBW Controller.app/  # generated payload, not user data
├── scripts/check-package.mjs
└── tests/                          # extend existing suites and managed lifecycle suites
scripts/plugin-native.py             # new build/stage/inspect/assemble logic, no native execution
scripts/test_plugin_native.py         # fixtures for payload/archive validation
Taskfile.yml                         # build/test/mocks/package workflow ownership
.github/workflows/{ci,release}.yml    # BLE-free software checks and native artifact dependencies
scripts/{release.py,test_release.py}  # retain CLI assets, update bundled-plugin instructions
README.md / README_RU.md
```

**Structure Decision**: Introduce only process-management functionality in `internal/managed`; it must not own settings formats, HTTP routes or BLE operations. `internal/config` exposes pure decode/validate/prepare/commit/read functions used by the supervisor and existing CLI as appropriate. No new public HTTP administration endpoint. The supervisor is compiled with CGO disabled; the worker retains its native imports. All native payloads are generated outside checked-in source templates.

## Implementation by Affected Boundary

1. **Configuration**: Extract reusable validators without changing flat `Init` semantics. Add immutable generation storage, sanitized proposals, expected-generation checks and one-pointer commit. Prepare reads sources only once; confirmation applies the prepared snapshot, not files that may have changed. Stop/reap the old worker before switching active configuration. Guarantee unchanged active data on pre-commit rejection. After a possible commit, use the private expected/candidate generation record and authoritative read-back for applied/not_applied/commit_unknown; block changes and lamp commands while active state is unreadable, offer read-only checking, and never automatically reapply, roll back or rotate the token. See [configuration-ui](contracts/configuration-ui.md).
2. **Process and native boundary**: Add the pure supervisor, installation-wide inherited advisory lock, reserved listener and bootstrap/session protocol. Establish parent EOF/lease watching before any worker spawn. Add managed worker mode that accepts inherited listener/lock/control descriptors; standalone `serve` keeps its bind behavior. Monitor lifetime during native initialization from the supervisor. Worker main also monitors its supervisor pipe. See [managed-runtime](contracts/managed-runtime.md).
3. **Plugin and UI**: Add one owned-runtime facade and a host-liveness adapter using the pinned SDK's public fresh settings request. Gate actions by configuration generation and owned launch readiness; suppress old response/catalog updates after restart or apply. An orderly live-parent shutdown must invalidate capabilities, abort/drain HTTP transports and acknowledge revocation before closing helper stdin; a stalled drain stops lease renewals but retains the pipe/listener barrier. Explicit recovery of an exited helper creates one new supervisor/session after old-handle/transport cleanup and fresh host proof; its fixed lock prevents starting a worker beside an orphan. Route all backend getGlobalSettings calls through one process-wide broker retaining at most one unsettled raw SDK promise across helper lifetimes; a timed-out promise must settle/discard before one fresh recovery probe, otherwise report host_unavailable without a new SDK call. Reload and validate authoritative config before new worker readiness; never replay commands. Add manual/import preview-confirm-cancel UI and restart, replace external controls, preserve action schemas and host artwork. Migrate legacy globals idempotently only after authoritative configuration commit.
4. **HTTP, controller and logging**: Reuse current routes, auth, timeout and serialized execution. Drive worker cancellation with its root context, preserving close behavior. Do not change `Link`/`Controller` signatures. For managed mode, skip generated URL-file writes inside immutable generations. Keep private protocol stdout separate from diagnostics; drain worker stderr without echoing raw data into SDK logs. Add safe lifecycle categories and retain request IDs for command diagnostics.
5. **Packaging and release**: Native Darwin jobs produce worker and supervisor slices from the same source revision. Assemble universal Mach-O payloads on macOS, build the helper app, finalize ad-hoc development signatures after `lipo`, and pack the immutable app into the development installer without Apple credentials. Developer ID/notarization tooling remains optional. Extend the strict content allowlist, deployment target and archive mode checks. Preserve four standalone CLI archives and all-or-nothing publication. See [distribution](contracts/distribution.md).
6. **Documentation**: Update both READMEs and generated release instructions with no-terminal setup, identity prerequisites, import, explicit old-server stop, interrupted transitions, normal system permission steps, failure recovery, data retention and pending platform evidence. Historical spec 006 remains historical; this spec records the changed behavior.

Order the work as configuration/protocol foundations, supervised fake worker, real managed bootstrap, plugin integration, native payload/release assembly, then installed-host and lamp acceptance. The installed-host TCC experiment occurs immediately after T024 via the standalone `scripts/plugin-native.py spike --output-root <absolute-directory>` CLI and existing JS-build/pinned-link tools, as detailed in the early quickstart section. This current-Mac-only fixture uses buildMode spike and owner-run testing with preserved working data; it requires neither the second architecture/signing credentials nor T067 commands, cannot pass universal package checks and requires real local installed-host acceptance for T073. Do not postpone permission-attribution discovery until final release.

## Validation Plan

**User-directed acceptance, 2026-10-23**: The owner will perform installed-host/Bluetooth/physical tests on the current Apple Silicon Mac and LT-06. A separate macOS user is optional; preserve the owner's data and distinguish existing TCC grants from a genuine first-run prompt. Intel execution remains pending. Smooth transitions are now implementation scope rather than a deferred baseline limitation; their command and lifecycle contract is added below after the requested parameter decisions.

### Acceptance sequencing (reconciled 2026-10-24)

Treat current-host observations, local artifact inspection and local installation as separate evidence scopes. Record artifact provenance/build mode and actual outcomes using the [evidence model](data-model.md#acceptance-evidence-documentation-only). Missing required host/lamp observations remain pending; removed signing/download gates are recorded as a scope change, not a passing observation.

| Evidence scope | Prerequisites / task boundary | Completion meaning |
| --- | --- | --- |
| Current Apple Silicon host setup/lifetime/recovery | Owner-run T025, T048 and T058; current integrated fixture with working data preserved | Proves only recorded host/permission/lifetime scenarios; separate macOS user optional |
| Current-Mac LT-06 observations | T078 after T025, T058, T075 and T092; T085 after T025/T084; T093 after T025/T092 | Owner observes baseline actions, dial and transitions on the identified build; no Intel or distribution inference |
| Local development artifact | T072 after T071; current-Mac fixture or complete development installer | Inspect source provenance, bytes, modes, native payload, privacy resources and licenses without executing the worker; no Apple credentials |
| Local installation acceptance | T073 after T061/T072/T057 | Owner installs/links locally, verifies setup/import/update/retention; downloading and quarantine testing are optional |
| Final reconciliation | T079 after all its declared prerequisites, including local-artifact T072/local-installation T073/T078/T085/T093 | Preserve all required local/software/lamp gates; signing and downloaded-installer gates are outside personal-development scope |

T078 explicitly waits for T092 because interrupted-transition observations require the integrated transition implementation. T093 uses the same current-host prerequisite. Dependencies determine execution order even when appended increments have higher task numbers; T079 remains terminal and the graph must remain acyclic. See [quickstart.md](quickstart.md#acceptance-sequencing) for owner-run paths and [distribution](contracts/distribution.md#acceptance-scopes-and-gates) for distribution limits.

### Validation checks

- **Design artifacts now**: Check relative links, requirement coverage, schemas/state consistency, placeholders, whitespace and hooks. No runtime or hardware validation is claimed by this planning command.
- **Future Go checks**: Extend `CORE_PACKAGES` with `./internal/managed`, then use `task test:core`, `task test:race`, `task vet`, `task build`; Linux `task check` retains full tests/race/vet/build. Verify supervisor dependency closure excludes native BLE. Add `task mocks:generate` entries for managed process/lock/clock/storage interfaces where used; generated mocks remain colocated.
- **Formatting**: `gofmt` changed `cmd/sunset/main.go`, `cmd/sunset/managed_worker.go`, `cmd/sunset/supervisor/*.go`, `internal/managed/*.go`, `internal/config/*.go` and any touched logging/test files. Apply Modern Go Guidelines when implementation writes Go code.
- **Software workflows**: New `plugin:check:software` runs existing lint/types/tests/JS build/schema validation plus payload-validator fixture tests with no native payload requirement. Existing `plugin:check` remains the full check and additionally requires a staged complete payload; `plugin:package` never silently packs JS only. Test Go lifecycle behavior with mocks and controlled non-BLE process fixtures, including a worker stalled before main.
- **Configuration faults**: Bad files, empty catalog, partial selection, normalization, repeat init, stale preview, identity replacement, concurrent panels, each staging write/sync/rename failpoint, crash before/after pointer replacement, missing reply, unknown schemas. Old values survive every pre-commit rejection; after commit, read-back reports new values consistently.
- **Recovery-specific checks**: Timeout -> helper exit -> explicit panel restart -> fresh supervisor/session/worker, retained orphan lock, stale active config, repeated restart with one unresolved raw SDK promise, late old reply discarded then fresh proof, no secret rotation or command replay. A pending probe may wait five seconds to settle, then one fresh probe has its own five-second deadline; neither deadline creates a second unsettled SDK operation.
- **Process faults**: Two launch attempts, retained lock on old worker, busy/raced port, fake health from a foreign server, EOF during startup/init/write, lease expiry, TERM-ignoring child, SIGKILL/reap, partial frames, stale ready, output backpressure and restart during cleanup. Zero probes to foreign servers, duplicate workers and replayed lamp commands.
- **Packaging**: Build native slices without invocation; inspect both architectures, deployment targets, interpreter/library references, permissions, licenses, signatures and archive round-trip. Test no settings, URLs, tokens, development fixtures or unexpected executable files are distributed.
- **Local installed-host**: On the owner's current Mac record OS/Stream Deck version, install source/signing, prompt identity, allow/deny/re-enable, no prior Terminal Bluetooth grant, quit/disable/crash/restart, sleep/wake, import/update and no surviving worker. Follow [quickstart.md](quickstart.md); missing hardware is explicitly pending.
- **Physical LT-06**: Locally observe On/Off, RGB FF5000, brightness 25/75, a selected preset and interruption/restart of a transition. Record actual visible effects and unknown outcomes separately; startup/check/restart must send no control commands. Existing `task test:hardware` remains opt-in and cannot alone prove Stream Deck packaging/permission behavior.
- **Not applicable**: No Spec Kit tooling changes, so no installer refresh or Spec Kit regression suite is added. No runtime tests, native CLI commands, signing, publishing or user-data migration run as part of plan generation.

### Requirement coverage

| Requirements | Design owner/artifact | Acceptance |
| --- | --- | --- |
| FR-001, FR-026 | Native payload and pipeline, distribution contract | US5.1; SC-001/009; complete two-architecture package inspection |
| FR-002, FR-010, FR-011 | Managed runtime, owned listener and provisional/full capability | US1.4, US3.1–2, US4.1/6; SC-004 |
| FR-003, FR-004, FR-005, FR-006 | Config canonical validators and UI prepare | US1.1–3/6, US2.1–3; SC-001/002 |
| FR-007, FR-008, FR-009 | Atomic generation commit, proposal confirmation and migration | US2.4–7, US4.7; SC-002/003 |
| FR-012, FR-013 | Safe PI checks, existing five action schemas/UUIDs | US1.5, US2.7, US4.3; SC-006 |
| FR-014, FR-015, FR-016 | Independent supervisor EOF/lease, native cancellation, reaping | US3.3–7; SC-005 |
| FR-017, FR-018, FR-019 | Explicit restart, fixed reservation, safe error taxonomy | US4.1–7; SC-004/005/007 |
| FR-020, FR-021 | Application Support generations, globals v2, redacted snapshots | US5.2–4; SC-003/008 |
| FR-022, FR-023, FR-024 | Unchanged HTTP/CLI and serialized controller, distinct physical evidence | HTTP/controller regression; US4.5–6; SC-006/007/010 |
| FR-025, FR-027 | Transient lifetime, paired READMEs and release instructions | US3.3–6; SC-005/009 |
| FR-028 | Verification matrix and quickstart, hardware isolation | Original five stories and SC-001–010, with explicit pending host evidence |
| FR-029, FR-030 | Brightness Encoder events, bounded target dispatch and EN/RU B1 feedback | US6.1–6; SC-011, with owner device evidence separate |
| FR-031–033 | Pure transition model, root-scoped job/admission, additive HTTP/CLI and sixth-action panel | US7.1–6; SC-012, with owner fade evidence separate |

## Stream Deck+ increment (2026-10-23)

Reuse the existing Brightness UUID and assignment schema. Add Encoder alongside Keypad in its manifest, using the built-in `$B1` indicator layout. Handle SDK 3 `onDialRotate` ticks at one percentage point each; clamp the current-session target to 0–100. Initialize from the existing assignment, without a command on appearance and without claiming a physical reading. Keep live dial adjustments in memory; panel saves remain authoritative and reset the target. The original increment kept press/touch inert; T100 supersedes this with dial-down Off, while dial-up/touch stay inert.

Coalesce rapid rotations per visible context: one HTTP command in flight and one latest unsent target. Use existing OperationStore, managed capability and BridgeClient; check context/settings/connection/capability again before every send. Drop pending work on disappearance, assignment/connection/runtime change and any failed/uncertain request. Do not replay after recovery. EN/RU touch feedback distinguishes target, pending, sent/rejected/unknown and runtime readiness. Keys retain their current code path and artwork.

Add deterministic tests for positive/negative/multi-tick/clamping, no-op and zero/malformed ticks, coalescing, unknown outcomes, stale completion, multiple contexts, lifecycle invalidation and unchanged Keypad operation. Full software/package-schema tests must accept Encoder only on Brightness. The user verifies actual Stream Deck+ events and physical brightness separately on the current Mac/LT-06.

Primary sources: [Elgato dial events and layouts](https://docs.elgato.com/streamdeck/sdk/guides/dials/), [manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/) and the installed pinned `@elgato/streamdeck` 3.0.3 type declarations. No SDK or minimum host version change is required by these APIs.

## Complexity Tracking

No constitutional violations. One BLE-free supervisor plus one BLE worker is the minimum chosen design that can clean up a worker stalled before its main function while keeping existing upstream BLE dependencies. A one-child Node-only cleanup hook cannot satisfy parent-crash cleanup; a permanent LaunchAgent would violate scope. Design limits and release prerequisites are recorded in research and the runtime/distribution contracts.

## Smooth-transition increment (2026-10-23)

User chose a sixth Keypad action with explicit endpoints and new-command interruption, then limited duration to **1–60 seconds**. The authoritative API, states, pacing and tests are in [transitions](contracts/transitions.md). Add pure transition parsing/interpolation/snapshot types in protocol, a root-scoped job in controller with serialized admission and existing BLE gate, and authenticated start/status/cancel dispatch in bridge. Existing Link and bridge.Controller signatures remain unchanged. Composition adds the optional transition capability and provides its lifetime context. CLI keeps existing commands and adds transition grammar/202 acceptance.

Implement Go/backend and plugin/UI as disjoint story phases against the shared contract, then integrate full mocked core/race/vet/native build and full plugin software gates. UI adds a distinct accepted outcome, sixth manifest action/assets, five parameter fields and explicit status/cancel operations bound to the active runtime. No periodic polling, persisted job, downloader, new service or state readback. New valid lighting commands cancel the transition before acquiring BLE execution; this includes the existing dial's ordinary brightness route. Root keeps documentation/integration, delegates each >=5-file story phase per the implement skill, and folds returned append-only task events sequentially.

**Observed key-feedback correction**: During physical On acceptance the lamp lit but the old pending attention overlay looked like an error. Replace showAlert-for-pending with the existing inspector pending status. Preserve key appearance overrides, duplicate suppression and actual error/success overlays. This supersedes the feature 006 attention-as-busy choice; T096 covers the shared key path and T097 the installed owner retry.

**Owner dial extension and boundary defect**: The owner confirmed both rotation directions, fast reversal, limits and the previous inert press/touch behavior, then requested press-to-Off. An outward turn at 100 after Off failed because unchanged clamped targets were dropped. T100/T101 add explicit dial-down Off and boundary reapplication through existing routes only. Preserve the target, one raw flight/one pending command, Off priority, failure/context/recovery fences and Keypad behavior. Source ownership is the five-file US6 phase in tasks.md; root owns paired docs and installed integration.

**Numeric dial display request**: After confirming Off and boundary reactivation, the owner requested a readable current value above the dial. T102 uses supported B1 Text feedback styling for a compact prominent percent, with separate short EN/RU status; it keeps the current per-dial target model and no-readback contract. A possible shared last-command source is asked separately before expanding state behavior. T103 covers local installation and physical readability.
