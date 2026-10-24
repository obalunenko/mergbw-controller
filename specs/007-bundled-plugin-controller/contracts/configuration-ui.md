# Configuration and Property Inspector contract

Related: [data model](../data-model.md), [runtime](managed-runtime.md). This replaces the external connection controls of spec 006 while preserving action settings and HTTP compatibility.

## Panel and messages

Use the existing session/context/request validation and EN/RU message-key scheme. New PI message envelope is `{v:2,sessionId,requestId,type,payload}`; unsupported v1 setup messages return `migration_required` and never activate an external endpoint. Action assignment storage remains schema v1, independent of PI wire version. No SDK auto-persistence on identity/import controls.

| Type | Allowed payload | Behavior |
| --- | --- | --- |
| inspector.get | empty | Return safe current snapshot |
| configuration.prepareManual | identity, expectedGeneration | Prepare candidate with current values; if none, valid legacy port/token or default port/new secret |
| configuration.prepareImport | settingsPath, optional presetsPath, expectedGeneration | Capture/validate selected source files read-only and prepare complete candidate |
| configuration.apply | transactionId, expectedGeneration, confirmed | Commit current session's proposal; changed existing data requires confirmed=true |
| configuration.cancel | transactionId | Discard this session's proposal |
| configuration.check | empty | Read back authoritative active configuration/outcome without writing or sending lamp commands |
| controller.restart | expectedGeneration | Restore own worker and, if exited, supervisor/session and host liveness; no old commands |
| connection.check | empty | Read-only readiness/auth/BLE check on own current runtime |
| presets.refresh | empty | Fetch own authenticated catalog, bound to generation/launch |
| assignment.save | settings | Existing kind-specific assignment validation |
| language.save | language | Persist language without changing controller/config generation |
| inspector.close | empty | Invalidate session/proposals, no controller lifetime change |

IDs keep the existing bounded allowlist. `expectedGeneration` is a validated opaque ID or null, never a path. `settingsPath`/`presetsPath` are transient absolute selected file paths, max 4096 UTF-8 bytes each; read regular files only, maximum 1 MiB per file, no file writes to sources, no executable selection. Invalid input, permissions, size or file type produce safe categories. The vendored file control has neither `setting` nor `global`; clear its value after prepare/cancel. Do not persist paths or raw contents in global/action settings or include them in replies/errors/logs. Preparation reads the pair once and retains the validated snapshot so confirmation cannot unexpectedly read changed files.

Use an initial Prepare/Review step. For first installation, the explicit Apply click initializes configuration. If existing values differ, preview shows changed identity/port/preset counts and secret-change boolean plus interruption warning; Confirm/Cancel are required. Never echo current/imported token. Repeated equal settings do not rotate token/generation or restart worker. New identity uses existing parser's six-HEX-byte manufacturer-data rule with help text, not Bluetooth discovery.

One proposal per PI session, five-minute expiry. Replaced/closed/expired proposals cannot be applied. Stale expected generation yields `stale_configuration`, not last-writer-wins. Repeat apply of an already applied transaction returns its original generation while session cache is valid. Lost reply after reconnect requires read-back instead of an automatic write.

## Supervisor configuration operations

PI requests are mapped by backend to the private supervisor protocol; source paths never reach HTTP. Canonical JSON parsing, defaults, normalization, token generation and generation transactions stay in `internal/config`, not a TypeScript copy. `configuration.read` returns safe summary plus port/token to the trusted backend over the private pipe only; it does not return full raw source files. No HTTP administration routes are added.

Apply is serialized with start/restart/stop; lifetime EOF/lease handling must remain independent of this queue:

