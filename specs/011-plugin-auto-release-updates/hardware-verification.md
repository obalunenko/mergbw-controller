# Owner verification: plugin auto-release and update offer

Happy-path checks only (home use). Software checks do not prove these rows.
Record each as observed, or as an accepted gap when it is not observed. A
successful install does not prove lamp state.

| # | Check | Criterion | Result |
|---|---|---|---|
| 1 | A tag publishes a release whose installer shows `X.Y.Z.0` in Stream Deck | SC-001 | pending |
| 2 | A browser-downloaded installer installs after the quarantine step; one lamp command works | SC-002 | pending |
| 3 | A local build shows `X.Y.Z.N` | FR-002a | pending |
| 4 | A newer stable release raises a macOS notification and the banner | FR-007a | pending |
| 5 | Banner Install opens Stream Deck's prompt; after confirming, settings and keys are kept, and one lamp command works | SC-004, FR-012 | pending |
