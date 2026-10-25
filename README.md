# MeRGBW Controller

A local Go controller for **MeRGBW LT-06 sunset lamps**, with Stream Deck buttons connected through HTTP. One `sunset` process owns the BLE connection and serializes commands. The default server address is `127.0.0.1:18765`.

[Инструкция на русском](README_RU.md)

## Compatibility and verification

- Targets the LT-06 protocol: advertised service `3519`, GATT service `FFF0`, writes to `FFF3`.
- **The Go BLE path was verified on one LT-06 on macOS on 2026-10-21:** ON/OFF, white and RGB colors, brightness 0/50/100%, and all six local presets, with user-confirmed visual effects. See the [hardware verification record](specs/002-ble-command-execution/hardware-verification.md). Power packets were also previously verified using nRF Connect.
- Verification applies to that device and environment. Other devices using the MeRGBW app are not automatically compatible.
- There is no physical power/color readback, music synchronization or built-in animation control. Software-driven RGB/brightness transitions and the owner-observed home-use results are described below.

## Prebuilt releases

[GitHub Releases](https://github.com/obalunenko/mergbw-controller/releases) provide `sunset_vX.Y.Z_darwin_arm64.tar.gz` (Apple Silicon), `darwin_amd64` (Intel Mac), `linux_amd64` and `linux_arm64` archives. Each includes the executable, both READMEs and the license. Download `SHA256SUMS` and verify the downloaded archive's SHA-256 (`shasum -a 256 <archive>` on macOS, `sha256sum <archive>` on Linux) against its entry before extracting it.

Run from the extracted directory; replace the example identity with your lamp's identity:

```sh
./sunset --identity AA:BB:CC:DD:EE:FF init
./sunset serve
```

The standalone archives need no Go, Node or Task. On macOS, the standalone CLI needs Bluetooth permission for its launching terminal; Linux needs BlueZ/D-Bus and an adapter. The macOS Stream Deck plugin 0.2 installer, `com.obalunenko.mergbw.development.streamDeckPlugin`, contains its own controller and uses the in-panel setup below.

Pushing a `vX.Y.Z` or `vX.Y.Z-prerelease` tag starts the [release workflow](.github/workflows/release.yml). Publication waits for CI checks, all four native controller archives and a two-architecture development plugin installer. The plugin job verifies extracted bytes, modes and local ad-hoc signatures without Developer ID or notarization credentials. Releases include `SHA256SUMS`, categorized commit subjects and descriptions, authors, commit links and a full changelog from the nearest reachable release tag. The first release includes all history; direct commits are included without requiring PRs. Prerelease tags produce GitHub prereleases. Published releases remain unchanged on reruns; interrupted draft uploads can be retried.

Local maintainer checks (release notes require the tag and complete Git history):

```sh
task release:test
task release:archive RELEASE_TAG=v1.0.0
task release:notes RELEASE_TAG=v1.0.0 RELEASE_REPOSITORY=obalunenko/mergbw-controller
```

Generated files are written to `dist/`; local commands do not publish a release. Product versions reported by the controller and plugin remain defined in their source and manifest independently of the repository release tag.

## Quick start on macOS from source

Install **Go 1.27.0+** from [go.dev/dl](https://go.dev/dl/) and Apple's **Xcode Command Line Tools** if needed:

```bash
xcode-select --install
```

The project uses ordinary Go and `tinygo.org/x/bluetooth v0.16.0`; the TinyGo compiler is not required. The macOS backend uses CoreBluetooth through CGO and must be built on macOS. See the [upstream macOS requirements](https://github.com/tinygo-org/bluetooth/blob/v0.16.0/README.md#macos).

```bash
git clone https://github.com/obalunenko/mergbw-controller.git
cd mergbw-controller
go tool -modfile=tools/task/go.mod task tools
task setup -- --identity AA:BB:CC:DD:EE:FF
task run
```

Replace the example identity with the lamp's identity described below. `task setup` downloads application modules, builds `sunset`, and initializes missing settings. Existing settings are preserved. The controller and pinned development-tool modules require Go 1.27.0 or newer. Install Go and Xcode separately; no background service is installed.

CLI diagnostic messages are currently in Russian.

Individual preparation steps are available separately:

```bash
task deps
task build
task init -- --identity AA:BB:CC:DD:EE:FF
```

Disconnect the lamp in nRF Connect and close MeRGBW on the phone before starting the controller. Keep Terminal open or minimized, keep the Mac awake, and use Ctrl+C to stop the server.

### Find the lamp identity

Use a BLE scanner to inspect the LT-06's manufacturer advertisement. The identity is the **first six bytes of the manufacturer payload, excluding the two-byte Company ID**, formatted as `AA:BB:CC:DD:EE:FF`. Some scanners display the Company ID separately; do not remove it twice. The controller matches this payload to discover the device.

This identity is not the macOS CoreBluetooth UUID. Do not substitute a scanner's Bluetooth address without confirming that it matches the advertised identity. The public project has no built-in device identity.

### macOS Bluetooth permission

For the standalone CLI, allow Bluetooth access for Terminal, or the terminal application launching `sunset`, in **System Settings → Privacy & Security → Bluetooth**. The BLE dependency creates CoreBluetooth managers during package initialization, so even `init`, `--help`, `send`, or `dry-run` may trigger the permission prompt. This alone does not scan, connect, or send lamp commands. Task retains the launching terminal's macOS permission context. Warp's missing `NSBluetoothAlwaysUsageDescription` can still cause an abort; Terminal.app worked in the recorded verification. No separate app runner is installed.

## Stream Deck setup

1. Start `task run` on the same Mac as Stream Deck.
2. Open the generated **streamdeck-buttons.txt**.
3. Add **System → Website** to a Stream Deck button.
4. Paste the complete URL for the desired action.
5. Enable **GET request in background** and give the button a label.

Check ON/OFF first, then verify RGB and brightness. URLs contain the generated access token: keep `settings.json` and `streamdeck-buttons.txt` private. Both are ignored by Git. Normal restarts preserve the token and button URLs.

## Native Stream Deck plugin

Version **0.2.0.0** provides six MeRGBW Keypad actions with one shared setup panel on macOS **13.5+** and Stream Deck **7.1+**. The installer contains the controller for Apple Silicon and Intel. Using a prebuilt installer requires no Terminal, Go, Node.js or separately running server. You need your lamp's manufacturer-data identity; automatic discovery of that identity is outside this feature.

Open `com.obalunenko.mergbw.development.streamDeckPlugin`, add a MeRGBW action and open its panel. First launch opens **Lamp and connection**; after setup, this screen is available from the link below key settings. Choose EN or RU and one setup method:

- **Enter lamp code:** enter six HEX bytes separated by colons, for example `AA:BB:CC:DD:EE:FF`. Use the first six manufacturer payload bytes after the Company ID, rather than a CoreBluetooth UUID. Review and apply. The plugin creates the secret and default presets.
- **Import files:** select the existing `settings.json` and optionally `presets.json`, review the changes and confirm. Identity, port, secret and selected custom catalog are preserved. Source files remain unchanged. Omitting presets retains the whole current catalog, or initializes defaults when no catalog exists; missing stock keys are never merged into an imported catalog.

Stop the previous standalone `sunset` before applying. A command URL alone lacks the lamp identity. Existing v1 plugin settings can supply their valid port/secret after explicit manual identity entry, but never activate an external server. A port conflict does not authorize connecting to or stopping another process.

All keys share one owned controller and BLE connection. The plugin starts it after setup and blocks commands until its private readiness and authorization checks finish. Setup, checking and restarting send no lighting commands. Allow Bluetooth through macOS when requested; use **System Settings → Privacy & Security → Bluetooth** to re-enable the application actually shown by macOS. The bundled helper opens as **MeRGBW Controller** to request its own Bluetooth permission. Installed-host permission outcomes are recorded separately below.

| Action | Assignment |
| --- | --- |
| On / Off | One explicit power command |
| Color | Visual picker or six HEX digits, optional `#`; default FF5000 |
| Brightness | Integer 0–100; default 50 |
| Preset | Current controller label with a stable saved ID |
| Transition | Explicit starting/ending RGB and brightness, integer duration 1–60 seconds |

**Preset settings:** one selector groups **Built-in presets** and **My presets**. Selecting a preset saves its assignment automatically; its color, brightness and effect appear below. Use **Customize a copy** for a built-in preset, **Edit** for your selected custom preset, or **+ Create preset**. The separate editor shows only the selected effect's parameters. Switching effects preserves the draft's color, brightness, timings and ordered palette. **Library** opens shared presets for editing/deletion; it loads automatically, with more pages available when needed. Static presets retain their existing behavior. Dynamic presets support:

| Effect | Settings |
| --- | --- |
| Color sequence / Palette | 2–16 ordered colors, brightness and 0.5–60 seconds per smooth transition; one pass or a loop with a smooth last-to-first transition |
| Strobe | Color, brightness and separate On/Off intervals of 0.25–60 seconds; one cycle or repeat |
| Breathing | Color, minimum/peak brightness and a 1–120 second rise/fall cycle; one cycle or repeat |
| Candle | Base color/brightness, flicker strength and a 0.25–5 second flicker interval; continuous or a finite 1-second to 1-hour run |

For a new preset or copy, choose **Create and assign…**, review the captured parameters and confirm **Create and assign**. The new ID is assigned to this key only after confirmed saving and a current catalog refresh. If saving is uncertain or the refresh fails, the old assignment remains; check the outcome and explicitly select the saved preset if needed. Editing a shared preset affects every key using it; review and **Apply changes** explicitly. Renaming preserves assigned IDs; deleting leaves affected keys visibly unavailable. Applying changed presets stops the current effect and restarts the controller while preserving lamp settings and secrets. Reading, editing and saving never start an effect. A stale draft cannot overwrite a newer catalog.

Press a dynamic preset key to start it; press it again to stop its current run. An active effect has a Stop control in key settings; **Diagnostics** provides **Check effect status** and **Stop current effect**. A normal command, dial rotation or dial press interrupts the effect; Off explicitly turns the light off. Stopping preserves the last commanded state, which can be Off during strobe. After an uncertain start reply, a press checks status rather than blindly starting another run; the panel offers explicit Stop. Effects never resume after restart. Timing is nominal and may stretch with Bluetooth writes. Software results and local-update evidence for these modes are recorded in [feature validation](specs/008-configurable-preset-effects/validation.md); they do not establish a measured physical waveform.

**Stream Deck+:** assign the existing **Brightness** action to a dial. Each clockwise tick adds one percentage point; counter-clockwise subtracts one, within 0–100%. The touch strip shows a prominent numeric percentage and a separate short status. This is the dial target, not measured lamp brightness. The initial target comes from the saved Brightness value (default 50%), not a lamp reading. Dial changes last for the current visible session; change the saved starting value in the panel. Fast turns combine into the latest target with at most one request in flight per dial. Failed or uncertain requests discard unsent changes. Hiding the dial, changing settings or losing readiness also clears unsent changes; recovery does not replay them. Pressing the dial sends **Off** and preserves its target percentage. A later turn applies that target and turns power on, including an outward turn at 100%. Touching the strip or releasing the dial sends no lighting command. Owner observations for the home-use version are recorded below.

**Smooth transition:** assign **Transition** to a key and set the starting RGB/brightness, ending RGB/brightness and duration (1–60 seconds). Defaults fade FF5000 from 100% to 0% over 30 seconds. The controller applies the explicit starting values, then interpolates to the endpoint. The initial state can change immediately; it is not read from the lamp. **Accepted** means the background transition was scheduled, not completed. **Diagnostics** enables **Cancel current transition** after the start is accepted. **Check transition status** refreshes progress or the final result; it is not required before cancelling. Any new valid lighting command, including a brightness-dial turn, cancels the old transition before executing; an in-progress native write must return first. Cancellation sends no extra Off. An endpoint of 0% leaves the power command unchanged. Native operation latency can extend the nominal duration. Closing/restarting the plugin never resumes the transition.

Color, brightness and presets also turn power on. Valid key settings save automatically on change; changing settings does not send lighting commands. Each key keeps its own assignment. Lamp setup and diagnostics have separate screens, and diagnostic checks remain explicit. Existing UUIDs, assignments, language and custom titles/images are retained. Exported assignments contain no connection secret or imported file paths. An imported profile on another installation needs local lamp setup. A missing preset remains invalid until explicitly reassigned; another preset is never substituted.

The panel distinguishes controller readiness, HTTP authorization and Bluetooth connectivity. Connected or **Command sent** does not verify physical lamp state. Pending is shown in the panel without a key error symbol. A confirmed send shows success; rejected or uncertain results show an alert. During an action, repeated presses on the same pending key add no command. A timeout or lost reply can leave an unknown physical outcome; inspect the lamp before a deliberate new press. Native cancellation is cooperative, and an already started write may finish before process exit.

Use **Diagnostics → Restart controller** after fixing a reported failure. Recovery preserves configuration and obtains fresh readiness; it never replays commands. If save confirmation is lost, use the read-only configuration check. The panel reports **Saved**, **Not saved** or **Save outcome unknown** and blocks configuration writes and lamp commands while active state cannot be read.

Quitting Stream Deck, disabling or restarting the plugin stops its controller. Pending actions and remaining steps are cancelled without an extra Off command or automatic continuation. No system service or independent autostart is installed. Standalone CLI and GET/POST Website integrations remain available; never run a competing controller on the plugin's port.

Lamp configuration lives in `~/Library/Application Support/com.obalunenko.mergbw`, outside the replaceable plugin directory. Updates retain settings, tokens, presets and key assignments. Files are private; treat copies as credentials. Restart does not reread imported source files: import an updated complete configuration through the panel to change it.

For development, install **Go 1.27+**, **Node 24**, pinned project tools and the macOS SDK. Run `task plugin:check:software` for software checks. Full `plugin:check` and `plugin:package` require the complete two-architecture native payload and default to `development`, with local ad-hoc signatures and no Apple credentials. The installer is `dist/com.obalunenko.mergbw.development.streamDeckPlugin`. Developer ID signing/notarization remains an optional explicit `PACKAGE_MODE=distribution` path, outside personal-development acceptance. See the [feature quickstart](specs/007-bundled-plugin-controller/quickstart.md) for exact build, development and explicit link commands. For local development acceptance, the current-Mac `spike` builder and explicit pinned CLI link are sufficient; the fixture remains separate from the universal installer and is rejected by full package checks. Local installation is sufficient; downloading an installer is optional.

Checks use synthetic HTTP/process/BLE fixtures and compile or inspect native binaries without executing the native worker. They do not install/link the plugin or operate a lamp. Diagnostics include safe categories, durations and request IDs, excluding tokens, full command URLs, imported paths and raw native errors. Keep SDK logging at INFO.

[Validation](specs/007-bundled-plugin-controller/validation.md) distinguishes software results from local installation, Bluetooth permission, architecture and LT-06 observations. Developer ID, notarization and downloaded-installer checks are outside personal-development acceptance. Historical [plugin hardware results](specs/006-streamdeck-control-plugin/hardware-verification.md) do not verify this new bundled process and permission chain.

The current local version is accepted for home use on the tested Apple Silicon Mac/LT-06. Additional manual permission/failure/sleep/clean-install/stress rounds are deferred by the owner, not passed. Runtime protections and automated tests remain in place.

## Task commands

Task builds the controller before each application command. Pass arguments after `--`. Runtime and hardware tasks use the repository root for settings by default; override it with `MERGBW_DATA_DIR` or the Task variable `DATA_DIR`.

```bash
task init -- --identity AA:BB:CC:DD:EE:FF
task run                         # alias: task serve
task urls
task send -- off
task send -- on
task send -- color FF5000
task send -- brightness 40
task send -- transition FF5000 100 FF5000 0 30
task send -- preset sunset
task dry-run -- on
task dry-run -- preset sunset
task inspect
task version
```

- `init` creates missing files and retains existing settings/presets. A new configuration requires `--identity`; `serve` can also initialize with that flag. A different identity cannot silently replace an existing one: stop the server and edit `settings.json` explicitly to change lamps.
- `send` is an HTTP client. Leave `task run` running and execute `task send` from another terminal.
- `inspect` discovers and connects to the configured lamp to show advertisement/GATT information, without writing control packets. Stop `serve` before using it.
- `dry-run` prints packets without connecting to the lamp or sending commands.
- `urls` regenerates and prints the current button URLs.

For a separate data directory, use the same directory in each command:

```bash
export MERGBW_DATA_DIR="$HOME/.config/mergbw"
task init -- --identity AA:BB:CC:DD:EE:FF
task run
```

Keep a custom data directory outside the repository or add it to your local Git exclusions.

## HTTP API

The service binds to IPv4 loopback. Command URLs accept **GET or POST**, with no request body or query parameters. GET support is intentional for Stream Deck's background Website action.

| Path | Operation |
|---|---|
| `/health` | Service and BLE connection status; no token required |
| `/<token>/presets` | GET-only authenticated ID/label catalog; no BLE calls |
| `/<token>/on` | Power on |
| `/<token>/off` | Power off |
| `/<token>/color/FF5000` | Set six-digit RGB color |
| `/<token>/brightness/40` | Set integer brightness, 0–100 |
| `/<token>/preset/sunset` | Apply a named preset |

Use the generated URLs instead of manually copying the token. Color, brightness, and preset commands send power-on first. HEAD requests never execute lamp commands.

Successful command responses contain `sent: true` and `physical_state_verified: false`. `/health` reports `bluetooth_connected`; it does **not** confirm that the lamp is illuminated or has reached the requested color. Native BLE operations may wait for library timeouts; an HTTP timeout does not guarantee immediate cancellation of an in-progress write.

## Logging

The controller writes structured text logs through Go's `log/slog` to **stderr**, with timestamps and levels. Command logs include the route in `command` and a `request_id`; BLE logs include packet bytes in `packet_hex`, results, retries, errors, and `duration_ms`. Follow a request from `command.received` through `packet.sent` to `command.sent`; failures and retries appear as `command.failed` and `command.retry`.

`bluetooth.connected` identifies the actual connected lamp with `identity`, `device_name`, `device_address`, `service_uuid`, and `write_uuid`. The identity in `service.started` is only the configured target. Neither event confirms the lamp's physical power or color.

Illustrative connection log; the identifiers below are examples:

```text
time=2026-01-01T12:00:00.000Z level=INFO msg=bluetooth.connected identity=AA:BB:CC:DD:EE:FF device_name=LT-06 device_address=00000000-0000-0000-0000-000000000000 service_uuid=0000fff0-0000-1000-8000-00805f9b34fb write_uuid=0000fff3-0000-1000-8000-00805f9b34fb
```

Successful `/health` requests are quiet. Access tokens and complete command URLs are excluded from logs. Logs normally stay in Terminal; to also append them to a file, run from the project directory:

```bash
task run 2>&1 | tee -a sunset.log
```

`*.log` is ignored by Git. The file contains device identifiers and command history. Logging does not change macOS Bluetooth permission requirements.

## Configuration and presets

`settings.json` contains `device_identity`, `port`, and `access_token`. Change settings with the server stopped. `presets.json` maps stable slugs to `label`, `rgb` (three integers, 0–255), and `brightness` (0–100).

Bundled presets: `sunset`, `night`, `alarm`, `magic`, `forest`, and `white`. `white` is an RGB mixture, not a dedicated white-channel mode. Stop the server, edit the JSON, and restart. Existing URLs remain valid when their slugs, port, and token stay unchanged; new preset URLs appear in `streamdeck-buttons.txt`.

### Migrate an existing Python configuration

Stop the Python server, copy its `settings.json` and `presets.json` beside the Go executable, then run `./sunset init` and `./sunset serve`. The token, routes, and preset slugs are preserved, so existing Stream Deck URLs continue to work. Run only one server on the configured port.

## Development and tests

| Directory | Responsibility |
|---|---|
| `cmd/sunset` | CLI and server lifecycle |
| `internal/protocol` | Packet encoding and validation |
| `internal/ble` | Discovery, GATT, and BLE writes through synchronous interfaces |
| `internal/ble/native` | TinyGo Bluetooth adapter; importing it may initialize CoreBluetooth |
| `internal/controller` | Command serialization and reconnect handling |
| `internal/bridge` | Local HTTP API |
| `internal/config` | Settings, presets, and button URLs |

Install the pinned development tools, then use the project workflows:

```bash
task tools
task --list
task build
task test:core
task test:race
task workflows:test
```

`task tools` delegates to the Make bootstrap, which installs tools declared in `tools/*/go.mod` with `go install tool`. If Task is not installed yet, use `go tool -modfile=tools/task/go.mod task tools`; `make tools` remains available for bootstrapping. Task 3.54.0 is pinned in `tools/task/go.mod` with its dependencies locked in `tools/task/go.sum`. Add `$(go env GOPATH)/bin` to `PATH` if needed, or run `go tool -modfile=tools/task/go.mod task --list` directly. The controller and both tool modules require Go 1.27.0 or newer. Go downloads the required toolchain automatically unless `GOTOOLCHAIN=local` is set.

`task workflows:test` checks Task ordering, argument/data-directory forwarding, error propagation, and hardware prerequisites using recording executables without native Bluetooth.

Go tests use Testify 1.11.1 assertions and Uber Mock 0.6.0 interface mocks. The test libraries belong to root `go.mod`; the generator is pinned separately in `tools/mockgen/go.mod` (Go 1.27.0). Run `task mocks:generate` after changing an interface and commit the generated `mock_*_test.go` files. Generation uses the pinned module directly, without relying on a global mockgen version.

`task test:core` and `task test:race` include the BLE backend with generated adapter/device mocks. They do not import the native Bluetooth adapter or require equipment/permissions. Default `task test` also excludes hardware tests.

Real-equipment integration tests require the `hardware` build tag and run only locally through a separate opt-in task. Stop `task run` and disconnect other clients. With settings in the repository root:

```bash
task test:hardware
```

The task rejects CI execution and requires settings.json and presets.json in the selected directory. For other settings, use `MERGBW_DATA_DIR=/absolute/path/to/lamp-config task test:hardware`. `TestHardwareLamp` inspects FFF0/FFF3, then resolves and sends real commands through the controller and native BLE backend on one persistent link. It establishes a white/100% baseline, checks OFF/ON transmission, red/green/blue, brightness 0/50/100%, every preset from local configuration in sorted order, and a final OFF. Each successful command pauses for two seconds and prints its expected visual effect. The sequence stops on the first failure and releases the connection; final OFF is reached only if preceding steps succeed. The task has a 15-minute overall timeout; individual operations use cooperative 35-second contexts.

PASS confirms connection/GATT and command transmission, without physical state readback. Observe the lamp and record the device, command, and actual effect separately; keep device identifiers and secrets in local records. The [2026-10-21 verification](specs/002-ble-command-execution/hardware-verification.md) ran all command cases in separate filtered invocations with user confirmations; it did not run the whole sequence uninterrupted. Brightness changes were compared visually, without calibrated measurements. Importing the native package may request macOS Bluetooth permission. If Warp aborts with a missing `NSBluetoothAlwaysUsageDescription`, run the test from Terminal.app, which succeeded in this session. Hardware tests are excluded from normal tests, race checks, `task check`, and CI; compilation or a skipped test is not hardware-verification evidence.

The [CI workflow](.github/workflows/ci.yml) runs tests, the core race checks, vet, and build on Linux with Go 1.27.x and the current stable Go release. A separate macOS job compiles the CoreBluetooth backend with CGO; it does not run the controller or BLE tests. Neither these tests nor a successful macOS build validate a physical lamp. Physical evidence comes from the separate local verification described above.

If the BLE backend reports that the process must be restarted, stop the server and start it again. Repeated commands cannot recover a native adapter marked unusable after an uncertain operation.

### Spec Kit

Specification tooling requires Python 3.11+ and [uv](https://docs.astral.sh/uv/getting-started/installation/):

```bash
task speckit:install
task speckit:update:check
task speckit:update:test
```

The Taskfile.yml pins Spec Kit 1.1.3, Companion 0.25.0, Brownfield 1.0.0, Bugfix 1.1.0, and the local feature-numbering extension 1.0.0. Installation uses `uv tool install` for the Specify CLI and installs all four project extensions with Codex skills. Existing Spec Kit initialization is preserved; a fresh project is initialized for Codex automatically. Restart Codex after installation to reload the generated skills.

New feature directories use `specs/NNN-feature-name`, starting at `001`. The mandatory `before_specify` hook selects the next number for both stock Specify and Companion; its source lives in `.speckit/feature-numbering/`.

The update check reports installed versions, pin drift, and available upstream releases without installing updates. It also checks the Companion editor extension when the VS Code or Cursor CLI is available. Edit the Taskfile.yml pins and rerun `task speckit:install` to apply an update. `task speckit:update:test` runs the checker's regression tests locally without network access.

## Protocol references

- [King1704G control.py, pinned revision](https://github.com/King1704G/custom_components-sunset_light_cheapass_amazon_light/blob/165539104949e8bc623b46040dee1ad33a3eb30c/custom_components/sunset_light/control.py): packet layout, folded checksum, power, RGB, and brightness. Verified power packets: OFF `55 01 FF 06 00 A3`; ON `55 01 FF 06 01 A2`.
- [rexxars config_flow.py, pinned revision](https://github.com/rexxars/ha-mergbw/blob/2771a214601d8c00ed21a4e05ca7616bd30fce0b/custom_components/mergbw/config_flow.py): advertisement discovery reference, not a source of verified control commands for this implementation.
- [Go Bluetooth v0.16.0](https://github.com/tinygo-org/bluetooth/tree/v0.16.0): platform integration; its [go.mod](https://github.com/tinygo-org/bluetooth/blob/v0.16.0/go.mod) requires Go 1.25.0.
- [Elgato System Actions](https://help.elgato.com/hc/en-us/articles/360028234471-Elgato-Stream-Deck-System-Actions-Hotkey-Open-Website-Multimedia): Website and background GET requests.

## License

[MIT](LICENSE).
