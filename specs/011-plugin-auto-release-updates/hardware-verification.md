# Owner verification: plugin auto-release and update offer

Software checks do not prove these rows. Record each as observed, or as an
accepted gap when it is not observed. A successful install does not prove
lamp state.

| # | Check | Criterion | Result |
|---|---|---|---|
| 1 | A prerelease tag publishes a release whose installer shows `X.Y.Z.0` in Stream Deck | SC-001 | pending |
| 2 | A browser-downloaded installer installs after the documented quarantine step; one lamp command works | SC-002 | pending |
| 3 | Skipping the quarantine step shows the `launch_blocked` help with the `xattr -dr` command | FR-004 | pending |
| 4 | A local build shows `X.Y.Z.N`, and `N` grows on the next build | FR-002a | pending |
| 5 | A newer stable release raises one macOS notification, shown once across a plugin restart | FR-007a | pending |
| 6 | Banner Install opens Stream Deck's prompt; after confirming, settings, presets, keys and language are kept, and one lamp command works | SC-004, FR-012 | pending |
| 7 | Later hides the banner until restart | US3-3 | pending |
