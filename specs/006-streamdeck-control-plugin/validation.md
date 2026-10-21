# Stream Deck plugin validation

Implementation run: 2026-10-21. Plugin baseline: 0.1.0.0, SDK 3.0.3, CLI 1.10.3. Automated checks use a temporary official Node 24.13.0 runtime. Dependency resolution initially used the installed Node 26; the lockfile pins the resulting package versions. Validation results below distinguish execution from plans.

Current progress: **80/80 tasks complete**. Installed-host acceptance and physical LT-06 acceptance T061/T072/T079 are complete under the owner’s revised personal-use scope. Excluded manual cases were not executed or measured: clean-global import, five-participant study, 100 visible-timing samples and old Website buttons. Current macOS package evidence is **83 top-level Node tests**, lint/format/types/build/package plus Go core/race/vet/build and workflow checks. The Linux equivalent pass predates the final inspector corrections; no later Linux execution or remote CI run is claimed. All original and follow-up reconciliation tasks T062/T073/T080 are complete. Earlier counts and pending statements are historical checkpoints.

Latest host follow-up: the installed five-action package runs on Stream Deck 7.6.0 with a standard 15-key device and **MeRGBW Acceptance** profile. Ten independent assignments, three restart rounds, safe actual export, existing-host import and one shared connection change pass. All failure modes, initial attention/custom-image restoration, busy/unknown guidance, invalid-link rejection and deliberate normal recovery pass. Final Check shows service available, authorization verified and the fixture's intentional Bluetooth disconnected; exactly one final Color 336699 command was sent. Actual logs contain no synthetic token or HTTP URL. The owner excluded manual clean-global import; no current settings were reset. Host acceptance is complete within that scope.

## Automated evidence

| Check | Result |
| --- | --- |
| Foundation TypeScript strict compile | Passed before story implementation |
| Go bridge tests including catalog guards | Passed before story implementation |
| Internal US1 two-action slice | 18/18 Node tests, selected Go catalog tests, lint, format, typecheck, build, validate and pack passed under Node 24 (worker run) |
| US2 values/catalog slice | 13/13 targeted tests, strict backend/UI/test compilation, scoped lint/format, build and manifest validation passed (worker run) |
| US3 lifecycle slice | 12/12 owned tests, backend/UI/test compilation and scoped ESLint passed (worker run) |
| US4 failure/recovery slice | 20/20 focused Node tests (including 100 loopback activations), catalog logging test, compilation, scoped lint and format passed (worker run) |
| Final plugin and controller checks | All runnable final checks passed; receipts below |
| Linux equivalent / CI | Passed in the T059/T070 Linux equivalent run below; no remote CI run was launched. This predates Phase 10 inspector corrections. |

## Host acceptance

The initial run recorded `/Applications/Stream Deck.app` as absent and collected no host observations. The current follow-up below finds the host under `/Applications/Elgato Stream Deck.app`; it supersedes that availability finding. These acceptance tasks still require observations:

| Task | Required observation | Status |
| --- | --- | --- |
| T027 | Power acceptance in the current five-action installer, import/check counters, press/release and host restart | Passed: counters 0 → 1 On → 2 Off; restart/Check stayed 2; physical On → 3, Off → 4; saved connection and assignments retained; user confirmed green checkmarks and no browser |
| T037 | Picker/percent and catalog baseline → renamed → deleted → duplicate-labels → empty → baseline in PI | Passed: picker/RGB sync; exact FF5000 and 0/100 commands; stable sunset on rename; deleted/empty activation blocked with zero commands; duplicate ids independently selected and sent; baseline restored and sunset sent once |
| T044 | Ten assignments, independent copies, custom appearance, profiles/export/import and three host restarts | Complete under revised owner scope: actual ten-key/copy/appearance/three-restart/export/existing-host-import/shared-port checks pass. Manual clean-global import explicitly excluded by owner for personal use; not executed or claimed as verified |
| T052 | Failure/recovery modes, attention overlay and safe host logs | Passed: all fixture modes, initial attention/custom restoration, busy/unknown/profile switch, safe errors/logs, four invalid imports and normal recovery. Final Save/Check and deliberate press produced one exact Color 336699 command without reinstall/reimport; user confirmed green and sent/unverified-state explanation |
| T069 / T076 | Combined actual host acceptance after implementation/inspector corrections | Complete within revised owner scope, using actual completed original tasks and unchanged installed package; clean-global manual import excluded, not verified |
| T060 / T071 / T078 | Historical five-participant and 100-visible-timing studies; revised owner SC-001/002/005 | Excluded from required acceptance by explicit owner decision for personal use. No measurements collected or numerical latency claimed; existing owner checks and automated tests retained |

The internal MVP manifest had exactly two actions; its pack report contained 15 files, 412.4 kB unpacked, with zero final validation warnings. These figures describe that intermediate artifact, which the final five-action build replaces. Clean npm ci and host execution were not observed at this MVP checkpoint.

Automated facade tests do not replace host observations. Actual counters, user feedback and the audited host profile export are recorded below. No numeric visible-feedback timing or participant usability result is claimed.

## Physical acceptance

T061/T072/T079 are complete. See [hardware-verification.md](hardware-verification.md) for the owner-observed real lamp effects: Off/On, orange FF5000, dim 25, brighter 75 and sunset orange/60. macOS 27.0.1, Stream Deck 7.6.0, plugin 0.1.0.0 and controller 2.0.0-go were used. Actual dispatch receipts corroborate the observations; runtime `physical_state_verified:false` remains unchanged. Manual old Website acceptance was explicitly excluded by the owner, not passed. Configuration hashes remained unchanged.


## Requirement review

The following is the final FR-001–FR-017 and SC-001–SC-008 mapping after host and physical acceptance. Owner exclusions are explicit in spec.md, plan.md and quickstart.md. They override historical task wording without claiming omitted tests ran. Unreproduced UI reports remain observations, not confirmed defects or claimed fixes.

