# Data model

**Home-use acceptance decision, 2026-10-24**: The owner explicitly stopped further manual qualification: «давай без душных проверок — это пока для домашнего пользования». The installed current-Mac home version is accepted using its executed software gates and recorded lamp/dial/transition observations. Additional permission, crash, sleep/wake, clean-user, installed fault-injection, picker/export and stress rounds are deferred, not passed, and no longer block this milestone. Existing runtime/safety requirements and automated tests are unchanged. Original broader definitions are preserved in [deferred-validation.md](deferred-validation.md). This decision supersedes earlier mandatory manual completion gates in these artifacts.


This is a design contract, not a claim that these structures exist in code. Formats used by the standalone CLI remain compatible.

## Acceptance evidence (documentation only)

**Scope update, 2026-10-24**: Personal development and local installation are the acceptance target. Developer ID, notarization, stapling, downloading an installer and quarantine testing are outside the required scope. Existing local ad-hoc helper signing stays credential-free. Universal packaging remains available; current-Mac linked fixtures are accepted for local checks. Preserve earlier results as historical evidence, not new observations.

Entries in `validation.md` and `hardware-verification.md` relate a task/scenario to the exact artifact and observation. They are documentation records, not application configuration, IPC fields or exported profile data.

| Field | Validation rule |
| --- | --- |
| Task / scenario | Stable task ID and requirement/story being checked |
| Artifact provenance | Source revision plus dirty-worktree status where applicable, artifact hash/build metadata and mode (`spike`, `development` or `distribution`); a revision alone does not identify uncommitted bytes |
| Host / scope | Apple Silicon or Intel, OS/Stream Deck versions, and scope: current-host fixture, universal artifact inspection, downloaded-installer execution or physical LT-06 observation |
| Outcome | `pass`, `fail` or `pending`, with actual observation or a missing prerequisite/reason; unknown effects remain explicitly unknown |
| Permission context | Observed responsible app and existing/new TCC grant; current macOS user permitted with working data preserved, separate test user optional |
| Physical observation | Command and actual visible effect/uncertainty when applicable; connection/write/build success alone is insufficient |

Compare retained settings/tokens locally and record equality only. Never record secrets, full command URLs or private hardware identifiers. Evidence for one architecture/build mode cannot complete another scope. T073 records local install/link, import, update and retention on the tested host. Downloading, quarantine, Developer ID and notarization are optional and do not block acceptance. T079 joins all required gates and remains pending while any prerequisite is incomplete. Revising the plan never changes an existing task checkbox or fabricates an observation.

## Persistent controller configuration

Root on Darwin: `os.UserConfigDir()/com.obalunenko.mergbw/`, independent of CWD, checkout, installed plugin and action profile. Production derives it from the current user; tests inject a temporary root.

```text
<root>/
  runtime.lock
  CURRENT.json
  generations/<generation>/settings.json
  generations/<generation>/presets.json
  staging/<transaction>/...
```

Directories are 0700; configuration, pointer, staging and lock files are 0600. No symlink escape, user-supplied generation path or executable/config path from a profile. Generation and transaction IDs are opaque random 32-character lowercase hex IDs, never an arbitrary filename/path. In-process session and launch IDs use the same representation. The advisory lock inode is stable and never unlinked as normal cleanup.

### ActivePointer v1

| Field | Type | Rule |
| --- | --- | --- |
| schemaVersion | integer | Exactly 1 |
| generation | string | One validated ID naming a complete generation |

Pointer is the only authority for the active pair. Missing pointer means not configured; malformed/unknown pointer or referenced damaged generation means configuration error, not an empty installation. A historical valid generation is retained until the new generation is confirmed usable; it is not activated automatically after a crash or failed command.

### Settings (existing format)

| Field | Rule |
| --- | --- |
| device_identity | Six hex bytes separated by colons; manual input trimmed and normalized uppercase using existing config rules; manufacturer-data identity, not discovered address |
| port | Integer 1024–65535; default 18765 |
| access_token | `[A-Za-z0-9_-]{24,128}`; first creation uses existing 24 random bytes/base64url generation; preserve existing/imported value |

### Preset catalog (existing format)

Nonempty map from stable slug `[a-z0-9_-]{1,40}` to `{label,rgb,brightness}`. Label has nonempty trimmed content and no CR/LF. RGB is exactly three integers 0–255. Brightness is required integer 0–100. Missing whole file can create defaults; missing stock keys never cause merging into an existing catalog.

