---
description: "Task list for plugin auto-release and update offer"
---

# Tasks: plugin auto-release and update offer

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/plugin-updates.md](contracts/plugin-updates.md).

**Tests**: The constitution asks for offline tests at the right boundary. The
spec's Verification Evidence lists automated cases. Tests are included and
written to fail first.

## Phase 1: Setup

- [x] **T001** Create branch `feature/plugin-auto-release-updates` from the
      latest `master` (`7e63cd0`). · git

## Phase 2: Foundational (shared plugin types and strings)

Files: `streamdeck/src/validation.ts`, `streamdeck/src/settings.ts`,
`streamdeck/src/diagnostics.ts`, `streamdeck/src/i18n.ts`,
`streamdeck/tests/settings.test.ts`, `streamdeck/tests/diagnostics.test.ts`

**Wave 1 — independent (different files):**

- [x] **T002** [P] `globals()` accepts an optional schema-2 `updates`
      field: `{autoCheck: boolean, notifiedVersion?: "vX.Y.Z"}`, and rejects
      any other key. It is absent from schema 1. Export the
      `UpdateSettings` type. · streamdeck/src/validation.ts
- [x] **T003** [P] Add `launch_blocked` to `managedErrorCategories`.
      Add the `UpdateErrorCategory` values (`network`, `rate_limited`, `http`,
      `malformed`, `no_asset`, `size`, `checksum`, `open_failed`) and the
      `update.checked` / `update.failed` events with fields `installed`,
      `latest`, `result`, `phase`, `errorCategory`. No URLs, notes or paths.
      · streamdeck/src/diagnostics.ts
- [x] **T004** [P] Add EN/RU strings:
      - the update banner, the Install, Later, Check now and auto-check
        labels, the state lines and every `UpdateErrorCategory`;
      - the notification title and text "MeRGBW X.Y.Z is available" /
        «Доступна MeRGBW X.Y.Z»;
      - `launch_blocked` help with the `xattr -dr com.apple.quarantine`
        command and a Privacy & Security pointer.
      · streamdeck/src/i18n.ts

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T005** Add `getUpdates()` (defaulting to `{autoCheck: true}`) and
      `saveUpdates()` on the serial queue. Saving preserves language and
      connection. · streamdeck/src/settings.ts
- [x] **T006** [P] Tests:
      - schema-2 globals with and without `updates`;
      - foreign keys, a bad `notifiedVersion` and schema 1 with `updates`
        are rejected;
      - `saveUpdates` keeps language.
      · streamdeck/tests/settings.test.ts
- [x] **T007** [P] Test that the update events drop every field not on the
      allow-list. · streamdeck/tests/diagnostics.test.ts

**Checkpoint**: `task plugin:test` passes.

## Phase 3: User Story 1 - Tag ships an installable, versioned plugin (P1) 🎯 MVP

Files: `scripts/plugin-native.py`, `scripts/test_plugin_native.py`,
`streamdeck/scripts/check-package.mjs`, `streamdeck/tests/package.test.ts`,
`Taskfile.yml`, `.github/workflows/release.yml`,
`streamdeck/src/managed-controller.ts`, `streamdeck/tests/managed-errors.test.ts`

**Goal**: A tag publishes an installer whose version is `X.Y.Z.0`, with
`release.json` `{tag, build: 0}`. A local assembly gets `X.Y.Z.N`. A
quarantined controller reports `launch_blocked`.

**Independent Test**: `python3 scripts/test_plugin_native.py` and
`task plugin:test`, without native execution.

### Tests

**Wave 1 — independent (different files):**

- [x] **T008** [P] Write assemble tests:
      - `--release-tag v1.3.0` stages `1.3.0.0` with `{tag: "v1.3.0", build: 0}`;
      - `v1.3.0-rc.1` stages `1.3.0.0` and keeps the full tag;
      - an invalid tag fails before staging;
      - without a tag, `git describe` gives `v1.2.0` and the counter goes 1 then 2;
      - with no reachable tag, the source manifest gives `v0.2.0`;
      - a missing counter file starts at 1;
      - the source manifest stays unchanged.
      · scripts/test_plugin_native.py
