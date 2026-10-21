# Workflow and Delivery Contract

Все имена ниже — проектируемые команды реализации. В момент планирования они ещё не добавлены в Taskfile.

## Ownership

- Taskfile.yml владеет workflow; npm scripts — локальные команды пакета streamdeck/.
- make tools сохраняет установку только существующих Go tools через tools/*/go.mod.
- package.json/package-lock.json и vendor asset pins принадлежат streamdeck/, не root go.mod или tools/task.
- Все plugin:* команды выполняют npm с working directory streamdeck, с безопасным quoting путей.
- deps/install, build/check, link/watch и real-device execution — отдельные операции. Check/build не запускают sunset или Stream Deck.

## Task mapping

| Task | Command / dependency | Host effects |
| --- | --- | --- |
| plugin:deps | npm ci | installs locked local npm dependencies only |
| plugin:lint | npm run lint, then npm run format:check | no formatting mutation |
| plugin:typecheck | npm run typecheck | backend/UI tsc --noEmit |
| plugin:test | npm test | compile test TS then node --test; no real SDK connect |
| plugin:build | npm run build | rollup -c produces backend/UI bundles |
| plugin:validate | npm run validate | pinned CLI validates built runtime folder |
| plugin:check | lint → typecheck → test → build → validate → npm run check:package | sequential, no implicit deps/install/link |
| plugin:package | plugin:check → npm run package | creates root dist installer |
| plugin:link | plugin:build → npm run link | explicit local macOS installation only |
| plugin:watch | npm run watch | explicit local rebuild/restart only |
| plugin:mock | node scripts/mock-bridge.mjs plus forwarded CLI_ARGS | explicit synthetic loopback fixture |
| workflows:test | existing Python recorder, extended for plugin workflows | fake executables, no app launch |

package script: streamdeck pack com.obalunenko.mergbw.sdPlugin --output ../dist --force --no-update-check.
validate script: streamdeck validate com.obalunenko.mergbw.sdPlugin --no-update-check.
link script: streamdeck link com.obalunenko.mergbw.sdPlugin.
watch script uses Rollup watch and pinned streamdeck restart com.obalunenko.mergbw on completed build, following official scaffold. It requires an explicitly linked plugin and never becomes a dependency of a check.

Linked development requires explicitly enabled Stream Deck developer mode (`streamdeck dev`). The CLI can report success after sending a restart URI that the host rejects with developer mode disabled; action visibility and a runtime `plugin.ready` event confirm loading. Normal installer acceptance removes an existing developer symlink with `streamdeck unlink com.obalunenko.mergbw` without `--delete` before opening the package, preserving repository files.

Local scripts are available from T001 and operate on the currently implemented manifest. T027 uses the explicit npm build/validate/package sequence in quickstart section 0 for the internal On/Off MVP; these scripts have no lifecycle hook requiring the later five-action check:package. The final plugin:package workflow from T055 still requires plugin:check and its five-action content gate before packing.

test script compiles tsconfig.test.json into ignored .test-build and invokes Node test runner on emitted tests. Pure services use injected clock/transport/SDK facades; bootstrap plugin.ts is not imported in tests. Tests with HTTP bind only temporary IPv4 loopback servers. They must not connect to port 18765 or use local controller files.

Task sequencing uses cmds for ordered checks, not parallel deps that can race against build output. Nonzero exit propagates and later stages do not execute. New source assets survive clean builds; generated outputs are ignored. CI/check never include hardware or local Spec Kit tasks.

## Synthetic fixture

plugin:mock runs a Node HTTP fixture on 127.0.0.1:18766 by default, not 18765. It does not import Go or Bluetooth and ignores real settings files. Synthetic token mock_access_token_1234567890123456 is publicly documented test data. Startup identifies itself as a simulator and does not print imported user credentials.

Default mode: health available with bluetooth_connected:false, two named presets and valid sent responses for commands. Additional deterministic --mode values:
auth-denied (403), legacy (health and commands work; catalog 400), backend-error (503), timeout (commands exceed 45s), malformed (200 wrong schema), echo-secret (error body deliberately repeats only the synthetic fixture token). A --bluetooth-connected flag changes only the synthetic health boolean; it is not evidence of physical equipment.

T025 provides an independent startup option --catalog, default baseline, selecting a built-in synthetic snapshot without reading files or changing controller settings:

| --catalog | Sorted entries {id,label} |
| --- | --- |
| baseline | night: «Ночь»; sunset: «Закат» |
| renamed | night: «Ночь»; sunset: «Вечер» |
| deleted | night: «Ночь» |
| duplicate-labels | night: «Одинаковый»; sunset: «Одинаковый» |
| empty | [] |

Each variant returns the valid catalog envelope with physical_state_verified:false. In normal mode, preset commands resolve only ids in the selected snapshot; a missing id returns the existing 400 rejection shape without sent:true. Other actions remain available. Unknown --catalog values fail startup explicitly. Catalog choice is independent of later failure --mode and Bluetooth flags; the failure mode controls responses as specified above, and returning to normal uses the selected catalog again.

Restart at the same port/token to change variants, then explicitly Refresh in PI; there is no runtime reload interface. Before T055 invoke node streamdeck/scripts/mock-bridge.mjs --catalog <variant> from the repo root; afterward task plugin:mock -- --catalog <variant> forwards the same option. Quickstart section 2 documents baseline → renamed → deleted → duplicate-labels → empty → baseline and expected selection behavior.

Fixture records received command count/type/parameter and outcome without token/full URL, including rejected command requests; health/catalog never increment that count. Counts reset on process restart, so evidence compares before/after within each run. Separate processes/modes allow manual recovery scenarios. It is explicitly invoked only, never automatically started by check or package.

## CI

Add .github/workflows/streamdeck.yml with Ubuntu/Node 24, installation of repository Task through make tools using the tools/task Go version, then task plugin:deps and task plugin:check. Pin Actions to verified commit SHAs at implementation, matching repository convention. No local installed app is required.

Existing controller workflow and macOS build-only contract remain unchanged. task check remains the Linux Go suite. UI installation, hardware observations, profile export and human usability measurements are local/manual. No speculative coverage threshold.

## Package content and validation

Source-controlled runtime directory contains manifest, static images, inspector HTML/CSS, local vendor distribution/license/source/checksum and .sdignore. Build adds bin/plugin.js and ui/inspector.js, with all required runtime JS dependencies bundled or explicitly accounted for; no dependency on the developer's node_modules after installation.

.sdignore plus check-package.mjs exclude logs, source maps, local settings, presets, generated URLs, tests, mock fixture, .test-build, private fixtures and developer files from distribution. Check verifies five matching UUIDs, all manifest paths, supported versions, vendor checksum, required licenses and no runtime remote assets. Inspect pack report/archive entries as delivery evidence; do not use real secrets as scanning arguments or fixtures.

Output: dist/com.obalunenko.mergbw.streamDeckPlugin. A repeated package task can replace this generated installer with --force. No publishing or Marketplace action occurs.

## Documentation delivery

Both README files include identical workflow names, prerequisites, offline/local nature, first import, five actions, language selector, catalog refresh after restart, attention-overlay meaning, unknown-result/late-write behavior, log location and old Website compatibility. A version change updates manifest and instructions together; no token, real identity or full user command URL in examples.
