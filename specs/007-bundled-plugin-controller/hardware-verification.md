# Bundled-controller hardware acceptance

Status: **Accepted for home use** on the owner's current Apple Silicon Mac/LT-06. Local installation, corrected helper TCC attribution, BLE operation, baseline controls, dial Off/reactivation/numeric display and transition cancellation/interruption/quit-relaunch were observed. The owner explicitly stopped additional manual qualification; unperformed scenarios are [deferred, not passed](deferred-validation.md). Historical pending statements below describe earlier checkpoints and are superseded by the final home acceptance sections.

**Acceptance ownership, 2026-10-23**: The user will perform manual tests on their current Apple Silicon Mac with LT-06, preserving their working data. A separate macOS user is optional by explicit user decision. Intel equipment is unavailable; Intel execution remains unverified and is not a required gate for personal development on the current Mac. The user chose to implement smooth transitions in this feature, so the corresponding observation remains required after implementation.

Before the owner-directed local installation, the Mac was used for compilation/inspection only. The subsequent local install/import, initial failed startup and corrected launch are recorded below; no physical command was issued by the agent. User scope update, 2026-10-24: T072 inspects a local fixture/development installer; T073 verifies local installation/link and retention. Developer ID, notarization, downloading and quarantine testing are not required. Current-Mac checks T078/T085/T093 can use the integrated owner-linked fixture after their declared setup/recovery/software prerequisites, without waiting for T072/T073 or claiming distribution or Intel acceptance.

| Evidence area | Apple Silicon | Intel Mac |
| --- | --- | --- |
| Local development installation/link and offline first use | Local link/import, corrected TCC attribution, normal quit/relaunch and BLE connection accepted for home use; extra qualification deferred | Not observed |
| No-Terminal setup/import and actual responsible Bluetooth application | Import and helper TCC attribution observed; extra clean/manual-first-run qualification deferred | Not observed |
| Additional permission/EN-RU picker/panel-recovery qualification | Deferred for home use | Not observed; outside home scope |
| One worker and data retention | One owned runtime and repeated backed-up update preservation observed; extended retention protocol deferred | Not observed |
| Host lifetime | Active-transition quit/relaunch and native ownership release observed; extra fault/sleep rounds deferred | Not observed |

| LT-06 command or effect | Actual observation |
| --- | --- |
| On and Off | Observed: owner confirms Off darkened the lamp, then On lit it; corrected fixture shows no false error symbol |
| RGB FF5000 | Observed: owner confirms orange color without error on the existing orange Color key (empty assignment uses FF5000 default) |
| Brightness 25 and 75 | Observed: owner confirms 25 is visibly dimmer and 75 brighter, without error; persisted 25 and 75 assignments checked |
| One explicitly selected preset | Observed: forest selected, owner confirms green light without error; imported target RGB [20,180,60], brightness 40 |
| Setup/check/restart control-write boundary | Software zero-command fixtures and no replay action events after actual relaunch; raw native packet capture deferred |
| Stop adds no Off and restart does not replay/continue commands | Observed: explicit cancel and active-transition host quit preserve light; relaunch preserves intermediate state without continuation |
| Interrupted smooth transition | Partial: owner confirms saved FF5000/100 → FF5000/0 in 10 seconds visibly fades without error. Observed: button/dial interruption, direct panel cancel/no-Off, 1/60-second RGB transitions and host quit/relaunch without continuation. Home setup prerequisite reconciled; extended checks deferred. |
| Stream Deck+ clockwise/counter-clockwise/fast rotation, 0–100 limits and touch feedback | Observed for prior behavior: both directions, fast reversal without long tail, 0–100 limits, inert press/touch. New press-Off and boundary reactivation confirmed under T101; numeric display readability confirmed under T103 |
| Stream Deck+ profile/restart/error queue boundaries and Keypad | Software regressions pass; ordinary key effects observed; extra manual failure/profile stress deferred |

Follow the owner-run current-Mac steps in [quickstart.md](quickstart.md). Record OS, Stream Deck version, source/build mode, actual executable architecture, local install/link and TCC attribution, command and user-observed effect. Developer ID and downloaded/quarantine checks are outside required scope. Do not record real identifiers, tokens, full command URLs or credential comparisons. Connection/write/build success does not establish the physical effect or state readback.

T072 local artifact inspection passes for the refreshed arm64 fixture; it establishes no host or physical observation. Earlier aggregate gates have been reconciled under the owner home-use scope; their unperformed extended portions are deferred. Software results and exact runnable evidence are in [validation.md](validation.md).