| Requirement | Automated boundary / evidence | Host evidence / remaining observation |
| --- | --- | --- |
| FR-001 | Five UUIDs, manifest validation, package content tests | Normal installer loaded; all five actions assigned in host |
| FR-002 | Inspector message contract, strict UI compile, controls included in bundle | Actual import, Save, Check, value editing and catalog variants pass; legacy Refresh-control report unresolved |
| FR-003 | Import, settings and inspector tests; import never dispatches | Synthetic host import/shared connection pass and final focused import/settings regressions pass. During real setup the owner reported import did not replace the port; manual port/token Save reached verified/connected. That report remains unreproduced, with no fix claimed; group/timed setup excluded |
| FR-004 | Raw import rejection and fixed IPv4 HTTP boundary tests; redirects never followed | None at automated boundary |
| FR-005 | Independent health/catalog tests; strict GoMock forbids controller calls on catalog | Three independent statuses observed, including normal verified and legacy unknown auth; no lighting command from Check |
| FR-006 | Assignment export allowlist, copy/restart facades and revision tests | Ten assignments, three restart rounds, export/existing-host import and one shared port change pass; clean-global manual import excluded by owner, automated contract retained |
| FR-007 | Action-value validation/defaults, canonical command tests | Actual picker/RGB and brightness 0/100 synchronization/exact commands pass; real lamp FF5000 and brightness 25/75 effects owner-confirmed |
| FR-008 | Catalog variants, rename/delete/duplicates/empty and stale-result tests | Actual variants/Refresh/stable ids pass under T037; real sunset effect owner-confirmed. Legacy Refresh-control report remains unreproduced |
| FR-009 | Go preset projection/auth/Host/URL/body/method tests; legacy fallback tests | Legacy upgrade guidance and compatible commands observed |
| FR-010 | Power event tests, busy/deadline recovery and 100 real loopback activations | Actual press/release, busy guard and initial attention pass; manual timing study excluded, runtime deadline/automatic checks retained |
| FR-011 | Pending/sent/rejected/unknown snapshots and local explanation tests | Owner observed initial overlay, Executing and actionable terminal explanations; group study excluded |
| FR-012 | Refusal/lost transport/503/504/malformed/timeout tests, zero automatic replay | Actual failure matrix and deliberate normal recovery pass under T052 |
| FR-013 | Settings, diagnostics, retained-secret/request-ID tests and actual synthetic installer exclusion | Actual export and synthetic logs audited; final nine installed logs also exclude the real controller token and all HTTP URLs |
| FR-014 | Runtime default labels, SDK override contract and facade lifecycle tests | Actual values/defaults, custom title/rocket, initial attention and restored appearance pass |
| FR-015 | Existing core/race regression suite, build and unchanged Go interfaces/native code | All required plugin LT-06 effects owner-confirmed, configuration preserved; manual Website acceptance excluded, GET/POST contract retained |
| FR-016 | Safe event fields, durations/IDs and bilingual log/recovery instructions | Actual installed log redaction and field/value audits pass |
| FR-017 | RU/EN key parity tests and paired README review | Owner completed interface/recovery instructions; group comprehension study excluded |

| Success criterion | Evidence status |
| --- | --- |
| SC-001 / SC-002 | Revised owner setup/five-action checks pass under T027/T037; historical five-participant/timed study excluded, not executed |
| SC-003 | Automated 100-activation and no-replay scenarios executed by story worker; final suite records follow |
| SC-004 | Actual ten-key/copy/three-restart/existing-host import passes; T044 complete under owner scope, clean-global manual import excluded |
| SC-005 | Revised owner initial/processing/result feedback observed, controlled deadline tested; historical 100-visible-timing/percentile study excluded, no numeric latency claim |
| SC-006 | Automated tests and actual failure/outcome/busy/custom-feedback/manual-recovery observations pass under T052 |
| SC-007 | Automated synthetic secret/redaction/installer checks and actual exported profile/installed-log audits pass |
| SC-008 | Go regression and unchanged configuration; required plugin lamp effects owner-confirmed. Old Website manual acceptance explicitly excluded, not executed |


## Pre-convergence executed receipts

macOS 27.0.1 arm64; Go 1.27.3; Task 3.54.0; Node 24.13.0; npm 11.6.2. SDK 3.0.3 and CLI 1.10.3 remain locked. The final Node suite has 63 top-level tests, including the 100-activation case and four package tests. The package workflow reruns its required check gate before packing.

| Recorded check | Exit | Result |
| --- | --- | --- |
| macOS core tests | 0 | Passed |
| Locked Node24 plugin dependencies | 0 | Passed |
| macOS core race tests | 0 | Passed |
| Final plugin check | 0 | Passed |
| Go static analysis | 0 | Passed |
| macOS controller build | 0 | Passed |
| Task workflow recorder | 0 | Passed |
| Final installer workflow | 0 | Passed |
| Final installer archive content | 0 | Passed |
| Working tree whitespace | 0 | Passed |

The final installer is `dist/com.obalunenko.mergbw.streamDeckPlugin` (182,879 bytes). Archive inspection passed: 28 files, five actions, all bundles/assets, plugin and dependency licenses, local SDPI checksum, no private or developer files. A separate package test packs a temporary synthetic runtime with private-file sentinels and verifies their actual exclusion. No real settings or secrets were used.

The clean install emitted the ESLint 9 deprecation notice. The pinned official Elgato ESLint configuration requires ESLint 9; lint passes with that declared peer version. This warning does not change the execution result.

54/62 tasks are complete after T058. T027, T037, T044, T052, T059, T060, T061 and T062 remain unchecked. T062's automated requirement review is documented above, but its Linux/host/participant/physical acceptance prerequisites remain pending. No completion promotion is requested while those tasks remain open.


## Convergence corrections T063–T067

All five appended corrections are implemented. The current task count is **59/67 complete**. The eight acceptance tasks listed above remain pending; no host, Linux, participant or physical observation was added.

| Task | Correction and regression evidence |
| --- | --- |
| T063 | Catalogs containing a current or retained in-flight token in an ID are rejected as a whole. Existing unsafe assignments cannot enter snapshots, default titles or saved action settings. `diagnostics.test.ts` and `preset-catalog.test.ts` cover equal and containing IDs, token rotation and direct persistence rejection. IDs are never replaced. |
| T064 | Initial reads and global saves share a queue. Restored settings notify existing keys and inspector sessions. Deferred-storage tests cover early RU/configured views and import/save races; corrupt and unknown schemas retain their existing recovery rules. |
| T065 | Rejected/unknown outcomes retain a public summary after private terminal records are removed. Lifecycle tests cover failures before hiding and while hidden, inspector reopening, no stale success/replay, and invalidation by a new operation or assignment/connection change. Unknown status continues to select the existing possible-late-effect explanation. |
| T066 | Local rejections include measured nonnegative duration. Controlled-clock activation tests cover invalid, unconfigured and missing-preset failures with exact safe fields and zero command dispatch. |
| T067 | Catalog route classification precedes authentication and counting. Fixture tests cover health, authorized/unauthorized catalogs and rejected lamp commands in normal/auth-denied modes across all five catalog variants. |

`task plugin:package` passed under Node 24.13.0, including lint, formatting, backend/UI typecheck, all **71 top-level Node tests**, build, CLI validation and runtime-content checks. An independent checker also passed typecheck, lint and formatting after reconciliation. The installer was rebuilt at `dist/com.obalunenko.mergbw.streamDeckPlugin` (**183,345 bytes**); archive inspection again passed with **28 files**.

The pinned packer rewrites source manifest whitespace while normalizing its version. The source manifest was formatted again after packing, without changing manifest values, and the final formatting check passed. No Go or BLE files were changed by these convergence corrections. The earlier Go core/race/vet/build receipts remain baseline evidence.

## Convergence follow-up T068–T073

T068 preserves unsaved RGB, brightness, preset and port fields when snapshots repeat their saved values. Changed persisted fields reconcile individually. Save acknowledgements preserve edits made after submission, failed saves leave drafts editable, and explicit link import restores its port without clearing an assignment draft. Missing or unchecked preset drafts remain visible and cannot be saved.

Six regressions in `streamdeck/tests/inspector-ui.test.ts` execute the actual inspector entry point with DOM and SDPI facades. They cover status/language/catalog updates, exact single Save submissions, updates during a save, explicit setting changes, failed saves, invalid values and replacement sessions. The final macOS Node 24.13.0 `task plugin:package` passed with **77 top-level tests**, lint, formatting, backend/UI types, build, manifest validation and package checks. The rebuilt installer is **184,132 bytes**. The first sandbox run could not bind synthetic loopback listeners (`listen EPERM`); the same gate passed outside that sandbox. Source manifest formatting was restored after packing.

