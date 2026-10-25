# Data Model: scenes

## Scene (fixed catalog entry)

| Field | Type | Rules |
|---|---|---|
| `slug` | string | `^[a-z]+$`, unique, contains at least one non-hex letter |
| `label` | string | Display name of the observed effect, e.g. "Red Pulse" |
| `id` | byte | `0x80`–`0x93`, unique |

Names come from the owner's LT-06 observations in `hardware-verification.md`.
Reference names are documentation only.

Full table: [contracts/scenes.md](contracts/scenes.md).

## Scene selector (input)

Either a catalog `slug` or a raw ID:

- Slug: exact lowercase match.
- Raw ID: two hex digits, case-insensitive, value `0x80`–`0x93` (CLI and HTTP
  also accept a `0x` prefix, since both go through `Resolve`). The canonical
  route never contains `0x`. `8A` and `92` have no catalog entry and are
  allowed. The Stream Deck plugin sends only the canonical form.

Resolution → `Action{Route: "scene/<slug>" | "scene/<HEX>", Packets: [on, scene]}`.
Invalid selector → error, zero packets.

## Stream Deck scene assignment

`{ schemaVersion: 1, sceneId: string }` — `sceneId` matches the selector rules
above, stored canonical (slug lowercase, hex uppercase without `0x`). Empty
settings default to `{ schemaVersion: 1, sceneId: "disco" }`.

## Unchanged

`settings.json`, `presets.json` and their validation are unchanged. Generated
`streamdeck-buttons.txt` gains one line per catalog slug (not raw IDs).

## State

Scenes carry no controller-side state: once sent, the lamp runs the scene
itself. A later command overwrites it; nothing is restored or tracked.