- [x] **T009** [P] Package-check tests:
      - accept `X.Y.Z.N` that agrees with `release.json`;
      - reject a mismatch, a missing `release.json` and extra keys;
      - with `MERGBW_EXPECTED_TAG`, require that exact tag and `build: 0`.
      · streamdeck/tests/package.test.ts
- [x] **T010** [P] Launch-blocked tests:
      - `spawn_failed`/`startup_timeout` with the injected `xattr` probe
        succeeding gives `launch_blocked`;
      - a failing probe keeps the original category;
      - the plugin never removes the attribute.
      · streamdeck/tests/managed-errors.test.ts

### Implementation

**Wave 1 — independent (different files):**

- [x] **T011** [P] `assemble --release-tag`: validate the tag with the
      `release.py` `TAG` pattern. A release gets `build 0`. A local build uses
      `git describe --tags --abbrev=0 --match 'v*'` (falling back to the
      source manifest) and `dist/plugin-build-number`+1, written atomically.
      Write the staged `manifest.json` `Version` and `release.json`, and add
      `release.json` to the staged file inventory. · scripts/plugin-native.py
- [x] **T012** [P] Replace the fixed `0.2.0.0` check with the `X.Y.Z.N`
      pattern. Require `release.json` (`tag`, `build` only) to agree with the
      manifest, add it to the allowed entries, and honour
      `MERGBW_EXPECTED_TAG`. · streamdeck/scripts/check-package.mjs
- [x] **T013** [P] After `spawn_failed` or `startup_timeout`, probe
      `/usr/bin/xattr -p com.apple.quarantine <app>` through an injectable
      exec. If the attribute is present, report `launch_blocked`.
      · streamdeck/src/managed-controller.ts

**⟶ Wait for Wave 1 to finish, then:**

- [x] **T014** [P] `plugin:native:assemble` forwards an optional
      `RELEASE_TAG` as `--release-tag`. Local runs omit it. · Taskfile.yml
- [x] **T015** [P] Set `RELEASE_TAG` on the plugin job's assemble step and
      `MERGBW_EXPECTED_TAG` on the package and archive-check steps.
      · .github/workflows/release.yml

**Checkpoint**: the tests pass, and a local `task plugin:package` produces
`X.Y.Z.N` with matching `release.json`.

## Phase 4: User Story 2 - Release notes list every change (P2)

Files: `scripts/release.py`, `scripts/test_release.py`

**Goal**: Notes for a stable tag start at the previous stable tag. They
include the plugin version, an "Updating the Stream Deck plugin" section and
the quarantine steps.

**Independent Test**: `task release:test`.

### Tests

- [x] **T016** Release-notes tests:
      - history `v1.2.0` → `v1.3.0-rc.1` → `v1.3.0`: the stable notes cover
        both ranges, and the rc notes start at `v1.2.0`;
      - each non-merge commit appears exactly once;
      - the new sections are present, with no `development build` /
        `downloading is optional` wording left that contradicts them.
      · scripts/test_release.py

### Implementation

**⟶ Wait for T016, then:**

- [x] **T017** In `previous_tag`, a stable tag skips prerelease candidates.
      The notes add:
      - the plugin version `X.Y.Z.0`;
      - an "Updating the Stream Deck plugin" section: open the installer,
        and settings, presets, keys and language are kept. 0.2.0.0 installs
        update manually once;
      - the browser-download quarantine step (`xattr -d com.apple.quarantine`
        on the file, or allow it in Privacy & Security) and the installed
        plugin `xattr -dr` fallback.
      · scripts/release.py

**Checkpoint**: `task release:test` passes.

## Phase 5: User Story 3 - Installed plugin offers the update (P2)