### Current host attempt

The installed host is **Stream Deck 7.6.0**, with a Stream Deck + layout visible. The Elgato connector reports a connected host. `task plugin:link` and `streamdeck restart com.obalunenko.mergbw` succeeded; `streamdeck list` confirms the developer link to this repository's runtime directory. This is a linked developer copy, not an observed installer installation.

Desktop automation can read the host accessibility tree and screenshot and change its action filter. Coordinate clicks needed for profile selection and drag/drop repeatedly fail with `noWindowsAvailable`; one reconnect also returned ScreenCaptureKit error **-3811**. No isolated test profile or assignment was created. The original Dials filter was restored. No controller process, simulator or lamp command was started for this host attempt.

T069 and the host portions of T027/T037/T044/T052 remain pending: installer/drag-drop, inspector interaction and counters, catalog variants, ten independent assignments, profile export/import, three restarts, appearance and visible failure recovery have not been observed. The earlier automated facade results remain separate evidence.

T071/T060 still lack five participant measurements and 100 visible-feedback samples. T072/T061 still lack observed LT-06 effects. T073/T062 can retain the requirement mapping above, but cannot close final acceptance before those prerequisites. The quickstart now identifies the two-action MVP as historical and directs current acceptance to the five-action package.

### Linux equivalent execution T059/T070

Both tasks passed in isolated Docker containers on **Debian 12, Linux/aarch64**, using **Go 1.27.3**, **Task 3.54.0**, **Node 24.22.0** and **npm 11.19.1**. Source was copied into Linux volumes; macOS dependencies and generated outputs were excluded. No CI run was launched, so there is no remote run URL.

| Actual Linux workflow | Exit | Evidence |
| --- | --- | --- |
| `make tools`, then `task check` | 0 | Pinned tools installed; Go tests, race tests, vet and controller build passed |
| `task plugin:deps`, then `task plugin:check` | 0 | Locked clean install; lint, format, backend/UI typecheck, **77/77 tests**, build, CLI validation and 28-file/five-action runtime check passed |

The context writer executed and captured both container workflows with `--verify-run`: **Linux Go full suite T070** and **Linux Node 24 locked workflow T070 retry**. The first captured Node install failed with `ECONNRESET`; retrying the same lockfile and workflow passed. npm reported zero vulnerabilities and the known pinned ESLint deprecation warning. Preparatory snapshots containing AppleDouble metadata or the packer's unformatted manifest were replaced before the final pass. Hardware tests and Bluetooth operations were excluded.

Official image digests:

- `golang:1.27-bookworm`: `sha256:5c3e9b43cfd3bb95c7937462e29d87ada57b481a96fa23ad0eb61778d7a00110`
- `node:24-bookworm`: `sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0`

Current progress is **62/73 tasks complete**. T027, T037, T044, T052, T060, T061, T062, T069, T071, T072 and T073 remain unchecked. The spec remains `implementing`; neither host attempts nor automated passes close those acceptance prerequisites.

## Phase 10 corrections and validation

| Task | Implemented behavior and executed regression evidence |
| --- | --- |
| T074 | Inspector requests wait for a final `complete:true` acknowledgement; `complete:false` status publications keep updating the view. Each queued Save retains its submitted values separately from later edits. UI regressions cover overlapping RGB/port saves, intermediate publications, a failed save, subsequent edits and explicit external changes. |
| T075 | Backend replies retain their original request ID while the same session remains active. Closed/replaced sessions receive no old acknowledgement. Deferred assignment/connection saves are tested with intervening language/check/refresh requests, failure and recovery. UI errors persist through unrelated publications until the affected setting saves successfully. |
| T077 | RU/EN timeout guidance for Check/Refresh asks the user to retry that read-only operation. Independent service/auth/Bluetooth results and assignments are preserved. Message/UI regressions verify zero command dispatch and preserve unknown/late-effect warnings for actual command timeouts. |

The writer captured exit-zero receipts for the focused regressions, final `task plugin:package`, installer-content/format checks, `task test:core`, `task test:race`, `task vet`, `task build` and `task workflows:test`. The package gate executed lint, formatting, backend/UI typechecks, **83/83 Node tests**, build, manifest validation and the 28-file/five-action content check under Node **24.13.0**. The installer is **184,684 bytes** at `dist/com.obalunenko.mergbw.streamDeckPlugin`; actual archive entries passed inspection. The packer's source manifest formatting was restored, and the final source formatting check passed. A separate reconciliation worker ran the declared typecheck/lint/format scripts and reported no failing names or concrete seam issue.

The first focused test attempt could not bind a temporary loopback fixture inside the sandbox (`listen EPERM`). The same inspector suite passed outside that sandbox. No Go, BLE, module or Taskfile changes were needed in this pass. The paired READMEs and PI reply contract describe the corrected behavior.

### T076 host attempt and remaining acceptance

The Elgato connector reports a connected Stream Deck host. Its inventory contained **215 actions and no MeRGBW actions**, both before and after the plugin restart. The pinned CLI still lists this repository's developer link, and `streamdeck restart com.obalunenko.mergbw` exited zero outside the sandbox after the sandbox blocked its process query. This receipt confirms the CLI operation; it does not prove plugin loading or installation from the archive. No runtime log files were present in the linked directory.

Accessibility inspection showed the Stream Deck + layout. Filtering Keys for MeRGBW showed an empty action list. A profile-selector click did not produce an accessible profile menu, and the following capture failed with ScreenCaptureKit **-3811**. Reconnecting and raising the host restored inspection but still showed no MeRGBW actions. No test profile, assignment, export, host command counter or visible-feedback measurement was collected. The original MeRGBW search and Keys filter were retained. No installer replacement, controller process, host simulator or physical lamp command was started.

T076 and T027/T037/T044/T052/T069 remain pending. T078 and T060/T071 still require five participant records and one hundred visible-feedback samples. T079 and T061/T072 still require the separate LT-06 observations. The automated requirement mapping remains usable, with the three corrections above adding evidence for FR-002/003/005/006/007/012/017, but T080 and T062/T073 cannot close final acceptance before those observations. The feature remains `implementing` at **65/80 tasks complete**.

### Normal installer follow-up

Read-only investigation of the pinned CLI and host diagnostics found the loading cause: Stream Deck rejected the previous restart URIs with **“Feature only enabled in developer mode.”** The CLI reports that it sent the URI, without waiting for the host to load a plugin. Its `list` command discovers plugin entries on disk, so the earlier developer-link listing did not establish loading.

The inactive developer symlink was removed with `streamdeck unlink com.obalunenko.mergbw` without `--delete`. The repository runtime remained intact. Opening `dist/com.obalunenko.mergbw.streamDeckPlugin` installed a real plugin directory, with no developer symlink and without enabling developer mode. The connector then exposed exactly the five expected UUIDs: on, off, color, brightness and preset. The host action list visibly showed the MeRGBW category and all five actions. The installed log contained one `plugin.ready` and no `plugin.start.failed` event.

The writer-derived **T076 normal installed package** receipt passed: version 0.1.0.0, five expected action UUIDs, **all 28 installed files byte-identical to their archive entries**, and successful runtime startup. No controller, host simulator or lamp command was started. The existing 83-test package receipt still describes this unchanged installer. The reconciliation worker reran the declared typecheck/lint/format checks successfully; no application source changed in this follow-up.

