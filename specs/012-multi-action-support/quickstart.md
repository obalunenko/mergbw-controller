# Quickstart: validate MeRGBW steps in Multi Action

## Prerequisites

- macOS with Node 24 and locked plugin dependencies (`task plugin:deps`).
- For owner checks: the Stream Deck app 7.1+, the configured LT-06, and a
  plugin build from this branch.

## Automated (no Stream Deck, Bluetooth or network)

```bash
task plugin:check:software
```

Expected: lint, typecheck, tests, build and CLI validation pass. In
particular:

- `streamdeck/tests/multi-action.test.ts`:
  - each of the seven step kinds sends the key's route;
  - steps get no title or icon writes, including accepted Transition and dynamic preset steps;
  - a repeated dynamic preset step follows the key's stop rule;
  - invalid steps send nothing and alert: corrupt settings, a deleted preset, no connection;
  - no duplicates while pending;
  - readiness loss rejects;
  - diagnostics carry `multiAction: "true"` and no token.
- `streamdeck/tests/package.test.ts`: a manifest with any action's
  `SupportedInMultiActions` set to `false` or missing fails the check.
- All existing suites pass unchanged.

See [contracts/multi-action.md](contracts/multi-action.md) for the expected
behavior table.

## Install for owner checks

```bash
task plugin:package   # or: task plugin:link
```

Open the produced installer, or restart Stream Deck after linking. Existing
keys and settings must remain as they were.

## Owner checks on Stream Deck with the LT-06

Record each row in `specs/012-multi-action-support/hardware-verification.md`.
- **Header**: the device used: the Stream Deck model, the app, macOS and plugin versions, and the LT-06.
- **Per row**: the date, the exact setup and the physical effect actually observed.
- **Excluded**: never record the lamp identity, the token or full URLs.

An unobserved row is an accepted gap, never a pass. A sent command is not evidence of lamp state.

| # | Setup | Expected |
| --- | --- | --- |
| 1 | Open the Multi Action and Multi Action Switch editors | MeRGBW category lists all seven actions |
| 2 | Add a Color step, set `FF0000`, restart Stream Deck, reopen | Same panel as a key; value kept |
| 3 | Color `FF0000` → Delay 0.5 s → Brightness 30 | Lamp red, then dimmer |
| 4 | Scene Disco → Delay 0.5 s → Off | Lamp ends off |
| 5 | Transition 5 s → Delay 5 s → Off | Transition completes, then off |
| 6 | Delete the preset used by a middle Preset step, press | Note where the alert shows; other steps run |
| 7 | Multi Action Switch: Scene / Off | Presses alternate scene and off |
| 8 | Custom title and icon on the Multi Action key, press several times | Title and icon unchanged |
| 9a | Color → Delay 0.5 s → Preset «Candle»; open the Preset step's panel | Effect keeps running after the Multi Action; panel shows status and Stop |
| 9b | Multi Action with only Preset «Candle»; press twice | Second press stops the run, as for a key |

The [spec](spec.md) Verification Evidence lists the same rows.
