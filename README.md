# MeRGBW Controller

A local Go controller for **MeRGBW LT-06 sunset lamps**, with Stream Deck buttons connected through HTTP. One `sunset` process owns the BLE connection and serializes commands. The default server address is `127.0.0.1:18765`.

[Инструкция на русском](README_RU.md)

## Compatibility and verification

- Targets the LT-06 protocol: advertised service `3519`, GATT service `FFF0`, writes to `FFF3`.
- **The Go BLE path was verified on one LT-06 on macOS on 2026-10-21:** ON/OFF, white and RGB colors, brightness 0/50/100%, and all six local presets, with user-confirmed visual effects. See the [hardware verification record](specs/002-ble-command-execution/hardware-verification.md). Power packets were also previously verified using nRF Connect.
- Verification applies to that device and environment. Other devices using the MeRGBW app are not automatically compatible.
- There is no physical power/color readback, music synchronization, built-in animation control, or smooth transition support.

## Quick start on macOS

Install **Go 1.25.0+** from [go.dev/dl](https://go.dev/dl/) and Apple's **Xcode Command Line Tools** if needed:

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

Replace the example identity with the lamp's identity described below. `task setup` downloads application modules, builds `sunset`, and initializes missing settings. Existing settings are preserved. The pinned Task module requires Go 1.27.0; Go downloads that toolchain automatically when needed. Install Go and Xcode separately; no background service is installed.

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

Allow Bluetooth access for Terminal, or the terminal application launching `sunset`, in **System Settings → Privacy & Security → Bluetooth**. The BLE dependency creates CoreBluetooth managers during package initialization, so even `init`, `--help`, `send`, or `dry-run` may trigger the permission prompt. This alone does not scan, connect, or send lamp commands. Task retains the launching terminal's macOS permission context. Warp's missing `NSBluetoothAlwaysUsageDescription` can still cause an abort; Terminal.app worked in the recorded verification. No separate app runner is installed.

## Stream Deck setup

1. Start `task run` on the same Mac as Stream Deck.
2. Open the generated **streamdeck-buttons.txt**.
3. Add **System → Website** to a Stream Deck button.
4. Paste the complete URL for the desired action.
5. Enable **GET request in background** and give the button a label.

Check ON/OFF first, then verify RGB and brightness. URLs contain the generated access token: keep `settings.json` and `streamdeck-buttons.txt` private. Both are ignored by Git. Normal restarts preserve the token and button URLs.

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

`task tools` delegates to the Make bootstrap, which installs tools declared in `tools/*/go.mod` with `go install tool`. If Task is not installed yet, use `go tool -modfile=tools/task/go.mod task tools`; `make tools` remains available for bootstrapping. Task 3.54.0 is pinned in `tools/task/go.mod` with its dependencies locked in `tools/task/go.sum`. Add `$(go env GOPATH)/bin` to `PATH` if needed, or run `go tool -modfile=tools/task/go.mod task --list` directly. The Task tool module requires Go 1.27.0; Go downloads the required toolchain automatically unless `GOTOOLCHAIN=local` is set. The controller still requires Go 1.25.0+.

`task workflows:test` checks Task ordering, argument/data-directory forwarding, error propagation, and hardware prerequisites using recording executables without native Bluetooth.

Go tests use Testify 1.11.1 assertions and Uber Mock 0.6.0 interface mocks. The test libraries belong to root `go.mod`; the generator is pinned separately in `tools/mockgen/go.mod` (Go 1.25.0). Run `task mocks:generate` after changing an interface and commit the generated `mock_*_test.go` files. Generation uses the pinned module directly, without relying on a global mockgen version.

`task test:core` and `task test:race` include the BLE backend with generated adapter/device mocks. They do not import the native Bluetooth adapter or require equipment/permissions. Default `task test` also excludes hardware tests.

Real-equipment integration tests require the `hardware` build tag and run only locally through a separate opt-in task. Stop `task run` and disconnect other clients. With settings in the repository root:

```bash
task test:hardware
```

The task rejects CI execution and requires settings.json and presets.json in the selected directory. For other settings, use `MERGBW_DATA_DIR=/absolute/path/to/lamp-config task test:hardware`. `TestHardwareLamp` inspects FFF0/FFF3, then resolves and sends real commands through the controller and native BLE backend on one persistent link. It establishes a white/100% baseline, checks OFF/ON transmission, red/green/blue, brightness 0/50/100%, every preset from local configuration in sorted order, and a final OFF. Each successful command pauses for two seconds and prints its expected visual effect. The sequence stops on the first failure and releases the connection; final OFF is reached only if preceding steps succeed. The task has a 15-minute overall timeout; individual operations use cooperative 35-second contexts.

PASS confirms connection/GATT and command transmission, without physical state readback. Observe the lamp and record the device, command, and actual effect separately; keep device identifiers and secrets in local records. The [2026-10-21 verification](specs/002-ble-command-execution/hardware-verification.md) ran all command cases in separate filtered invocations with user confirmations; it did not run the whole sequence uninterrupted. Brightness changes were compared visually, without calibrated measurements. Importing the native package may request macOS Bluetooth permission. If Warp aborts with a missing `NSBluetoothAlwaysUsageDescription`, run the test from Terminal.app, which succeeded in this session. Hardware tests are excluded from normal tests, race checks, `task check`, and CI; compilation or a skipped test is not hardware-verification evidence.

The [CI workflow](.github/workflows/ci.yml) runs tests, the core race checks, vet, and build on Linux with Go 1.25.x and the current stable Go release. A separate macOS job compiles the CoreBluetooth backend with CGO; it does not run the controller or BLE tests. Neither these tests nor a successful macOS build validate a physical lamp. Physical evidence comes from the separate local verification described above.

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