Profile preferences are accessible, but repeated coordinate attempts on their Add control did not open a profile-creation dialog. The profile list/Add control has no usable accessibility entry. A manual handoff requested an isolated **MeRGBW Acceptance** profile with an On key selected. Until it is available, no import/check counters, press/release results, assignment retention, custom appearance, profile exports, host recovery or visible timing are claimed. Both READMEs, the quickstart and workflow contract now describe developer mode and unlinking before normal installation. T027/T069/T076 and the other acceptance tasks remain open; progress stays **65/80**.

### Standard Stream Deck acceptance in progress

The user created **MeRGBW Acceptance** and switched to a standard 15-key Stream Deck. The host visibly shows the profile, an On assignment in its first slot, and all five MeRGBW actions. This supersedes the missing-profile prerequisite above. Bringing the application to the foreground restored coordinate input; keyboard navigation then reached the embedded inspector fields.

The unchanged installed package imported the documented synthetic link for port **18766**. The inspector displayed **Token saved**, cleared the import field, and retained port 18766. A normal/baseline `task plugin:mock` instance started on IPv4 loopback without a real controller or lamp. **Check connection** displayed **Service Available**, **Authorization Verified**, **Bluetooth Disconnected**, and **Ready to send a command**. The simulator emitted no command-counter entries through import and Check: **zero lighting commands**. Disconnected Bluetooth here is the fixture's intentional status.

The user pressed and released the physical On key once and reported a green checkmark appearing and then disappearing. The simulator emitted exactly **one** entry: `count:1`, `type:on`, `outcome:sent`. In normal mode this outcome requires a valid POST. The inspector then visibly displayed **Command sent. Lamp state is unverified**. This confirms the single On request and reported success feedback, without a measured latency or physical lamp-state claim.

Adding Off through desktop automation failed with **AXError.notImplemented** for drag/drop. The user added it to the second slot and confirmed the green checkmark on activation. The simulator emitted exactly one additional entry: `count:2`, `type:off`, `outcome:sent`. The host visibly showed both On and Off, and Off's inspector showed **Token saved** without another import.

Stream Deck was quit normally with Cmd+Q; the application inventory then contained no running Stream Deck entry. Reopening it and returning to **MeRGBW Acceptance** showed both assignments retained. Check connection again displayed **Service Available**, **Authorization Verified**, **Bluetooth Disconnected** without entering the token. The same simulator emitted no further command entries during quit, startup, profile selection or Check: the count remained **2**, with no replay.

After restart, the user pressed/released On then Off once each and confirmed green checkmarks on both and no browser opening. The simulator emitted `count:3,type:on,outcome:sent`, then `count:4,type:off,outcome:sent`. T027's power, connection and restart checks pass against the unchanged five-action package, using the existing automated package receipts above. The historical two-action manifest was not restored.

T027 is complete. Initial attention/custom-overlay acceptance and visible latency remain unobserved under T052/T060 and their follow-ups. T069/T076 still require the other host scenarios; overall progress is **66/80**. No physical lamp state is verified.

### Values and baseline catalog acceptance in progress

The user added Color, Brightness and Preset to the second row of **MeRGBW Acceptance**. Initial labels were **00FF00**, **50%** and **Ночь**. Before the controlled value pass, the existing normal/baseline simulator emitted an additional trial entry `count:5,type:color,parameter:00FF00,outcome:sent`; this is recorded separately from the requested FF5000 activation.

In the actual inspector, RGB was changed to **FF5000** and saved; the key label became **FF5000**. Brightness's numeric field was changed from 50 to **0**, its slider moved to the lower end, and Save changed the key label to **0%**. The baseline Preset selector showed **Ночь**, then **Закат** after selecting the next entry; Save changed the key label to **Закат**. The shared connection was retained. No additional command-counter entries appeared during these edits and saves: the count remained **5**.

The user pressed/released Color, Brightness and Preset once each and reported green checkmarks on all three. The simulator emitted exactly `count:6,type:color,parameter:FF5000,outcome:sent`, `count:7,type:brightness,parameter:0,outcome:sent`, and `count:8,type:preset,parameter:sunset,outcome:sent`. These confirm the intended normalized values and stable baseline preset id.

Brightness was then changed from 0 to **100** in its numeric field. The slider moved to the upper end, and Save changed the key label to **100%**. No additional command entry appeared before stopping that baseline fixture; its final count was **8**.

The fixture was restarted normally with `--catalog renamed`, resetting its counter to **0**. Opening Preset and clicking **Refresh presets** showed **Available** with **Вечер** still selected; its key label also became **Вечер**. No alternative preset was selected, and no connection was imported again. No command-counter entry appeared during opening, saving the unchanged selection or Refresh. The user then pressed/released Brightness and Preset once each and confirmed green checkmarks on both. The renamed fixture emitted exactly `count:1,type:brightness,parameter:100,outcome:sent` and `count:2,type:preset,parameter:sunset,outcome:sent`. Both brightness boundaries and the stable preset id through rename pass; the renamed run ended at **2** commands.

The actual **Select Color** dialog was opened from the inspector's color well. Entering **#336699** in its HTML field and confirming updated the RGB draft to **336699**. The RGB field was then restored to **FF5000** and saved; the assignment remained FF5000. This observes picker-to-RGB synchronization without sending a lighting command.

The fixture was restarted with `--catalog deleted`, resetting its command counter to **0**. Opening Preset and explicitly clicking **Refresh presets** left the key labelled **sunset**, with **Preset unavailable. Refresh the list and select another preset** in the selector/status. The assignment was not silently replaced by night. No command entry appeared during picker editing, restore/save, opening Preset or Refresh. The user pressed/released this unavailable preset once and confirmed warning feedback instead of a green checkmark. The inspector displayed **Command rejected. Preset unavailable. Refresh the list and select another preset.** The fixture emitted no command entry, ending at **0**.

The fixture was restarted with `--catalog duplicate-labels`, again starting at **0**. Explicit Refresh showed **Available** and **Одинаковый (sunset)**. The first Preset assignment was changed via the actual selector to **Одинаковый (night)** and saved. Its copy independently retained **Одинаковый (sunset)**, including after its own explicit Refresh. No command entry appeared during selection, saving or Refresh. The user pressed/released night then sunset once each and confirmed green checkmarks on both. The fixture emitted exactly `count:1,type:preset,parameter:night,outcome:sent` and `count:2,type:preset,parameter:sunset,outcome:sent`, ending this run at **2**. Long duplicate names are readable with ids in the inspector but visibly clipped on the default key titles; custom appearance acceptance remains separate.

The next fixture started with `--catalog empty` and counter **0**. Explicit Refresh of the sunset assignment preserved the night/sunset key ids, displayed the unavailable-preset guidance, and disabled assignment Save. No command-counter entry appeared through Refresh. The user pressed both unavailable preset keys once and confirmed warning feedback on both. No command entry appeared; the empty run ended at **0**.

The fixture was restored to `--catalog baseline`, starting again at **0**. Explicit Refresh restored **Available**, enabled Save, retained selected **Закат** (`sunset`) and restored **Ночь** on the independent night key. No token import, preset reselection or package installation was needed. The user pressed/released Закат once and confirmed green feedback; the fixture emitted exactly `count:1,type:preset,parameter:sunset,outcome:sent`. T037 is complete with the actual host evidence here and existing automated US2/package receipts. Combined host follow-ups remain open for lifecycle/appearance/failure acceptance; progress is **67/80**.