An imported pair replaces the selected target pair after confirmation, not a fieldwise/catalog merge. If presets were not selected, preserve the current complete catalog; only use defaults when no target catalog exists. Sources are read-only, bounded regular files; a prepared proposal uses its captured contents even if the source later changes.

## ConfigurationProposal (transient)

Fields: `transactionId`, `ownerSession`, `expectedGeneration: ID|null`, `candidateGeneration: ID`, `expiresAt`, `candidateSettings`, `candidatePresets`, `changedFields`, `requiresConfirmation`. Candidate values are held privately by config/supervisor, never sent to the PI. The candidate generation ID is allocated once during prepare and returned to the backend privately so read-back can identify a lost apply confirmation; it is not a source path or a new token. Expiry is five minutes; changing PI session, active generation, cancellation or successful application invalidates it. One outstanding proposal per PI session; prepare creates a fresh token only for an actually new candidate, not on apply/reply retry.

Safe preview: transaction ID, expected generation, identity, port, preset count, hasToken, flags for identity/port/token/presets changes, interruption warning. Never raw token, raw imported JSON, source paths or command URLs. Repeated equal configuration is a no-op preserving generation and controller.

### Commit state

`prepared -> confirmed -> staged -> quiescing -> pointer_committed -> applied`.

Before pointer replacement, failure is `rejected` and the active pair is unchanged. Old worker may have stopped during quiescing; that is reported separately and is not a configuration rollback failure. `pointer_committed` cannot be reported as rejected merely because a reply/directory sync is lost: read back current pointer and classify `applied`, `not_applied` or `commit_unknown`. Launch failure after commit means saved configuration + failed controller. Do not automatically replay apply or regenerate credentials. No partial active pair is observable.

The backend retains a bounded private attempt record with transaction/expected/candidate IDs until outcome resolution. Read-back of the complete validated active pair determines `applied` for the candidate generation or `not_applied` for the unchanged expected generation; an equal-config no-op is reported as unchanged, not a failed save. An unreadable or unrelated generation leaves the attempted save `commit_unknown`. User labels are «Сохранено», «Не сохранено» and «Исход сохранения неизвестен». While authoritative active state cannot be read, block writes and lamp commands and offer a read-only configuration check. A successful authoritative reload can restore operation using that explicitly displayed active state even if the historical attempt remains unknown; never silently reapply it.

## Stream Deck persistence

| Entity | Schema and migration |
| --- | --- |
| Globals v1 (legacy) | `{schemaVersion:1, connection:{port,accessToken}|null, language}`; preserve raw source until disk commit, retain valid language |
| Globals v2 | `{schemaVersion:2, language:"en"|"ru"}`; no connection, identity, token, paths or generation authority |
| Existing action assignments v1 | Existing `{schemaVersion:1,rgb?,percent?,presetId?}` interpreted by the original five kinds; their UUIDs/allowed fields/host title-image/profile layout stay unchanged |
| Transition assignment v1 | Separate sixth kind: `{schemaVersion:1,fromRGB,fromPercent,toRGB,toPercent,durationSeconds}`; explicit endpoints and integer 1–60 seconds |

Current disk configuration wins over leftover v1 connection. After successful commit, write v2 globals idempotently. If that SDK write fails, preserve active disk config and retry cleanup on a later explicit/startup synchronization, never import the stale token over disk state. Unknown global versions remain unsupported without silent overwrite; invalid action assignments remain preserved but unusable until explicitly saved.

Manual migration may combine an explicitly entered identity with valid legacy port/token when there is no active disk config, with this preservation shown in preview. Full settings import wins after confirmation. A legacy link/connection alone cannot create an identity.

## Brightness Encoder session (transient)

The existing Brightness assignment remains `{schemaVersion:1,percent:0..100}`. A visible Encoder context has an epoch, saved-assignment revision, connection/capability revision, current target, at most one raw in-flight operation and at most one pending command (brightness target or explicit Off). Initialize the target from the assignment (default 50). Each signed integer tick adds one percentage point, clamped to 0–100. Runtime targets do not change the saved assignment and are not read-back physical state. Nonzero outward rotation reapplies a 0/100 boundary even if its displayed value is unchanged. Dial-down preserves the target and replaces queued brightness with Off; pending/in-flight Off coalesces repeated presses and takes priority over rotations until settlement. Appearance, dial-up and touch have no lighting effect. The strip value is a compact percentage for this transient target; a separate short localized title carries request status. It is not sensor readback.

