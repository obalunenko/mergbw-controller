# Research: bundled controller and managed lifecycle

**Scope update, 2026-10-24**: The owner chose personal local development: Developer ID, notarization/stapling, downloaded-installer and quarantine acceptance are no longer required. Keep earlier research below as historical design context. The current contract is [local development](contracts/distribution.md); local ad-hoc helper signing needs no Apple credentials.

Date: 2026-10-22. Scope: Phase 0 design research, read-only repository inspection and primary documentation. No installed-host or physical claim is made. Three read-only research agents covered lifecycle, macOS packaging and configuration/UI; the final design below consolidates their recommendations. No source files were changed by those agents.

## Questions resolved

| Initial unknown | Decision | Follow-up evidence |
| --- | --- | --- |
| Parent loss during native package initialization | Independent BLE-free supervisor plus one native worker | Process fixtures, then installed-host crash test |
| Reliable one-instance/port ownership | Fixed inherited advisory lock plus inherited reserved listener | Lock/FD tests and raced-port fixtures |
| Proof of readiness | Private launch handshake + current owned worker + authenticated catalog check | No inference from public health alone |
| Host quits while Node stays alive | Public SDK round-trip lease, no undocumented disconnect API | Pinned SDK unit facade and real host quit/sleep tests |
| Multi-file import consistency | Immutable generation + one CURRENT.json replacement | Failpoints and crash/read-back tests |
| File selection and legacy settings | Vendored SDPI selection, private paths, globals v2 after commit | Real PI selection and migration regression |
| Architectures, privacy identity, distribution | Universal helper app; signed/notarized distribution path | Per-architecture installed/TCC/Gatekeeper acceptance |
| Pipeline dependency ordering | Native Darwin artifacts feed macOS helper assembly | Content/manifest checks, no native invocation in CI |

No unresolved product clarification remains. Actual macOS permission attribution is an experiment to execute at implementation time, not a claim inferred from documentation.

## R8. Acceptance scopes and task ordering (2026-10-24 reconciliation)

**Decision**: Separate owner-run current-Mac host/lamp observations from universal signed-package inspection and downloaded-installer execution on each architecture. T078 depends on T025/T058/T075/T092 instead of aggregate T073; T093 also requires T025. Preserve T072 and aggregate T073 as required final T079 gates, recording Apple Silicon and Intel outcomes independently. Retain every task ID, checkbox and existing result. Dependencies may refer to later IDs after appended increments; require an acyclic graph and keep T079 terminal.

**Rationale**: Local read-only research of spec.md's 2026-10-23 scope clarification, plan.md's acceptance decision, quickstart.md and tasks.md found that unavailable Intel execution unnecessarily blocked current-Mac physical checks, and interrupted-transition acceptance lacked its integration prerequisite. The owner permits their current macOS user with working data preserved. A separate test user is optional; existing TCC grants cannot demonstrate a fresh prompt. One read-only research agent reviewed these recorded decisions for this planning revision. No new technology choice or external documentation update is needed.

**Alternatives considered**: Requiring Intel before any current-Mac lamp observation couples independent evidence. Removing Intel/distribution gates would overstate complete-feature acceptance. Renumbering or regenerating the implemented task list would disrupt stable references and recorded progress. Targeted dependency corrections preserve both current-host progress and honest final gates.

**Evidence limits**: A current-architecture spike can establish only the observed host/physical effects for that exact build; it is rejected by full-package checks. T073 remains unchecked while either architecture is pending. T079 cannot complete with missing required gates. The related documentation-only evidence fields are in data-model.md; no runtime schema or physical readback is added.

## R1. Native initialization requires supervision outside the worker

**Decision**: Add `cmd/sunset/supervisor` with no Bluetooth imports and `internal/managed` for process management. It starts parent-lifetime handling before spawning the existing native worker. It also composes `internal/config` for configuration operations, avoiding a third config-only executable.