### Ten-assignment preparation

Host Cmd+C/Cmd+V into empty slots created a second instance of each action, without editing profile files. The profile visibly has ten keys: row 1 On/Off/On/Off; row 2 FF5000/100%/night/sunset/100%; row 3 a Color copy. Changing the first Preset to night did not change the copied sunset assignment. The third-row Color copy was changed and saved to **336699**; reopening the original Color showed **FF5000**, and both distinct key labels remained visible. This verifies Color and Preset copy independence. Custom appearance, profile export/import and three restarts with all ten assignments are still pending under T044.

The third-row Color copy received the native host title **Копия** and the blue rocket icon from the installed Elgato Legacy Icons library. Both appeared on the key and inspector preview; the original Color retained its wheel and FF5000 title. No fixture command appeared during these appearance edits; its count stayed **1**.

The first ten-assignment restart attempt quit the host with Cmd+Q and confirmed its absence from the running-app inventory. Reopening selected the user's existing default **TTRPG** profile. Preferences still listed **MeRGBW Acceptance**, but its profile-selector popup was absent from the accessibility tree and window screenshot; keyboard selection did not visibly change the profile. The ten keys have therefore not yet been verified after this restart, and it does not count as a completed retention pass. No default-profile setting or unrelated assignment was changed. Returning to MeRGBW Acceptance is the next manual UI prerequisite; the remaining two restarts, custom-key activation, export/import and shared-connection change remain pending.

The user then selected **MeRGBW Acceptance**, pressed/released the rocket **Копия** once, and confirmed green feedback followed by the retained rocket and title. The fixture emitted exactly one additional entry, `count:2,type:color,parameter:336699,outcome:sent`. Host inspection showed all ten assignments retained after the first restart: four power keys, FF5000, two 100% brightness keys, night/sunset and the custom Color copy. Preset titles displayed the retained ids before a new catalog Refresh. This completes the first retention pass and confirms custom appearance after success feedback. The second and third restart passes, export/import with clean global storage and the shared-connection change remain pending; T044 stays open.

After requesting two additional restart/ten-key passes, the user confirmed the green feedback and retained rocket. The fixture recorded **one** ten-command sequence, counts **3–12**: on, off, on, off, color FF5000, brightness 100, preset night, preset sunset, brightness 100, color 336699, all `outcome:sent`. This verifies one complete activation pass with exact retained values and no additional command in the observed sequence. Clarification is pending on whether the user performed one or two additional full restarts; a second ten-command pass is not present, so all three restart passes are not yet claimed.

The writer-derived **Installed plugin safe-log audit** passed against six actual installed log files: synthetic token absent, full synthetic link absent, no HTTP URL, six `plugin.ready` markers and zero `plugin.start.failed` markers. Startup markers are not substituted for observed restart/assignment retention. The native UI connection now fails with **Sky Computer Use native pipe startup failed**, including after a runtime reset; no export/import action was attempted through the unavailable UI. Export/import, the shared connection change, initial attention overlay and the failure-mode matrix remain pending.

After the restart instructions were explained explicitly, the user confirmed **two rounds completed**. The fixture emitted the second ten-command sequence, counts **13–22**, with the same exact order and values as counts 3–12: on, off, on, off, color FF5000, brightness 100, preset night, preset sunset, brightness 100, color 336699, all `outcome:sent`. Together with the first agent-operated quit/reopen and custom-key activation, this passes three restart rounds: the later two full quit/reopen operations are user-reported, with command values corroborated by the fixture. The preceding user confirmation covers green feedback and rocket retention; no missing-feedback exception was reported. No extra/replayed command appears in either ten-command sequence. T044 remains open for actual profile export/import with clean global storage and the shared-connection change. The native UI connection still fails at startup, so exporting the isolated test profile requires a manual UI handoff.

### Actual host profile export

The user exported **MeRGBW Acceptance** through the host to the Desktop. The writer-derived **Actual host profile export audit** passed against the actual 7,248-byte `.streamDeckProfile` ZIP from host **7.6.0.23012**, SHA-256 `e42ec222268737bfe93a436039266d06ffeae6b350c693e27fa8ed2f8b5b03fe`. It contains exactly two assignments of each of the five MeRGBW actions. Assignment settings contain only the allowed schema/value fields: colors **336699/FF5000**, brightness **100/100**, preset ids **night/sunset**, and empty settings for On/Off. No synthetic token or HTTP URL occurs in any unpacked entry.

The custom Color state retains title **Копия** and an embedded PNG. Visual inspection of that actual exported PNG confirmed the blue rocket. This closes the export-content portion of T044, without claiming import into clean global storage or changing the shared connection. Those checks and T044 remain pending; progress stays **67/80**.

The user confirmed importing the exported profile and checking the ten keys/custom rocket. The normal fixture produced no additional command entry during import: its counter stayed **22**. This is an import into the existing host with retained global connection, not the required clean-global-storage case. Native UI inspection still fails at startup, so the imported layout is user-reported; imported command values remain to be exercised. A second normal/baseline fixture using the existing `createMockBridge` handler was prepared on IPv4 loopback **18767** to test one shared connection change while retaining the original 18766 counter. Its listener launch requires the environment's network permission; no connection change or second-fixture command is claimed yet.

The environment approved the second fixture's listener, and it started successfully on **127.0.0.1:18767** with baseline catalog, normal mode and zero commands. The original fixture remains on 18766 at count 22. The next requested user action is a single connection-port Save in the imported profile, explicit preset Refresh, then one activation of each of its ten keys.

The user confirmed that all ten imported keys showed green feedback after changing the connection port once to **18767** and refreshing presets. The new fixture emitted exactly counts **1–10**: on, off, on, off, color FF5000, brightness 100, preset night, preset sunset, brightness 100, color 336699, all sent. The original 18766 fixture emitted no further entry and stayed at **22**. Port Save and preset Refresh produced no additional lighting command. This passes imported assignment values and shared-connection propagation to all ten contexts, with no per-key connection re-entry. T044 now lacks only the clean-global-storage import case; availability of a second clean host was requested, without clearing the current host's settings.

For T052, the 18767 fixture was then stopped normally with Ctrl+C, ending at **10** commands. The plugin's saved port remains 18767, so the next explicit activation can exercise service-unavailable feedback. No outcome for that activation is claimed yet.

### T052 service-unavailable feedback and recovery preparation

With the 18767 fixture stopped, the user activated **Копия** once and reported warning/error feedback followed by the restored rocket. The user then supplied the inspector's retained explanation: **Command rejected. Service unavailable. Start sunset and check the port.** This passes the unavailable-service warning, custom-image restoration after failure and actionable last explanation. It does not observe the initial processing overlay or any physical lamp state.

The normal/baseline fixture was restarted on **127.0.0.1:18767**, with the saved host connection unchanged. It emitted no command entry during startup and the subsequent five-second observation, so its new counter remains **0**: no automatic replay was observed before the next requested activation. The original 18766 fixture was stopped at its final count **22**. The writer-derived **Installed plugin logs after unavailable-service activation** audit passed on seven actual log files: no synthetic token, full synthetic link or HTTP URL; seven plugin-ready markers and zero plugin-start-failed markers. Normal manual recovery awaits one new activation, and the other T052 modes remain pending.

