# Deferred extended qualification

The owner explicitly stopped further manual testing: «давай без душных проверок — это пока для домашнего пользования». The current milestone accepts the installed home-use version on the owner's Apple Silicon Mac/LT-06, its already executed software gates and recorded positive device observations.

Unperformed permission deny/re-enable, clean-user/manual-first-setup, forced-death/socket-loss/sleep-wake, installed foreign-port/host-timeout fault injection, extended EN/RU picker/profile/export and queue-recovery rounds are **deferred, not passed**. Intel execution and distribution qualification remain unverified/outside this milestone. Do not automatically resume these manual rounds. Existing safety behavior and automated regression coverage remain required and unchanged.

The original broader task definitions are retained below for future qualification. Their observed portions remain in validation.md and hardware-verification.md. The active tasks now reconcile home acceptance and explicit deferral; closing them does not assert that these original broader scenarios ran.

## T025: original extended definition

T025 [US1] Run US1 software scenarios and the dedicated Early current-Mac feasibility section in `specs/007-bundled-plugin-controller/quickstart.md` after T024, using its standalone spike CLI, existing JS build and explicit pinned dev/link commands run by the owner on the current Mac with existing data preserved (a separate user is optional by the 2026-10-23 decision). Record actual TCC prompt/allow/deny/re-enable, manual setup, one worker, cleanup and zero setup/check control writes in `specs/007-bundled-plugin-controller/validation.md`; native launch occurs only from Stream Deck with no prior Terminal grant. Host/plugin restart may be used for early permission re-enable; later panel recovery/import/distribution/other-architecture acceptance remains separate. Required missing current-host observations leave this task unchecked. Depends: T024, T095.

## T048: original extended definition

T048 [US3] Perform real Stream Deck quit/disable/restart/forced-Node-death/socket-loss/sleep-wake checks from `specs/007-bundled-plugin-controller/quickstart.md` after current-host setup, recording actual owned-worker disappearance/lease/no competitor in `specs/007-bundled-plugin-controller/validation.md`; preserve production data, mark absent architecture pending, and keep task unchecked without required current-host observations. Depends: T024, T025, T047.

## T058: original extended definition

T058 [US4] Validate permission deny/re-enable, synthetic port conflict and panel-only recovery in installed Stream Deck, recording actual responsible app and foreign fixture still alive in `specs/007-bundled-plugin-controller/validation.md`; zero setup/check/restart control writes, honest unknown outcomes, unavailable host stays pending and task unchecked. Include panel-only recovery after host timeout/helper exit, fresh session and authoritative config, with one SDK request across repeated clicks and no token rotation or command replay. Depends: T048, T057.

## T073: original extended definition

T073 [US5] Owner locally installs or explicitly links the T072 artifact in Stream Deck and verifies first run/import/upgrade/EN-RU file selection/profile isolation and three-restart ten-assignment retention. Record tested host, exact artifact/build mode, local install/link, TCC attribution and actual outcomes in validation.md. Downloading and quarantine are not required; no existing checkbox becomes a pass from this scope change alone. Depends: T061, T072, T057, T095.

## T085: original extended definition

T085 [US6] User performs physical Stream Deck+ rotation acceptance from `specs/007-bundled-plugin-controller/quickstart.md` on current Apple Silicon Mac/LT-06: both directions, limits, fast rotation, pending/failure display, profile/restart no replay, shared process and unchanged Keypad. Record exact build/mode and observed effects separately in `specs/007-bundled-plugin-controller/hardware-verification.md`; unavailable device or observations remain pending, with no Intel/distribution inference. Depends: T025, T084.

## T093: original extended definition

T093 [US7] User follows `specs/007-bundled-plugin-controller/quickstart.md` to verify 1–60-second smooth RGB/brightness effects, exact endpoints, explicit cancellation, ordinary button/dial interruption, shutdown no Off and restart no continuation on current Mac/LT-06 after current-host setup. Record exact fixture provenance/build mode, actual effects and uncertainty in `specs/007-bundled-plugin-controller/hardware-verification.md`; missing observations remain pending and do not complete Intel/distribution acceptance. Depends: T025, T092.

## T078: original extended definition

T078 Perform separate LOCAL installed-plugin LT-06 On/Off, RGB FF5000, brightness 25/75, one selected preset and interrupted-transition/no-Off/no-resume observations from `specs/007-bundled-plugin-controller/quickstart.md` on the current Apple Silicon Mac after host setup/recovery and transition integration. The current integrated owner-linked fixture is sufficient; preserve working data and record exact provenance/build mode, commands/actual effects/uncertainty/zero setup-check-restart control writes in `specs/007-bundled-plugin-controller/hardware-verification.md` without secrets. No CI/default hardware tag; connection/write/build are not physical proof; required missing observations keep task unchecked. Any Intel execution remains explicitly unverified; T073 separately checks local installation and retention. Depends: T025, T058, T075, T092.

## T079: original extended definition

T079 Reconcile FR-001–033/SC-001–012 instructions/evidence in `specs/007-bundled-plugin-controller/quickstart.md`, `specs/007-bundled-plugin-controller/validation.md` and `specs/007-bundled-plugin-controller/hardware-verification.md` with `README.md`, `README_RU.md` and instructions generated by `scripts/release.py`; confirm local installation and physical results/remaining architecture limits are honest and all required personal-development gates pass before feature completion. Developer ID, notarization and downloaded/quarantine acceptance are outside scope. Commits/tags/publication need a separately requested later action. Depends: T025, T048, T058, T072, T073, T077, T078, T084, T085, T092, T093, T095, T097, T099, T101, T103.
