# MeRGBW Controller

A local Go controller for **MeRGBW LT-06 sunset lamps**, with Stream Deck buttons connected through HTTP. One `sunset` process owns the BLE connection and serializes commands. The default server address is `127.0.0.1:18765`.

[Инструкция на русском](README_RU.md)

## Compatibility and verification

- Targets the LT-06 protocol: advertised service `3519`, GATT service `FFF0`, writes to `FFF3`.
- **Power ON/OFF packets were verified on an LT-06 using nRF Connect.** RGB and brightness are derived from the protocol reference and still need physical verification.
- The Go BLE implementation requires testing on a Mac with the actual lamp. Other devices using the MeRGBW app are not automatically compatible.
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
bash setup.command --identity AA:BB:CC:DD:EE:FF
bash run.command
```

Replace the example identity with the lamp's identity described below. `setup.command` checks the tools, downloads Go modules, builds `sunset`, and initializes local settings. It does not install Go, Xcode, or a background service. On first setup without arguments, an interactive Terminal prompts for the identity. Existing settings are preserved on subsequent runs.

Setup prompts and CLI diagnostic messages are currently in Russian.

Alternatively, build and initialize manually:

```bash
go mod download
CGO_ENABLED=1 go build -buildvcs=false -o sunset ./cmd/sunset
./sunset --identity AA:BB:CC:DD:EE:FF init
./sunset serve
```

Disconnect the lamp in nRF Connect and close MeRGBW on the phone before starting the controller. Keep Terminal open or minimized, keep the Mac awake, and use Ctrl+C to stop the server.

### Find the lamp identity

Use a BLE scanner to inspect the LT-06's manufacturer advertisement. The identity is the **first six bytes of the manufacturer payload, excluding the two-byte Company ID**, formatted as `AA:BB:CC:DD:EE:FF`. Some scanners display the Company ID separately; do not remove it twice. The controller matches this payload to discover the device.

This identity is not the macOS CoreBluetooth UUID. Do not substitute a scanner's Bluetooth address without confirming that it matches the advertised identity. The public project has no built-in device identity.

### macOS Bluetooth permission

Allow Bluetooth access for Terminal, or the terminal application launching `sunset`, in **System Settings → Privacy & Security → Bluetooth**. The BLE dependency creates CoreBluetooth managers during package initialization, so even `init`, `--help`, `send`, or `dry-run` may trigger the permission prompt. This alone does not scan, connect, or send lamp commands. For an iTerm2 `abort: trap`, check its Bluetooth permission or try Apple's Terminal.

## Stream Deck setup

1. Start `sunset serve` or `run.command` on the same Mac as Stream Deck.
2. Open the generated **streamdeck-buttons.txt**.
3. Add **System → Website** to a Stream Deck button.
4. Paste the complete URL for the desired action.
5. Enable **GET request in background** and give the button a label.

Check ON/OFF first, then verify RGB and brightness. URLs contain the generated access token: keep `settings.json` and `streamdeck-buttons.txt` private. Both are ignored by Git. Normal restarts preserve the token and button URLs.

## CLI

Global flags go **before** the subcommand. By default, data files live beside the `sunset` executable.

```bash
./sunset --identity AA:BB:CC:DD:EE:FF init
./sunset serve
./sunset urls
./sunset send off
./sunset send on
./sunset send color FF5000
./sunset send brightness 40
./sunset send preset sunset
./sunset dry-run on
./sunset dry-run preset sunset
./sunset inspect
```

- `init` creates missing files and retains existing settings/presets. A new configuration requires `--identity`; `serve` can also initialize with that flag. A different identity cannot silently replace an existing one: stop the server and edit `settings.json` explicitly to change lamps.
- `send` is an HTTP client. Leave the server running and execute it from another Terminal.
- `inspect` discovers and connects to the configured lamp to show advertisement/GATT information, without writing control packets. Stop `serve` before using it.
- `dry-run` prints packets without connecting to the lamp or sending commands.
- `urls` regenerates and prints the current button URLs.

For a separate data directory, use the same directory in each command:

```bash
./sunset --data-dir ./local-data --identity AA:BB:CC:DD:EE:FF init
./sunset --data-dir ./local-data serve
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
bash run.command 2>&1 | tee -a sunset.log
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
| `internal/ble` | Discovery, GATT, and BLE writes |
| `internal/controller` | Command serialization and reconnect handling |
| `internal/bridge` | Local HTTP API |
| `internal/config` | Settings, presets, and button URLs |

```bash
go test ./internal/protocol ./internal/config ./internal/controller ./internal/bridge
go test -race ./internal/controller ./internal/bridge
```

The [CI workflow](.github/workflows/ci.yml) runs tests, the core race checks, vet, and build on Linux with Go 1.25.x and the current stable Go release. A separate macOS job compiles the CoreBluetooth backend with CGO; it does not run the controller or BLE tests. Neither these tests nor a successful macOS build validate a physical lamp. Hardware verification remains limited to the power packets described above.

If the BLE backend reports that the process must be restarted, stop the server and start it again. Repeated commands cannot recover a native adapter marked unusable after an uncertain operation.

## Protocol references

- [King1704G control.py, pinned revision](https://github.com/King1704G/custom_components-sunset_light_cheapass_amazon_light/blob/165539104949e8bc623b46040dee1ad33a3eb30c/custom_components/sunset_light/control.py): packet layout, folded checksum, power, RGB, and brightness. Verified power packets: OFF `55 01 FF 06 00 A3`; ON `55 01 FF 06 01 A2`.
- [rexxars config_flow.py, pinned revision](https://github.com/rexxars/ha-mergbw/blob/2771a214601d8c00ed21a4e05ca7616bd30fce0b/custom_components/mergbw/config_flow.py): advertisement discovery reference, not a source of verified control commands for this implementation.
- [Go Bluetooth v0.16.0](https://github.com/tinygo-org/bluetooth/tree/v0.16.0): platform integration; its [go.mod](https://github.com/tinygo-org/bluetooth/blob/v0.16.0/go.mod) requires Go 1.25.0.
- [Elgato System Actions](https://help.elgato.com/hc/en-us/articles/360028234471-Elgato-Stream-Deck-System-Actions-Hotkey-Open-Website-Multimedia): Website and background GET requests.

## License

[MIT](LICENSE).