The user then deliberately activated **Копия** once and confirmed green success feedback followed by the restored rocket. The recovery fixture emitted exactly `count:1,type:color,parameter:336699,outcome:sent`. There was no reinstallation, token reimport or connection edit between failure and success. This passes manual recovery from stopped service without replay; the normal run ended at **1** when stopped for the next mode.

The fixture next started with **auth-denied** on the unchanged saved port **18767**, baseline catalog and a fresh counter **0**. It deliberately returns access denied using the existing synthetic token; no token replacement is requested. The next requested user checks are read-only Check connection, then one physical custom-key activation and its retained explanation. Results remain pending.

The user performed Check connection and activated **Копия** once, reporting the check guidance **Access denied. Replace the shared token and check again.** and the retained command explanation **Command rejected. Access denied. Replace the shared token and check again.** The auth-denied fixture emitted exactly `count:1,type:color,parameter:336699,outcome:rejected`, with no further entry through the subsequent five-second observation. Thus Check did not add a lighting command and the command was rejected without automatic retry. This records access failure, without interpreting it as lamp power/state. No token or connection was changed. The auth run ended at **1** before the fixture was stopped.

The fixture then started with **backend-error** on unchanged port 18767, baseline catalog and fresh command counter **0**. One explicit custom-key activation and its unknown/backend explanation are the next requested observations; no outcome is claimed yet.

In backend-error mode, the user activated **Копия** once and supplied the retained command explanation: **Outcome unknown. The command may execute later. Check the lamp before one conscious new press. Controller or Bluetooth failed. Check sunset and the lamp before pressing again.** The earlier Check connection message still said access denied; no new connection check was requested, so that upper text is the retained result of the preceding auth check, not evidence of a new authorization failure. The backend fixture emitted exactly `count:1,type:color,parameter:336699,outcome:unknown`, with no additional entry through the five-second observation before stopping. This passes visible backend/unknown/possible-late-effect guidance without claiming success or lamp state. The run ended at **1**.

The fixture next started in **malformed** mode on unchanged port 18767, baseline catalog and fresh counter **0**. It returns HTTP 200 with an incompatible response schema. One deliberate activation, its visible warning/success feedback and retained explanation are the next requested observations; no outcome is claimed yet.

In malformed mode, the user confirmed a warning on activation and supplied the retained command explanation: **Outcome unknown. The command may execute later. Check the lamp before one conscious new press. Incompatible response. Update the controller and check again.** The upper access-denied text remains the prior Check result; no fresh Check was requested. The fixture emitted exactly `count:1,type:color,parameter:336699,outcome:unknown`, with no additional entry through the five-second observation before stopping at **1**. This passes warning instead of success for HTTP 200 with the wrong schema and actionable incompatible-response guidance. No lamp state is verified.

The fixture then started in **echo-secret** mode on unchanged port 18767, baseline catalog and fresh counter **0**. Its synthetic error response includes the public fixture token and full fixture URL. One deliberate custom-key activation, safe inspector explanation and installed-log audit are next; no redaction outcome for this mode is claimed yet.

In echo-secret mode, the user supplied the retained explanation: **Outcome unknown. The command may execute later. Check the lamp before one conscious new press. Controller or Bluetooth failed. Check sunset and the lamp before pressing again.** Neither public synthetic token nor URL appears in that reported text. The fixture emitted exactly `count:1,type:color,parameter:336699,outcome:unknown`, with no further entry through the five-second observation. The writer-derived **Installed plugin logs after echo-secret host activation** audit passed on seven actual installed logs: synthetic token, full synthetic link and any HTTP URL absent; zero plugin-start-failed events. The mode ended at **1**. This passes actual host error/log redaction for the echoed synthetic secret; no real credential was used.

The fixture next started in **timeout** mode on unchanged port 18767, baseline catalog and fresh counter **0**. It delays command responses for 46 seconds to exceed the plugin's 45-second observation window. Two immediate physical presses of the same custom key, initial attention/Executing feedback and the final timeout explanation are the next requested observations. No measured timing or busy-guard result is claimed yet.

During the requested double-press pass, the user first supplied **Executing. A repeated press is ignored.**, then the terminal explanation **Outcome unknown. The command may execute later. Check the lamp before one conscious new press. Observation timed out. A late effect is possible. Check the lamp before pressing again.** The fixture emitted exactly `count:1,type:color,parameter:336699,outcome:unknown` and no second entry through the subsequent observations. This passes busy suppression, visible in-progress text and unknown/late-effect timeout guidance for the actual host. No physical effect was tested and no visible latency or exact wall-clock duration was measured. Whether the user saw the initial icon overlay was asked separately and remains pending.

The timeout fixture remains running at count **1**. The next requested scenario is one new deliberate custom-key activation, switching to another profile while it is pending, then returning after the timeout to check that no old success is shown on another assignment and the custom appearance is retained. This profile-change scenario is not yet claimed as passed.

For the requested pending/profile-switch pass, the user reported that the rocket remained and a warning appeared then disappeared. The fixture emitted exactly one additional `count:2,type:color,parameter:336699,outcome:unknown`, and no further entry through the subsequent five-second observation before stopping at **2**. This exercises a profile switch during the pending request and confirms retained custom appearance on return with warning feedback; the user did not report a green success. Initial-overlay timing remains unconfirmed: whether that warning appeared immediately after pressing or only after waiting was asked separately. The earlier explicit Executing and terminal timeout texts remain the observed processing/outcome evidence. No visible latency is measured.

The fixture next started in **legacy** mode on saved port 18767 with a fresh counter **0**. Its health endpoint remains available, preset catalog returns the unsupported/upgrade response, and ordinary On/Off/Color/Brightness POSTs remain accepted. The next requested observations are explicit preset Refresh, one activation of each ordinary kind and one blocked preset activation, including the host's upgrade guidance. No legacy host result is claimed yet.

The user reported green feedback everywhere and that Refresh was unavailable to click. The actual legacy fixture emitted **seven** commands: count 1 On, 2 Off, 3 Color FF5000, 4 Brightness 100, 5 Preset night, 6 Preset sunset, 7 Brightness 100, all sent. The previously requested blocked-preset expectation was incorrect: existing saved ids intentionally remain usable when the catalog is unavailable (`presetAvailable`, and the existing test **known missing and unset ids block commands; unavailable catalogs permit an explicit saved id**). FR-009 requires upgrade guidance for an unsupported catalog while compatible actions remain usable; it does not require rejecting a saved preset solely because catalog loading is unsupported. No application change is justified by the green preset feedback.

The unavailable Refresh report remains an unresolved host observation. The current inspector code does not disable Refresh; it disables preset selection and assignment Save when no usable catalog is available. Without a current native UI capture, the exact affected control cannot be established and is not dismissed as user error. The fixture remains in legacy mode at count **7**. A fresh explicit **Check connection** can exercise the unsupported-catalog guidance independently of the reported Refresh difficulty; its outcome is the next requested observation. Initial-overlay timing confirmation and invalid-input/final-normal checks remain pending.

The user explicitly ran Check connection on On and reported **Service Available**, **Authorization Unknown**, **Bluetooth Disconnected**, and **Preset catalog unsupported. Update sunset. Other commands remain available.** The legacy fixture emitted no additional command, staying at **7**, before it was stopped. This passes the actual unsupported-catalog/upgrade guidance and independent service/auth/Bluetooth status display, while the seven earlier compatible commands remain usable. Unknown authorization is recorded as shown, not promoted to verified. The earlier unavailable-Refresh observation is retained separately.

