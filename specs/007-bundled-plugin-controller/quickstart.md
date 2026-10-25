# Quickstart and validation guide

This is the implementation acceptance guide for manual setup, selected-file import, managed recovery and local development installation and optional universal packaging. The standalone early `spike` builder remains independent of the complete package workflow. Software checks do not prove installed-host behavior; actual observations are recorded separately in [validation.md](validation.md).

## Home-use acceptance

The owner stopped further manual rounds. The currently installed numeric-dial fixture and recorded positive observations are accepted for home use. Software gates passed; no new manual tests are requested. See [deferred-validation.md](deferred-validation.md) for unrun broader qualification, explicitly deferred rather than passed.

The procedures below remain an optional future reference, not completion gates for this home milestone. Use existing controls and the current local installation; no additional permission toggles, fault injection, reinstall or stress test is required now.

## Prerequisites

Developer validation: repository Go 1.27.0+ toolchain, Node 24, Task via `make tools`; Xcode command-line tools/SDK for native macOS builds. End users of the final installer need only supported macOS/Stream Deck and the lamp configuration/identity; no developer prerequisites or Terminal step.

Use synthetic identities/tokens and temporary data for automated tests. Do not copy private root settings/presets into fixtures, archives, reports or source control. Import acceptance with real data is local, not CI. See [configuration](contracts/configuration-ui.md) for formats and [runtime](contracts/managed-runtime.md) for states/timing.

## 1. Software validation without Bluetooth

From repository root, after implementation:

```bash
make tools
task plugin:deps
task mocks:generate
task test:core
task test:race
task vet
task build
task plugin:check:software
task release:test
task workflows:test
```

`CORE_PACKAGES` must include the new BLE-free management package. Expect generated GoMock interfaces, core/race passes, unchanged HTTP/CLI regressions, plugin schemas/localizations, config transactions and synthetic process lifecycle all passing. `task build` compiles but does not execute native code. On Linux use `task check` for the full application suite. Do not use `task test:hardware` in these checks.

Inspect the supervisor dependency closure without executing it:

```bash
go list -deps ./cmd/sunset/supervisor
```

Expected: no `internal/ble/native`, `tinygo.org/x/bluetooth` or `github.com/tinygo-org/cbgo`. Tests must not invoke the real native worker even with `--help` or `--version`.

Required automated fixtures: configured/unconfigured startup; repeated initialization; valid/invalid/oversized import; missing/preserved custom presets; stale/concurrent confirmation; write/sync/rename failure and lost reply before/after commit; two launches; port race/foreign health; stalled worker before main; ignored TERM; reaping delay; retained lock/listener; parent EOF; host lease timeout; wrong IDs/version; output backpressure; capability/transport revocation; old response invalidation; no command replay. Assertions for signatures/native architecture use payload fixtures, not worker execution.

Also cover authoritative save read-back (`applied`, `not_applied`, `commit_unknown`, equal-data no-op), blocked mutations/commands while active state is unreadable, helper exit followed by panel-only recovery, and repeated Restart with one unresolved raw SDK probe. A late timed-out probe must settle without renewing an old lease before a fresh probe can authorize a new session.

## Early current-Mac feasibility

**Acceptance owner, 2026-10-23**: The user will run these manual checks on their current Apple Silicon Mac with LT-06. They explicitly permit using their current macOS user. Preserve existing plugin assignments and configuration before installing or linking; use a separate macOS user only if desired. Record existing Bluetooth grants honestly: an existing grant cannot establish new-install prompt attribution. Intel execution is recorded separately when available; Developer ID and downloaded-installer checks are optional. The agent prepares builds/software checks and, after the owner's request to continue, may perform local installation, import and startup diagnostics. The owner supplies physical lamp/dial observations; no lighting commands are issued while owner availability is unanswered.

This separate T024/T025 path runs as soon as US1 and the minimal `spike` builder are implemented. It does not use the later T067 Task interfaces or a universal installer. Follow the acceptance-owner decision above and preserve current data before replacing the same-UUID plugin. A prior Terminal Bluetooth grant must not be used as evidence that the installed plugin has the correct permission attribution. Both native components are built for the current Mac only. These are developer setup commands; the native components are subsequently launched only by Stream Deck.

