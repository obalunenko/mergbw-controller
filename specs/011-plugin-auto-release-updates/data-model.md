# Data model: plugin auto-release and update offer

This feature ties the plugin version to the release tag and adds an update
check to the plugin. It introduces a release stamp, a parsed release record, an
in-memory update state, an update offer and an optional `updates` field in
global settings. It reshapes the plugin manifest version, the release-notes
range for stable tags, and the managed launch error categories. Controller
configuration, presets, action settings, the loopback HTTP contract and BLE
are unchanged.

## Release tag and version

A release tag is the single source of the plugin version.

| Field | Validation |
| --- | --- |
| `tag` | Full match of `v(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)(-<pre>)?`, the existing `TAG` pattern in `scripts/release.py`. Anything else stops the release before publishing (US1-2). |
| `core` | `X.Y.Z`, three non-negative integers without leading zeros. |
| `prerelease` | Optional dot-separated identifiers of `[0-9A-Za-z-]`. Present means the GitHub release is a prerelease. |
| `manifestVersion` | `X.Y.Z.build` (`.0` for releases). Stream Deck accepts only four numeric parts, so the prerelease suffix is dropped here and kept in the release stamp. |

**Comparison** (R9): numeric core parts compare first. A version without a
prerelease is newer than the same core with one (`1.3.0 > 1.3.0-rc.1`).
Prerelease identifiers compare per semver §11: numeric identifiers
numerically, alphanumeric ones lexically, numeric lower than alphanumeric, and
a shorter list lower when all shared identifiers are equal. Numbers compare as
numbers (`1.10.0 > 1.9.0`). A tag that does not parse is never newer.

## Release stamp (`release.json`)

Written by `plugin-native.py assemble` to the plugin root, next to
`manifest.json`, outside the signed app bundle.

| Field | Validation |
| --- | --- |
| `tag` | A valid release tag, as above. For a local build, the nearest reachable tag or the source-manifest fallback. |
| `build` | Integer. `0` for a release; `≥ 1` for a local build, incremented on every local assembly through `dist/plugin-build-number`. Unknown fields are rejected. |

The installed version is the pair `(tag, build)` and the manifest `Version` is
`X.Y.Z.build`. Comparison orders by tag first (semver, as above), then by
`build`. A release always has `build = 0`, so a local `1.2.0.7` is newer than
release `1.2.0` and older than release `1.2.1`.

Rules:

- With `--release-tag`, the stamp holds that tag with `build: 0`, and the
  staged manifest `Version` is `X.Y.Z.0`. Without it (local build), see
  `build` above.
- Without a tag, the stamp is derived from the source manifest
  (`0.2.0.0` → `v0.2.0`). The source manifest is never edited by a release.
- `check-package.mjs` requires `Version` to match `^\d+\.\d+\.\d+\.\d+$` and to
  equal the stamp's `X.Y.Z.build`. With `MERGBW_EXPECTED_TAG`, `build` must be `0`. With `MERGBW_EXPECTED_TAG` set, the
  stamp's `tag` must equal it. Any mismatch fails the package step, and so the
  release, before publishing (FR-002).
- The plugin reads the stamp at start as its installed version. A missing or
  invalid stamp, as in an installed 0.2.0.0, disables the offer: such builds
  cannot check for updates, and the first move is manual (Compatibility).

## Release

The published GitHub release created by `release.yml`. The plugin sees it
through `/releases/latest`, which already excludes drafts and prereleases.

| Field | Source | Validation in the plugin |
| --- | --- | --- |
| `tag` | `tag_name` | A valid release tag. A prerelease tag here is not offered. |
| `htmlUrl` | `html_url` | `https://github.com/obalunenko/mergbw-controller/releases/...`; anything else is a malformed response. |
| `notes` | `body` | String, may be empty. Rendered as plain text only, cut to the first 2000 characters for the banner. |
| `installer` | Asset named `com.obalunenko.mergbw.development.streamDeckPlugin` | Optional. `size` positive and at most 256 MiB; `browser_download_url` on `github.com` or `objects.githubusercontent.com` over HTTPS. |
| `checksums` | Asset named `SHA256SUMS` | Optional. Same URL rule; at most 64 KiB when downloaded. |

The response as a whole is limited to 1 MiB and 10 s. A non-2xx status, a
rate-limit status, invalid JSON, a missing required field or an exceeded limit
fails the check; it never throws past the update service.

The installer asset name is the same in every release (FR-003, R2), so the
plugin finds it without knowing the version. A release lacking either the
installer or `SHA256SUMS` produces no install offer, only a release-page link.