Current software is ready for owner testing: use `/private/tmp/mergbw-feature007-numeric-dial-20261024/com.obalunenko.mergbw.sdPlugin` and sections 6–8 of quickstart.md for baseline lamp, dial and transition checks. Duration is integer 1–60 seconds. Physical Stream Deck+/fade effects and the Bluetooth dialog remain unconfirmed; the owner On observation is recorded below.

## Local-host observation, 2026-10-24

The owner-directed local link loads version 0.2.0.0 and registers six actions. Existing 17 assignment records and imported settings/token/presets remain equal to their pre-install/source values. Stream Deck file pickers and the Property Inspector import were exercised. The current-Mac worker aborted with missing Bluetooth usage-description diagnostics; macOS attributes responsibility to Stream Deck. A readable embedded worker plist did not change that outcome. No permission allow/deny/re-enable or lamp effect is inferred. LaunchServices/private-control correction T094/T095 subsequently passed software and installed-host retry: TCC names the helper, one owned worker serves compatible health, normal host quit releases processes/lock/port, and relaunch reports BLE connected. The dialog/toggle and private PI readiness label were not visually confirmed because UI automation failed. No physical lighting action was sent. Details and runnable checks are in validation.md.

### LaunchServices fixture used for first On

That linked fixture used buildMode spike, arm64, source-tree SHA256 `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647` and artifact-tree SHA256 `e9f7f2bcf1da291499926350fe16c1618fc35671de3d0a0b6214271d6945dfbf`. It preserves all 17 assignments and imported configuration. Its health reports BLE connected after normal host relaunch; physical_state_verified remains false. See validation.md for exact provenance and installed observations. Physical, dial and transition rows above remain pending until the owner observes their actual effects.

## Owner-observed acceptance session

The owner confirmed that the lamp is visible and authorized continuing physical tests. Automatic Stream Deck action discovery returned no executable actions twice; CUA still returned noWindowsAvailable for the editor. The agent therefore requested one physical On press on the existing MeRGBW Acceptance copy profile and awaits the observed result. Read-only health outside the sandbox responds with compatible bridge version and BLE disconnected at this checkpoint; the sandboxed curl attempt failed to connect. Safe plugin diagnostics contain zero action events before that requested press. No physical-effect row is closed from availability or health alone.

### First owner On and feedback defect

The owner reports «засветилась правда сразу был символ ошибки»: the lamp visibly lit, but the key immediately displayed an error symbol. Sanitized diagnostics contain two On and two Off commands, all `action.sent`, with no failed/unknown/rejected event; only the On physical effect is confirmed by this message. The first On took about 951 ms; the remaining logged commands completed in 1–4 ms. Code review traced the immediate icon to Feedback.pending calling showAlert before every request. It was a misleading busy indicator, not a reported command failure. T096 removes that overlay and retains inspector pending, duplicate suppression, true error alerts and validated-send success. This physical On observation belongs to the pre-feedback-fix linked fixture identified above. The owner retry after local update remains separate.

### Corrected feedback installed, owner retry pending

The new linked fixture is `/private/tmp/mergbw-feature007-feedback-20261024/com.obalunenko.mergbw.sdPlugin`, staged at ignored `dist/plugin-local-feedback/`. It has 39 files, spike/arm64, unchanged native source-tree SHA256 `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647`, artifact-tree SHA256 `03c0b9bddf48612e3c1e2cd954a452e1a775d7930cfd923fc982679f58014704`, revision `b57139f7c0f0e51c9b11a07999d55f266105df9e` and a dirty worktree. Public/native bytes, signatures, inventory and privacy resources pass inspection. The complete 206-case plugin software gate and 27 native-payload fixtures pass. A private backup preceded the local update. Real host startup has one supervisor/worker, helper TCC attribution and BLE connected; all 17 assignment records and configuration/source values remain preserved.

The owner was asked to press Off, wait for the lamp to go dark, then press On and report both physical effects and the absence/presence of the false error symbol. That retry has not yet been confirmed. No physical pass is inferred from the new software tests.

### Corrected Off/On owner confirmation

The owner answered «да» to the explicit post-update question whether Off darkened the lamp and On lit it again without the error symbol. Both physical effects and disappearance of the false overlay are confirmed for the corrected-feedback fixture. Sanitized diagnostics corroborate sent Off and On receipts (about 6.75 ms and 1.60 ms), plus a later sent Off; no failure/unknown/rejected event appears. The extra receipt alone adds no separate observation. T097 is complete. Machine physical_state_verified remains false; baseline T078 stays open for its remaining cases.

### Orange owner confirmation

