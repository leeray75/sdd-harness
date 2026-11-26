# Changes: p4-ci-linux-fix

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-ci-linux-fix/changes.md | created | The record of the files this build touched, with the T3 annotation review below. | T1-T5 |
| docs/specs/p4-ci-linux-fix/tasks.md | edited | Ticked T1 to T5 after each check passed. T5's AC6 check (the pull request's CI run) is still to do after the push. | T1, T2, T3, T4, T5 |
| src/main/env/wsl.ts | edited | `linuxResult` now applies the four rules in order: a native absolute result inside the share root maps to its Linux path; a `/`-prefixed result is returned unchanged only for a non-POSIX (UNC) share root; a relative result is kept; anything else is `ENOENT`. It is exported so the tests can call it. This fixes the realpath, readlink and WSL root-check failures on a Linux host. `shareFor` and `linuxFor` are unchanged. | T1 |
| src/main/env/index.ts | edited | `environmentFor` for `kind: 'wsl'` checks the distribution name first (`UNSUPPORTED_ENVIRONMENT`), then the platform (`WSL_UNAVAILABLE` off `win32`). The doc comment now states that order. This fixes the env-local case that expected `UNSUPPORTED_ENVIRONMENT` on Linux. | T2 |
| tests/unit/env-wsl.test.ts | edited | Import line adds `linuxResult` (dependency wiring only). New cases only: AC1 string cases for a POSIX root and a UNC root (inside, outside, `/`, relative), with a small `errorCodeOf` helper; AC2 cases for the name-before-platform order and for a valid name off Windows. No existing assertion changed (`git diff main -- tests/` shows only additions and the import line). | T1, T2 |
| CHANGELOG.md | edited | `[Unreleased]` **Fixed** entry for the Linux CI unit test failures. | T4 |
| docs/environments.md | edited | The WSL "Share" bullet states the four-rule share-result mapping that replaces the one-line description. | T4 |
| docs/phases/phase-04-progress.md | edited | A line under the `p4-env-wsl` follow-ups: the Linux CI failures are fixed by `p4-ci-linux-fix`. | T4 |

## T3: annotations of `check (Linux)`

- Newest `main` run: `45859620722` (`026c76c`), job `140050027176`, conclusion `failure`. Its Unit tests step is the only failing step.
- Also read: `45859481598` (`4965bb1`), job `140046432204`, same failing step and the same seven failures.
- The annotations list seven test failures plus the exit line `Process completed with exit code 1` (path `.github`, not a test). Each failure is covered:
  - `env-wsl.test.ts` readlink, Linux form (line 263), and the outside-share ENOENT case (line 257): T1, `linuxResult`.
  - `env-wsl.test.ts` realpath of an existing file (line 109): T1, `linuxResult`.
  - `env-recording.test.ts` read tool (line 164), write tool (line 176): T1. Both fail at the root check, `the root is not a readable directory`, because `resolveInRoot` (`src/main/tools/paths.ts`, line 140) gets the host path back from `realpath` and the share `stat` then fails.
  - `env-recording.test.ts` run_command (line 190): T1 by the same cause. The message `expected [] to include 'ran'` is Vitest coercing a `false` value (`result.ok` was `false`) through `Array.from`. `runCommandInRoot` calls `resolveInRoot` on the root first, so it refuses at the same point.
  - `env-local.test.ts` line 173: T2, `environmentFor`.
- No other failure was reported, so no further product or test-support change was needed.
- Not run here: the Linux job itself. The run_command case (line 190) and the two symlink cases are checked by reasoning and by the Windows run, not by a Linux run. The symlink cases skip on this Windows machine, because it cannot create symbolic links without developer mode.

## Checks run

- `pnpm exec vitest run tests/unit/env-wsl.test.ts tests/unit/env-recording.test.ts`: 2 files passed, 80 tests passed, 2 skipped (symlink cases, Windows).
- `pnpm exec vitest run tests/unit/env-local.test.ts tests/unit/env-wsl.test.ts`: 2 files passed, 77 tests passed, 2 skipped.
- `pnpm test`: 90 files passed, 1892 tests passed, 18 skipped.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed (exit 0).
- `pnpm format:check`: passed.
- `git diff main -- tests/`: only added cases and the import line.