From the repository root in a Node 24 shell, after T024:

```bash
make tools
task plugin:deps
task plugin:build
MERGBW_SPIKE_ROOT="$(mktemp -d /private/tmp/mergbw-spike.XXXXXX)"
python3 scripts/plugin-native.py spike --output-root "$MERGBW_SPIKE_ROOT"
streamdeck/node_modules/.bin/streamdeck dev
streamdeck/node_modules/.bin/streamdeck link "$MERGBW_SPIKE_ROOT/com.obalunenko.mergbw.sdPlugin"
```

The `spike` subcommand stages only allowlisted JS/UI assets, the current-architecture helper app/privacy resources and matching `buildMode: spike` metadata. It builds, applies credential-free ad-hoc signatures and inspects without invoking the worker, linking or installing; the last two explicit CLI commands perform the host-side developer action. Do not call the helper directly or run `sunset init/serve` from Terminal. No Developer ID/notarization credentials, Intel/Apple Silicon second host, full-package checker or `plugin:native:*` Task command is needed for this experiment.

In Stream Deck add an action, enter the known identity using the manual setup panel, and observe actual prompt ownership and allow/deny/re-enable behavior. Before T053 implements panel recovery, use an explicit Stream Deck/plugin restart for the re-enable check; native execution must still originate from Stream Deck. Record zero setup/check control writes, one shared worker and cleanup on plugin/host exit. If later recovery/status tasks are not implemented, record their scenario as pending; T025 proves the US1 manual/permission path and does not claim US4 or import acceptance. Missing prompt/permission access or a required Terminal grant is a failed feasibility result, not a pass. Record OS/architecture/build/development-mode evidence in this feature's validation report, with other architecture, actual downloaded-installer and physical acceptance still pending.

After the experiment, close Stream Deck and confirm worker exit before unlinking the staged fixture:

```bash
streamdeck/node_modules/.bin/streamdeck unlink com.obalunenko.mergbw
```

Do not use --delete or remove user configuration to clean up. `spike` is not an installer or package mode; full package/release checks must reject its one-architecture payload. The builder rejects relative or symlinked output paths and an existing staged plugin; use a fresh absolute directory. Its manifest records exact source revision, a source-tree fingerprint, protocol/bridge versions and each native file’s hash/mode. This one-architecture, ad-hoc-signed fixture is rejected by full package checks. The implementation run did not link it or run Stream Deck, Bluetooth or a lamp.

## 2. Local artifact inspection (T072) and optional universal installer

For personal development, T072 may inspect the current-Mac integrated fixture linked through the early guide. Verify exact source fingerprint, native hashes/modes/current architecture/minimum OS, public assets, privacy resources and dependency licenses without starting either executable. Record its `spike` build mode. It does not need to pass universal installer checks.

The optional universal installer task interface is defined in [distribution](contracts/distribution.md). `plugin:native:build` emits current-architecture slices under `dist/plugin-native/darwin_arm64` or `dist/plugin-native/darwin_amd64`. Obtain both architecture directories from native builds or matching CI artifacts from the same source revision before assembly. A single-architecture directory is intentionally insufficient for a complete installer.

On each matching native Mac runner, with a fresh `dist/plugin-native/darwin_<arch>` output directory:

```bash
task plugin:native:build
```

On the macOS assembly machine with both directories staged, build the JS/UI first and use a fresh `dist/plugin-stage` directory. Existing generated output is never overwritten by assembly. `NATIVE_ARM64_DIR` and `NATIVE_AMD64_DIR` optionally select build-input directories; runtime paths stay fixed. CI transfers each slice in a tar envelope and uses `plugin-native.py extract-slice --archive <file>` to validate names/types/modes before extraction; assembly checks source revision AND source-tree fingerprint, protocol, bridge, architecture, minimum OS and hashes.

```bash
task plugin:build
task plugin:native:assemble
task plugin:native:dev
task plugin:check PACKAGE_MODE=development
task plugin:package PACKAGE_MODE=development
```

