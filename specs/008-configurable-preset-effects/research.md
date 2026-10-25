# Research decisions

## One controller-owned job

**Decision:** Generalize the internal active-job slot shared by transitions and effects. Keep the finite transition API and snapshot unchanged through an adapter. Add a separate effect snapshot and status/cancel API. Retain only the latest transition and latest effect snapshot for status, including their terminal outcomes, beside the single shared active-job reference. There is no unbounded run history.

**Rationale:** Existing admission, root cancellation and gate draining prevent interleaved writes. Looping jobs have no finite progress percentage and cannot satisfy the existing 1–60-second transition snapshot validator. Validate replacement commands before cancelling the previous job. Retain admission until the replacement is published.

**Alternatives considered:** Independent timers in the plugin would lose ownership on panel/profile changes. Starting one transition per palette segment would create cancellation races. Weakening the existing transition snapshot would break compatibility.

## Compatible preset definitions

**Decision:** Retain the required legacy fields `label`, `rgb`, `brightness`; add optional `effect`. Absence means static. The effect is a tagged object with `kind` equal to `palette`, `strobe`, `breathing` or `candle`. Root RGB is the first palette color or the fixed base color; root brightness is the palette/strobe level, breathing peak or candle base. For palette, `effect.colors` contains the remaining colors after root RGB. The editor presents one combined ordered palette.

**Rationale:** Existing JSON, static command resolution, zero brightness, stable slug IDs and imported catalogs remain valid without rewriting unrelated entries. This avoids duplicate initial colors or brightness values. Extend `DecodePresets` deliberately; it currently reconstructs only static fields. Deep-copy every nested effect value in imports and proposals.

**Alternatives considered:** Replacing the catalog schema would require migration. A separate effect catalog would split assignment and persistence rules. Storing duplicate first-color or peak-brightness fields would create conflicting values.

## Timing, bounds and defaults

**Decision:** Use integer milliseconds, nominal 250 ms smooth sampling, the existing 80 ms packet gap and scheduling from the current time after slow writes. Never burst overdue samples. Hold every explicit endpoint before advancing the next phase. Candle targets use injected test randomness; production uses the standard library without a new dependency.

| Kind | Parameters and bounds | Initial values |
| --- | --- | --- |
| Palette | 2–16 total colors; each RGB channel 0–255; brightness 0–100; `transitionMs` 500–60000 per adjacent pair; `loop` boolean | Orange → blue → purple; brightness 75; 2000 ms; loop true |
| Strobe | Fixed RGB/brightness; `onMs` and `offMs` each 250–60000; `loop` boolean | White; brightness 75; 500/500 ms; loop true |
| Breathing | Fixed RGB; root brightness 1–100 is peak; `minBrightness` 0–99 below peak; `cycleMs` 1000–120000; `loop` boolean | Orange; peak 75; minimum 5; 4000 ms; loop true |
| Candle | Fixed editable warm RGB; base brightness 0–100; `depth` 0–100 percent of base; `flickerMs` 250–5000; `loop` boolean; finite `durationMs` 1000–3600000 when loop false | FFB040; base 65; depth 35; 500 ms; loop true; finite default 30000 ms |

Palette once starts at root RGB and ends at the last listed color; looping includes last-to-first interpolation. Strobe once is one complete On/Off cycle and ends Off. Breathing once is lower-to-peak-to-lower. Candle chooses nonuniform bounded targets between `base * (1-depth/100)` and base, interpolates to them and stops at its finite deadline when selected. All timing is nominal and may stretch with BLE writes; no precision-frequency claim.

**Alternatives considered:** Fast unrestricted strobe timing exceeds the transport's behavior. A precomputed infinite sequence wastes memory. Catch-up writes can make physical timing worse and block interruption.

## Editing and frame limits

**Decision:** Add `configuration.presetList`, `configuration.presetRead` and `configuration.preparePreset` to the existing private management protocol. Prepare accepts `{ownerSession, expectedGeneration, operation, id, preset?}`, with `operation` equal to `create`, `update` or `delete`. Create rejects an existing ID; update/delete require an existing ID; delete omits `preset`. The supervisor merges the mutation into a deep copy of the active catalog, preserves settings exactly and calls `PrepareProposal`. Apply/Cancel/Check remain unchanged.

