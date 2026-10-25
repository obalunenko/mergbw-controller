# Research: plugin auto-release and update offer

## R1. Where the plugin version comes from

**Decision**: `scripts/plugin-native.py assemble` writes the staged
`manifest.json` `Version` as `X.Y.Z.N`. It also adds
`release.json` (`{"tag": "vX.Y.Z[-pre]", "build": N}`) to the plugin root.

- Release (`--release-tag vX.Y.Z[-pre]`): `N = 0`, tag as given.
- Local build (no `--release-tag`): the tag is the nearest reachable valid tag
  (`git describe --tags --abbrev=0 --match 'v*'`, checked against `TAG`).
  With no tag, it falls back to the source manifest (`0.2.0.0` → `v0.2.0`).
  `N` is the previous value in `dist/plugin-build-number` plus 1, starting at 1.

The plugin compares `(semver(tag), build)`, so `1.2.0.7` is newer than release
`1.2.0` and older than `1.2.1`. The source manifest is not edited.
`// simplified`: the counter lives in ignored `dist/` and restarts at 1 after
`dist` is deleted. Stream Deck reinstalls a lower version anyway, so nothing
breaks.

**Rationale**: Stream Deck accepts only numeric `X.Y.Z.W` versions, so a
prerelease suffix cannot live in the manifest. `release.json` keeps the exact
semver for comparison: an installed `1.3.0-rc.1` is older than `1.3.0`, and
both show as `1.3.0.0` in Stream Deck. The manifest sits outside the signed app
bundle, so stamping it does not touch native signatures.

**Alternatives considered**: Bumping the source manifest in a release commit
was rejected because tags would drift from the manifest. Encoding prereleases
in the fourth number (`1.3.0.1` for rc.1) was rejected because then a stable
`1.3.0.0` would compare older than its own rc.

## R2. Installer asset name

**Decision**: Keep `com.obalunenko.mergbw.development.streamDeckPlugin`.

**Rationale**: It already has no version in it, so it is stable across
releases (FR-003). Renaming it would break existing links and README text for
no gain.

## R3. Release notes for a stable tag

**Decision**: In `previous_tag`, a stable tag considers only stable candidate
tags. A prerelease tag keeps today's rule (the nearest valid tag). Add an
"Updating the Stream Deck plugin" section and the downloaded-installer
quarantine steps to the notes.

**Rationale**: A stable-channel user who skipped the rc releases must see every
change since the last stable release (US2-2).

## R4. Where update data comes from

**Decision**: Use an unauthenticated
`GET https://api.github.com/repos/obalunenko/mergbw-controller/releases/latest`
with `Accept: application/vnd.github+json`, a 10 s timeout and a 1 MiB response
cap. Repository owner and name are constants. The response gives `tag_name`,
`html_url`, `body` and `assets[]` (`name`, `size`, `browser_download_url`).

**Rationale**: `/releases/latest` already excludes drafts and prereleases,
which is exactly the stable channel. One request every 24 h is far below the
anonymous limit of 60 per hour. Node 24 `fetch` is built in, so no dependency
is added.

**Alternatives considered**: Listing all releases and filtering them was not
needed. A redirect-based "latest download" URL gives no version or notes.

## R5. Download, verification and handing the file to Stream Deck

**Decision**: Fetch `SHA256SUMS` (cap 64 KiB) and the installer (cap 256 MiB,
and no larger than the size the API reports). Stream the installer to
`<tmpdir>/mergbw-update/<tag>/…streamDeckPlugin.part` while hashing it. Rename
it only when the hash matches its `SHA256SUMS` line. Then run
`execFile("/usr/bin/open", [path])`, which shows the standard Stream Deck
install confirmation. Delete the temp directory on mismatch, and on the next
start.

**Rationale**: `open` hands the file to its registered handler. A file
written by Node gets no `com.apple.quarantine` attribute, so updates made from
the panel need no manual Gatekeeper step. Only a first install from a browser
download needs one.

**Alternatives considered**: `streamDeck.system.openUrl` with a `file://` URL
was rejected because how it handles local files is undocumented. Unpacking the
plugin in place was rejected because it bypasses Stream Deck's installer and
breaks FR-008.

## R6. macOS system notification

**Decision**: Run
`execFile("/usr/bin/osascript", ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", text, title])`.
Text goes in as argv, never through string interpolation. Errors are ignored.
After the attempt, the plugin persists `notifiedVersion`.

**Rationale**: This adds no dependency and no native code. macOS attributes the
notification to Script Editor. If the owner has disabled those notifications,
nothing appears and the panel offer remains (FR-007a). Delivery cannot be
detected, so the attempt counts as "notified".

**Alternatives considered**: Posting through `UNUserNotificationCenter` in the
bundled `MeRGBW Controller.app` was rejected. It needs native code and a new
notification permission in the signed helper, which is too large for this MVP.

## R7. Where update state is stored

**Decision**: Schema-2 global settings gain an optional field,
`updates: { autoCheck: boolean, notifiedVersion?: string }`. It defaults to
auto-check on, with no `notifiedVersion`. "Later" and the last check result
stay in memory only.

**Rationale**: Language is already stored in global settings, so this matches
existing practice. Stream Deck keeps global settings across plugin updates.
"Later" lasting until restart matches US3-3.

**Alternatives considered**: A separate file in Application Support was
rejected because it adds a second store for UI preferences.

## R8. Detecting a downloaded controller that macOS blocks

**Decision**: When the supervisor launch fails (`spawn_failed` or
`startup_timeout`), read `com.apple.quarantine` on the bundled
`controller/MeRGBW Controller.app` using
`execFile("/usr/bin/xattr", ["-p", "com.apple.quarantine", app])`. If the
attribute is present, report a new managed category, `launch_blocked`. The
panel then shows the one-time instruction text, with the exact `xattr -dr`
command for the installed plugin directory.

**Rationale**: The plugin cannot see Gatekeeper's dialog, but quarantine on its
own payload is a deterministic signal (FR-004). The plugin never removes the
attribute itself, because that is the owner's security decision.

## R9. Comparing versions

**Decision**: A semver comparison of about 20 lines in
`streamdeck/src/updates.ts`. It compares numeric core parts, and a version with
no prerelease beats the same version with one. Prerelease identifiers are
compared per semver §11. Any tag that is not `vX.Y.Z[-pre]` is treated as
"not newer".

**Rationale**: It is too small to justify a dependency.