### Release assets and notes (publishing side)

| Element | Rule |
| --- | --- |
| Assets | Controller archives, the installer with its fixed name, `SHA256SUMS` listing every asset (FR-001). |
| Notes range | A stable tag starts from the previous stable tag, skipping prerelease tags. A prerelease tag starts from the nearest valid tag, as today (FR-005, R3). |
| Notes body | Every non-merge commit in the range exactly once, grouped by type, with author and link; then the plugin version, an installer link, an "Updating the Stream Deck plugin" section and the one-time quarantine step for a browser-downloaded installer (FR-004, FR-005). |
| Re-runs | An already published release is not changed. |

## Update settings (global settings)

Schema-2 global settings gain one optional field. It is the only persisted
update state (R7).

```text
GlobalSettings (schemaVersion 2) = { schemaVersion, language, updates? }
updates = { autoCheck: boolean, notifiedVersion?: string }
```

| Field | Validation | Default |
| --- | --- | --- |
| `updates` | Optional object with exactly the keys below; other keys are a validation error. | Absent, read as `{ autoCheck: true }`. |
| `autoCheck` | Boolean. `false` stops timer and start-up checks and all notifications; "Check now" still works (FR-010). | `true` |
| `notifiedVersion` | Optional valid release tag: the newest version a notification was attempted for. | Absent |

Rules:

- Existing schema-1 and schema-2 settings without `updates` decode unchanged
  and keep their meaning. Schema 1 does not gain the field.
- Writes go through `settings.saveUpdates` on the existing serial settings
  queue, so they never race with language or connection writes.
- Stream Deck keeps global settings across plugin updates, so the field,
  language and connection survive an install (FR-012).
- The field holds no token, lamp identity, path or release notes.

## Update state (in memory)

Owned by `UpdateService`. Lost on restart, which is what makes "Later" last
only until restart (US3-3).

| Field | Meaning |
| --- | --- |
| `status` | One of the states below. |
| `installed` | Installed tag from the release stamp. |
| `latest` | Last parsed release, if any. |
| `offer` | Current update offer, present in `Available`, `Dismissed`, `Downloading`, `Handed` and install failures. |
| `dismissedTag` | Tag the owner pressed "Later" on. |
| `lastCheckAt` | Time of the last finished check, from the injected clock. |
| `lastError` | Category of the last failure, cleared by a successful check. |
| `inFlight` | The running check's promise; a second check joins it. |

## Update offer

Built only when every condition holds; otherwise no offer exists (FR-006).

| Field | Rule |
| --- | --- |
| `installed` | Installed tag. |
| `available` | `latest.tag`; strictly newer than `installed` and not a prerelease. |
| `notes` | Plain text, first 2000 characters of `latest.notes`. Markup and links are shown as text and never executed (Edge Cases). |
| `releaseUrl` | `latest.htmlUrl`. |
| `installerUrl`, `installerSize` | From the installer asset. |
| `checksumsUrl` | From the `SHA256SUMS` asset. The expected digest is read from that file at install time, from the line naming the installer asset; a missing line is a `checksum` failure. |

## Update decision

`decide(installed, release)` is pure and covers the automated cases.

| Input | Result |
| --- | --- |
| No valid installed stamp | No offer. |
| Release tag invalid or a prerelease | `UpToDate`. |
| Release tag equal to or older than installed | `UpToDate`. |
| Newer, but installer or `SHA256SUMS` missing | `UpToDate`, with the release-page link in the last-check line. |
| Newer, with both assets, tag equal to `dismissedTag` | `Dismissed`. |
| Newer, with both assets | `Available`. A notification follows if `autoCheck` is on and `notifiedVersion` differs from the tag. |

An installed prerelease such as `1.3.0-rc.1` is offered the stable `1.3.0`.

## States

```text
Idle         no check yet, or auto-check off and no manual check
Checking     request in flight
UpToDate     nothing to offer
Available    offer shown in the banner of every MeRGBW action panel
Dismissed    offer hidden after "Later"; visible in settings
Downloading  installer streaming and hashing; Install disabled
Handed       file opened; Stream Deck shows its own install confirmation
Failed       check or install failed, with a category
```