**Rationale:** Catalog files allow 1 MiB while control frames allow 64 KiB. Sending an entire existing catalog through the editor would regress valid configurations. List pages contain at most 50 ID/label summaries, bounded to 32 KiB with label previews of at most 128 Unicode code points and explicit truncation. A read returns one definition or a safe `preset_too_large` error when it exceeds 32 KiB. New editor definitions use 1–128-code-point single-line labels and the bounded effect shape. Oversized legacy entries remain preserved and executable through existing routes; editing reports the limit without truncating or overwriting their definitions. File-import limits remain unchanged.

List/read carry owner session and expected generation; cursors are the last sorted stable ID and cannot cross generations. List returns `{generation, entries:[{id,label,labelTruncated}], nextCursor}` and read returns `{generation,id,preset}`. Final-entry deletion is rejected by existing nonempty-catalog validation. IDs match the existing `[a-z0-9_-]{1,40}` rule. The editor generates/checks a new slug once and retains it on rename; duplicates are rejected rather than replacing another entry.

**Alternatives considered:** Whole-catalog PI messages cannot preserve current size limits. Direct file writes bypass stale-generation and commit-outcome handling. Hot reload would enlarge this feature and weaken the established replacement barrier.

## Run ownership and repeat press

**Decision:** Keep `preset/<id>` for both kinds: static returns the existing 200 sent receipt; dynamic returns 202 with an effect run snapshot. Add authenticated `GET effect` and `POST effect/cancel/<runId>`. A snapshot has `id`, `presetId`, `kind`, `state`, `elapsedMs`, nullable `durationMs`, and `physical_state_verified:false`; loop duration is null. Finite duration is nominal, and elapsed time may exceed it after slow writes. States match transition lifecycle: running, cancelling, completed, cancelled, failed, unknown.

**Rationale:** The action can identify dynamic admission from its receipt without changing the old ID/label catalog. Store an ephemeral owner record outside visibility-limited OperationStore records, bound to key context, assignment revision, preset ID and current runtime capability. Preserve it across disappear/reappear of the same context; clear it on assignment/runtime change, ordinary lighting admission or a different admitted job. Never export/persist run IDs. Before repeat-press cancellation, read status and cancel only the matching active owned run. If it completed, start a new run. A read failure or mismatched/stale response does not trigger speculative start/stop or retry.

Unknown admission creates no trusted ownership. Its next key press checks the current effect; a matching active effect with unknown ownership produces an explicit status/stop choice rather than blindly creating a duplicate. A key with no prior admission ambiguity starts its selected effect and replaces any previous job normally. Status is commanded lifecycle, not physical light verification. Returning HTTP 202 releases the request but does not cancel the controller-root job.

**Alternatives considered:** A local running boolean becomes stale after ordinary commands or restart. Cancelling whichever ID happens to be current can stop another button's newer effect. Polling forever on every key is unnecessary; read on repeat press, appearance or explicit status action, plus existing admission invalidation.

## UI and save outcomes

**Decision:** Add New/Edit/Delete and type-specific fields in the Preset inspector. Draft and read operations send no lighting commands. Reuse captured review/apply and read-only uncertain-save reconciliation, with a visible notice that applying changed presets stops the current effect and restarts the controller. Unchanged save does not restart. Static assignments remain `{presetId}`.

**Rationale:** The existing managed path already preserves settings/token and rejects stale panels. UI messages require exact allowlists, session ownership, deduplication, safe snapshots and EN/RU text. A lost confirmation must not replay a save or effect. Stop preserves the last commanded state; the existing Off key and dial press explicitly turn off.

**Alternatives considered:** Automatic playback after save or preview contradicts the request's existing control model. A second editor application or separate actions per effect are unnecessary.

## Verification boundary

**Decision:** Use deterministic sampling tests, mocked link lifecycle tests, temporary generation stores, HTTP method/auth/response fixtures and PI/action tests. Preserve the software and short owner-observation home-use scope accepted for feature 007.

**Rationale:** The native transport and TCC launch architecture do not change. Code checks can establish sequencing, stale fencing and data preservation; they cannot prove the physical waveform. Build/inspect a fresh payload, then use the established local installation backup procedure when implementation is ready.

**Alternatives considered:** A new full signing, permission, crash, sleep or multi-machine qualification series is outside the accepted home-use scope.

## Planning tool fallback

`plan-blocks.py calls states screens` cannot load the installed `call-paths.md` grammar; no grammar resources exist in this checkout. The plan therefore documents equivalent call paths, state-to-screen links and screen sketches directly. This is a planning-tool packaging limitation, not an application change.