Expected: `dist/com.obalunenko.mergbw.development.streamDeckPlugin`, containing universal supervisor and native worker, complete privacy resources and no private configuration. The stage is `dist/plugin-stage/com.obalunenko.mergbw.sdPlugin`. `PACKAGE_MODE` defaults to `development`; `spike` is never a complete package mode. Development mode is the personal-development package target. Developer ID and notarization are optional. No build/check/package task starts Stream Deck or BLE. The pinned packer omits Unix ZIP modes, so installer authoring sets archive metadata from already validated source bytes in a temporary output directory, then verifies extracted bytes before atomically exposing the final mode-specific filename. Downloaded/extracted installers are never repaired. A failed development pack preserves an existing distribution installer.

For an explicitly authorized local host experiment, `task plugin:link PACKAGE_MODE=development` validates and links the complete stage. `task plugin:watch PACKAGE_MODE=development` validates that stage and writes watched JS bundles into it before explicitly restarting the linked host. Image/CSS/manifest changes require refreshing the staged public assets through a fresh assembly; full package checks compare them to current built source and reject a stale stage. The source template directory alone has no native payload. The separate early-spike link commands above still use their isolated fixture.

Optional, outside required acceptance: with external Developer ID/notarization credentials already configured for a distribution target:

```bash
task plugin:native:sign
task plugin:check PACKAGE_MODE=distribution
task plugin:package PACKAGE_MODE=distribution
PACKAGE_MODE=distribution node streamdeck/scripts/check-package.mjs --archive dist/com.obalunenko.mergbw.streamDeckPlugin
```

Expected: `DEVELOPER_ID_APPLICATION` must identify an available Developer ID Application certificate/private key and `NOTARY_KEYCHAIN_PROFILE` an externally configured notarytool profile. No credentials are created by the local builder. Missing credentials fail clearly rather than silently downgrading. Production package checks cover strict signatures/ticket, actual plist/localized privacy fields, matching source/protocol metadata and built UI bytes, arm64+x86_64 slices, deployment target 13.5, system-only library/interpreter references, archive extraction/execute modes and linked Go/native licenses. The finite distribution ticket path is `Contents/CodeResources`, distinct from `_CodeSignature/CodeResources`, as documented by the installed Apple `stapler(1)` manual. `stapler validate` may contact Apple; offline end-user usability remains a separate installed-host observation. For the distribution target use a fresh assembly, since development-signing output cannot be silently re-signed as distribution. Follow [distribution](contracts/distribution.md); do not assume private credentials are available. Do not execute an unverified payload to inspect its version.

## 3. Local installed first-run acceptance (T073)

Use a supported Mac/Stream Deck host without a prior Terminal Bluetooth grant for this validation. Use a separate test user or otherwise preserve real configuration before the test; do not erase the owner's production data to simulate a clean install. Record the exact local development artifact and whether it was installed from a local installer or explicitly linked with the pinned CLI. A download or quarantine test is not required.

1. Open the installer in Stream Deck and add On/Off actions. Open either panel: expect manual identity and file import, no external-server mode, commands blocked while unconfigured.
2. Enter the known manufacturer-data identity. Try one invalid value first: expect a field error, no process controlling BLE and no data replacement. Apply a valid value.
3. Observe the system Bluetooth request and record the actual responsible application's name/text. Deny it: expect an actionable permission error, no restart loop or lighting command. Enable the appropriate system permission and use explicit Restart. A 15-second worker startup timeout must give a clear retry step; it must not claim lamp state.
4. Confirm readiness/auth/Bluetooth display separately. Startup/check must not turn the lamp on/off. Add ten assignments across all five action types and test their settings/EN/RU; adding keys or opening panels does not create another native worker.
5. Check local data remains in Application Support and the installed app contains no generated user settings or URLs. Inspect diagnostics locally for safe lifecycle/request events; never paste tokens/full URLs/real identities into the report.

Expected end-user path needs no Terminal, standalone controller, runtime download or developer tools. A Terminal grant or security alteration of Elgato's app means this journey failed, even if the helper worked from a shell. Record Apple Silicon and Intel results separately; unavailable hardware remains pending.

## 4. Migration and update acceptance

