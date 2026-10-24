# Native payload and local development contract

## Personal-development scope (2026-10-24)

The owner requires local development and local installation only. Developer ID, notarization, stapling, downloaded-installer and quarantine acceptance are optional, outside feature completion. Existing credential-free ad-hoc helper signing remains. A current-Mac integrated fixture installed through the pinned CLI link satisfies the local artifact path; full universal installers retain their stricter content checks. Earlier signed-distribution plans are superseded for required acceptance.

## Runtime package

Keep plugin UUID/action UUIDs, Node 24, SDK 3, Stream Deck 7.1 and macOS 13.5 minima. Plan plugin/package minor version 0.2.0 / manifest 0.2.0.0 for the new setup and migration behavior; update current version assertions together. Controller bridge version remains independently defined; private managed protocol is version 1 with source-revision metadata.

```text
com.obalunenko.mergbw.sdPlugin/
  bin/{plugin.js,package.json}
  ui/...                         # existing offline UI/vendor files
  imgs/...                       # five existing actions, Transition and category
  licenses/...                   # existing notices plus bundled Go/native notices
  controller/
    payload-manifest.json
    MeRGBW Controller.app/
      Contents/Info.plist
      Contents/MacOS/mergbw-supervisor
      Contents/Helpers/sunset
      Contents/Resources/en.lproj/InfoPlist.strings
      Contents/Resources/ru.lproj/InfoPlist.strings
      ...final signature and stapled-ticket material
```

Complete installers contain universal arm64+x86_64 executables. The owner-linked local fixture contains only the current Mac architecture. The supervisor is a CGO-disabled BLE-free build; the worker uses existing CGO/CoreBluetooth. Native `CFBundleExecutable` is `mergbw-supervisor`, stable bundle ID `com.obalunenko.mergbw.controller`, `LSMinimumSystemVersion` 13.5, localized Bluetooth usage description. The installed-host TCC correction launches this app through fixed /usr/bin/open -n -g -W with a private Unix control endpoint. Do not require the helper to run in Terminal, modify Elgato's signature or write configuration into the bundle. See the current launch/lifetime section in managed-runtime.md; direct spawn failed actual TCC acceptance. `LSUIElement` may hide the background helper from Dock; it is not a lifetime mechanism.

Packaging templates live under `streamdeck/native`; the app and payload manifest are generated artifacts. `payload-manifest.json` records format version, exact source revision, managed protocol/bridge versions, build mode, architecture/deployment targets and exact path/hash/mode for every bundled helper file. Do not put configuration or host-specific paths in it. A checked trusted manifest and final bundle inspection determine the finite native file set, including real signature/stapling files observed from tooling; no unrestricted recursive file allowlist. Reject symlinks, traversal, duplicate archive entries, unexpected executables and private data.

## Early current-Mac fixture (T024/T025)

Before the full US5 workflow exists, T024 implements `python3 scripts/plugin-native.py spike --output-root <absolute-directory>`. It consumes the existing JS/UI build, compiles supervisor/worker only for the current Mac with the same 13.5 target and bundle/privacy identity, and stages a fresh `com.obalunenko.mergbw.sdPlugin` under that root. Copy only allowlisted runtime assets, never logs, settings or the source tree. Add a current-architecture payload manifest with `buildMode: spike`, exact source/protocol/bridge versions and file hashes/modes; it is recognizable by the managed backend but rejected by every full package/release check. The script fails if the target staged plugin already exists, builds/inspects only, and never installs, starts Stream Deck, executes the worker or accesses the lamp.

