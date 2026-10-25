# Preset effects contracts

These contracts extend the existing preset action, private management channel and loopback HTTP bridge. Existing static preset files, action assignments, catalog responses and finite transition routes retain their behavior. The specification pins no additional literal identifiers; the names below are design choices for implementation and tests.

## Stored preset definition

The catalog remains an object keyed by stable IDs matching `[a-z0-9_-]{1,40}`. Each entry retains `label`, `rgb` and `brightness`. `rgb` is three integer channels from 0 through 255; `brightness` is an integer from 0 through 100. Omitting `effect` defines a static preset. `effect: null`, unknown effect kinds and unknown effect fields are invalid.

```json
{
  "evening_colors": {
    "label": "Evening colors",
    "rgb": [255, 80, 0],
    "brightness": 75,
    "effect": {
      "kind": "palette",
      "colors": [[0, 80, 255], [160, 0, 255]],
      "transitionMs": 2000,
      "loop": true
    }
  }
}
```

Root RGB is the first palette color or the fixed color of another kind. Root brightness is the palette/strobe level, breathing peak or candle base. The editor displays root RGB and `effect.colors` as one ordered palette. No duplicate first-color or peak-brightness field is stored.

| `effect.kind` | Exact additional fields | Validation |
| --- | --- | --- |
| `palette` | `colors`, `transitionMs`, `loop` | `colors` contains 1–15 additional RGB triples, giving 2–16 total colors. `transitionMs` is an integer 500–60000. `loop` is boolean. |
| `strobe` | `onMs`, `offMs`, `loop` | Both intervals are integers 250–60000. `loop` is boolean. |
| `breathing` | `minBrightness`, `cycleMs`, `loop` | Root brightness is 1–100. Integer `minBrightness` is 0–99 and below root brightness. Integer `cycleMs` is 1000–120000. `loop` is boolean. |
| `candle` | `depth`, `flickerMs`, `loop`, finite-only `durationMs` | Integer `depth` is 0–100 percent of root brightness. Integer `flickerMs` is 250–5000. `loop` is boolean. When false, integer `durationMs` is required and is 1000–3600000; when true, omit `durationMs`. |

New or edited labels contain 1–128 Unicode code points, include non-whitespace text and contain no control characters or line separators. Existing valid imported catalogs retain their existing label/import size rules; unrelated legacy entries are never truncated or normalized during an edit.

Palette once ends at the last color; looping includes the smooth last-to-first segment. Strobe once is one On/Off cycle ending Off. Breathing once runs minimum-to-peak-to-minimum. Candle uses irregular brightness targets from `base * (1-depth/100)` through base, preserving RGB. Timing is nominal and may stretch with synchronous BLE writes.

## HTTP execution

All routes below are relative to `/{accessToken}/` on the existing IPv4 loopback bridge. Preserve Host validation, constant-time token checks, no query/body/encoded-route additions, no redirects and existing safe logging. HEAD never starts, stops or reads through a lighting command handler. The existing `GET presets` response remains sorted `{id,label}` entries with `physical_state_verified:false`.

| Method | Route | Result |
| --- | --- | --- |
| GET or POST | `preset/<id>` for a static entry | Existing 200 `{ "sent": true, "action": "preset/<id>", "physical_state_verified": false }`. |
| GET or POST | `preset/<id>` for a dynamic entry | 202 `{ "accepted": true, "action": "preset/<id>", "effect": <snapshot>, "physical_state_verified": false }`. |
| GET | `effect` | 200 `{ "effect": <snapshot-or-null>, "physical_state_verified": false }`. |
| POST | `effect/cancel/<runId>` | 200 `{ "effect": <matching-snapshot>, "physical_state_verified": false }` when cancellation is acknowledged. |

The effect status route exposes the retained latest effect run in this controller lifetime, including its terminal outcome. It returns null when no effect run is available. The controller retains at most one latest effect snapshot and one latest transition snapshot while executing at most one shared active job. A finite transition is never represented as an effect. Status reads send zero BLE packets.

An effect snapshot has exactly these fields:

