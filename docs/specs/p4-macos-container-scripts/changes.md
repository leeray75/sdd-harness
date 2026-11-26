# Changes: p4-macos-container-scripts

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/unit/container-scripts.test.ts | edited | Adds the one-time `STAT_C` probe (`stat -c %s` through `SH` on a temp file, removed after), makes the six stat scenarios `it.skipIf(!STAT_C)`, and updates the header comment. No scenario, name, body or `expect` line changed. A line was re-wrapped to satisfy Prettier. | T1, T4 |
| docs/specs/p4-macos-container-scripts/tasks.md | edited | Ticks T1 to T4 after each check passed. | T1, T2, T3, T4 |
| CHANGELOG.md | edited | Adds a `Fixed` line under `[Unreleased]` for the macOS container scripts test failure. | T3 |
| docs/phases/phase-04-progress.md | edited | Adds the `p4-macos-container-scripts` follow-up: the `realpathSync.native(tmpdir())` wording for PR #33, and the macOS check still to run. | T3 |
| docs/specs/p4-macos-container-scripts/changes.md | created | This record of the files touched. | T1 |
