# Owner verification: plugin auto-release and update offer

Happy-path checks only (home use). Software checks do not prove these rows.
Record each as observed, or as an accepted gap when it is not observed. A
successful install does not prove lamp state.

| # | Check | Criterion | Result |
|---|---|---|---|
| 1 | A tag publishes a release whose installer shows `X.Y.Z.0` in Stream Deck | SC-001 | observed 2026-10-26: `v1.0.0` published by the workflow; installer `release.json` `{tag: v1.0.0, build: 0}`, manifest `1.0.0.0`, checksum matches `SHA256SUMS` |
| 2 | A browser-downloaded installer installs after the quarantine step; one lamp command works | SC-002 | partly observed 2026-10-26: the `v1.0.0` installer (fetched with `gh`, so not quarantined) installed over a linked 0.2.0.0; log shows `plugin.ready` and `update.checked` `up_to_date`. Lamp works after the later v1.0.2 update (owner, 2026-10-26). Browser download with the quarantine step not exercised: accepted gap |
| 3 | A local build shows `X.Y.Z.N` | FR-002a | observed 2026-10-26: local `spike` build stamped `1.0.0.3`, `release.json` `{tag: v1.0.0, build: 3}`. First run picked `v0.1.0` because it shares a commit with `v1.0.0`; fixed to take the highest reachable tag |
| 4 | A newer stable release opens Stream Deck's install prompt on its own, or via Check now | FR-007a | accepted gap: needs a release after v1.0.2 (v1.0.0 predates the prompt). v1.0.0 found v1.0.1 and v1.0.2 via Check now (`update.checked` `available`) and showed the banner |
| 5 | Banner Install opens Stream Deck's prompt; after confirming, settings and keys are kept, and one lamp command works | SC-004, FR-012 | observed 2026-10-26: v1.0.0 → v1.0.2 through the banner; `release.json` `{tag: v1.0.2, build: 0}`; owner reports keys, settings and lamp OK. The v1.0.1 attempt failed safely on `./` names in `SHA256SUMS` (fixed in v1.0.2) |