```json
{
  "id": "0123456789abcdef0123456789abcdef",
  "presetId": "evening_colors",
  "kind": "palette",
  "state": "running",
  "elapsedMs": 0,
  "durationMs": null,
  "physical_state_verified": false
}
```

`id` is an opaque 32-character lowercase hexadecimal run ID. `presetId` is the stable catalog ID. `kind` is one of the four effect tags. `state` is `running`, `cancelling`, `completed`, `cancelled`, `failed` or `unknown`. `elapsedMs` is a nonnegative safe integer. `durationMs` is null for looping effects; for finite effects it is the nominal duration: adjacent-pair count times `transitionMs`, `onMs + offMs`, `cycleMs`, or candle `durationMs`. Actual elapsed time may exceed nominal duration after slow writes, so validation does not require `elapsedMs <= durationMs`.

202 proves admission, not completion or a physical lamp state. The admitted job belongs to the controller root lifetime, not the HTTP request lifetime. Starting a valid replacement cancels/drains the previous transition or effect through the shared admission gate. Invalid requests do not interrupt it. There is one active job across both APIs.

Cancellation validates the exact run ID before dispatch. An ID not matching the latest effect returns 404 and never cancels a replacement. A matching latest terminal effect can return that terminal snapshot without touching a newer active transition. For an active effect, cancellation waits for the job and native operation to drain before returning 200; concurrent status may report `cancelling`. Cancellation leaves the last commanded light state; Off remains the explicit power-off command. Timeout returns 504 with an uncertain outcome; backend failure returns 503 without claiming that no physical write occurred. Invalid parameters return 400, failed authorization 403 and unsupported methods 405, following existing bridge conventions.

The existing transition response and its finite snapshot validator remain unchanged. Effect response validation is separate and exact; a malformed or mismatched 200/202 receipt becomes unknown rather than success. Neither client nor server replays an uncertain lighting command.

## Private management editor operations

Use the existing v1 control frame `{v,session,requestId,type,payload}` and result/error envelope. Frames remain bounded to 64 KiB. Each new operation uses the current `ownerSession` and `expectedGeneration`, validates field allowlists, and returns safe error categories without raw paths, tokens or whole configuration contents. These operations require an existing configured catalog and never turn on the lamp.

### `configuration.presetList`

Request payload: `{ownerSession, expectedGeneration, cursor?}`. `cursor` is the last stable ID from the preceding page, not an offset. Omit it for the first page.

Result data: `{generation, entries, nextCursor}`. Each entry is exactly `{id,label,labelTruncated}`. IDs are sorted; pages contain at most 50 entries and at most 32 KiB of serialized JSON. Labels are safe previews of at most 128 Unicode code points; `labelTruncated` explicitly identifies a preview. `nextCursor` is the last returned ID when another page remains, otherwise null. Preview truncation never alters stored labels.

Every page must match `expectedGeneration`; a cursor cannot continue into another generation. A stale page/read returns `stale_configuration`, and the editor reloads explicitly rather than merging generations.

### `configuration.presetRead`

Request payload: `{ownerSession, expectedGeneration, id}`.

Result data: `{generation,id,preset}`, containing one complete definition. A definition exceeding the 32 KiB editor response budget returns `preset_too_large`; it is not truncated or overwritten. Oversized legacy entries remain executable and preserved through imports and unrelated edits. An absent ID returns `preset_not_found`.

### `configuration.preparePreset`

Request payload: `{ownerSession, expectedGeneration, operation, id, preset?}`.

| `operation` | Presence of `preset` | Preconditions |
| --- | --- | --- |
| `create` | Required | `id` must not already exist; a duplicate returns `preset_exists`. |
| `update` | Required | `id` must already exist; rename changes `preset.label`, retaining this ID. |
| `delete` | Forbidden | `id` must already exist; deleting the final entry fails whole-catalog validation. |