```text
Idle      ─start (autoCheck) / Check now─▶ Checking
Checking  ─▶ UpToDate | Available | Dismissed | Failed(check)
UpToDate  ─24 h timer / Check now─▶ Checking
Available ─Later─▶ Dismissed
Available ─Install─▶ Downloading ─▶ Handed | Failed(install)
Dismissed ─check finds a newer tag─▶ Available
Dismissed ─check finds the same tag─▶ Dismissed
Failed    ─24 h timer / Check now─▶ Checking
Handed    ─Stream Deck installs─▶ plugin restarts (state reset)
Handed    ─owner cancels─▶ stays Handed; Install may be pressed again
any       ─restart─▶ Idle (dismissedTag cleared)
```

Rules:

- A check while `Downloading` or `Handed` is skipped, so a check cannot remove
  the offer being installed.
- `Failed(check)` shows in settings only. `Failed(install)` keeps the offer in
  the banner with the reason and a release-page link (US3-2).
- No state change sends a lamp command, and no failure reaches the keys
  (FR-009, SC-005).
- The 24 h timer starts after `runtime.open` and runs whether or not a check
  failed; with `autoCheck` off the timer does nothing.

### Failure categories

| Phase | Category | Cause |
| --- | --- | --- |
| check | `network` | DNS, connection, TLS or timeout. |
| check | `rate_limited` | 403 or 429 with an exhausted rate limit. |
| check | `http` | Any other non-2xx status. |
| check | `malformed` | Invalid JSON, a missing field, an unexpected URL or over 1 MiB. |
| check | `no_asset` | Newer release lacks the installer or `SHA256SUMS`; recorded, not shown as an error. |
| install | `network` | Download of `SHA256SUMS` or the installer failed. |
| install | `size` | Body over its cap or different from the reported size. |
| install | `checksum` | No line for the installer, or the digest differs. |
| install | `open_failed` | `/usr/bin/open` exited non-zero. |

## Installer download

| Item | Rule |
| --- | --- |
| Directory | `<tmpdir>/mergbw-update/<tag>/`; `<tag>` is a validated tag, so it cannot escape the root. Removed on mismatch and at the next start. |
| Partial file | `<installer name>.part`, written while SHA-256 is computed. |
| Final file | Renamed from `.part` only after the digest matches; only that file is passed to `/usr/bin/open` (FR-008). |
| Quarantine | Node-written files carry no `com.apple.quarantine`, so panel updates need no Gatekeeper step. |

A file with a mismatched digest is never opened (SC-005).

## Notification record

| Item | Rule |
| --- | --- |
| Trigger | First transition to `Available` for a tag that is not `notifiedVersion`, with `autoCheck` on. |
| Content | Title and text in the plugin language: "MeRGBW X.Y.Z is available" / «Доступна MeRGBW X.Y.Z». No secrets, paths or notes. Passed to `osascript` as argv. |
| Persistence | `notifiedVersion` is saved after the attempt, whether or not macOS shows it (R6), so a version is notified at most once, across restarts and "Later" (FR-007a). |
| Failure | Ignored; the panel offer remains. |

## Managed launch category

The managed controller categories gain `launch_blocked` (R8).

| Field | Rule |
| --- | --- |
| Trigger | A launch fails with `spawn_failed` or `startup_timeout`, and `xattr -p com.apple.quarantine` finds the attribute on the bundled `controller/MeRGBW Controller.app`. |
| Otherwise | The original category stays. A failing `xattr` probe also keeps it. |
| Panel | Shows the one-time instruction and the exact `xattr -dr com.apple.quarantine <installed plugin dir>` command instead of a generic launch error (FR-004). |
| Effect | The plugin never removes the attribute itself. |

## Inspector messages

Added to the existing inspector protocol; each carries no settings, token or
lamp identity.

| Message | Direction | Payload |
| --- | --- | --- |
| `update.status` | panel → plugin | None. The reply snapshot carries `update`: state, installed, latest, notes, URLs, `lastCheckedAt`, `errorCategory`, `autoCheck` (see contract §6). |
| `update.check` | panel → plugin | None. Runs a check even when `autoCheck` is off. |
| `update.install` | panel → plugin | `tag`; a `validation` error unless it equals the current offer. |
| `update.dismiss` | panel → plugin | `tag`; a `validation` error unless it equals the current offer. |
| `update.autoCheck` | panel → plugin | `autoCheck` boolean; saved through `saveUpdates`. |

## Diagnostics events

| Event | Fields |
| --- | --- |
| `update.checked` | `installed`, `latest`, `result` (`up_to_date`, `available`, `dismissed`, `no_asset`). |
| `update.failed` | `phase` (`check`, `install`), `errorCategory`. |

Events hold versions and categories only, never the token, lamp identity,
import paths, release notes or download paths (FR-011, Edge Cases).
