# Data model: configurable preset effects

The active configuration generation owns the preset catalog. Saved definitions are independent of ephemeral runs: editing, reading and restarting never start playback.

## Preset catalog and entry

The existing catalog remains an object keyed by stable preset ID. Each entry retains its legacy fields and may add one effect definition.

| Field | Meaning and validation |
| --- | --- |
| Catalog key | Stable ID matching `[a-z0-9_-]{1,40}`. Creating an existing ID is rejected; renaming a label retains the key. |
| `label` | Existing nonempty, single-line name. New editor values contain 1–128 Unicode code points. Larger valid legacy names are preserved. |
| `rgb` | Exactly three integer channels, each 0–255. The initial palette color or the fixed base color. |
| `brightness` | Integer 0–100. Static/palette/strobe level, breathing peak, or candle base. Breathing requires a peak of at least 1. |
| `effect` | Optional tagged definition. Absent means the existing static preset behavior. |

The catalog remains nonempty and keeps the existing file-import size limit of 1 MiB. Validate every entry before committing a changed catalog. A failed edit preserves the entire active generation. Changing one entry must not normalize, truncate or remove unrelated legacy entries.

A static preset still emits On, RGB and brightness. An effect preset resolves to a validated effect action with a captured definition; it must not fall through to an empty ordinary packet sequence.

## Effect definitions

`effect.kind` is one of `palette`, `strobe`, `breathing` or `candle`. Each kind accepts its own bounded fields and rejects malformed or unrelated effect parameters. All effects have a boolean `loop`; finite runs and loops remain distinguishable without inferred defaults at execution time. The editor supplies the initial values below.

### Palette

| Field | Validation | Initial value |
| --- | --- | --- |
| `kind` | `palette` | `palette` |
| `colors` | 1–15 additional RGB triplets after root `rgb`, giving 2–16 total colors | Blue, purple after an orange root |
| `transitionMs` | Integer 500–60000 per adjacent pair | 2000 |
| `loop` | Boolean | `true` |

Root brightness initially equals 75. The editor displays root `rgb` and `colors` as one ordered palette. One pass has `N - 1` transitions for `N` colors and ends at the final color. A loop adds the final-to-first transition without an abrupt color reset.

### Strobe

| Field | Validation | Initial value |
| --- | --- | --- |
| `kind` | `strobe` | `strobe` |
| `onMs` | Integer 250–60000 | 500 |
| `offMs` | Integer 250–60000 | 500 |
| `loop` | Boolean | `true` |

Root RGB initially equals white and brightness equals 75. One cycle applies the selected light, holds the On phase, applies Off and holds the Off phase. A finite cycle completes Off; stopping a loop preserves whichever phase was last commanded.

### Breathing

| Field | Validation | Initial value |
| --- | --- | --- |
| `kind` | `breathing` | `breathing` |
| `minBrightness` | Integer 0–99, strictly below root `brightness` | 5 |
| `cycleMs` | Integer 1000–120000 for a complete rise and fall | 4000 |
| `loop` | Boolean | `true` |

Root RGB initially equals orange and peak brightness equals 75. RGB stays fixed. The complete cycle rises from minimum to peak and returns to minimum. A finite run ends at minimum, including an explicit zero-brightness endpoint when selected; it does not add an Off command.

### Candle

| Field | Validation | Initial value |
| --- | --- | --- |
| `kind` | `candle` | `candle` |
| `depth` | Integer 0–100, percentage of base brightness available for downward flicker | 35 |
| `flickerMs` | Integer 250–5000 between bounded flicker targets | 500 |
| `loop` | Boolean | `true` |
| `durationMs` | Integer 1000–3600000, required for finite mode; a loop has no execution deadline | Finite-mode default 30000 |

Root RGB initially equals `FFB040` and base brightness equals 65. The user can edit the base RGB; warm color is a default, not a color restriction. Random targets remain between `base * (1 - depth / 100)` and base, rounded to valid integer brightness and clamped to 0–100. The run interpolates to successive targets at fixed RGB. Zero base or zero depth is valid and need not create redundant writes. Finite playback stops at its deadline without restoring another value.

All intervals are nominal. Smooth sampling uses 250 ms updates and the existing packet gap; slow writes can stretch actual timing. Endpoint writes are serialized and are not skipped by advancing to another phase. No overdue burst is generated.

## Editor read models

The management surface exposes definitions without settings, lamp identity, access tokens or command URLs.

| Entity | Fields and constraints |
| --- | --- |
| Catalog page | `{generation, entries, nextCursor}`; at most 50 sorted summaries and a cursor identifying the last returned ID. The page is bounded to 32 KiB. |
| Label summary | `{id, label, labelTruncated}`; stable ID, label preview limited to 128 Unicode code points and an explicit truncation flag. A preview is not an editable full definition. |
| Preset read | `{generation, id, preset}`; stable ID and one complete entry bounded to 32 KiB. Oversized legacy entries produce safe `preset_too_large` rather than partial data. |
| Local draft | Generation observed on read, operation, stable ID and editable definition. Exists only in inspector memory until reviewed. |