The owner answered «да» to the explicit question whether the existing orange key made the lamp orange without an error. That physical color and no-error feedback are confirmed. The key had empty saved action settings when requested; the validated Color default is FF5000. Safe diagnostics include a successful color receipt. Numerous additional brightness receipts are also present, but no exact brightness or dial physical result is inferred from those events. Next requested case is saving 25 on the test profile's 15-percent key and observing 25 then 75. This deliberate test assignment edit is distinct from the earlier update-preservation check.

### Brightness 25/75 owner confirmation

The owner answered «да» to saving 25 on the former 15-percent test key, then pressing 25 followed by 75 and observing dimmer-to-brighter light without error. Local profile inspection confirms one saved percent=25 assignment alongside the existing percent=75 assignment. Diagnostics include sent brightness receipts; those generic receipts do not independently encode the target percentage. The owner's explicit sequence and persisted assignment values establish the requested qualitative comparison, not a calibrated brightness measurement. Additional dial/brightness activity in the log is not an owner-confirmed dial acceptance result.

Next requested case: add a Preset key, select forest, save and press it. The active imported forest preset has RGB [20,180,60] and brightness 40. Its physical green effect remains pending until confirmed by the owner.

### Forest owner confirmation

The owner answered «да» to adding/selecting/saving forest and observing green light without an error. Profile inspection confirms saved presetId=forest entries. The selected active imported forest target is RGB [20,180,60], brightness 40; the physical confirmation is green light, not calibrated RGB/brightness readback. This completes the separately observed preset case in the baseline matrix. T078 remains open for interruption/lifetime/no-replay and its declared host prerequisites.

The next requested test is a Transition key with FF5000/100 to FF5000/0 in 10 seconds, saved before a single activation. Completion, explicit cancel, button/dial interruption, duration bounds and host interruption remain separate observations.

### Ten-second transition owner confirmation

The owner answered «да» to a single saved FF5000/100-to-FF5000/0 transition in 10 seconds, observing initial bright orange and then gradual darkening without error. Profile inspection confirms all five saved values exactly. This records qualitative smoothness and nominal timing, not calibrated intensity, measured timing or physical readback. Duration 1/60, different-RGB endpoints, explicit cancel, button/dial interruption and shutdown/no-continuation cases remain pending. The next requested test interrupts the same fade after 2–3 seconds with the 75-percent key, then observes for another 10 seconds.

### Ordinary-button interruption confirmed

The owner answered «да» to starting the ten-second transition, pressing 75 after 2–3 seconds, and observing that the 75 target held for another ten seconds with no continued fade or error. This confirms ordinary-button interruption on the current corrected-feedback fixture. It does not establish dial interruption, explicit cancel, shutdown or restart behavior. Next request: open the Transition panel, start the same fade, cancel after 2–3 seconds and observe intermediate brightness with no Off or continued fade for another ten seconds.

### Explicit cancel required a status check

The owner reports that explicit cancellation worked only after first pressing **Check transition status**, correcting the earlier abbreviated label to this exact control. This is a conditional cancel observation, not a pass for immediate panel cancellation. Inspection found the validated admission response's transition ID was dropped before the inspector. T098 retains that safe snapshot in the operation record, fences stale IDs and exposes Cancel immediately. T099 installs and validates the owner retry without a preliminary check. No unconditional cancel/no-Off pass is inferred yet.

### Immediate-cancel fixture installed, retry pending

The active local fixture is `/private/tmp/mergbw-feature007-immediate-cancel-20261024/com.obalunenko.mergbw.sdPlugin`, linked through ignored `dist/plugin-local-immediate-cancel/`. It has 39 files, spike/arm64, source revision `b57139f7c0f0e51c9b11a07999d55f266105df9e` with a dirty worktree, native source-tree SHA256 `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647` and artifact-tree SHA256 `7fa0c55f9c0ece857fd713210578517a7ac1342025ebdb3f14b9976301b1f2ab`. Inspection and all 209 plugin software cases plus 27 native-payload fixtures pass. Native UI quit attempted a pipe startup and failed, but the pinned CLI stop/update completed safely.

A private backup preserved the current profile state before installation. All 20 current MeRGBW assignment records are equal to that pre-update backup, including the owner's deliberate 25-percent and newly added assignments. Imported/source settings, token and presets remain equal and storage modes remain private. Real startup confirms one owned worker, helper TCC attribution, compatible health and BLE connected.

The owner was asked to start the ten-second fade with its panel open, then cancel after 2–3 seconds **without Check transition status**, observing immediate button availability and intermediate light/no-Off for another ten seconds. That retry remains pending, so T099 stays open.

### Immediate cancel owner confirmation

