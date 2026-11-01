# Contract: MeRGBW steps in Stream Deck Multi Action

Supersedes the `SupportedInMultiActions:false` decision in
`specs/006-streamdeck-control-plugin/contracts/plugin.md`. Every other
statement of that contract stands.

## Manifest

- All seven actions (`com.obalunenko.mergbw.on`, `.off`, `.color`, `.scene`,
  `.brightness`, `.preset`, `.transition`) declare
  `"SupportedInMultiActions": true`.
- UUIDs, names, tooltips, icons, `Controllers`, `Encoder`, `States`,
  `DisableAutomaticStates` and the shared `PropertyInspectorPath` are
  unchanged.
- The package check (`streamdeck/scripts/check-package.mjs`) fails with
  `action paths or behavior` when any action has the field set to `false`
  or missing.

## Step events

| Event | Step behavior |
| --- | --- |
| `willAppear` (`isInMultiAction: true`) | Receive settings; register for operation results; no `setTitle` or `setImage` |
| `didReceiveSettings` | Same as a key: new settings revision |
| `keyDown` (`isInMultiAction: true`) | Same validation, route and command as a key with the same assignment; dispatched immediately; operation flagged `multiAction` |
| `keyUp` | Ignored, as for keys |
| `willDisappear` | Unregister; close the panel binding; a pending operation still finishes |
| `propertyInspectorDidAppear` / `sendToPlugin` | Same panel and messages as a key |

## Ordering

- The plugin keeps no queue and does not wait across contexts. Each step's
  request is sent when its `keyDown` arrives.
- The controller admits one command at a time before connecting. A request
  that arrives after an admitted one waits for it to return. This is the
  existing behavior and is not changed.
- Order across steps is the owner's responsibility through Stream Deck
  Delay. Without a Delay, order is not guaranteed.

## Feedback

| Outcome | Key | Step |
| --- | --- | --- |
| invalid / rejected before request | `showAlert` | `showAlert` |
| sent | `showOk` | `showOk` |
| accepted (effect or transition started or stopped) | title "Accepted" | nothing on the key; status in the step panel |
| rejected / unknown after request | `showAlert` | `showAlert` |
| runtime title/icon defaults and lifecycle titles | written | never written |

Where Stream Deck renders `showOk` and `showAlert` for a step is outside the
plugin's control and is recorded in hardware verification.

## Diagnostics

- `action.rejected`, `action.started`, `action.sent`, `action.accepted` and
  `action.unknown` for a step add `multiAction: "true"`. Key events omit the
  field.
- No other field changes. The token, full URL and assignment values are
  never logged.

## Unchanged interfaces

- Controller HTTP routes, methods, statuses and JSON; CLI; protocol packets;
  settings, presets and managed configuration files.
- Standalone keys, the Stream Deck+ Brightness dial, preset effect start and
  stop rules, and transition rules.