**Rationale**: `cmd/sunset/main.go` imports `internal/ble/native`; `internal/ble/doc.go` and `internal/ble/native/adapter.go` document upstream adapter initialization at import time. Go initializes imported packages before main, so a worker may stall before any watchdog in main runs. This ordering follows [Go program initialization](https://go.dev/ref/spec#Program_initialization). The worker remains the only BLE controller.

**Alternatives**: Node exit hooks cannot execute asynchronous cleanup after parent death. A watchdog only inside the native binary misses package initialization. Replacing/forking upstream native initialization or using a permanent OS service adds unrelated scope. The pure supervisor covers the required single parent failure without rewriting BLE.

## R2. Pipes, inherited ownership and explicit reaping

**Decision**: Node spawns the exact bundled supervisor executable, with `shell:false`, `detached:false`, ordinary pipes and no `unref`. Supervisor owns the worker's process handle, a persistent exclusive nonblocking lock and the reserved IPv4 listener. Pass listener and duplicate lock using `exec.Cmd.ExtraFiles`; worker uses `net.FileListener` and retains lock FD until exit. Do not use PID-file contents to identify a process to kill or unlink the lock file.

**Rationale**: A child is not automatically terminated merely because its parent is gone; ordinary pipes provide a separate parent-loss signal. [Node child processes](https://nodejs.org/api/child_process.html) also distinguishes a sent signal from actual process exit. Go's [exec.Cmd](https://pkg.go.dev/os/exec#Cmd) supports extra descriptors and requires waiting for a successfully started process; [net.FileListener](https://pkg.go.dev/net#FileListener) and [TCPListener.File](https://pkg.go.dev/net#TCPListener.File) have independently closed copies. Darwin [flock](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/flock.2.html) supports nonblocking exclusive ownership shared by duplicate/inherited descriptors. [Pipe EOF](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/pipe.2.html) detects loss of all writers.

**Alternatives**: Preflight bind-and-close creates a port race. HTTP health and matching tokens do not establish ownership. Killing a persisted PID risks an unrelated process. Lock-file existence is not liveness and deleting the file can split ownership across inodes.

**Limit**: Simultaneously killing plugin and supervisor while the native worker is stuck before main is a multiple-failure case. Inherited lock/listener prevent a competing launch, but automatic orphan termination in that case is not claimed. Once worker main runs it also watches its supervisor pipe. Ordinary plugin loss is handled by the independent supervisor even during native initialization. No OS process design can promise a scheduling deadline for a kernel-stuck process; `cleanup_blocked` forbids replacement until exit is proven.

## R3. Host liveness, readiness and cancellation

**Decision**: One SDK global-settings round trip every 2 seconds with a 5-second response deadline renews a 10-second supervisor lease. A missed reply disables commands and stops lease renewals; abort/drain HTTP transports and acknowledge revocation before a live parent closes the lifetime channel. If drain stalls, keep the pipe open so the expired lease stops the worker while retaining its port. Do not issue accumulating follow-up requests. Polling never saves or activates returned settings. Use signal/EOF handling too. Worker readiness is a current private session/config/launch handshake followed by existing compatible health and authenticated catalog reads. BLE status is separate; disconnected BLE does not by itself make the HTTP process foreign or lamp off.

**Rationale**: Inspected pinned `streamdeck/node_modules/@elgato/streamdeck/dist/plugin/connection.js`: only connected is exposed, not a supported disconnect hook. Its `settings.js:getGlobalSettings` sends a fresh request, so a round trip can prove recent host participation. The public [Elgato settings API](https://docs.elgato.com/streamdeck/sdk/guides/settings/) supports reading globals; default SDK v3 settings-event behavior means backend saves must activate local state themselves. `/health` in `internal/bridge/http.go` is unauthenticated and cannot prove authorization. Node [exit listeners](https://nodejs.org/docs/latest-v24.x/api/process.html#event-exit) cannot wait for asynchronous work. A pause/sleep interruption fails closed and offers explicit restart.

**Recovery decision**: Explicit Restart is a backend operation over the whole owned chain. For an exited helper, drain old transports/handles, obtain fresh host proof, create one new BLE-free supervisor/session, require its fixed lock and authoritative config validation, then start one worker. A leftover inherited lock blocks the worker. One process-wide broker retains the sole raw SDK getGlobalSettings request across helper lifetimes: local timeout is not SDK cancellation. Wait up to five seconds for an expired old probe, discard that result for lease renewal, and only then issue one fresh five-second probe. If the old probe does not settle or the fresh one fails, return host_unavailable; never create accumulating raw requests or a retry loop. Test stale replies/repeated clicks as well as a successful full-chain recovery.

**Stop decision**: Cancel root context, stop admissions and send TERM; after 10 seconds send KILL to the actual owned child, then wait. Current worker shutdown already allows HTTP shutdown 5 seconds and BLE close 3 seconds; this fits inside the supervision grace. The 15-second worker bootstrap deadline ends waiting for native initialization/readiness through the same cleanup path, not an abandoned native goroutine. No command or transition resumes automatically. These constants are design choices tested by an injected clock, not native-operation guarantees.

**Alternatives**: Child references/timers alone can keep Node alive after the host socket closes. Importing private SDK socket internals is brittle. Reconnect loops or automatic process restarts would obscure permission failure and unknown command outcomes.

## R4. Canonical configuration and atomic import

**Decision**: Keep authoritative rules and transactions in `internal/config`; supervisor handles prepare/apply/read on its private channel. Store snapshots under `os.UserConfigDir()/com.obalunenko.mergbw`, with single `CURRENT.json` active pointer. Stage and sync both JSON files before atomic pointer replacement on the same filesystem. Serialize apply/restart/stop, compare expected generation, stop/reap old worker before commit, and retain previous snapshots until new startup is confirmed.

**Rationale**: Existing config validates six-byte identity, port 1024–65535 and 24–128-character URL-safe token; protocol requires nonempty valid preset catalog. `Init` creates a missing whole preset file but never merges missing stock keys. Executing `sunset init` is not Bluetooth-free. [Go os.UserConfigDir](https://pkg.go.dev/os#UserConfigDir) selects Application Support on Darwin; [os.Rename](https://pkg.go.dev/os#Rename) and [File.Sync](https://pkg.go.dev/os#File.Sync) support the chosen Unix single-pointer strategy. Application-specific storage belongs under the user's [Application Support directory](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html).

**Failure semantics**: Pre-commit failures retain old configuration. FR-007 now explicitly applies the unchanged-data guarantee before the commit point. Privately retain the prepared expected/candidate generation IDs so read-back can distinguish applied/not_applied/commit_unknown, expose the three user outcomes and a read-only check, and block writes/commands while authoritative state is unreadable. Once pointer rename happened, a failed reply or directory sync is not an ordinary rejected import: read back pointer/generation and report committed, not committed, or commit-unknown. Never regenerate token or automatically replay apply. Power-loss durability beyond what filesystem sync provides is not promised. No native worker writes generated URL files into immutable snapshots; standalone CLI still generates them normally.

**Alternatives**: Sequential settings/presets overwrites can leave a mixed configuration. Reimplementing Go formats/defaults in TypeScript duplicates ownership and drift risk. A separate config helper is unnecessary because the supervisor is already BLE-free.

## R5. UI selection and migration

**Decision**: Use the existing vendored `sdpi-file` control for the two selected JSON paths, without `setting` or `global` persistence. Validate/read selected regular files read-only and size-limit them; return sanitized preview fields, never token/raw content/path in PI replies or logs. Bind proposals to PI session, expected active generation and expiration. Existing actions keep their schema/UUID and custom artwork. Legacy global v1 data stays intact until successful configuration commit; then write globals v2 language only. Current authoritative disk state wins if cleanup of legacy globals fails.

**Rationale**: [SDPI File](https://sdpi-components.dev/docs/components/file) documents a selected path string and optional automatic persistence; omit that persistence to avoid putting source paths in exports. [Elgato action/global settings](https://docs.elgato.com/streamdeck/sdk/guides/settings/) have different export/persistence roles. The current plugin already validates session/request IDs, allowlists action fields and sanitizes snapshots; extend those patterns.

**Manual migration**: If no disk configuration exists and legacy port/token are valid, a user-supplied identity can prepare a configuration preserving those values, explicitly indicated in preview. Full imported settings are authoritative after confirmation. Existing secret is preserved on repeated saves. Unknown versions/corrupt values produce a recoverable error, never automatic reset.

**Alternatives**: Treating a URL as complete configuration invents an identity it does not contain. Persisting file controls in action settings leaks local paths. Automatically replacing the active secret breaks compatibility.

## R6. Universal helper app and permission proof

**Decision**: Package one universal `MeRGBW Controller.app` with stable bundle ID, native supervisor as `CFBundleExecutable`, native worker in `Contents/Helpers/sunset`, macOS 13.5 minimum and localized `NSBluetoothAlwaysUsageDescription`. Both executables contain arm64 and x86_64 slices. Launch the checked app with fixed `/usr/bin/open -n -g -W` and connect through a private Unix socket, following the installed-host correction in contracts/managed-runtime.md. The earlier direct-executable choice failed actual TCC attribution. Keep data outside its installed directory.

**Rationale**: Apple's [universal binary guide](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary) describes merging slices with `lipo`; it avoids architecture/Rosetta routing. The [Bluetooth usage key](https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription) supplies the privacy purpose text; Stream Deck manifest JSON does not substitute for Apple bundle metadata. The [Bluetooth entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.device.bluetooth) is documented in the App Sandbox context, so it is not a generic replacement for permission. Do not sandbox the helper or re-sign Elgato's app merely to add this key.

**Toolchain compatibility**: [Go 1.27 Darwin release notes](https://go.dev/doc/go1.27#darwin) require macOS 13 or later, compatible with the existing plugin minimum 13.5. Set and inspect minimum OS load commands for both the pure-Go supervisor and CGO worker, not only the outer plist; an SDK runner's newer OS must not silently become the deployment requirement.

**Inference, not a guarantee**: Apple DTS explains TCC responsible-code attribution and native bundle identity in [On File System Permissions](https://developer.apple.com/forums/thread/678819). That article discusses general TCC/file access, not a tested Stream Deck Bluetooth chain. It does not prove that this helper receives its own prompt. The actual responsible application, deny/re-enable path and upgrade stability must be observed from installed Stream Deck without a prior Terminal grant. A failing experiment blocks the no-terminal acceptance claim and requires design adjustment.

**Early feasibility decision**: T024 supplies a standalone `spike` builder CLI using only current-Mac native slices and the already existing JS build and pinned explicit link commands. Stage allowlisted assets under an isolated temporary root, attach buildMode spike metadata and preserve working data during owner-run testing; a separate macOS user is optional by the 2026-10-23 user decision. The builder never executes native code or links automatically. T025 follows its dedicated early quickstart section before any T067 workflow exists; it records only current-host feasibility, with full universal installer/Gatekeeper/other-architecture evidence pending. Full checks reject spike mode.

## R7. Signing, pipeline and offline payload

**Decision**: Keep four native standalone archives. Darwin native jobs additionally upload worker/supervisor slice payloads from the tagged commit. Final plugin job runs on macOS, waits for both Darwin inputs, assembles/signs the universal app, verifies it, then packs one installer. Publication waits for checks, four CLI archives and complete installer as today. The strict package checker validates native contents and permissions without invoking native binaries. JS-only software checks remain usable on Linux; a JS-only payload cannot pass full package checks.

**Distribution path**: For Developer ID distribution sign inner worker then outer app with hardened runtime and timestamp after `lipo`; notarize the app in a supported ZIP, staple it, then pack. Signing credentials are an external release prerequisite, not assumed present or read during planning. A local ad-hoc/unsigned development payload must be explicitly identified and must not silently pass the signed distribution target. If credentials are absent, that target fails with a clear message; it does not weaken its verification or change already published releases.

**Rationale**: [Elgato pack](https://docs.elgato.com/streamdeck/cli/commands/pack/) packages plugin directory contents using ignore rules and requires plugin validation; this does not prove native execution. Apple [notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [custom workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) distinguish supported containers and stapling the app before a third-party installer. No claim that `.streamDeckPlugin` itself is an Apple notarization container. Archive extraction must preserve final signed bytes, modes and ticket.

**Alternatives**: Runtime downloads violate scope. Building a Darwin BLE executable on Ubuntu ignores CGO/Apple SDK requirements. Per-architecture installers complicate the selected one-package UX. Silent unsigned fallback mislabels what was verified. Marketplace publication remains excluded.

## Research closure and evidence limits

All design questions above have concrete decisions; no implementation placeholder remains. No credentials, hardware identity or imported private configuration were accessed. Research supports the design, not a physical/Bluetooth/Gatekeeper success claim. The implementation must collect process-fixture evidence, installed-host evidence per architecture and separate LT-06 observations before calling the corresponding acceptance criteria complete.

## Transition amendment (2026-10-23)

User decisions supersede the earlier missing-baseline fade concern: implement a sixth action with explicit endpoints, new-command interruption and duration 1–60 seconds. Existing 35-second request limits make a synchronous one-minute action unsuitable. Use a bounded controller-root job with 202 acceptance and explicit read-only status/cancel endpoints; no poll service or persisted execution. Existing native cancellation remains cooperative, so new commands wait for the active Write before obtaining the BLE gate. The accepted protocol, pacing, uncertainty and test rules are specified in contracts/transitions.md. No additional external runtime dependency is introduced.

## Installed-host launch correction (2026-10-24)

**Evidence**: Direct spawning kept Stream Deck as the TCC responsible application. The worker aborted for a missing Bluetooth usage description even though the helper app had one. A valid embedded worker plist did not change that result. The local `/usr/bin/open -h` documents new-instance, background, wait-for-exit and argument forwarding. Pure non-BLE app fixtures verified ordinary LaunchServices launch. Inherited `/dev/fd` redirection failed; private FIFOs worked after connection but could block if the parent died before opening, so they were rejected.

**Decision**: Use the public app launcher and a fresh private Unix socket. Bind before launch, validate the endpoint before admitting a session, and retain the owned launcher plus control connection until worker cleanup. The existing private frames, lease, revocation and worker ownership remain unchanged. Software fixtures cannot prove TCC attribution; repeat actual Stream Deck startup with preserved data.