1. On a test installation keep representative v1 global settings, five action types, custom titles/icons and language. Stop the old standalone controller manually using its existing control method; plugin does not stop foreign processes.
2. First try a legacy command link/connection only. Expect identity-required migration and zero command execution, not automatic external connection.
3. Import selected settings plus custom-only presets; review changed identity/port/secret-presence/catalog counts. Cancel once: expect no changed active data or sources. Confirm: expect imported values preserved and source files unchanged.
4. Repeat using settings only: preserve the existing target catalog; on a clean target create defaults. Empty or malformed selected preset file rejects the entire import. Change a source after Prepare: Apply uses the reviewed snapshot, not reread content.
5. Use two panels to prepare against the same generation; apply one, then the other. Expect stale-configuration rejection, never overwrite the newer config. Simulate failures through fixtures rather than corrupting production files: before commit expect unchanged active values; after possible commit expect read-back and «Сохранено», «Не сохранено» or «Исход сохранения неизвестен». Unknown authoritative state blocks changes and lamp commands; read-only configuration check can resolve it without retry/rollback/token rotation. An already applied import must not be labelled rejected.
6. Replace the installed plugin with the updated complete installer, preserving Application Support. Restart three times and compare ten assignments, titles/icons, language, identity, port, token and presets locally. Missing selected preset stays missing and is not replaced by another preset.
7. Export/import a profile into an installation with no local configuration. Expect assignments but no credential/local-source path; setup is required before commands. Legacy global cleanup failure must not re-import stale connection settings over an already committed generation.

Expected: preserved configuration values and sources; safe recovery for failed/unknown commits; no partial settings/presets pair, secret rotation or replay. Do not publish credential comparisons—record equality as a result only.

## 5. Ownership and recovery acceptance

Most fault injection is automated; the following host checks prove the real process tree. Use a developer process monitor or a separate test harness to observe exact owned handles. Ordinary users only use the panel controls.

- Reserve configured port with a synthetic loopback fixture (not a real lamp controller). Start plugin: expect port-conflict, zero native worker starts, no probe/token to the fixture and no killing it. Release the fixture and explicitly restart.
- Quit Stream Deck, disable plugin, restart plugin and force only its Node backend to exit in separate runs. Expect supervisor-led native cleanup, no surviving BLE controller and no duplicate on reopen.
- Close host socket/quit while child timers exist; simulate liveness deadlines. Expect capabilities revoked and worker stopped. Profile change or device unplug alone must not be treated as host exit. Check sleep/wake: a missed lease safely stops, with explicit restart rather than resumed command.
- After a host timeout has closed the helper pipe and the supervisor has exited, restore host responsiveness and press Restart in the panel. Expect old handles/transports drained, one new management session, acquired fixed lock, authoritative config reload and one worker with fresh auth. A retained old-worker lock blocks it. While an old SDK request is unresolved, repeated clicks must not issue another SDK call; late old reply is discarded for lease renewal and followed by one fresh host probe. An unavailable host remains an error without automatic retry; helper recovery never requires a whole-plugin restart when the host is responsive and cleanup succeeds.
- Test TERM-ignoring/pre-main-stalled fixtures automatically: KILL after the 10-second grace, wait/reap, hold lock/listener until confirmed exit and revocation drain. No arbitrary PID-file killing. A delayed reap is cleanup-blocked, not successful cleanup.
- While stopping/restarting, try another key and another panel's Restart. Expect busy/stopping state, zero extra worker/command and no old responses making a new runtime ready.

Limits: simultaneous destruction of both supervisor and plugin before a worker's main function is a different multiple-failure case; inherited lock prevents a competing worker, but do not claim that fixture proves automatic cleanup of every OS failure combination.

## 6. Separate LT-06 observations

Only on the owner's explicitly selected lamp, disconnect other apps using it. Keep these checks local and separate from CI; use normal installed plugin actions so this verifies the new launch/permission chain.

For T078, first complete current-host setup/recovery T025/T058 and software/integration T075/T092. Use the current integrated owner-linked fixture and record its provenance/mode. T073 separately checks local installation/import/update/retention; these physical observations neither require nor complete it.

