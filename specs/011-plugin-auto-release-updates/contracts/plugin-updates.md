# Plugin release and update contract

Related: [spec](../spec.md), [plan](../plan.md), [research](../research.md),
007 [distribution](../../007-bundled-plugin-controller/contracts/distribution.md)
and [configuration UI](../../007-bundled-plugin-controller/contracts/configuration-ui.md).

The controller contract does not change. `sunset` HTTP routes, CLI, protocol,
BLE behaviour, actions, presets and action settings stay as they are. This
contract covers four things: the release artifacts, the one outbound request
the plugin makes, the global settings field it adds, and the Property Inspector
messages for updates.

## 1. Release build interface

### Tag

- Accepted: `vX.Y.Z` (stable) and `vX.Y.Z-pre` (prerelease; `pre` follows
  semver prerelease identifiers, for example `v1.3.0-rc.1`).
- Any other tag stops the release before `gh release create` and prints a
  clear error (US1-2, FR-002).

### `scripts/plugin-native.py assemble`

| Input | Contract |
|---|---|
| `--release-tag vX.Y.Z[-pre]` | Optional. When given, the staged `manifest.json` `Version` is set to `X.Y.Z.0`, and `release.json` is written to the plugin root. |
| omitted | The tag is derived from the source manifest (`0.2.0.0` → `v0.2.0`). The source manifest is never edited. |
| invalid tag | Non-zero exit and an error before anything is staged. |

The stamped manifest sits outside the signed app bundle, so native signatures
are unchanged.

### `release.json` (plugin root, inside the installer)

```json
{"tag": "vX.Y.Z[-pre]", "build": 0}
```

- Exactly two keys. `tag` is the full semver tag, including any prerelease
  suffix. `build` is `0` for a release and `N ≥ 1` for a local build.
- Local build (assemble without `--release-tag`): `tag` is the highest
  reachable valid tag, or is derived from the source manifest. `build` is the
  previous `dist/plugin-build-number` plus 1. The manifest `Version` is
  `X.Y.Z.build`.
- It is the plugin's source of truth for the installed version. The manifest
  `Version` (`X.Y.Z.0`) is only for display, because Stream Deck cannot express
  prereleases.

### Taskfile and workflow

| Name | Contract |
|---|---|
| `RELEASE_TAG` | Taskfile variable. `task plugin:native:assemble` forwards it as `--release-tag`. `.github/workflows/release.yml` sets it to the pushed tag. |
| `MERGBW_EXPECTED_TAG` | Environment variable read by `streamdeck/scripts/check-package.mjs`. When set, the packaged manifest `Version` must equal `X.Y.Z.0`, `release.json` `tag` must equal it exactly and `build` must be `0`. Otherwise packaging fails. Without it, the check only enforces the `X.Y.Z.W` pattern and agreement between the manifest and `release.json`. |

### Release assets

| Asset | Contract |
|---|---|
| `com.obalunenko.mergbw.development.streamDeckPlugin` | The installer. The name is stable across releases (FR-003, R2); the plugin looks it up by exact name. |
| `SHA256SUMS` | Contains a line `<64 lowercase hex>  com.obalunenko.mergbw.development.streamDeckPlugin`. |
| controller archives | Unchanged. |

Re-running the workflow for a release that is already published leaves the
release unchanged, as it does today.

### Release notes (`scripts/release.py`)

- Previous tag: for a stable tag, the nearest earlier stable tag
  (prereleases are skipped). For a prerelease tag, the nearest earlier valid
  tag, as today (R3, US2-2).
- Every non-merge commit in that range appears exactly once, grouped by type,
  with its author and a link (FR-005).
- New sections: the plugin version, a link to the installer, "Updating the
  Stream Deck plugin" (open the installer; settings are kept), and the one-time
  quarantine step for a browser-downloaded installer (remove quarantine, or
  allow it in **System Settings → Privacy & Security**) (FR-004).

## 2. Outbound request (plugin → GitHub)

This is the plugin's only network access (FR-011). It sends no settings,
token, lamp identity, paths or other user data, and no credentials.

