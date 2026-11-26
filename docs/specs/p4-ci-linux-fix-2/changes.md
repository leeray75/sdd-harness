# Changes: p4-ci-linux-fix-2

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/unit/env-recording.test.ts | edited | The WSL `beforeAll` writes `share/usr/bin/tool` with `{ mode: 0o755 }`, so `fs.access(…, X_OK)` passes on Linux. No assertion changed. | T1 |
| docs/specs/p4-ci-linux-fix-2/tasks.md | edited | Ticked T1 after its check passed. | T1 |
| CHANGELOG.md | edited | Added a Fixed line under `[Unreleased]` for the last Linux CI unit test case (AC2). | T2 |
| docs/phases/phase-04-progress.md | edited | The "Linux CI failures" follow-up now says the env-recording `run_command` case is fixed by `p4-ci-linux-fix-2` (AC2). | T2 |
| docs/specs/p4-ci-linux-fix-2/tasks.md | edited | Ticked T2 after `pnpm format:check` passed. | T2 |
| docs/specs/p4-ci-linux-fix-2/tasks.md | edited | Ticked T3 after typecheck, lint, format:check and test passed. | T3 |
| docs/specs/p4-ci-linux-fix-2/changes.md | created | The record of this build's changes. | T1, T2, T3 |