1. Verify session/proposal/expiry/expected generation and confirmation. Resolve candidate's whole catalog using existing preservation/default rules. If equal to active, report no-op.
2. Fully stage both validated JSON files and sync them in an immutable generation on the same filesystem. A new-port candidate can reserve that port before disturbing the active worker; failure leaves active data and worker unchanged.
3. Revoke action admissions/capabilities and drain pending HTTP transports. Cancel old worker, wait/reap it, retaining old listener/lock. An unconfirmed exit aborts commit with cleanup-blocked; no new worker.
4. Recheck expected generation. Install the staged complete generation, sync containing directory, and atomically replace a temporary `CURRENT.json` in the same root with `os.Rename`. Sync pointer directory. No active settings/presets file is overwritten in place.
5. At a pre-rename failure the old pointer remains authoritative and rejection preserves old data. At a post-rename sync/reply failure read back the complete validated active pair; use `applied`, `not_applied` or `commit_unknown`, shown as «Сохранено», «Не сохранено» or «Исход сохранения неизвестен». Compare with the private expected/candidate IDs captured during prepare; equal-data no-op stays unchanged. Do not call a committed config rejected or automatically replay, roll back or generate a second token. If authoritative state is unreadable, block mutations and lamp commands and expose read-only configuration.check. An unrelated active generation leaves that attempt unknown; operation can resume only after successful authoritative reload and display of the current state, never by guessing the attempted result.
6. Read active generation, migrate globals, and launch that worker automatically after an explicitly applied configuration. A launch failure reports saved configuration + controller error. No automatic rollback or replay of lamp operations.
7. Retain the previous complete generation until the new one is confirmed ready. Garbage collection is limited to owned inactive staging/generations and never runs against import sources, active data or unrelated paths.

If a pre-commit failure occurs after old worker stopped, configuration remains old while runtime is stopped/failed; offer explicit restart. Normalization/defaults remain the current config rules; empty catalogs fail rather than receive defaults.

## Migration and persistence

Read globals v1 without altering action assignments. Without disk identity, show migration instead of using legacy endpoint. User can import full settings/presets, or enter identity and explicitly preserve valid legacy port/token in the preview. No automatic connection to verify old server. Explain that the old external `sunset` must be stopped; conflict never authorizes killing it.

After disk pointer commit, globals v2 contains language only. Cleanup is idempotent: if SDK save fails, disk is still authoritative on next startup and legacy connection is not imported over it. Unknown schemas and corrupt values are preserved with an error, never reset automatically. A profile imported elsewhere has assignments only and needs local lamp setup.

Safe snapshot fields:

- `configuration`: configured, generation?, identity?, port?, hasToken, migration status.
- `controller`: state, errorCategory?, canRestart, configurationGeneration?, launchId?.
- `proposal`: transactionId, expectedGeneration, identity, port, presetCount, hasToken, changedFields, requiresConfirmation, expiry.
- `saveOutcome`: transactionId, applied/not_applied/commit_unknown/unchanged, activeStateKnown and canCheck; no candidate credentials or generation path.
- existing language, assignment, operation summary, catalog and distinct service/auth/BLE check status.

Identity is displayed only for setup/review; no raw credential/path/full URL/native error in a snapshot. Backend-only credentials are stored outside this object. A provisional read-only connection may be used for health/catalog only after private owned-listener bootstrap; ordinary action capability appears only after authorization. Revocation aborts/destroys HTTP requests and waits for transport drain before acknowledging release of the old listener.

Worker's allowlisted private `worker.bluetooth` event can supply permission-denied/restart-required category while HTTP health retains its existing schema; do not infer those reasons solely from bluetooth_connected=false. An unknown reason stays unknown. Startup, check, import, restart and permission dialogs write zero lighting commands. Color/brightness/preset retain the existing also-turns-on behavior.

Restart is one backend single-flight recovery operation. If the supervisor still exists, use its ordinary owned-worker restart and keep the listener reservation. If it exited or its pipe was closed, confirm old-helper exit and HTTP drain, obtain fresh host proof through the process-wide probe broker, spawn one new helper/session and acquire the fixed lock before a worker; reload and validate expected active generation, then perform normal readiness/auth. A retained old-worker lock yields cleanup_blocked. A changed configuration yields stale_configuration instead of starting an old snapshot. Unsettled host probe yields host_unavailable without a second SDK call. The user does not need to restart the entire plugin for a recovered host/helper failure, but actual absent host/blocked cleanup stays an actionable failure with no automatic retry.

## Acceptance mapping