| Action | Observation to record |
| --- | --- |
| On / Off | Actual light visibly turns on / off |
| Color FF5000 | Actual displayed color, not merely successful write |
| Brightness 25 then 75 | Actual visible relative brightness change |
| One selected preset | Actual effect matching that preset |
| Transition interrupted by plugin close | Remaining steps stop; no extra Off; restart does not continue it |
| Setup/check/restart | No lighting-control packets/effect initiated by these actions |

An already-started native write may finish during stopping; record that outcome honestly. A packet log, process status or connected adapter cannot prove the final physical lamp state. Existing `task test:hardware` can supplement transport checks but is not a substitute for installed-plugin observations. Never enable hardware tags in CI/default tests.

## Evidence record

At implementation time record software checks, source revision/build mode, actual tested-host steps, prompt attribution, local artifact inspection and separately lamp commands/observations in this feature's validation artifacts. Use pass/fail/pending with reasons, not inferred passes. The planning phase creates neither passing runtime evidence nor a tasks completion record.

## 7. Stream Deck+ owner check (T085)

Assign **Brightness** to a dial and save a deliberate starting percentage in its panel. Appearance alone must not change the lamp. Rotate clockwise and counter-clockwise: expect one percentage point per tick, clamped to 0–100. The `$B1` touch strip displays the target and request status, not measured brightness. A brightness command also turns power on; 0% is not an Off command. Dial press sends explicit Off and preserves the target. Once Off settles, a fresh rotation turns power on even at the 100-percent ceiling. Dial release and strip touch have no lighting effect.

Turn quickly and reverse direction while a command is pending. Expect one active request and a single coalesced target per dial, without a growing queue. Check failure/unknown reporting and that no unsent turn is replayed after readiness recovery, profile changes or restart. The saved panel percentage remains the initial value when the action reappears. At 100, press the dial to turn the lamp off, wait for the result, then turn clockwise without lowering the target: expect brightness 100 and power on. Press also cancels any older queued rotation; wait for its result before a new turn. Check a second dial context and an existing Brightness key; all use the same owned worker. Record actual visible lamp effects and Stream Deck+ device details in hardware-verification.md; synthetic event tests do not establish this result.

## 8. Owner smooth-transition acceptance (T093)

Complete current-host setup T025 and integrated transition software T092 before this owner-run check. Follow the acceptance sequencing above; Intel and distribution observations remain separate.

The current personal-development fixture, including the LaunchServices/TCC, pending-feedback, immediate-cancel dial-Off/boundary and numeric-display corrections and Go/native license notices, is `/private/tmp/mergbw-feature007-numeric-dial-20261024/com.obalunenko.mergbw.sdPlugin`. It is already locally linked from ignored `dist/plugin-local-numeric-dial/`; use the existing installation for owner checks. It includes Transition and Brightness Encoder; previous dial-only fixtures do not include transitions. For a new installation, use the explicit pinned link path from the early feasibility section with this directory, after preserving working data. This directory is not a universal distribution installer.

Use the current Apple Silicon Mac/LT-06 with working data preserved. Add **Transition**, save explicit endpoints and an integer **1–60 seconds**. Start with FF5000/100 to FF5000/0 in 10 seconds, then test different RGB endpoints and the 1/60-second bounds. Invalid 0/61/noninteger durations must not save or cancel an active job. Saving/checking/appearing must not write a lighting command.

Press the key once. Acceptance is distinct from completion. The starting values apply explicitly and may change the lamp immediately; the nominal fade duration starts after those initial packets. Observe visible smoothness and the exact endpoint, recording what actually occurred. Check status from the panel without changing the lamp. Cancel explicitly and confirm no extra Off. Start another transition and interrupt with an ordinary button, then a Brightness dial turn: the new command must follow the last in-progress native write, with no old steps afterward. Cancellation during a native write may have an unknown final effect.

Quit/restart during a transition; confirm no automatic continuation, command replay or Off. Record current Mac/Stream Deck/LT-06 and physical effects separately in hardware-verification.md. Any Intel execution evidence remains separate; Developer ID and downloaded-installer checks are optional. A successful write or completed schedule is not physical state readback.