The supervisor deep-copies the active catalog, applies this one mutation, validates the complete result and preserves current settings/identity/port/token unchanged. It then uses `PrepareProposal`, returning the existing captured proposal shape: `{transactionId,candidateGeneration,expectedGeneration,identity,port,hasToken,presetCount,changed,requiresConfirmation,diff,changedFields,expiresAt}`. `diff.presets` identifies a changed catalog; other settings differences remain false. `changedFields` retains the existing alias of `diff`. Proposal owner, expiry and stale-generation rules are unchanged.

`configuration.apply`, `configuration.cancel` and read-only configuration checking retain their existing payloads and save outcomes: `applied`, `not_applied`, `commit_unknown`, `unchanged`. Changed Apply revokes/drains capabilities, stops/reaps the old worker, commits atomically and starts the new runtime. It does not resume any prior effect. Unchanged Apply does not restart. Unknown confirmation is reconciled read-only, without replaying Apply.

`preset_exists`, `preset_not_found` and `preset_too_large` are added to the safe management error allowlists and EN/RU messages. Other validation, storage, stale and unknown outcomes reuse existing categories.

## PI v2 messages and visible behavior

Keep the existing `com.obalunenko.mergbw.preset` action UUID and exported `{presetId}` assignment. The following PI messages use the current envelope `{v:2,sessionId,requestId,type,payload}`, exact payload allowlists and existing session/deduplication rules. The backend supplies `ownerSession` from the PI session instead of trusting an arbitrary UI owner.

| Message `type` | Payload |
| --- | --- |
| `configuration.presetList` | `{expectedGeneration,cursor?}` |
| `configuration.presetRead` | `{expectedGeneration,id}` |
| `configuration.preparePreset` | `{expectedGeneration,operation,id,preset?}` |
| `effect.status` | `{}` |
| `effect.cancel` | `{id}` |

Reuse `configuration.apply`, `configuration.cancel` and `configuration.check` for proposal review and outcome reconciliation. PI snapshots may add `presetPage`, `presetDefinition`, `presetEditorError`, `effect`, `effectError` and `effectPending`, containing only validated safe editor/run data. Proposal snapshots continue to omit private candidate-generation/owner details; credentials never enter PI or exported action settings. Reply snapshots are fenced by current session, request, configuration generation and runtime capability. Existing safe-text redaction applies to user labels and IDs.

The Preset inspector adds New/Edit/Delete, name/type selection and only the selected kind's fields. New creates an ID once; editing a name never regenerates it. A delete review names the entry, and existing assignments to it become visibly unavailable rather than selecting a replacement. Duplicate labels remain disambiguated by ID. A new or edited definition is captured before review; later draft changes do not mutate that proposal.

Save review visibly states that changed data stops the current effect and restarts the controller. Opening, reading, editing, discarding, saving and checking the catalog send no lighting commands. Unknown save outcome blocks further writes until read-only resolution. Preset definition changes do not automatically assign or start that preset.

## Key ownership and stop behavior

A trusted 202 receipt creates an ephemeral ownership record bound to key context, assignment revision, preset ID, exact run ID and current runtime capability. Preserve it across disappearance/reappearance of the same context, independently of visibility-limited operation receipts. Clear it after assignment/runtime change, another lighting admission or a different admitted job. Never persist/export it.

The first explicit key press starts the selected preset. Before a repeat press stops an owned run, read status and require the same current active run ID. Cancel only that ID. If the owned run is terminal, the explicit press can start a new run. A failed, stale or mismatched read does not trigger speculative cancellation or a replacement start. Duplicate pending presses remain coalesced by the existing action guard.

Unknown admission creates no trusted ownership. The next explicit key press checks effect status; a matching active effect with uncertain ownership presents its status and an explicit Stop choice instead of blindly launching another run. `effect.cancel` from the inspector requires a current validated snapshot ID, like existing exact-ID transition cancellation. A stale inspector cannot cancel a newer run.

UI states distinguish accepted, running, cancelling and terminal completed/cancelled/failed/unknown outcomes in EN/RU. Loops show elapsed time without invented completion percentages. Status is commanded lifecycle, always with `physical_state_verified:false`. Ordinary keys and dial rotation interrupt the job before their own complete action; the existing dial press sends Off. Host/controller exit cancels future steps without extra Off or automatic restart playback.