Files: `streamdeck/src/updates.ts`, `streamdeck/tests/updates.test.ts`,
`streamdeck/src/inspector-messages.ts`, `streamdeck/tests/inspector-messages.test.ts`,
`streamdeck/src/plugin.ts`, `streamdeck/src/ui/inspector.ts`,
`streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html`,
`streamdeck/tests/inspector-ui.test.ts`

**Goal**: The plugin checks `/releases/latest` on start and every 24 h. It
sends one notification per tag and shows the banner. Install downloads the
installer, verifies it and opens it in Stream Deck's prompt. Failures never
reach the keys.

**Independent Test**: `task plugin:test` with injected `fetch`, `exec`,
clock and temp root, and no network.

### Tests

**Wave 1 — independent (different files):**

- [x] **T018** [P] Write the `UpdateService` tests:
      - **Version comparison**: semver (`1.10.0>1.9.0`, `1.3.0>1.3.0-rc.1`,
        §11 identifiers, invalid never newer), `(tag, build)` order (local
        `1.2.0.7` is offered `1.2.1` but not `1.2.0`), and no offer without a
        valid stamp.
      - **Offer decision**: newer, equal, older, prerelease, missing installer
        or `SHA256SUMS`, malformed JSON, a foreign `html_url`/download host,
        and responses over 1 MiB.
      - **Request**: the GitHub request carries no user data.
      - **Schedule**: a start check plus a 24 h timer, a second check joins
        the first, `autoCheck=false` means no timer request and no
        notification, and Check now still works.
      - **Notification**: exactly once per tag, even across restart and
        after Later; `osascript` gets the text as argv; an exec failure is
        ignored.
      - **Later**: hides the offer until restart, and a newer tag shows it
        again.
      - **Install**:
        - a matching hash renames `.part` and runs `/usr/bin/open` on the
          file;
        - a mismatch, a missing line, an oversize file or a network error
          deletes the temp dir and never opens it;
        - leftovers are cleared on start;
        - `open_failed` is reported.
      · streamdeck/tests/updates.test.ts
- [x] **T019** [P] Message tests for `update.status`, `update.check`,
      `update.install`/`update.dismiss` (`tag` must match the offer, else
      `validation`) and `update.autoCheck` (`autoCheck` boolean). Foreign
      payload keys are rejected, and the snapshot carries the `update` field.
      · streamdeck/tests/inspector-messages.test.ts
- [x] **T020** [P] UI tests:
      - the banner shows for `available`, `downloading`, `handed` and
        install `failed`;
      - notes render as text, so markup stays inert;
      - the settings row toggles auto-check and runs Check now;
      - the `launch_blocked` help is shown.
      · streamdeck/tests/inspector-ui.test.ts

### Implementation

**⟶ Wait for the Tests wave, then:**

- [x] **T021** Create `UpdateService` with injected `fetch`, `exec`, clock,
      temp root, settings and `readStamp`. It covers:
      - semver plus build comparison;
      - the `/releases/latest` request with a 10 s timeout and a 1 MiB cap,
        validating the hosts;
      - `decide()` and the states from data-model;
      - the start check and 24 h timer;
      - the one-time osascript notification and `saveUpdates(notifiedVersion)`;
      - Later;
      - install: `SHA256SUMS` (64 KiB), then a streamed `.part` with hashing
        (256 MiB, and no more than the asset `size`), rename, `/usr/bin/open`;
      - temp cleanup;
      - `update.checked`/`update.failed` events.
      · streamdeck/src/updates.ts

**⟶ Wait for T021, then:**

**Wave 2 — independent (different files):**

- [x] **T022** [P] Add the five `update.*` message types with their payload
      keys, the `update` snapshot field and the handlers that delegate to
      `UpdateService`. · streamdeck/src/inspector-messages.ts
- [x] **T023** [P] Add the banner markup and the auto-check / Check now row
      on the Lamp and connection screen. · streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html
- [x] **T024** [P] Construct `UpdateService` with the real `fetch`,
      `execFile` and `os.tmpdir()`. Read `release.json` from the plugin root,
      start it after `runtime.open`, and pass it to `InspectorController`.
      · streamdeck/src/plugin.ts