Discard the epoch and unsent target on hiding, assignment/connection/capability change or loss of readiness. Any failed/uncertain command clears pending work, including Off, without retry. A completion from a discarded epoch cannot render feedback, restore a target or dispatch work. New physical rotation is a new explicit command; it never replays the earlier uncertain request. Keypad behavior remains unchanged.

## OwnedRuntime (transient)

Fields: `supervisorSession`, `configurationGeneration`, `launchId`, actual process handles, reserved listener(s), inherited lock, `state`, `errorCategory`, `leaseDeadline`, `lastWorkerEvent`, `connectionCapability` and revocation status. PIDs are diagnostic only and never persisted for killing/re-adoption.

States: `unconfigured`, `starting`, `ready`, `stopping`, `stopped`, `failed`, `cleanup_blocked`, with an orthogonal migration/configuration error. `ready` means own compatible HTTP runtime and verified authorization; Bluetooth remains `unknown|connected|disconnected`, with a separate optional `permission_denied`, `bluetooth_unavailable` or `backend_restart_required` error category. Physical state remains unverified.

A backend-only connection capability contains port/token and current session/generation/launch IDs plus an abort signal. It is issued after the private handshake and authenticated read. It expires on stop/apply/host lease failure/worker exit. Raw stored credentials alone never authorize plugin requests. Hold the listener while invalidation drains existing request transports; no foreign-port handoff window is permitted.

Explicit recovery distinguishes a live supervisor with a failed worker from an exited supervisor. In the second case the backend waits for old owned handles/transports to finish, creates at most one new BLE-free helper/session, and requires successful fixed-lock acquisition before any worker. Fresh host proof, authoritative config read and normal authorization precede worker readiness. A lock retained by an old worker means cleanup_blocked, not permission to adopt/kill it. No saved token or preset changes during recovery.

Host probing is owned by one backend-process-wide broker, not by a worker/helper session. It retains at most one unsettled SDK getGlobalSettings promise across timeouts and explicit restarts. A timeout does not cancel that SDK operation. Recovery can wait at most five seconds for the old probe to settle, discards its late result for lease renewal, and only then issues one fresh five-second probe. If it remains unsettled, report host_unavailable without issuing another SDK call or starting a new worker. Settled/cancelled local waiters are removed; repeated clicks are single-flight and cannot accumulate SDK listeners. New-session poll/lease IDs invalidate old replies; no private SDK access is needed.

## Operation and catalog bindings

Keep existing action revision and per-key operation semantics. Add runtime session/launch and configuration generation to pending commands and catalog/check observations. An old reply may finish bookkeeping for an unknown/sent command, but cannot mark a new runtime ready, repaint a new assignment or repopulate its catalog. Language changes do not rotate configuration/launch or replay a command. Process failure during a sent request produces unknown outcome; process readiness is never lamp state.

## Distribution metadata

Generated helper-payload metadata records source revision, supervisor/worker protocol version 1, bridge version, architecture slices, deployment minimum, build mode and exact file paths/hashes/modes. Production excludes all user configuration, private identifiers, logs and secrets. The package checker compares against trusted staged metadata and validates the final extracted payload; metadata is not a substitute for local artifact inspection or host execution. Apple Developer ID/notarization checks apply only to the optional explicit distribution mode.

Build mode distinguishes `spike`, `development` and `distribution`. `spike` is a current-architecture-only staged developer fixture for explicit owner-run linking with working data preserved; it is never a package/release mode. The other two modes require both architectures for complete installer checks.

## Smooth transition (2026-10-23)

Assignment v1 adds the separate transition kind with explicit fromRGB/fromPercent/toRGB/toPercent/durationSeconds (1–60). Existing assignments are unchanged. A controller process retains only one current/last transition snapshot, identified by a fresh 32-hex ID; snapshots contain state, elapsedMs/durationMs and physical_state_verified:false. Job lifetime is the worker root; no job is persisted or continued across restart. See contracts/transitions.md for terminal/uncertainty and new-command admission rules. Plugin operation outcomes add accepted for a validated 202 response; accepted is not sent or completed. Safe PI snapshots may include only the validated current-capability transition status.