The fixture was restored to normal/baseline on saved port **18767** with fresh counter **0**. No connection import, token replacement, plugin installation or source change was made. Final normal recovery and invalid-input host checks remain pending. The timing of the previously reported warning overlay is still unconfirmed; visible timing measurements remain separate prerequisites.

When asked directly whether the initial overlay appeared immediately or only after the timeout, the user answered **did not notice**. Initial attention is therefore unverified, not a pass or a confirmed failure. Polling the normal recovery-preparation fixture before stopping revealed an additional `count:1,type:color,parameter:336699,outcome:sent`; it ended at **1**, not zero. This activation was outside the requested legacy Check-only sequence, and its physical feedback was not reported, so it is recorded separately without inferring automatic replay or closing the final manual recovery case. A fresh timeout-mode fixture was started on saved port **18767**, counter **0**, solely for a focused observation of the custom key in the first seconds of one new deliberate press. The user is not asked to infer visibility from code or from the later timeout warning. Final recovery and invalid-input checks remain pending.

For the focused initial-attention pass, the user explicitly reported **warning icon immediately, then rocket** after one deliberate activation while watching the physical key. The fixture emitted exactly `count:1,type:color,parameter:336699,outcome:unknown`. This confirms immediate visible attention and custom-icon restoration; the earlier explicit **Executing** text provides the processing explanation. No numeric visible latency is inferred from the user's wording. This focused run was stopped at **1** after the observation, without using it as another terminal-timeout measurement. Normal/baseline was restarted on unchanged port **18767**, with fresh counter **0**. Invalid-input host checks and a final deliberate normal activation remain pending.

The user confirmed that all four requested invalid imports were rejected and port **18767** was retained: remote host `example.invalid`, encoded action `%6Fn`, query `?test=1`, and disallowed port **1**, each using only the public synthetic token. The normal fixture emitted no command during those imports and the subsequent five-second observation, remaining at **0**. This is actual host rejection/retention evidence plus the existing automated parser/no-dispatch coverage; no separate outbound packet capture was performed. The writer-derived **Installed plugin logs after host invalid-link checks** audit passed on nine actual installed log files: synthetic token, full synthetic link and any HTTP URL absent; zero plugin-start-failed markers.

The final requested recovery sequence is to save the unchanged valid port/retained token, explicitly Check connection, and deliberately activate **Копия** once. This clears the retained rejected-import error through a successful connection Save, rather than treating unrelated publications as a successful save. Normal success feedback and one exact command are not claimed until observed.

### T052 completion

The user completed the final recovery sequence and confirmed green success feedback. Check displayed **Service Available**, **Authorization Verified**, **Bluetooth Disconnected**, followed by **Command sent. Lamp state is unverified.** The normal fixture emitted exactly `count:1,type:color,parameter:336699,outcome:sent`. It had remained at **0** throughout the four invalid imports and before this deliberate press, so no automatic replay was observed in this final run. There was no reinstall, token reimport or per-assignment connection change. The final writer-derived **Installed plugin logs after final host recovery** audit passed on nine actual installed log files, with no synthetic token, full synthetic link or HTTP URL and zero plugin-start-failed markers.

T052 is complete using the actual mode/counter/feedback evidence above and the unchanged package's existing automated US4/83-test receipts. The earlier Refresh-control report remains an unresolved UI observation, rather than a confirmed implementation failure; legacy catalog guidance was separately observed through Check, and actual Refresh/catalog variants passed under T037. Numeric visible timing and physical lamp state are not claimed. Progress is **68/80**. T044 remains pending only for clean-global-storage import; combined host follow-ups remain open for that prerequisite.

The writer-derived **Actual installed diagnostic fields audit** also passed across **172** actual events. All five action kinds and auth/backend/preset/protocol/service/timeout categories were present; **66** events contained valid finite nonnegative durations and **91** contained allowlisted numeric request IDs. Every parsed diagnostic used only the documented fields and allowed values. These are backend diagnostic observations, not measurements of visible key latency. The current requirement/evidence mapping above now reflects completed host checks and the remaining external prerequisites.

### Owner acceptance change: clean-global manual import excluded

The owner explicitly said to omit the other-installation test because the plugin is for personal use. This changes required manual acceptance for T044 and its dependent host follow-ups T069/T076. Clean-global manual import is **excluded by owner decision**, not passed, and no current host settings were reset. The functional no-connection/secret-isolation contract remains intact; the existing `assignment-lifecycle.test.ts` scenario **ten imported assignments survive three restarts and use only installation globals** covers the automated boundary.

All other T044 observations are complete above: ten assignments of five kinds, independent Color/Preset copies, custom title/rocket through processing/success/failure, profile switching and three restart rounds, actual secret-free export and existing-host import, and one shared port change with ten exact new-port commands. T044 is closed under that revised scope, using the unchanged package's existing automated receipts. The historical task wording is interpreted with this explicit acceptance override in spec.md and plan.md; its clean-global phrase is not evidence of an executed manual test. Participant/100-visible-sample measurements and LT-06 physical effects are not excluded by this decision.

T069's combined host review now reconciles the completed original T027/T037/T044/T052 observations: normal installed package and five actions, user-added assignments/copies, zero-command import/Check/Refresh, exact commands on activation, picker/brightness/catalog variants, ten independent assignments through profiles/restarts, custom appearance, actual secret-free export/import and logs, and failure/busy/unknown/manual recovery. The current installed package includes T068 and the later inspector corrections. Clean-global manual import is excluded by the owner's explicit acceptance update; measured participant/visible timing and real lamp effects remain separate tasks. T069 is closed on this actual evidence, not on the earlier unavailable-host attempts.

T076's later-build host review uses the same actual observations collected against the normally installed five-action **0.1.0.0** package containing T074/T075/T077. The 28-file installed/archive identity and 83-test package receipts establish that build; no runtime source or installed package changed during the host rounds. The final independent Check, one-command normal recovery, actual profile ZIP and nine-file safe-log/172-event field audits complete this host follow-up after the inspector corrections. T076 is closed under the same explicit clean-global-manual-import exclusion. The old unavailable-host reports above are historical; participant/visible timing and physical acceptance remain pending rather than being folded into this host result.

### Owner acceptance change: group and manual-timing studies excluded

After being asked specifically about the five-participant and 100-manual-visible-timing studies, while retaining automated tests and real-lamp verification, the owner explicitly replied **yes, remove those; unnecessary**. SC-001/002/005, plan.md and quickstart.md now reflect that personal-use scope. This overrides the historical measurement conditions in T060/T071/T078. No participant sessions, stopwatch values, percentile samples or numerical visible-latency results were collected or invented.

T060 is closed under the revised scope: actual owner setup/power/value checks passed in T027/T037, and initial/custom/processing/result feedback passed in T052. Automated 100-command/no-replay and controlled-deadline checks remain required and covered by the unchanged package's existing 83-test receipts. The removed studies are recorded as excluded, not passed measurements. T061/T072/T079 physical observations and their dependent final reconciliation are not excluded.

