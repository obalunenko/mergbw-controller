# Hardware verification: built-in scenes

Device: owner's MeRGBW LT-06, macOS. Steps follow [quickstart.md](quickstart.md)
"With the LT-06". An HTTP 200, `sent: true` or a dry-run frame is **not** a
pass: only an observed lamp effect is.

## Scene IDs (quickstart step 2)

| ID | Slug (reference names) | Observed effect | Matches reference name | Date | Notes |
|---|---|---|---|---|---|
| `80` | red (ref: fantasy) | Static red, no animation | unclear | 2026-10-25 | |
| `81` | green (ref: greenprairie) | Static green, no animation | yes (color) | 2026-10-25 | Reference-verified |
| `82` | night (ref: sunset, forest) | Static dim cool blue with some white, night-like | no | 2026-10-25 | Duplicate ID |
| `83` | sunrise (ref: sunrise) | Static warm, sunrise-like color | yes | 2026-10-25 | |
| `84` | ghost (ref: ghost) | Static pale ghost-like color, no animation | yes (color) | 2026-10-25 | Reference-verified |
| `85` | pink (ref: midsummer) | Static pink-purple | unclear | 2026-10-25 | |
| `86` | warmwhite (ref: tropicaltwilight) | Static warm white-orange, close to white | no | 2026-10-25 | |
| `87` | disco (ref: disco) | Animated: colors change fast, more than once per second | yes | 2026-10-25 | Reference-verified; first animated scene |
| `88` | party (ref: alarm) | Animated: fast color cycle (white, red, green, blue, cyan), slightly faster than 87 | unclear | 2026-10-25 | Reference-verified; not a red alarm flash |
| `89` | rgbfade (ref: rubyglow, aurora) | Animated: green, blue, red with fade through dim between colors | aurora: likely; rubyglow: no | 2026-10-25 | Duplicate ID |
| `8A` | rainbowfade (ref: —) | Animated: fade through dim across white, red, blue, orange, purple, green, cyan | n/a | 2026-10-25 | No reference name; like 89 with more colors |
| `8B` | redpulse (ref: savanah) | Animated: red pulse, fades out through dim and back | no | 2026-10-25 | Reference-verified |
| `8C` | greenpulse (ref: lakeplacid) | Animated: green pulse, fades from max through dim and back | no | 2026-10-25 | Same pattern as 8B, green |
| `8D` | bluepulse (ref: neon) | Animated: blue (night-like) pulse, fades through dim and back | no | 2026-10-25 | Same pattern as 8B, blue |
| `8E` | amberpulse (ref: sundowner) | Animated: yellow-orange (sunrise-like) pulse, fades through dim and back | yes (color) | 2026-10-25 | Same pattern as 8B |
| `8F` | icepulse (ref: bluestar) | Animated: white-blue pulse, fades through dim and back | yes | 2026-10-25 | Same pattern as 8B |
| `90` | pinkpulse (ref: redrose) | Animated: purple-pink pulse, fades through dim and back | partly (pink, not red) | 2026-10-25 | Same pattern as 8B |
| `91` | whitepulse (ref: rating) | Animated: white pulse, fades through dim and back | unclear | 2026-10-25 | Same pattern as 8B |
| `92` | greenredpulse (ref: —) | Animated: pulse alternating green and red, each fades through dim | n/a | 2026-10-25 | No reference name |
| `93` | blueredpulse (ref: autumn) | Animated: pulse alternating whitish blue and whitish red, each fades through dim | no | 2026-10-25 | |

## Behaviour checks

| Check | Quickstart step | Result | Date | Notes |
|---|---|---|---|---|
| A running preset effect stops and the lamp stays on `scene disco` | 3 | pass | 2026-10-25 | Tested with a 60 s transition `FF0000 100 0000FF 100 60` (no effect presets in local `presets.json`); `scene disco` sent after ~10 s took over at once, and no transition color returned during the remaining time. An effect preset was not tested. |
| `brightness 20` after a scene: dims, stops or is ignored (FR-012) | 4 | observed: ignored | 2026-10-25 | During `scene 8C` (green pulse), `brightness 20` changed nothing: the pulse continued at the same brightness. |
| Stream Deck Scene key runs its scene and keeps its selection after a plugin restart | 5 | pass | 2026-10-25 | Plugin built as a spike into `dist/plugin-local-scenes-20261025` and linked. Existing keys still worked. A Scene key set to Aurora showed "Aurora" and ran `89`. After a Stream Deck restart the key still showed Aurora, its settings still selected Aurora, and pressing it ran `89` again. After the rename, the plugin rebuilt into `dist/plugin-local-scene-names-20261025` listed the new names; the key set to RGB Fade ran `89`. |

## Summary

Every ID `80`–`93` produces a visible effect on this LT-06. `80`–`86` are static
colors. `87`–`8A` change colors. `8B`–`93` pulse through dim. Most reference
names do not match what the lamp shows, so scenes were renamed after the
observed effect. Brightness does not affect a running scene.