The owner answered «да» to the explicit retry on the immediate-cancel fixture: panel open, start fade, cancel after 2–3 seconds without Check transition status, immediate button availability, and another ten seconds with intermediate light/no Off/no continued fade. This closes T099 and the explicit-cancel portion of T093. It does not close runtime shutdown/restart or other duration/RGB/dial cases. Next requested case interrupts the ten-second fade using a deliberate Brightness dial target change, followed by a ten-second hold.

### Dial interruption confirmed

The owner answered «да» to starting the ten-second fade, changing the Brightness dial target after 2–3 seconds, then observing another ten seconds with the new light held, no old fade and no error. This confirms physical dial interruption on the current immediate-cancel fixture. It does not establish all T085 direction/limit/fast-rotation/touch/profile/restart cases.

Next requested transition: FF0000/75 to 0000FF/25 over 60 seconds, saved and activated once. The owner is asked to wait for completion and observe red gradually becoming blue without error. Duration/RGB/end-state confirmation remains pending.

### Sixty-second RGB transition confirmed

The owner reports «все работает» in direct response to the specific FF0000/75-to-0000FF/25, 60-second test and request to wait for red gradually becoming blue without error. Local profile inspection confirms exactly those five saved values. This confirms that requested visual/timing case only, not every remaining feature acceptance scenario. Timing and endpoint observations are qualitative, with no calibrated RGB/intensity or device readback claim. The next requested test changes only duration to one second and observes red-to-blue settling without error.

### One-second RGB boundary confirmed

The owner answered «да» to the same red-to-blue endpoints at a saved one-second duration, quickly settling blue without error. Profile inspection confirms FF0000/75 to 0000FF/25 with durationSeconds=1. Both allowed duration bounds now have owner observations, with qualitative timing only.

Before the next host-exit test, read-only process inspection recorded one current supervisor and its worker; the first sandboxed ps call was denied, and the authorized derived check passed. The owner was asked to restore 60 seconds, start, quit the whole host after 2–3 seconds, wait ten seconds and leave it closed while intermediate light/no-Off and native cleanup are checked. That shutdown observation remains pending.

### Host quit during transition and relaunch

The owner first reported «остановился» after the requested active-fade host quit. The derived cleanup check then confirmed zero owned native processes, the reusable configured port and the available installation lock. Its 0.03-second observation duration is measured from the check, not from the owner's quit. The pinned CLI confirmed Stream Deck was stopped and started it again. Fresh startup confirms one supervisor/worker, helper TCC attribution, compatible health and BLE connected. No action events appear after the latest plugin.ready.

The owner explicitly followed up «свет сохранился без продолжения перехода» in response to the no-Off/no-resume question. This confirms intermediate light preservation across quit/relaunch and no resumed transition. It adds no calibrated final-state readback. The physical cases requested by T093 and the baseline effects/interrupted-transition portion of T078 are now recorded; their declared aggregate host/setup/recovery prerequisites remain open, so their checkboxes stay unchecked.

Next requested dial cases: both rotation directions, fast reversal without a delayed tail, 0–100 target limits, and no light effect from dial press/touch-strip contact. Profile/restart/failure recovery remain separate.

### Owner dial observations and revised press behavior

The owner reports «все так» to both rotation directions, fast reversal without a long tail, 0–100 target limits and inert press/touch. Those prior-behavior observations are confirmed. In the same message the owner requests that pressing the dial send Off, and reports a defect: after turning the light off at dial target 100, a clockwise turn does not turn it on; rotation below the ceiling does.

This changes the press contract rather than retroactively failing the earlier inert-press test. T100/T101 implement and validate press-Off plus clamped-boundary reapplication. The previous fast/direction/limit observations remain provenance-scoped; new press/up/touch, Off queue and 100-percent reactivation observations remain pending.

### Dial Off/boundary fixture installed, owner retry pending

T100 adds one explicit Off on dial-down, preserves its target and keeps release/touch inert. A positive tick at 100 (and symmetric outward tick at 0) reapplies the boundary even when the number is unchanged. One raw flight and one pending command are retained; Off replaces pending brightness, coalesces repeated presses and takes priority until settled. Failed/unknown/timeout/context changes discard pending work. An untracked pending operation rejects the new gesture rather than leaving false Sending feedback or replaying it later.

