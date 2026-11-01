# Research: MeRGBW actions in Multi Action

Sources: installed `@elgato/streamdeck` 3.0.3 typings and runtime
(`dist/api/events/action.d.ts`, `dist/api/events/keypad.d.ts`,
`dist/plugin/actions/key.{d.ts,js}`), `@elgato/schemas` plugin manifest
typings, and repository code as of `136e224`.

## R1. How actions become visible in Multi Action

**Decision**: Set `"SupportedInMultiActions": true` explicitly on all seven
actions.

**Rationale**: The manifest schema says the flag "determines whether the
action is available to users when they are creating multi-actions. Default
is `true`." The current explicit `false` is the only reason the category is
missing. Multi Action Switch uses the same availability.

**Alternatives considered**: Removing the field to rely on the default. This
was rejected because the package check should assert an explicit, reviewed
value rather than an absent field.

## R2. Detecting a step

**Decision**: Use `ev.payload.isInMultiAction === true` from `willAppear` and
`keyDown`.

**Rationale**: The SDK types `willAppear`, `willDisappear`,
`didReceiveSettings` and `keyDown` as `MultiActionPayload |
SingleActionPayload`, with a literal `isInMultiAction: true | false`.
`KeyAction.isInMultiAction()` only returns that payload field. Reading the
payload works with the existing test facades, which build plain `{ id,
isKey, … }` actions without that method. A missing field means a key, so
current tests stay valid.

**Alternatives considered**: `ev.action.isInMultiAction()`. It reads the same
data, but every existing facade would need the method. `coordinates ===
undefined` was rejected because it is indirect.

## R3. Settings, panel and storage for a step

**Decision**: No change. Steps use `settings.receiveAction`,
`settings.getAction`, `setAction` through `streamDeck.actions.getActionById`,
and the shared inspector.

**Rationale**: The SDK constructs a `KeyAction` for a step (its constructor
accepts `isInMultiAction` and leaves coordinates undefined) and registers it
like any other action. `willAppear` and `didReceiveSettings` carry the step's
settings. The inspector reply path checks `streamDeck.ui.action?.id ===
context`, which is the step's context while its panel is open in the Multi
Action editor. On the device, owner row 2 verifies the panel and
persistence.

**Alternatives considered**: None needed.

## R4. Ordering without a plugin queue

**Decision**: Dispatch each step immediately, like a key. Do not add a queue
or cross-context waiting. The owner orders steps with Stream Deck Delay
(spec clarification, 2026-11-01).

**Rationale**: `Controller.Execute` takes the single-slot `gate` in `admit`
before `link.Connect` and holds it through every packet write and the single
retry (`internal/controller/controller.go`). A command that reaches the
controller after an earlier one has been admitted waits until that one
returns, including during a reconnect. A short Delay only has to cover the
earlier request's delivery to the controller. Without a Delay, near-
simultaneous HTTP requests race to the gate, so order is not guaranteed;
the READMEs document this.

**Alternatives considered**: A plugin-wide FIFO that waits for each command's
outcome. The owner rejected it in favor of Delay. It would also change
standalone key timing.

## R5. Appearance of a step

**Decision**: Do not call `setTitle` or `setImage` for steps: no runtime
defaults on appear, on settings or catalog refresh, or on lifecycle changes,
and no Accepted title. Keep `showOk` on sent and `showAlert` on invalid,
rejected or unknown.

**Rationale**: FR-009 forbids changing the Multi Action key's title and icon.
The SDK sends these writes with the step's context, and how Stream Deck
renders them for a step is not documented. Skipping them removes the risk.
`showOk` and `showAlert` are momentary, and they are the only failure signal
Stream Deck offers for a step. Where Stream Deck shows them is recorded by
owner row 6. The step panel and diagnostics remain the detailed outcome.

**Alternatives considered**: Treating steps exactly like keys. Rejected
because of the FR-009 risk. Suppressing `showOk` for steps was also rejected:
it adds a branch with no evidence it is needed.

## R6. Diagnostics flag

**Decision**: Add an optional `multiAction: true` to `OperationRecord` (set
at `acquire`) and `multiAction?: boolean` to `Diagnostic`. `emit` writes the
literal string field `multiAction: "true"` only for `true`.

**Rationale**: Diagnostic fields are `number | string` and pass an
allowlist. A record-level flag keeps the marker on `action.sent`,
`action.unknown` and similar events even after the step has disappeared.
The value is a fixed literal, so redaction is unaffected.

**Alternatives considered**: Looking up the step map at emit time. Rejected
because the flag would be lost after `willDisappear`.

## R7. Preset effects and Transition inside a Multi Action

**Decision**: No change to `PresetRuns`, `Preset` or `Transition`.

**Rationale**: Both work per context. Every pending record advances the
`PresetRuns` epoch and clears the effect owner, so a second Multi Action
press stops a running effect only if no other MeRGBW step ran before the
preset step; otherwise the preset starts again. This matches pressing the
keys by hand (spec edge case). An ordinary command interrupts an effect or
transition in the controller (`cancelActive`). Accepted results keep their
status and Stop controls in the step's panel.

**Alternatives considered**: Special-casing a "stop on repeat" rule for
steps. Rejected because the plugin cannot group steps of one Multi Action
press.

## R8. Multi Action Switch and states

**Decision**: No extra handling.

**Rationale**: All actions have one state with `DisableAutomaticStates`.
`userDesiredState` applies only to multi-state actions, so the plugin ignores
it.

## R9. Brightness and the dial

**Decision**: No change.

**Rationale**: A step's controller is always `Keypad`, so `Brightness` uses
the key path with its saved percent. `DialBrightness` is entered only for
`!isKey() && isDial()`.

## R10. Package check and the 006 contract

**Decision**: The check requires `SupportedInMultiActions === true`. Add a
one-line note in `specs/006-streamdeck-control-plugin/contracts/plugin.md`
that 012 supersedes the Multi Action ban.

**Rationale**: FR-012 and constitution governance require feature artifacts
to stay consistent with the shipped contract.

**Alternatives considered**: Dropping the field from the check. Rejected
because a silent regression to hidden actions would pass.