T071's follow-up review reuses completed T069 and the same owner/automatic evidence after T060's explicit scope revision. Its five-participant and 100-visible-sample collection is excluded, rather than reported as collected; the original SC-003/004/006/007 observations and runtime deadlines remain in force. T071 is closed under the owner's revised acceptance criteria.

T078's later-build measurement follow-up reuses completed T076 and the same revised T060/T071 scope. The installed package's functional checks, actual owner feedback observations and existing automatic deadline/100-command receipts remain valid; no later-build participant study or manual timing sample is claimed. T078 is closed under the explicit exclusion. The remaining open tasks are T061/T072/T079 (real LT-06 observations) and T062/T073/T080 (their dependent final requirement/evidence reconciliation).

On 2026-10-22 the owner reported manually changing the plugin port to **18765** because import had not replaced it, with Bluetooth Disconnected and the previous sent message still displayed. Fresh real health remains connected and the writer-derived **Real controller after manual port report: no lighting commands and preserved config** audit passed with zero commands. Inspector source confirms that Check reads saved settings, not the port draft; the preceding handoff had omitted an explicit connection Save after a manual edit. The next check therefore saves, reopens the inspector and repeats Check. Import behavior remains an unresolved user report. Physical tasks remain pending and progress stays **74/80**.

After that Save handoff the owner reported access denied and a rejected-command explanation. The writer-derived **Real controller after denied authorization: zero lighting commands and preserved config** audit passed; actual health still reports Bluetooth connected. A blank replacement token preserves the previous shared token by design, so the next handoff explicitly replaces the plugin token using the existing private local settings, then saves and checks. No lighting execution, lamp effect, successful real authorization or resolution of the import report is claimed. Progress remains **74/80**.

The owner subsequently reported **Service Available**, **Authorization Verified**, **Bluetooth Connected**, **Ready to send a command** after the shared-token replacement handoff. The derived zero-command expectation failed because real command receipts are now present; that failed receipt is retained. The subsequent **Real controller command audit after verified plugin connection** captures actual events. At inspection there were eight POST commands: On, Off, color FF5000, brightness 100, preset night, color 336699, On, Off, each with command.sent and HTTP 200, plus a completed preset-catalog read and unchanged configuration hashes. The user's status report does not identify the activation sequence or physical effects, so neither automatic replay nor physical success is inferred. The next handoff requests deliberate Off/On activation and direct lamp observation. Progress remains **74/80**.

The owner replied **все ок** to the explicit Off/On lamp-observation sequence. Physical lamp-off and lamp-on effects are therefore owner-confirmed in hardware-verification.md, separately from runtime state readback. The derived **Real controller command audit after owner physical Off On confirmation** passed with 12 cumulative commands and preserved configuration; the four additional commands are On/Off POSTs with successful sent/HTTP 200 receipts. No exact press-count claim is made. RGB FF5000, brightness 25/75, sunset and existing Website controls still need physical observations; T061/T072/T079 and final reconciliation remain pending, **74/80**. Runtime `physical_state_verified:false` remains correct.

The owner confirmed the requested physical Color FF5000 effect: the lamp became orange. The derived **Real controller command audit after owner physical FF5000 confirmation** passed with a corresponding color receipt, 16 cumulative commands and preserved configuration. Other new commands (forest, alarm, brightness 15) have no owner-reported effects and do not substitute for brightness 25/75 or sunset. Physical On/Off/RGB are now owner-confirmed; remaining physical observations and final reconciliation stay pending, **74/80**.

The owner replied **да** to the requested 25/75 dim-to-brighter sequence. However, **Real controller command audit after owner brightness 25 75 confirmation** records 55 cumulative commands with brightness routes 15, 50 and 100, and no 25 or 75. The audit itself passed and configuration hashes are unchanged; it does not establish the requested brightness cases. The initial conversational acknowledgment was premature. The owner reports a qualitative brightness change, but exact 25/75 effects remain pending until the saved assignment and dispatched value agree. The next handoff checks that 25 persists after leaving and reopening the assignment, then requests one deliberate activation. No source defect or cause is inferred yet.

The owner answered **25** to the saved-value check. The derived **Real controller command audit after saved brightness 25 report** passed: 57 cumulative commands, with new Off (request 77) followed by brightness 25 (request 78), both sent and HTTP 200; configuration hashes are unchanged. This resolves dispatch of the exact 25 value, but the brief answer does not separately confirm the physical effect. Await whether the lamp turned on dimly; brightness 75, sunset and old Website observations remain pending.

The owner separately confirmed that the lamp turned on dimly after brightness 25. That physical observation is now complete with the prior exact-route request 78 receipt. Brightness 75, sunset and existing Website observations remain pending; physical acceptance tasks and final reconciliation remain open, **74/80**.

The owner confirmed that brightness 75 made the lamp noticeably brighter. **Real controller command audit after owner physical brightness 75 confirmation** passed: exact brightness 75 request 79, two packets sent, HTTP 200, 58 cumulative commands, unchanged configuration. Required 25/75 dispatch and human effects now agree, resolving the earlier mismatch. Sunset and existing Website controls remain pending; progress stays **74/80**, with machine `physical_state_verified:false`.

The owner confirmed the requested sunset physical effect after Off: orange light, dimmer than at 75%. The configured preset is FF5000/60. **Real controller command audit after owner physical sunset confirmation** passed with successful preset/sunset receipts (requests 82/84/86/88), 66 cumulative commands and preserved configuration; exact activation count is not inferred from the brief answer. Existing Website controls remain the final physical case. Progress remains **74/80**.

## Final reconciliation T062, 2026-10-22

Reviewed all 17 functional requirements and eight success criteria against the current spec, plan, quickstart, paired README instructions and physical record. Implementation preserves the sole serialized Go controller, loopback request guards, cooperative native cancellation and unverified-state contract. T056/T058/T059, revised T060 and completed physical T061 satisfy the original reconciliation prerequisites. T062 is complete within the explicit owner scope. The real setup import-port report and earlier legacy Refresh-control report remain unreproduced observations; successful manual connection Save, completed host catalog cases and final focused import/settings tests are recorded without claiming those reports were reproduced or fixed.

### T073 follow-up reconciliation

Completed T068–T072 and their original host/physical prerequisites are reflected in the matrix. T068 inspector draft reconciliation has focused regressions and actual saved-value observations; T069 host acceptance is complete within owner scope; T070 records actual Linux equivalent passes; T071 follows the explicit measurement exclusion; T072 records completed physical observations. T062 is closed on actual evidence. Earlier unavailable-host, Linux-pending and missing-study checkpoints are historical, with later execution or explicit owner exclusions recorded. The paired README descriptions and retained runtime contracts agree. T073 is complete; no required acceptance observation remains pending.

### T080 final-build reconciliation

T074–T079 and their original prerequisites are complete. The final matrix covers the inspector queue/save fixes T074/T075, completed later-build host T076, read-only timeout guidance T077, owner-revised measurement acceptance T078 and completed later-build physical acceptance T079. The current macOS 83-test package/Go/workflow receipts, actual installed/archive identity, owner lamp observations, final focused import/settings regressions and actual-token log audit provide the evidence. Linux Go/full Node equivalent execution passed before the last inspector changes; this is not presented as a later Linux pass or a remote CI result. No required observation remains pending under the explicit owner scope. Unreproduced import-port and legacy Refresh-control reports remain documented, with no claimed fix; manual connection Save works and the saved-value mismatch is resolved. T080 is complete.
