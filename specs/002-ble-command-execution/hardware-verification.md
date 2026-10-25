# Hardware Verification — 2026-10-21

**Result**: H01 verified for the commands below on one LT-06, with the user's
visual confirmation after each step. This is evidence for this device and
environment, not automatic compatibility with other lamps.

## Device and Environment

- Device alias: `local-lt06-01`, advertised model LT-06.
- macOS 27.0.1 (26A434), arm64; Go 1.27.3 darwin/arm64.
- The configured manufacturer identity and native address are retained only in
  the private local record, alongside per-run logs and the test executable hash.
  No identity, access token, or command URL is included in this report.
- The hardware-tagged `TestHardwareLamp` binary ran from Terminal.app with
  `MERGBW_DATA_DIR` pointing to the existing local configuration.

## Method and Results

The test exercised `protocol.Resolve`, `controller.Execute`, the production
retry policy, and the real TinyGo/CoreBluetooth adapter. Inspection discovered
FFF0/FFF3 before command transmission. Sixteen filtered test invocations passed
with exit code 0 and sent seventeen command actions. The connection was released
between invocations so the user could confirm each effect before the next step.
The initial brightness and white baseline shared one invocation.

| Step | Command / configured values | User-confirmed physical effect |
|------|-----------------------------|--------------------------------|
| 01 | `brightness/100`, `color/FFFFFF` | Bright white baseline |
| 02 | `off` | Lamp went dark |
| 03 | `on` | White light returned |
| 04 | `color/FF0000` | Red light |
| 05 | `color/00FF00` | Green light |
| 06 | `color/0000FF` | Blue light |
| 07 | `brightness/0` | Visible light disappeared |
| 08 | `brightness/50` | Blue light returned, dimmer than at 100% |
| 09 | `brightness/100` | Blue light became brighter than at 50% |
| 10 | `preset/alarm`: RGB 255/0/0, 70% | Red with moderate perceived brightness |
| 11 | `preset/forest`: RGB 20/180/60, 40% | Dim green |
| 12 | `preset/magic`: RGB 160/0/255, 45% | Purple with moderate perceived brightness |
| 13 | `preset/night`: RGB 40/60/255, 25% | Dim blue |
| 14 | `preset/sunset`: RGB 255/80/0, 60% | Warm orange |
| 15 | `preset/white`: RGB 255/255/255, 50% | White, dimmer than the initial baseline |
| 16 | `off` | Lamp went dark; final observed state off |

The brightness percentages are command values. Human comparison confirms visible
changes, not calibrated light output or exact colorimetry. PASS establishes
transport success; the physical-effect evidence comes from the separate user
confirmations, retained in the private local record.

This session did not test HTTP/Stream Deck end to end, Linux, other lamps, or an
uninterrupted full `task test:hardware` run. There is no runtime lamp-state
readback; `physical_state_verified`, `StateReadback`, and
`WritePropertiesVerified` retain their existing false values.

## Launcher Issue

The initial sandbox run failed with `timeout enabling CentralManager`. A retry
outside the sandbox aborted before sending commands. macOS TCC logs identified
the responsible Warp application as missing `NSBluetoothAlwaysUsageDescription`.
Running the same binary from Terminal.app succeeded. These two preparation
failures are excluded from the sixteen successful hardware invocations.

For local reproduction, stop `serve`, disconnect other clients, and run
`MERGBW_DATA_DIR=/absolute/path/to/lamp-config task test:hardware` from
Terminal.app. Observe and record effects separately. Hardware tests remain
excluded from CI and default unit/race/check workflows.