FR-003–009: canonical setup/import and transactional preservation. FR-010–013: owned runtime and all five action/UI behaviors. FR-017–021: explicit recovery, data retention and secrets. FR-024: no physical-state claim. Test file selection/confirmation manually in installed Chromium PI as well as synthetic tests; file-control documentation alone is not execution evidence.

## Stream Deck+ Brightness Encoder

The existing Brightness assignment and PI v2 messages are unchanged. The saved percent is an explicit initial target, default 50; it is not a physical reading. The panel explains that clockwise/counter-clockwise ticks change the current-session target by one percentage point within 0–100, that brightness commands also turn power on, and that dial targets are not persisted by rotation. Encoder `$B1` feedback uses title/status, target text and indicator. The current owner-directed contract adds dial-down Off; dial-up and touch stay inert. See the bounded command/Off rules below.

One visible context owns one pending HTTP operation and one latest coalesced target. Context/profile/assignment/connection/capability changes drop the unsent target; failure or uncertainty also drops it. A raw HTTP operation remains fenced until settlement even if local timeout or disappearance occurs. Fresh user input cannot create overlapping raw requests for the same context. No queued target is replayed on recovery. FR-029–030 and US6 define the software and owner hardware checks.

## Transition panel extension

A sixth Keypad action stores explicit fromRGB/fromPercent/toRGB/toPercent/durationSeconds, with integer duration 1–60. Its start result is accepted, distinct from sent or completed. PI v2 adds explicit read-only transition status and cancel-current-job requests using the active managed capability. Status is safe process-local metadata from contracts/transitions.md; late session/capability replies cannot repaint or cancel a new runtime. New valid lighting commands, including existing Brightness Encoder commands, cancel an active transition in the backend before executing. Panel field saves and read-only status never start or cancel a transition.

## Key feedback correction from owner observation

Pending commands, duplicate busy presses and reappearing busy keys do not use showAlert. Pending status remains in the inspector; key title/image overrides and busy guards stay unchanged. A validated sent result may show success, while invalid/rejected/unknown outcomes retain the alert. The owner observed a successful On accompanied by the previous immediate error overlay, so the old attention-as-pending choice from feature 006 is superseded.

## Owner-directed dial Off and boundary reapply

The owner now requests physical dial-down to send the existing Off command, preserving the dial target for a later turn. Dial-up and touch remain inert. Rotation uses existing brightness/On behavior and must reapply a clamped target even when the displayed number remains 100 (and symmetrically 0). A real boundary gesture queued behind an equal in-flight target may cause one bounded reapplication; ordinary non-boundary reversal back to the in-flight target stays deduplicated.

Retain one raw HTTP flight and at most one pending command per visible dial. An explicit press clears queued brightness and queues one Off behind any unsettled successful brightness flight. A pending/in-flight Off takes priority: repeated presses coalesce and rotation while Off is pending is ignored until it settles. A fresh turn after Off completion applies the preserved target and turns power on, including an outward turn at 100. Failure, uncertainty, timeout, disappearance, assignment/connection/capability changes discard pending work, including queued Off; no replay. A timed-out/obsolete raw request must settle before a new one starts. Use exact off route through the existing owned capability/client; never infer lamp power from a local boolean.

Feedback distinguishes Off pending/sent from brightness targets on EN/RU and keeps physical state unverified. Keypad Brightness, UUID, user settings/appearance, worker/HTTP/BLE ownership and transition cancellation stay on existing paths. Add no new server endpoint, BLE interface, process or persistent setting. Software tests use synthetic SDK events and fake HTTP replies only. Actual Off/upper-limit reactivation is an installed owner observation.

## Numeric dial display

The built-in B1 value item shows only the dial's numeric command target, such as 75%, or a dash for an invalid assignment. Use supported Text feedback styling to make the percentage prominent; keep a short localized status in the separate title. Sending/Off/error/unavailable remain distinguishable without long technical text competing with the percentage. The numeric target remains available after Off for the next turn and is never claimed as measured lamp brightness. No new poll or lighting command is triggered by formatting. A shared last-command value across all plugin actions is a separate source preference, not inferred hardware readback.