List cursors are generation-bound. A page or read from another generation cannot be merged into the current draft. Oversized legacy entries remain preserved and executable; editing them reports the limit without rewriting their data. Reading pages or definitions does not touch BLE.

## Edit proposal and configuration generation

`configuration.preparePreset` accepts `{ownerSession, expectedGeneration, operation, id, preset?}` and produces the existing captured proposal. `operation` is `create`, `update` or `delete`. Create rejects existing IDs; update and delete require an existing entry. Create/update carry the complete `preset`; delete omits it. A conflicting create cannot overwrite another entry.

The supervisor reads the active pair, deep-copies its complete catalog, applies one mutation and validates the resulting catalog. Settings, identity and secret remain the exact active values. The existing `PrepareProposal`/Apply transaction stages the full pair, revokes and drains the old runtime, waits for worker cleanup, commits atomically and starts the configured replacement. An unchanged proposal does not restart it.

Nested `effect` objects and palette colors require deep copies at import, proposal and run boundaries. An inspector draft or later catalog edit cannot mutate the accepted run's captured parameters.

| Save state | Transition |
| --- | --- |
| Draft | Review captures a validated proposal against the observed generation. Invalid or stale input leaves the active generation unchanged. |
| Review | Apply submits that captured proposal once. Back/Cancel discards it without lighting commands. |
| Saving | Existing configuration transaction applies; the UI shows that changed saves stop effects and restart the controller. |
| Saved | Authoritative read confirms the new generation. Refresh the catalog; do not start playback. |
| Not saved | Authoritative read confirms the prior generation. Retain the draft/error for deliberate correction. |
| Outcome unknown | Block further mutation/lighting until the existing read-only outcome check resolves uncertainty. Never replay Apply automatically. |

Deleting the last entry fails nonempty-catalog validation. Deleting an assigned entry keeps the action's saved ID visibly unavailable; it never substitutes another preset. Renaming keeps assignments intact.

## Effect action and active run

An effect action captures its preset ID and a deep copy of the validated definition. Admission owns one shared slot for transitions and effects. It validates before cancelling the prior job, waits for its gate, publishes a root-owned run and returns acceptance without waiting for completion.

| Snapshot field | Meaning |
| --- | --- |
| `id` | Opaque ID unique to this admitted run. |
| `presetId` | Stable catalog ID used at admission. |
| `kind` | One of the four effect tags. |
| `state` | `running`, `cancelling`, `completed`, `cancelled`, `failed` or `unknown`. |
| `elapsedMs` | Nonnegative commanded execution elapsed time; may exceed nominal duration after slow writes. Loops do not fabricate a finite completion percentage. |
| `durationMs` | Nominal finite duration, or `null` for a loop. |
| `physical_state_verified` | Always `false`. |

Finite nominal duration is `(N - 1) * transitionMs` for palette, `onMs + offMs` for strobe, `cycleMs` for breathing and `durationMs` for candle. Setup, packet gaps and slow native operations may stretch physical timing. A snapshot reports job lifecycle, not readback.

The existing finite `TransitionSnapshot` and 1–60-second transition contract remain unchanged through an adapter over the shared internal active-job lifecycle. Keep only the latest transition and latest effect snapshots, including terminal outcomes, beside the single active-job reference. Status has no unbounded history; cancelling an already terminal matching effect does not affect a newer transition.

| Run state | Transition |
| --- | --- |
| Running | Sampling produces serialized changed packets until completion, cancellation or error. |
| Cancelling | Exact-ID stop, a valid replacement command or root shutdown prevents further steps and drains any started native operation. |
| Completed | A finite run reaches its defined endpoint/deadline. No automatic replay. |
| Cancelled | Cancellation finishes without an uncertain write. Last commanded light remains. |
| Failed | Execution fails before an uncertain physical write, such as connection failure. No automatic replay. |
| Unknown | A write's outcome is uncertain. No remaining steps or retry. |

Ordinary Off, colors, static presets, brightness, dial changes and explicit transitions use the same admission boundary. A new command cannot interleave with the old native write. Invalid replacement input does not cancel the current run. Runtime shutdown never sends a compensating Off or restores an effect after restart.

## Key ownership record

A separate in-memory record associates an accepted run ID with key context, assignment revision, preset ID and current runtime capability. It is not an exported action setting, a persisted global or a lamp-state flag. It survives disappearance/reappearance of the same context, while assignment/runtime changes, a newer lighting admission or a different admitted job invalidate it.

On repeat press, read the current effect and cancel only a matching active owned run. If that run has completed, the explicit press can start a new run. A stale, mismatched or failed status response does not authorize a speculative cancellation or start. An ambiguous start receipt grants no trusted ownership; matching active status then requires an explicit status/stop choice instead of silently duplicating the effect. Keys without prior admission ambiguity start their selected preset normally and replace the prior job.
