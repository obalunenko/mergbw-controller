# Research: lightning effect

## R1. One packet per flash edge

**Decision**: Keep the lamp's brightness register at the flash brightness for
the whole effect. A flash is one color packet (`0x03`) with the flash RGB; the
return is one color packet with the background RGB scaled by
`backgroundBrightness / brightness`, each channel rounded.

**Rationale**: Every write waits for the shared 80 ms gap
(`internal/controller/controller.go`, `writeJobFrame`). Changing color and
brightness costs two packets, so a flash would last at least 160 ms plus write
time. Real lightning flashes are short; one packet per edge roughly halves the
shortest visible flash.

**Fallback**: If the owner sees on the LT-06 that a scaled RGB does not look
like a dimmer background, switch to color plus brightness packets per edge.
T020 makes that call.

**Alternatives considered**: Color plus brightness packets per edge (simple,
but at least 160 ms per edge; kept as the fallback). Brightness-only flashes with a fixed color
(cannot show a blue background and a white flash).

## R2. Flash timing is controller constants

**Decision**: Named constants in `internal/controller/effects.go`: flash hold
100–180 ms, gap between flashes in a strike 60–250 ms, both drawn with
`c.random()`. Actual edges are additionally stretched by the 80 ms gap and
write time. These values are provisional. The owner's LT-06 run decides the final ones;
they go to `hardware-verification.md`.

**Rationale**: The spec keeps flash timing out of the editor (FR-005). Holds
below the packet gap would only be stretched by it, so a lower minimum buys
nothing.

**Alternatives considered**: A hardware-tag test that sweeps flash lengths.
Rejected: the deciding question is what looks natural, which only the owner
can judge on the lamp.

## R3. Natural variation

**Decision**: Per strike: pause uniform in `[minPauseMs, maxPauseMs]`, flash
count uniform in `1..maxFlashes`. Per flash: hold and gap uniform in their
ranges, and the flash RGB scaled by a random 70–100 % so follow-up flashes
differ in strength. All draws use the injected `c.random()`.

**Rationale**: Unequal gaps and intensities are what separate lightning from
a strobe, and intensity variation is free under R1 (still one packet).

**Alternatives considered**: Weighted distributions (no visible gain for the
cost).

## R4. Start, end and stop

**Decision**: The effect starts with `InitialPackets` built from the scaled
background RGB and the flash brightness. With `loop: false`, the pause before a
strike is clipped to the deadline; a strike that has started finishes its
current flash, writes the background and ends. Cancellation returns at once
from any pause or write, as for other effects; no restore packet is sent.

**Rationale**: FR-003 and FR-009. Matches the existing cooperative stop rules
(constitution III).

## R5. Ranges

**Decision**:

| Field | Range |
|---|---|
| `minPauseMs` | 500–120000 |
| `maxPauseMs` | `minPauseMs`–120000 |
| `maxFlashes` | 1–5 |
| `backgroundRgb` | three channels 0–255 |
| `backgroundBrightness` | 0 to `brightness − 1` |
| `durationMs` | 1000–3600000, only when `loop` is false |

**Rationale**: Mirrors candle's duration rule and breathing's "below peak"
rule. Like breathing, a preset brightness of 0 makes the effect invalid.

## R6. Editor shape

**Decision**: New `editor-lightning-controls` block with a background color
input pair, background brightness, min and max pause in seconds and max
flashes. Move `editor-duration-controls` out of the candle block so candle and
lightning share it. Review pre-checks raise errors for min > max pause and a
background not below the flash.

**Rationale**: Follows the existing per-kind blocks; sharing the duration
block avoids a second copy.
