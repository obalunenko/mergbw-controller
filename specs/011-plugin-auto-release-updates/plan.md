# Implementation Plan: plugin auto-release and update offer

**Feature Directory**: `specs/011-plugin-auto-release-updates` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

## Summary

Tags already publish a release with the plugin installer and commit notes.
This feature ties the plugin version to the tag. A release assembly stamps `X.Y.Z.0`
into the manifest. A local assembly stamps `X.Y.Z.N`, taking `X.Y.Z` from the
nearest tag and incrementing `N` on every build. Assembly also writes
`release.json` with the exact tag and the build number, so the next release
always compares newer than any local build. Release
notes for a stable tag now cover everything since the previous stable tag, and
they explain how to update and how to clear quarantine on a downloaded
installer. The plugin gains one module, `updates.ts`. It checks
`/releases/latest` on start and then every 24 h, and sends one macOS
notification per new version. It offers the update in the panel and installs
it by downloading the installer, checking it against `SHA256SUMS` and opening
it so Stream Deck shows its normal install prompt. No new dependency: this uses
Node 24 `fetch`, `crypto` and `execFile` with `/usr/bin/open`, `osascript` and
`xattr`.

## Project Structure

```text
scripts/plugin-native.py                 assemble: X.Y.Z.0 (release) or X.Y.Z.N (local counter) + release.json
scripts/test_plugin_native.py            stamping, bad tag, default from source manifest
scripts/release.py                       stable tag skips prerelease predecessors; update + quarantine notes
scripts/test_release.py                  stable-after-rc history, notes sections
Taskfile.yml                             plugin:native:assemble forwards RELEASE_TAG
.github/workflows/release.yml            RELEASE_TAG to assemble; package check against expected tag
streamdeck/scripts/check-package.mjs     Version pattern + release.json agreement, MERGBW_EXPECTED_TAG
streamdeck/src/updates.ts                NEW semver, release fetch, decide, download+verify, open, notify
streamdeck/src/validation.ts             globals(): optional updates {autoCheck, notifiedVersion}
streamdeck/src/settings.ts               getUpdates / saveUpdates on the serial queue
streamdeck/src/inspector-messages.ts     update.status|check|install|dismiss|autoCheck messages
streamdeck/src/managed-controller.ts     launch_blocked after quarantine probe on launch failure
streamdeck/src/diagnostics.ts            launch_blocked category; update.checked|update.failed events
streamdeck/src/plugin.ts                 construct UpdateService, start timer after runtime.open
streamdeck/src/i18n.ts                   EN/RU strings for offer, notification, errors, quarantine help
streamdeck/src/ui/inspector.ts           update banner and settings rows
streamdeck/com.obalunenko.mergbw.sdPlugin/ui/index.html  update banner + settings markup
streamdeck/tests/updates.test.ts         NEW decisions, download/verify, notify-once, offline
streamdeck/tests/*.test.ts               globals schema, inspector messages, launch_blocked, package
README.md, README_RU.md                  install from release, quarantine step, updates, first move from 0.2.0.0
specs/011-plugin-auto-release-updates/hardware-verification.md  NEW owner observations
```

**Structure Decision**: Plugin changes stay in `streamdeck/`, and release
changes stay in `scripts/` and the workflow. `cmd/sunset` and `internal/` are
untouched. `UpdateService` is one class with injected `fetch`, `exec`, clock
and filesystem root, following the injected-launcher pattern in
`managed-controller.ts`.

## Calls

