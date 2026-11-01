# Data Model: MeRGBW actions in Multi Action

There is no persisted model change. Stream Deck stores a step's assignment in
the same per-action settings as a key. The plugin keeps step state only in
memory.

## Multi Action step

One MeRGBW action instance inside a Multi Action or Multi Action Switch.

| Field | Source | Notes |
| --- | --- | --- |
| context | Stream Deck action id | Unique per step; two Color steps are two contexts |
| kind | action UUID | One of `on`, `off`, `color`, `scene`, `brightness`, `preset`, `transition` |
| assignment | action settings | Same schema and validation as a key (`validation.ts`) |
| isInMultiAction | event payload | `true` for steps; missing or `false` means a key |

Lifecycle:

```text
willAppear(isInMultiAction) ─▶ Registered (settings received, operations.appear, no title/icon)
Registered ─keyDown─▶ Pending ─▶ Sent | Accepted | Rejected | Unknown ─▶ Registered
Registered ─didReceiveSettings─▶ Registered (new revision; no title/icon)
any ─willDisappear─▶ Gone (operations.disappear; a pending record finishes, then is dropped)
```

Rules:

- A keyDown while the same context is Pending is ignored (FR-007).
- A keyDown with an invalid assignment, no connection, or no runtime
  capability goes straight to Rejected without a request (FR-006, FR-008).
- A step never calls `setTitle` or `setImage` (FR-009).

## OperationRecord (extended)

The existing record in `streamdeck/src/operation-store.ts`.

| Field | Change |
| --- | --- |
| multiAction | NEW optional `readonly multiAction?: true`; set by `BaseAction` at `acquire` for steps; copied unchanged |

All other fields, the 45 s deadline and `canRender` are unchanged.

## Diagnostic (extended)

The existing input type in `streamdeck/src/diagnostics.ts`.

| Field | Change |
| --- | --- |
| multiAction | NEW optional `boolean`; emitted as `multiAction: "true"` only when `true`; omitted otherwise |

Events carrying it: `action.rejected`, `action.started`, `action.sent`,
`action.accepted`, `action.unknown`. The token, URL and settings are never
included.
