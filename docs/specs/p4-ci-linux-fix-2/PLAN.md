# Plan: p4-ci-linux-fix-2

Ticket: none (vibe planning; CI fix during Phase 4)
Status: approved
Date: 2026-11-26

## Objective

After `p4-ci-linux-fix` (PR #31, merge `b827150`), `check (Linux)` still fails one unit test: `tests/unit/env-recording.test.ts:190`, the `run_command` case over the WSL backend. Its fixture `share/usr/bin/tool` is written with the default mode `0644`. The program lookup checks `files.access(…, 'execute')`, which the WSL backend maps to `fs.access(…, X_OK)` on the share. Windows treats `X_OK` as an existence check, so the case passes there. On a Linux host the file is not executable, so the program is refused. This work makes the fixture executable, so `check (Linux)` passes. Nothing else changes.

## Scope

- **In:**
  - `tests/unit/env-recording.test.ts`: in the WSL `beforeAll`, write `share/usr/bin/tool` with mode `0o755`. This is a setup change; no assertion changes.
  - Docs:
    - a `CHANGELOG.md` `[Unreleased]` **Fixed** line, or an update to the existing Linux CI Fixed entry;
    - the `p4-env-wsl` follow-up line in `docs/phases/phase-04-progress.md` (the "Linux CI failures" line), saying the last case is fixed by `p4-ci-linux-fix-2`.
- **Out:**
  - Product code. The WSL backend runs only on Windows in the app, so `access('execute')` is correct there.
  - Any other test, the CI workflow, and any cleanup.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Where to fix | The test fixture's file mode (setup only) | Make the WSL backend's `access('execute')` ignore the mode bits (a product change for a test-only host); skip the case on Linux (hides coverage) |
| Slug and branch | `p4-ci-linux-fix-2` on `feature/p4-ci-linux-fix-2` from `main` (`b827150`) | (default, not asked) |
| Proof | The pull request's CI run, green on every job, including `check (Linux)` | (a Windows host cannot run the Linux job) |

## Approach

1. Add `{ mode: 0o755 }` to the `writeFileSync` of `share/usr/bin/tool` in the WSL `beforeAll` of `tests/unit/env-recording.test.ts`.
2. Docs: the CHANGELOG and the progress follow-up line.
3. Local checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`.
4. After the push, the pull request's `check (Linux)` job must be green before the merge.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Only this case still fails on Linux | Annotations of job `140055359006` (run `45862070215`, `b827150`): one test failure, `env-recording.test.ts:190`, plus the exit line |
| The lookup checks execute | `src/main/commands/lookup.ts:53`: `await env.files.access(file, 'execute')` |
| WSL maps execute to `X_OK` on the share | `src/main/env/wsl.ts:230`: `fsp.access(share(path), mode === 'execute' ? constants.X_OK : constants.F_OK)` |
| The fixture has no mode | `tests/unit/env-recording.test.ts` `beforeAll`: `writeFileSync(join(share, 'usr', 'bin', 'tool'), '#!/bin/sh\n')` |

## Risks

- **Linux is proven only by CI.** If another hidden Linux difference shows up after this case passes, that would need one more fix.

## Open questions

None.