| Request | Limits |
|---|---|
| `GET https://api.github.com/repos/obalunenko/mergbw-controller/releases/latest` with `Accept: application/vnd.github+json` | 10 s timeout, 1 MiB response cap |
| `GET <browser_download_url>` of `SHA256SUMS` | 64 KiB cap |
| `GET <browser_download_url>` of the installer | 256 MiB cap, and no larger than the asset's `size` |

The owner and repository name are constants. The plugin reads only these
fields: `tag_name`, `html_url`, `body`, and `assets[].name`, `assets[].size`,
`assets[].browser_download_url`. A response that is malformed or too large
counts as a failed check, and the plugin keeps running.

### Schedule

- One check after `runtime.open` on plugin start, then at most one every 24 h
  (FR-006).
- `update.check` from the panel runs a check immediately, even when automatic
  checking is off (FR-010).
- When `autoCheck` is `false`, no timer-driven requests and no install prompts
  happen (US3-6, FR-007a).
- If a check is already running, a new one joins it.

### Offer decision

An offer is `available` only when all of these hold:

1. `tag_name` matches `vX.Y.Z` with no prerelease suffix. (`/releases/latest`
   already excludes drafts and prereleases.)
2. `(semver(tag_name), 0) > (semver(release.json tag), release.json build)`. A
   local build `1.2.0.7` is therefore offered `1.2.1`, but not `1.2.0`. Core parts compare
   numerically (`1.10.0 > 1.9.0`), a version beats its own prerelease
   (`1.3.0 > 1.3.0-rc.1`), and prerelease identifiers follow semver §11. A tag
   that does not parse is never newer.
3. The assets include both `com.obalunenko.mergbw.development.streamDeckPlugin`
   and `SHA256SUMS`.

When 1 and 2 hold but 3 does not, the panel shows only a release-page link,
with no Install button.

## 3. Global settings (schema 2, additive)

```ts
type GlobalSettings = {
  schemaVersion: 2;
  language: Language;
  updates?: { autoCheck: boolean; notifiedVersion?: string };
};
```

- `updates` is optional. When it is absent, the plugin uses
  `{ autoCheck: true }`. Existing schema-2 globals decode unchanged, and
  schema 1 migration is unchanged.
- `updates` accepts only the keys `autoCheck` and `notifiedVersion`.
  `notifiedVersion` must be a `vX.Y.Z` tag.
- Writes go through `settings.getUpdates` / `settings.saveUpdates` on the
  existing serial queue.
- "Later" (`dismissed`) and the result of the last check live in memory only
  and are cleared on restart (US3-3, R7).
- Stream Deck keeps global settings across plugin updates. Disk configuration,
  token, presets, assignments, language and custom icons are kept under 007
  rules (FR-012).

## 4. Install prompt (replaces the macOS notification, 2026-10-26)

- When a check finds an `available` offer and `autoCheck` is `true`, the
  plugin runs §5 for that tag on its own. Stream Deck shows its install
  confirmation; nothing installs without it (FR-007a, FR-008).
- At most once per tag per plugin start (kept in memory). After Cancel the
  next check returns to `available` and keeps the banner without reopening
  the prompt; a newer tag or a plugin restart prompts again.
- `updates.notifiedVersion` is still accepted in global settings for
  compatibility, but is no longer written.

## 5. Install hand-off

1. Fetch `SHA256SUMS` and find the installer line.
2. Stream the installer to
   `<os.tmpdir()>/mergbw-update/<tag>/com.obalunenko.mergbw.development.streamDeckPlugin.part`,
   hashing it with SHA-256 as it arrives.
3. If the hash matches, rename the file to drop `.part`, then run
   `execFile("/usr/bin/open", [path])`. Stream Deck shows its standard install
   confirmation. There is no silent install (FR-008).
4. On a mismatch, an oversize file or a download error: delete
   `<tmpdir>/mergbw-update/<tag>/`, never open the file, and go to `failed`
   with a category. `<tmpdir>/mergbw-update/` is also removed on the next
   plugin start.

## 6. Property Inspector messages

