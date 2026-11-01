# Hardware verification: MeRGBW actions in Multi Action

**Owner session 2026-11-01.** The owner ran rows 1–9 and reported them all
OK in one summary ("проверил все ок"). No per-row details were given.

- **Device**: Stream Deck app 7.6.0; macOS 27.0.1 on an Apple Silicon (arm64)
  Mac; owner's MeRGBW LT-06. A 15-key Stream Deck and a Stream Deck + were
  both connected; the owner did not say which one was used.
- **Plugin**: arm64 spike build `1.0.3.4` in
  `dist/plugin-local-multi-action-20261101`, linked with
  `streamdeck/node_modules/.bin/streamdeck link` on 2026-11-01, replacing
  release `1.0.3.0`. After the Stream Deck restart the log showed
  `plugin.ready` and `update.checked` `up_to_date`; no lamp command was sent
  before the owner session.
- **Backup before linking**: profiles, managed configuration and the
  `1.0.3.0` plugin in
  `~/Library/Application Support/MeRGBW Development Backups/20261101T133838Z`.
- **Scope**: mac arm64 only (owner, 2026-11-01, home use). The Intel slice
  and the universal installer from `task plugin:package` are out of scope,
  not gaps.

Steps follow [quickstart.md](quickstart.md) "Owner checks". Only a physical
effect on the lamp or the key counts. A sent command, `showOk` or a
diagnostics line is not lamp-state evidence.

| # | Setup | Expected | Observed | Date | Status |
|---|---|---|---|---|---|
| 1 | Open the Multi Action and Multi Action Switch editors | MeRGBW category lists all seven actions | Owner: OK | 2026-11-01 | observed |
| 2 | Add a Color step, set `FF0000`, restart Stream Deck, reopen the step | Same panel as a key; value kept | Owner: OK | 2026-11-01 | observed |
| 3 | Color `FF0000` → Delay 0.5 s → Brightness 30 | Lamp red, then dimmer | Owner: OK | 2026-11-01 | observed |
| 4 | Scene Disco → Delay 0.5 s → Off | Lamp ends off | Owner: OK | 2026-11-01 | observed |
| 5 | Transition `FF0000` 10 % → `0000FF` 80 %, 5 s → Delay 5 s → Off | Transition completes, then off | Owner: OK | 2026-11-01 | observed |
| 6 | Color → Delay 0.5 s → Preset (deleted from the library) → Delay 0.5 s → Off | Note where the alert shows; Color and Off run | Owner: OK; where the alert showed was not stated | 2026-11-01 | observed |
| 7 | Multi Action Switch: Scene Disco / Off; press twice | Presses alternate scene and off | Owner: OK | 2026-11-01 | observed |
| 8 | Custom title and icon on the Multi Action key; press several times | Title and icon unchanged | Owner: OK | 2026-11-01 | observed |
| 9a | Color → Delay 0.5 s → Preset «Candle»; open the Preset step's panel | Effect keeps running after the Multi Action; panel shows status and Stop | Owner: OK | 2026-11-01 | observed |
| 9b | Multi Action with only Preset «Candle»; press twice | Second press stops the run, as for a key | Owner: OK | 2026-11-01 | observed |
