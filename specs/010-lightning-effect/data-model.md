# Data model: lightning effect

This feature adds a fifth tagged effect definition to the existing preset catalog. Catalog entries, editor read models, the save transaction, the active run snapshot and key ownership keep the contracts of feature 008. Existing presets and effects decode and run unchanged.

## Preset entry

A lightning preset is an ordinary catalog entry whose `effect.kind` is `lightning`. The root fields keep their meaning and gain a lightning role.

| Field | Meaning and validation |
| --- | --- |
| `rgb` | Flash color. Exactly three integer channels, each 0–255. |
| `brightness` | Flash brightness, integer 1–100. Zero makes the effect invalid, as for breathing. |
| `effect` | Lightning definition below. |

## Lightning definition

| Field | Validation | Initial value |
| --- | --- | --- |
| `kind` | `lightning` | `lightning` |
| `loop` | Boolean | `true` |
| `backgroundRgb` | Exactly three integer channels, each 0–255 | Dark blue |
| `backgroundBrightness` | Integer 0 to root `brightness - 1` | 15 |
| `minPauseMs` | Integer 500–120000 | 2000 |
| `maxPauseMs` | Integer from `minPauseMs` to 120000 | 15000 |
| `maxFlashes` | Integer 1–5 | 3 |
| `durationMs` | Integer 1000–3600000, required when `loop` is false and rejected when `loop` is true | Finite-mode default 30000, shared with candle |

Root RGB initially equals `E8F0FF` and flash brightness equals 100. The exact background color and brightness are settled on the owner's LT-06. Validation covers the whole definition before any packet is sent. Unknown or unrelated effect fields are rejected. A presets file with an invalid lightning entry is rejected like any other invalid effect, and the active generation stays unchanged. Nested `backgroundRgb` is deep-copied at import, proposal and run boundaries.

Equal minimum and maximum pauses are valid and give fixed pauses with a random flash count. A `maxFlashes` of 1 gives single-flash strikes. A background brightness of 0 keeps the lamp on but dark between strikes.

## Controller constants

Flash timing is not part of the definition (FR-005). The controller owns it as named constants and draws every value from the injected random source.

| Constant | Value | Meaning |
| --- | --- | --- |
| Flash hold | 100–180 ms | Time a flash stays lit before the return packet. |
| Inner gap | 60–250 ms | Background time between flashes of one strike. |
| Flash intensity | 70–100 % | Scale applied to the flash RGB per flash. |

The lower bounds may rise after the LT-06 observation. The chosen values are recorded in `hardware-verification.md`, and the controller never uses shorter ones. Every write still waits for the shared 80 ms packet gap, so actual edges are longer than nominal.

## Packets

The lamp's brightness register holds the flash brightness for the whole run. Fallback after the LT-06 check: each edge sends color plus brightness, and this section is updated. Setup sends On, color and brightness, with the color set to the background. Each later edge is one color packet.

| Packet color | Value |
| --- | --- |
| Background | `backgroundRgb` scaled by `backgroundBrightness / brightness`, each channel rounded |
| Flash | Root `rgb` scaled by the per-flash intensity, each channel rounded |

## Strike

A strike is a runtime value and is never saved. It holds a flash count drawn uniformly from `1..maxFlashes` and, per flash, a hold, an inner gap and an intensity. The pause before it is drawn uniformly from `[minPauseMs, maxPauseMs]`.

## Run states

The run uses the shared active-job lifecycle and snapshot. The snapshot `kind` adds `lightning`. `durationMs` is the definition's `durationMs` for a finite run and `null` for a loop. `physical_state_verified` stays `false`.

| Phase | Transition |
| --- | --- |
| Background | Setup or a return packet showed the background. Wait the pause, clipped to the deadline when finite. |
| Flash | A flash packet was written. Hold, then write the background and wait the inner gap. After the last flash, draw the next pause. |
| Completed | A finite deadline arrives during a pause, or a started flash finishes its return to background after the deadline. No further strike. |
| Cancelled | Another lighting command, exact-ID stop or shutdown returns at once from any pause or write. No restore packet. |
| Failed / Unknown | As for other effects. No retry or replay. |

Slow writes shift the following timing. Missed flashes are never sent in a burst. A restart of the controller or Stream Deck does not resume the run.
