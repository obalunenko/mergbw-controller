# Hardware verification: lightning effect

Device: owner's MeRGBW LT-06, macOS. Run the default Lightning preset
(flash `E8F0FF` at 100, background `1A2A6C` at 15, pauses 2–15 s, up to 3
flashes, loop) from a Stream Deck key. An HTTP 202, a running snapshot or a
passing test is **not** a pass: only an observed lamp effect is.

## Controller constants

Values in `internal/controller/effects.go`. Every write also waits
for the shared 80 ms packet gap.

| Constant | Provisional | Chosen on LT-06 | Date | Notes |
|---|---|---|---|---|
| Flash hold | 100–180 ms | 100–180 ms (kept) | 2026-10-25 | Owner saw no need to change timing |
| Inner gap | 60–250 ms | 60–250 ms (kept) | 2026-10-25 | |
| Flash intensity | 70–100 % | 70–100 % (kept) | 2026-10-25 | |

## Checks

| Check | Requirement | Result | Date | Notes |
|---|---|---|---|---|
| Looks like lightning and more natural than Strobe | SC-001 | pass | 2026-10-25 | Owner confirmed |
| Shortest flash is clearly visible; record the minimum hold used | SC-006, FR-005 | pass | 2026-10-25 | Owner confirmed; minimum hold 100 ms, plus the 80 ms packet gap |
| Scaled background looks dim, not a different color (else switch to the two-packet fallback) | R1 | pass | 2026-10-25 | Owner confirmed |
| Background brightness 0: lamp looks lit or off between strikes | Edge case | gap (accepted) | 2026-10-25 | Not observed; owner accepted it as a known gap for this personal-use MVP |
| Another key stops the effect; no flash follows | FR-007, SC-004 | pass | 2026-10-25 | Owner confirmed |
| A finite run ends on the background | FR-009 | pass | 2026-10-25 | Owner confirmed |

## Summary

Owner ran the default Lightning preset on the LT-06 through the spike plugin
`dist/plugin-local-lightning-20261025`. It looks like lightning and more
natural than Strobe; the shortest flashes are visible; the scaled background
looks dim, so the one-packet design stays and the two-packet fallback is not
needed. The provisional timing constants are final.

Known gap: background brightness 0 was not observed on the LT-06. The owner
accepted it for this personal-use MVP; it does not block completion.
