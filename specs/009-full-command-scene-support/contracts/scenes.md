# Contract: scene command

## Catalog (canonical; Go and TypeScript tests pin this table)

One entry per ID `80`–`93`. Names describe the effect observed on the owner's
LT-06 on 2026-10-25 (see [hardware-verification.md](../hardware-verification.md));
the reference names did not match and are kept only for traceability.

| Slug | Label | ID | Scene frame | Reference name(s) |
|---|---|---|---|---|
| `red` | Red | `80` | `55 06 FF 06 80 1E` | fantasy |
| `green` | Green | `81` | `55 06 FF 06 81 1D` | greenprairie |
| `night` | Night | `82` | `55 06 FF 06 82 1C` | sunset, forest |
| `sunrise` | Sunrise | `83` | `55 06 FF 06 83 1B` | sunrise |
| `ghost` | Ghost | `84` | `55 06 FF 06 84 1A` | ghost |
| `pink` | Pink | `85` | `55 06 FF 06 85 19` | midsummer |
| `warmwhite` | Warm White | `86` | `55 06 FF 06 86 18` | tropicaltwilight |
| `disco` | Disco | `87` | `55 06 FF 06 87 17` | disco |
| `party` | Party | `88` | `55 06 FF 06 88 16` | alarm |
| `rgbfade` | RGB Fade | `89` | `55 06 FF 06 89 15` | rubyglow, aurora |
| `rainbowfade` | Rainbow Fade | `8A` | `55 06 FF 06 8A 14` | — |
| `redpulse` | Red Pulse | `8B` | `55 06 FF 06 8B 13` | savanah |
| `greenpulse` | Green Pulse | `8C` | `55 06 FF 06 8C 12` | lakeplacid |
| `bluepulse` | Blue Pulse | `8D` | `55 06 FF 06 8D 11` | neon |
| `amberpulse` | Amber Pulse | `8E` | `55 06 FF 06 8E 10` | sundowner |
| `icepulse` | Ice Pulse | `8F` | `55 06 FF 06 8F 0F` | bluestar |
| `pinkpulse` | Pink Pulse | `90` | `55 06 FF 06 90 0E` | redrose |
| `whitepulse` | White Pulse | `91` | `55 06 FF 06 91 0D` | rating |
| `greenredpulse` | Green Red Pulse | `92` | `55 06 FF 06 92 0C` | — |
| `blueredpulse` | Blue Red Pulse | `93` | `55 06 FF 06 93 0B` | autumn |

Every scene action sends, in order: `55 01 FF 06 01 A2` (power on), then the scene frame.

## CLI

```text
sunset send scene <slug|HEX>        e.g. scene disco, scene 8a, scene 0x8A
sunset dry-run scene <slug|HEX>     prints both frames, no BLE
```

Errors (non-zero exit, no packets): missing/extra argument, unknown slug,
uppercase or spaced name, hex outside `80–93`, malformed hex. Unknown-name
message lists available slugs and the `80–93` range.

## HTTP

`GET|POST /<token>/scene/<slug|HEX>` — existing Host, token, method and empty
body rules apply unchanged. HEX is case-insensitive and may carry a `0x`
prefix, as in the CLI: `scene/8a`, `scene/8A` and `scene/0x8A` all return
`"action": "scene/8A"`.

| Case | Status | Body |
|---|---|---|
| Sent | 200 | `{"sent": true, "action": "scene/disco", "physical_state_verified": false}` (raw: `"scene/8A"`) |
| Invalid selector | 400 | existing `"некорректная команда или параметр"` |
| Extra path segment (`/<token>/scene/disco/extra`) | 404 | existing `"неизвестный адрес команды"` |
| HEAD | 405 | existing; nothing executed |
| Bad token | 403 | existing |
| BLE failure / timeout | 503 / 504 | existing |

Logs: `command.received` with `command=scene/<…>`, `packet_count=2`; token and
full URL redacted as today (pinned in `internal/bridge/logging_test.go`).

## Stream Deck

- Action UUID `com.obalunenko.mergbw.scene`, Keypad, name "Scene", tooltip
  "Run a built-in lamp scene / Встроенная сцена лампы".
- Settings `{schemaVersion: 1, sceneId}`; route `scene/<sceneId>`.
- Inspector lists catalog scenes by label, then raw IDs `80`–`93` as "ID 80" … "ID 93".
- Key title: the scene label (e.g. "Disco"); raw IDs show "ID 8A".
- Diagnostics record `actionKind: "scene"` like the other six actions.
- Route patterns (both exported from `streamdeck/src/scenes.ts`; no other
  copies):
  - `SCENE_ROUTE_SOURCE` = `scene\/(?:[a-z]{1,40}|[0-9A-Fa-f]{2})`
    (unanchored, case-insensitive hex). Connection-link parsing in
    `validation.ts` embeds it as an alternative in both of its regexes, then
    checks `sceneSelector(param) !== undefined` (catalog slug or range
    `80–93`; rejects `Disco`).
  - `SCENE_ROUTE` = `^scene\/([a-z]{1,40}|[0-9A-F]{2})$` (anchored, canonical).
    `bridge-client.ts` accepts a route only if it matches and
    `sceneSelector(param) === param`.

## streamdeck-buttons.txt

After brightness lines, one block per catalog slug in table order:
`Сцена <Label>` + `<base>/scene/<slug>`. Existing lines unchanged.
