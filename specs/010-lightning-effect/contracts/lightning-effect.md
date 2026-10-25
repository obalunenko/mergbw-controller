# Lightning effect contracts

These contracts add one effect kind to the preset effects contract in `specs/008-configurable-preset-effects/contracts/preset-effects.md`. Static presets, the other four kinds, the HTTP routes, the management operations and the PI messages keep their behavior. The specification pins one literal identifier: the effect kind `lightning`. The other names below are design choices for implementation and tests.

## Stored preset definition

A lightning preset is an ordinary catalog entry with `label`, `rgb` and `brightness`. Root `rgb` is the flash color and root `brightness` is the flash brightness. The `effect` object has exactly these keys: `kind`, `loop`, `backgroundRgb`, `backgroundBrightness`, `minPauseMs`, `maxPauseMs`, `maxFlashes`, and `durationMs` only when `loop` is false.

```json
{
  "storm": {
    "label": "Storm",
    "rgb": [232, 240, 255],
    "brightness": 100,
    "effect": {
      "kind": "lightning",
      "loop": true,
      "backgroundRgb": [26, 42, 108],
      "backgroundBrightness": 15,
      "minPauseMs": 2000,
      "maxPauseMs": 15000,
      "maxFlashes": 3
    }
  },
  "short_storm": {
    "label": "Short storm",
    "rgb": [232, 240, 255],
    "brightness": 100,
    "effect": {
      "kind": "lightning",
      "loop": false,
      "backgroundRgb": [26, 42, 108],
      "backgroundBrightness": 15,
      "minPauseMs": 2000,
      "maxPauseMs": 15000,
      "maxFlashes": 3,
      "durationMs": 60000
    }
  }
}
```

| Field | Validation |
| --- | --- |
| `brightness` (root) | Integer 1–100. A root brightness of 0 makes the preset invalid. |
| `loop` | Boolean. |
| `backgroundRgb` | Three integer channels from 0 through 255. |
| `backgroundBrightness` | Integer from 0 through `brightness - 1`. |
| `minPauseMs` | Integer 500–120000. |
| `maxPauseMs` | Integer from `minPauseMs` through 120000. |
| `maxFlashes` | Integer 1–5. |
| `durationMs` | Integer 1000–3600000. Required when `loop` is false; forbidden when `loop` is true. |

The whole definition is validated before any packet is sent. The catalog is rejected, with no packets sent, when any required key is missing, any key is null, a foreign key is present (including keys of another effect kind), `minPauseMs` is greater than `maxPauseMs`, `backgroundBrightness` is not below `brightness`, `durationMs` is present with `loop: true` or absent with `loop: false`, or any value is outside its range. Rejection uses the existing validation error categories. Equal pauses are valid; flash counts stay random.

## Packet behavior

The effect starts with the existing initial packets: power on, one `0x03` color packet with the background RGB scaled by `backgroundBrightness / brightness` (each channel rounded), and one `0x05` brightness packet with the flash brightness. The brightness register then stays at the flash brightness for the whole run.

Each strike follows a pause drawn uniformly from `minPauseMs` through `maxPauseMs`. A strike has 1 to `maxFlashes` flashes, drawn uniformly. Each flash edge is exactly one `0x03` color packet: the flash RGB scaled by a random 70–100 percent, then the scaled background RGB. Flash hold (100–180 ms) and the gap between flashes in a strike (60–250 ms) are controller constants, not preset fields. All writes pass the shared 80 ms packet gap. Slow writes stretch the timing; overdue flashes are never sent as a burst. Fallback: if the owner's LT-06 check shows that the scaled background does not look dim, each edge becomes a `0x03` color packet plus a `0x05` brightness packet, and this contract is updated.

Any other lamp command, a cancellation, controller exit or Stream Deck exit stops the effect by the existing rules. The effect sends no further packets and no restore packet. A finite run clips the pause before a strike to its deadline. If the deadline falls inside a strike, the current flash finishes, the background packet is written and the run ends. A finite run always ends on the background. Effects never resume after a restart.

## Execution

The CLI command `sunset send preset <id>` and the HTTP route `/<token>/preset/<id>` (GET or POST) are unchanged. For a lightning preset they return the existing dynamic-preset 202 response with an effect snapshot. `GET effect` and `POST effect/cancel/<runId>` behave as for other effects. In the snapshot, `kind` is `"lightning"`. `durationMs` is null for a looping run and equals the preset `durationMs` for a finite run. Because a finite run finishes its current flash, `elapsedMs` can exceed `durationMs` by up to one flash and its return. `physical_state_verified` stays false.

## Stream Deck editor

The preset editor adds `lightning` to the kind selector, labelled through the i18n key `kind.lightning` in EN and RU. Selecting it shows only the `editor-lightning-controls` block: background color, background brightness, minimum and maximum pause in seconds, and maximum flashes. The `editor-duration-controls` block moves out of the candle block and is shared by candle and lightning; it appears when loop is off. Root color and brightness are the flash color and brightness.

New lightning drafts use these defaults: flash `rgb` `E8F0FF`, `brightness` 100, background `1A2A6C` at brightness 15, pause 2–15 s, `maxFlashes` 3, `loop` true. The review step raises an error for a minimum pause above the maximum and for a background not below the flash brightness, and the catalog stays unchanged. Create, copy, edit and delete behave as for the other effects.