This fixture is explicitly linked using the already installed pinned Elgato CLI by the owner on the current Mac, with working configuration and assignments preserved; a separate macOS test user is optional under the 2026-10-23 scope clarification. Record existing TCC grants honestly rather than treating them as a new-install prompt. No second architecture, Developer ID/notarization credentials or T067 Task command is required. Development commands in this experiment are for the developer; all actual native execution starts from Stream Deck, without a Terminal Bluetooth grant. See the separate [early guide](../quickstart.md#early-current-mac-feasibility). It proves only that host's permission/lifetime feasibility; it is a local linked development installation, not a universal installer. No `PACKAGE_MODE=spike`, automatic mode fallback or permission to publish is introduced. The later development/distribution installers still require both architectures.

## Acceptance scopes and gates

Current-Mac host and physical observations may use the current integrated owner-linked fixture after its software/setup/recovery prerequisites. T078 requires T025/T058/T075/T092, so it can record actual LT-06 effects without waiting for Intel hardware or the complete distribution installer. T085/T093 separately record dial/transition observations. Identify exact artifact provenance and mode using the [evidence model](../data-model.md#acceptance-evidence-documentation-only); these results apply only to the observed build and host.

T072 inspects the identified local fixture or development installer: provenance, public assets, native hashes/modes/architecture/minimum OS, privacy resources and licenses. T073 records actual local installation/link, first run, import, update, EN/RU file selection, profile isolation and three-restart ten-assignment retention. Downloading and quarantine are not prerequisites. T079 reconciles these local artifact/installation gates plus the required host and lamp observations; changing scope does not manufacture a pass.

## Build and task boundaries

Proposed Task commands, implemented through Taskfile and repository scripts rather than a new development module:

| Task | Behavior |
| --- | --- |
| plugin:check:software | Existing lint/types/Node tests/JS build/schema validation plus payload-validator fixture tests; works without real native payload |
| plugin:native:build | Native macOS host builds current-arch worker and pure supervisor slices, target macOS 13.5; never executes worker |
| plugin:native:assemble | Require both architecture slice artifacts from same revision; lipo, bundle, add resources and inspect, no BLE |
| plugin:native:sign | Explicit Developer ID signing/notarization/stapling and verification for distribution; requires configured credentials |
| plugin:native:dev | Explicit development-only ad-hoc payload assembly/marking for local host experiments; no distribution verification claim |
| plugin:check | Full software checks + complete staged native payload/content checks; never silently skips missing payload |
| plugin:package | Full checks then existing pinned Elgato pack into root dist; distribution mode requires signed/stapled payload |

Local scripts must surface missing slices/credentials/SDK clearly rather than download an executable at runtime or silently omit the native payload. No build/check task launches Stream Deck, installs/links a plugin, executes the worker or sends a lamp command. `plugin:link/watch` remain explicit host actions; linked development also needs a staged payload. Pure supervisor and synthetic worker execution in tests are separately allowed.

`plugin:native:build` writes its current-architecture output to `dist/plugin-native/darwin_arm64` or `dist/plugin-native/darwin_amd64`; assembly reads both directories by default. Optional Task variables `NATIVE_ARM64_DIR` and `NATIVE_AMD64_DIR` select prebuilt artifact directories without altering production runtime paths. `PACKAGE_MODE` defaults to `development`, producing `com.obalunenko.mergbw.development.streamDeckPlugin`. Explicit `PACKAGE_MODE=distribution` remains an optional Developer ID path. The release workflow builds and publishes the clearly named development asset without Apple credentials.

## Release workflow

1. Preserve native controller matrix for Darwin arm64/amd64 and Linux arm64/amd64 and its four existing archives. Preserve existing release note/checksum/all-or-nothing semantics and independent declared component versions.
2. Darwin jobs also build/upload supervisor+worker slice artifacts and provenance metadata from the same tagged source. Use deployment target 13.5 and native CGO for worker. Do not run worker for version inspection; use build metadata/Mach-O inspection.
3. Move final plugin job to macOS with a dependency on native artifacts. Download both Darwin payloads, verify revision/protocol/bridge compatibility, lipo each role and assemble the helper. Linux software validation remains available in CI; native code on macOS CI is compile/inspect only.
4. Finalize a credential-free development payload with `plugin:native:dev`: sign the inner worker and outer app ad hoc after lipo, then inspect hashes and signatures. Do not mutate the native bundle afterward.
5. Pack the development installer, extract it into a temporary directory and verify native hashes, Mach-O slices/minima, executable bits, local signatures and finite contents again. Never execute the candidate during inspection.
6. Publish only when CI, all four standalone archives and the complete verified development installer exist; checksums cover all five assets. No Developer ID certificate or notarization credentials are required. This implementation run does not publish anything.

Optional Developer ID tooling remains available through `plugin:native:sign` and explicit `PACKAGE_MODE=distribution`; it retains hardened-runtime/timestamp/ticket checks and fails on missing credentials. It is outside personal-development acceptance and the default release path.

## Content and safety checks

Extend current `streamdeck/scripts/check-package.mjs` deliberately for the native bundle and Go/native license notices while retaining rejection of settings.json, presets.json, streamdeck-buttons.txt, logs, environment files, source trees and fixtures anywhere in the installer. Verify manifest version/paths, package modes and both architectures without executing native code. Freeze source revision/protocol in metadata; matching text versions alone are not sufficient provenance.

There is no runtime downloader/updater. Stream Deck replaces installed files; persistent config remains under Application Support. Preserve imported settings/tokens/presets and host title/image settings when replacing plugin version. The app's signature and TCC identity must stay stable across updates.

## Extended installed-host evidence (deferred for home use)

The owner home-use decision accepts the existing current-Mac observations and defers additional manual rounds. For a future broader qualification, record on the tested Mac: architecture, OS and Stream Deck versions, exact source/artifact/build mode, local installation or explicit link, successful first start without developer tools or prior Terminal Bluetooth grant, prompt owner/text, allow/deny/re-enable, actual executable architecture, EN/RU file selection, update retention, quit/disable/plugin crash/host crash/sleep-wake, and no surviving native controller.

A bundle plist or local signature inspection does not prove Bluetooth attribution under Stream Deck -> Node -> supervisor -> worker. Record the responsible application observed in System Settings; do not prescribe the helper's own name before observing it. If permission requires Terminal or manual alteration of Elgato's app, the specified setup journey has failed and design must be adjusted. Missing Intel or hardware evidence stays pending; content checks never turn it into a pass.