**⟶ Wait for Wave 2 to finish, then:**

- [x] **T025** Render the banner and states with `textContent` only. Wire
      Install, Later, Check now and auto-check to the messages, request
      `update.status` on open, and show the `launch_blocked` help.
      · streamdeck/src/ui/inspector.ts

**Checkpoint**: `task plugin:check:software` passes, and all US3 decisions
are covered offline.

## Final Phase: Polish

**Wave 1 — independent (different files):**

- [x] **T026** [P] README changes:
      - install from the release, with the one-time quarantine step;
      - versions: release `X.Y.Z.0`, local `X.Y.Z.N`;
      - update checks, the notification, Install with Stream Deck's prompt,
        disabling the checks and the only outbound request;
      - the manual move from 0.2.0.0;
      - replace "product versions remain independent of the tag".
      · README.md
- [x] **T027** [P] The same in Russian. · README_RU.md
- [x] **T028** [P] Create the verification record with pending rows:
      - a prerelease tag publishes, and its installer shows `X.Y.Z.0`;
      - a browser-downloaded installer installs after the quarantine step,
        with `launch_blocked` help when it is skipped;
      - a local build shows `X.Y.Z.N`;
      - an N→N+1 update through the banner keeps settings, and one lamp
        command works afterwards;
      - the notification appears once.
      Unobserved rows are recorded as accepted gaps.
      · specs/011-plugin-auto-release-updates/hardware-verification.md

**⟶ Wait for Wave 1 and all stories, then:**

- [x] **T029** Run `task plugin:check:software`, `task release:test`,
      `python3 scripts/test_plugin_native.py`, `task test:core`, `task vet`
      and `task build`, and check them against SC-001, SC-003 and SC-005.
      Skip Linux `task check` by owner decision. · repo
- [ ] **T030** Owner observation:
      - push a prerelease tag and install its installer from the browser
        download;
      - simulate N→N+1 with a local build and a later release;
      - fill in the hardware-verification rows (SC-002, SC-004, SC-006).
      · specs/011-plugin-auto-release-updates/hardware-verification.md

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T004 together, then T005 with T006 and T007) → US1, US2 and US3 in parallel → Polish.
- US1: T008–T010 together, then T011–T013 together, then T014 and T015 together.
- US2: T016, then T017.
- US3: T018–T020 together, then T021, then T022–T024 together, then T025.
- Polish: T026–T028 together, then T029, then T030 on the device.
- US3 reads `release.json` but does not need US1 code to pass its tests, because the stamp is injected. T030 needs every story.

## Phase 6: Convergence

- [x] T031 Keep a dismissed ("Later") offer installable from the Lamp and connection → Updates row: show an Install control there for the dismissed tag that sends `update.install`, and cover it in `streamdeck/tests/inspector-ui.test.ts` · streamdeck/src/ui/inspector.ts, streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html per US3/AC3 (partial)
- [x] T032 Render the release page in the banner and the Updates row as an openable link (validated `releaseUrl`, text-only label), not as plain URL text, including after a failed install, and cover it in `streamdeck/tests/inspector-ui.test.ts` · streamdeck/src/ui/inspector.ts per FR-007, US3/AC2 (partial)
- [x] T033 Restrict `UpdateService.install` to the `available` and `dismissed` states (reject `handed` with `validation`) and stop offering Install in the `handed` banner, with tests in `streamdeck/tests/updates.test.ts` and `streamdeck/tests/inspector-ui.test.ts` · streamdeck/src/updates.ts, streamdeck/src/ui/inspector.ts per contracts/plugin-updates.md §6 update.install (contradicts)
- [x] T034 Report a non-2xx `SHA256SUMS` or installer download response as `http` instead of `network`, with a test in `streamdeck/tests/updates.test.ts` · streamdeck/src/updates.ts per contracts/plugin-updates.md UpdateErrorCategory (partial)