These use the existing envelope `{v:2, sessionId, requestId, type, payload}`
and validation: unknown payload keys are rejected with `validation`. The
following entries are appended to `messageTypes`:

| Type | Payload | Behaviour |
|---|---|---|
| `update.status` | empty | Return the snapshot with `update` |
| `update.check` | empty | Run a check now (joins one already running), then return the snapshot |
| `update.install` | `tag` (`vX.Y.Z`) | Allowed only when the offer state is `available`, `dismissed` or `handed` for that same `tag`; otherwise `validation`. `handed` re-opens the installer after a cancelled Stream Deck prompt. Starts §5. |
| `update.dismiss` | `tag` (`vX.Y.Z`) | "Later": hide the banner for that tag until restart. A newer tag shows the banner again. |
| `update.autoCheck` | `autoCheck` (boolean) | Save `updates.autoCheck`. `true` restarts the 24 h timer; `false` stops it. |

### Snapshot field

`InspectorSnapshot` gains this optional field:

```ts
update?: {
  state: "idle" | "checking" | "up_to_date" | "available" | "dismissed"
       | "downloading" | "handed" | "failed";
  installed: string;          // release.json tag
  latest?: string;            // tag_name of the latest stable release
  autoCheck: boolean;
  lastCheckedAt?: string;     // ISO 8601
  notes?: string;             // body, at most 2000 chars, shown as plain text only
  releaseUrl?: string;        // html_url, must start with https://github.com/obalunenko/mergbw-controller/
  installable?: boolean;      // installer and SHA256SUMS both present
  errorCategory?: UpdateErrorCategory;
};
```

- The panel renders `notes` with `textContent`, never as HTML (spec edge
  case). The banner appears on every MeRGBW action's panel when the state is
  `available`, `downloading` or `handed`, or when it is `failed` after an
  install attempt.
- Keys never get an update error or badge (FR-007, FR-009).

### `UpdateErrorCategory`

| Category | Meaning |
|---|---|
| `network` | DNS, connection or TLS failure, or timeout (check or download) |
| `rate_limited` | HTTP 403 or 429 from the API |
| `http` | Any other non-2xx status |
| `malformed` | Response is not JSON, is missing a field, has an unexpected URL, or exceeds 1 MiB |
| `no_asset` | A newer release has no installer or no `SHA256SUMS`; informational, the panel shows the release link |
| `size` | A download exceeds its cap or differs from the reported asset size |
| `checksum` | No `SHA256SUMS` line for the installer, or the hash differs |
| `open_failed` | `/usr/bin/open` returned an error |

In each case lamp control is unaffected, and the next timer tick or "Check
now" retries.

## 7. Controller launch blocked by quarantine

- New managed error category: `launch_blocked`, added to the
  `managed-controller.ts` and `diagnostics.ts` category lists.
- Trigger: a supervisor launch fails with `spawn_failed` or `startup_timeout`,
  and
  `execFile("/usr/bin/xattr", ["-p", "com.apple.quarantine", "<plugin>/controller/MeRGBW Controller.app"])`
  succeeds.
- The panel shows the one-time instruction (EN/RU) with the exact
  `xattr -dr com.apple.quarantine "<installed plugin directory>"` command and a
  pointer to **System Settings → Privacy & Security**. The plugin never removes
  the attribute itself.

## 8. Diagnostics events

| Event | Fields |
|---|---|
| `update.checked` | `installed`, `latest`, `result` (`up_to_date` \| `available` \| `dismissed` \| `no_asset`) |
| `update.failed` | `installed`, `phase` (`check` \| `install`), `errorCategory` (`UpdateErrorCategory`) |

These events carry no token, lamp identity, import paths, URLs with query
strings or notes text.

## Verification hooks

`UpdateService` takes injected `fetch`, `exec` (`execFile`), a clock and a
temporary root. Tests cover every decision, schedule, install prompt and
download row above with synthetic responses, without network, Stream Deck or
Bluetooth. The owner checks the installed behaviour by hand and records it in
`hardware-verification.md`. A successful install does not prove the lamp's
physical state.