All 26 focused dial cases, independent types/lint, the complete **219/219** plugin cases and 27 native-payload fixtures pass. The actual held-brightness-reply/separate-Off-key/return-to-100 regression is covered. The new local fixture is `/private/tmp/mergbw-feature007-dial-off-20261024/com.obalunenko.mergbw.sdPlugin`, linked through ignored `dist/plugin-local-dial-off/`, spike/arm64, 39 files. Revision `b57139f7c0f0e51c9b11a07999d55f266105df9e` has a dirty worktree. Native source SHA256 remains `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647`; artifact-tree SHA256 is `806d605ecb35b82e50f1e26c74a9bd17ff3fa0af199cb5ef33c8716b82a154ae`. Bytes, modes, privacy resources, architecture, licenses and local signatures pass inspection.

The pinned CLI stopped/restarted the plugin after a private current-data backup. Actual startup confirms one owned worker, helper TCC attribution and BLE connected. All 20 current assignment records and private configuration/source data remain preserved. No native executable was run by software/build checks. The owner was asked to verify at 100: dial press Off then clockwise On without reducing the target, followed by ordinary Off-key then clockwise On. These new physical effects remain pending; T101 stays open.

### Press-Off and ceiling reactivation confirmed

The owner answers «да все работает» to the installed 100-percent test: dial press turns the lamp off while the target stays 100; clockwise rotation at unchanged 100 turns it on; ordinary Off-key followed by clockwise rotation also turns it on. These physical effects confirm the new press behavior and reported boundary fix. T101 is complete. The same message requests a clearer numeric display above the dial because the current text is hard to read; that is the next UI increment, not a failure of these command effects.

### Numeric dial display installed, visual check pending

The value now contains only the transient dial target percentage, such as 75%, styled through the installed SDK's supported B1 Text fields (28 px, weight 600, center alignment). A separate short EN/RU title carries status. Long Target/Цель prefixes and technical success text no longer compete with the number. This does not read the lamp or change the target, Off, queue, settings or request behavior. The optional preference between per-dial target and a shared last-command value was asked; the existing per-dial source is retained until any expansion is explicitly resolved.

All 27 focused dial tests, independent types/lint, **220/220** full plugin cases and 27 native-payload fixtures pass. The fresh 39-file spike/arm64 fixture is `/private/tmp/mergbw-feature007-numeric-dial-20261024/com.obalunenko.mergbw.sdPlugin`, linked through ignored `dist/plugin-local-numeric-dial/`. Native source SHA256 remains `12d3a8902536b9b1263aff3e6bbaa8b5dada22e9c9b7bf8def31161a685af647`, revision `b57139f7c0f0e51c9b11a07999d55f266105df9e` is dirty, and artifact-tree SHA256 is `f4ab001efc01e2f5a8d9c59469995a292c6b14abede3b25420b37cfaa49e56c4`. Public/native bytes, privacy resources, modes, architecture, licenses and local signatures pass inspection.

The pinned CLI installed it after a private backup. Startup confirms one owned worker, helper TCC attribution and BLE connected; all 20 current assignments and private configuration/source data remain preserved. Owner readability/no-clipping on the actual display is pending, so T103 remains open.

### Numeric display readability confirmed

The owner answers «да» to the installed numeric display being readable and fitting in full. This confirms the physical 28-px percentage rendering on the current numeric-dial fixture. The final question explicitly stated that the number is currently this dial's target; no sensor readback or cross-action synchronization is claimed. T103 is complete for the retained per-dial model. A future explicit shared-source request remains a separate behavior change.

## Final home-use acceptance

### T085: dial controls

Accepted from owner observations: signed rotation directions, fast reversal without a long tail, 0–100 limits, transition interruption, dial-down Off with retained target, outward-turn reactivation at 100 after both dial Off and the ordinary Off key, and legible numeric feedback. Touch/release remain inert; the prior inert-press observation was superseded by the requested Off behavior. Current software regressions retain queue/error/epoch/Keypad boundaries. Additional manual failure/profile/restart stress is deferred.

### T093: transitions

Accepted from owner observations: orange 100-to-0 ten-second fade, red-to-blue 1/60-second transitions with saved values checked, direct panel cancellation without a preliminary status read, ordinary-button and dial interruption, and host quit/relaunch preserving intermediate light without Off or continuation. These are qualitative effects and approximate timing, not calibrated measurements or physical readback. Extra native fault/stress qualification is deferred; automated cancellation/unknown-result/stale-ID coverage remains unchanged.

### T078: baseline lamp effects

Accepted from owner observations: On/Off, orange FF5000, visually dimmer 25 then brighter 75, selected forest green, and interruption/quit/relaunch with no observed extra Off or continuation. Fixtures/provenance and intentional assignment edits are recorded above. Setup/check/restart zero-command paths retain software coverage and startup diagnostics; no raw native packet capture is claimed. Additional manual/payload-capture rounds are deferred. The runtime continues to report physical_state_verified=false.
