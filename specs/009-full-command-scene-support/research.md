# Research: full command and built-in scene support

Source analysed: King1704G `custom_components/sunset_light/control.py`
(Home Assistant integration), compared with `internal/protocol/protocol.go`.

## R1. Which reference commands are missing

- **Decision**: Add only the scene command `0x06`. Treat `set_white` as the
  existing `color FFFFFF`; do not port the unused `CMD_WHITE_OFF = 0x00`.
- **Rationale**: Power (`0x01`), RGB (`0x03`) and brightness (`0x05`) already
  use the identical frame and one's-complement checksum (`packet()` matches
  `build_command()` byte for byte). White is RGB `FF FF FF` and is already
  hardware-verified on the owner's LT-06. `CMD_WHITE_OFF` is declared but never
  sent by the reference.
- **Alternatives considered**: a `white` alias route — rejected as a second
  spelling of an existing absolute command with no new device behavior.

## R2. Scene identifiers in CLI/URL

- **Decision**: Slug = reference name lowercased with spaces removed
  (`greenprairie`, `lakeplacid`), keeping the reference spelling (`savanah`).
  Accept raw IDs as exactly two hex digits `80`–`93`, case-insensitive, with an
  optional `0x` prefix in both CLI and HTTP (shared `Resolve`; owner decision,
  2026-10-25). Canonical route: `scene/<slug>` or
  `scene/<UPPER-HEX>`.
- **Rationale**: Slugs fit the existing preset slug pattern and need no URL
  escaping. No catalog slug consists only of hex characters, so names and IDs
  cannot collide. Range `80–93` is what the reference enumerates (owner
  decision, 2026-10-25).
- **Alternatives considered**: names with `%20`/`-` (fragile in Stream Deck
  Website URLs); any byte `00–FF` (rejected by owner: unpredictable device
  behavior); names only (rejected by owner: blocks exploration of `8A`/`92`).

## R3. Duplicate reference IDs

- **Decision**: Keep `sunset`/`forest` (`0x82`) and `rubyglow`/`aurora`
  (`0x89`) as separate catalog entries sharing an ID. The name that appears
  first in the reference `SCENE_PARAMS` dict (`sunset`, `rubyglow`) is primary;
  `forest` and `aurora` carry `DuplicateOf`. This is a project choice
  (owner decision, 2026-10-25): the reference's own comments are contradictory
  and do not establish which name is correct.
- **Rationale**: Users may know either name; hiding one silently loses a
  reference command. The marker prevents implying two distinct effects.

## R4. Packet sequence and preemption

- **Decision**: `scene` resolves to `[packet(0x01, 1), packet(0x06, id)]`,
  executed through the existing `Controller.Execute`.
- **Rationale**: Mirrors `color`/`brightness` (power-on first). `Execute`
  already calls `admit` → `cancelActive`, so running effects/transitions are
  cancelled before the scene frame (FR-005) with no controller change. The
  action is absolute, so the existing single reconnect retry is safe.
- **Alternatives considered**: scene frame only — rejected: a lamp that is off
  would likely ignore it, and behavior would differ from other commands.

## R5. Where the catalog lives

- **Decision**: Canonical catalog in `internal/protocol/scenes.go`; the Stream
  Deck plugin keeps a static mirror in `streamdeck/src/scenes.ts`. Both are
  pinned by tests against the table in `contracts/scenes.md`.
- **Rationale**: The protocol package must stay standard-library only and owns
  validation. Fetching the catalog over HTTP would add a new endpoint for a
  fixed, compile-time list. Mirrored tables are small and test-locked.
- **Alternatives considered**: a `/scenes` HTTP endpoint — deferred; adds
  contract surface without user value in this feature.

## R6. Stream Deck action

- **Decision**: New seventh action `com.obalunenko.mergbw.scene` (Keypad only)
  with a `<select>` of catalog scenes plus raw IDs, stored as
  `{schemaVersion: 1, sceneId: "<slug|HEX>"}`; default `disco` (verified by the
  reference author). Route validation in `bridge-client.ts` and
  `validation.ts` accepts `scene/<slug|HEX>`.
- **Rationale**: Follows the existing `Color`/`Preset` action pattern
  (`BaseAction.route`). Existing six actions and their settings are untouched.
  Key title follows `feedback.ts` preset behavior: scene label, or `ID 8A` for
  raw IDs. Every hard-coded action-kind list (`validation.ts`,
  `diagnostics.ts`, `ui/inspector.ts`) gains `"scene"`. `inspector-messages.ts`
  has no such list and needs no change (verified 2026-10-25).

## R7. Hardware verification

- **Decision**: Add a local `hardware-verification.md` for this feature with
  one row per ID `80`–`93`: observed effect, name match, notes. No status
  becomes "verified" in docs without a row. No new hardware Go test is required;
  manual checks use `sunset send scene <id>` against a running controller.
- **Rationale**: Physical scene appearance cannot be read back; Constitution VI
  forbids treating writes as verification.