```text
git tag vX.Y.Z ─▶ release.yml
  plugin job ─▶ task plugin:native:assemble RELEASE_TAG ─▶ plugin-native.py assemble --release-tag
                   └▶ stage manifest Version X.Y.Z.0 + release.json {tag, build: 0}
local: task plugin:native:assemble ─▶ git describe v* tag + dist/plugin-build-number+1 ─▶ X.Y.Z.N
             ─▶ task plugin:package ─▶ check-package.mjs (MERGBW_EXPECTED_TAG) ─▶ installer
  publish job ─▶ release.py notes (stable: previous stable tag) ─▶ gh release create

plugin start ─▶ settings.load ─▶ runtime.open ─▶ updates.start()
  updates.check()  (start, every 24 h, or update.check from panel; skipped when autoCheck=false)
    └▶ fetch /releases/latest ─▶ parse ─▶ decide(installed tag, release)
          newer + installer + SHA256SUMS ─▶ state=available
             └▶ notifiedVersion != tag ─▶ osascript notification ─▶ settings.saveUpdates(notifiedVersion)
panel update.install
  └▶ fetch SHA256SUMS ─▶ stream installer to .part + sha256 ─▶ match ─▶ rename ─▶ /usr/bin/open file
                                                            └▶ mismatch ─▶ delete, state=failed(checksum)
supervisor launch fails ─▶ xattr -p com.apple.quarantine app ─▶ present ─▶ launch_blocked
```

## States

```text
Idle: no check yet, or auto-check off. shows settings
Checking: request in flight; a second check joins the same promise.
UpToDate: installed tag >= latest stable, or no installer asset. shows settings
Available: newer stable release with installer and SHA256SUMS. shows banner
Dismissed: Available, but the owner pressed Later; hidden until restart or a newer tag. shows settings
Downloading: installer streaming and hashing; Install disabled. shows banner
Handed: file opened; Stream Deck shows its own prompt, and installing restarts the plugin. shows banner
Failed: check or download failed, with a category; keys are unaffected; the next timer retries. shows settings

Idle ─check─▶ Checking ─▶ UpToDate | Available | Failed
Available ─Later─▶ Dismissed ─newer tag─▶ Available
Available ─Install─▶ Downloading ─▶ Handed | Failed
Failed ─timer/Check now─▶ Checking
```

## Screens

```text
banner: panel top, update available
MeRGBW 1.3.0 is available (installed 1.2.0)
<first 2000 chars of release notes, plain text>
[Install]  [Later]   Release notes ↗
Downloading… / Opened in Stream Deck: confirm the installation / Checksum mismatch: not installed. Release page ↗
```

```text
settings: Lamp and connection screen, Updates row
Updates: [x] Check automatically   [Check now]
Last check: 14:36, up to date | 1.3.0 available | failed (network)
```

## Constitution Check

| Principle | Assessment |
|---|---|
| I. Package and module boundaries | PASS. Update logic is a plugin module and release logic stays in `scripts/`. `cmd/sunset` and `internal/` are unchanged. |
| II. Local command contract | PASS. Loopback HTTP, GET/POST, tokens and routes are unchanged. The new outbound request goes from the plugin to GitHub, not through the controller. |
| III. BLE effects and cancellation | PASS. No BLE change. An install restart stops the controller under the existing 007 rules, with no extra Off. |
| IV. Configuration and secrets | PASS. The global settings field is additive and optional. Requests and logs carry no token, identity or paths. Old settings decode unchanged. |
| V. Verify at the right boundary | PASS. Tests inject `fetch`, `exec`, clock and temp root, and use no network, Stream Deck or Bluetooth. Install and notification are recorded as owner observations. |
| VI. Hardware integration tests | PASS. No hardware-tag test is added. |

**Recorded exception**: this is the plugin's first outbound network access. It
is limited to public release metadata and assets of
`obalunenko/mergbw-controller`, sends no user data and can be disabled. No
principle forbids it, so no amendment is needed.

Re-checked after Phase 1 design: still PASS.

## Validation

- `task plugin:check:software`, `task release:test`, `python3 scripts/test_plugin_native.py`.
- Owner checks, recorded in `hardware-verification.md`:
  - A prerelease tag publishes, and its installer reports the stamped version.
  - A browser-downloaded installer installs after the documented quarantine step.
  - An update from N to N+1 through the banner keeps settings, and one lamp command works afterwards.
  - The notification appears once.
  - Unobserved rows are recorded as accepted gaps.
- Linux `task check` is skipped by owner decision.
