# Quickstart: validate scene support

## Without a lamp

```bash
task test:core          # protocol catalog/frames, HTTP, config URLs
task test:race
task vet && task build
task plugin:check:software   # Stream Deck lint, typecheck, tests, build
./sunset dry-run scene disco # expect 55 01 FF 06 01 A2 then 55 06 FF 06 87 17
./sunset dry-run scene 8a    # expect route scene/8A, frame ... 8A 14
./sunset dry-run scene 94    # expect error, no frames
./sunset dry-run scene "green prairie"  # expect error listing slugs
```

Expected: frames match [contracts/scenes.md](contracts/scenes.md) exactly;
`streamdeck-buttons.txt` (via `./sunset urls`) lists 20 scene links after the
brightness lines and prior lines are unchanged.

## With the LT-06 (manual, pending)

1. Start the controller (`task run` or the Stream Deck plugin).
2. For each ID `80`–`93`: `./sunset send scene <ID>`; note what the lamp does.
3. Start a preset effect, then `./sunset send scene disco`; the effect must
   stop and the lamp must stay on the scene.
4. Run a scene, then `./sunset send brightness 20`; note whether the scene
   dims, stops, or ignores it (FR-012).
5. In Stream Deck add the Scene action, pick a scene, press it; restart the
   plugin and confirm the selection persists.

Record each observation in `hardware-verification.md`. An HTTP 200 or
`sent: true` is not a pass for steps 2–4.
