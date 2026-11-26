---
status: approved
ticket:
---

# p4-ci-linux-fix-2

## Problem

After `p4-ci-linux-fix` (PR #31, `b827150`), `check (Linux)` still fails one unit test: `tests/unit/env-recording.test.ts:190`, the WSL `run_command` case (run `45862070215`, job `140055359006`). The fixture `share/usr/bin/tool` is written with mode `0644`. The program lookup's `files.access(…, 'execute')` becomes `fs.access(…, X_OK)` on the share, which fails on a Linux host but passes on Windows, where `X_OK` only checks that the file exists.

## Goals

- **G1:** `check (Linux)` passes, with no product change and no assertion changed.

## Non-goals

- Product code, other tests, the CI workflow, any cleanup.

## Design

- In the WSL `beforeAll` of `tests/unit/env-recording.test.ts`, write `share/usr/bin/tool` with `{ mode: 0o755 }`. Nothing else in the test changes.

## Acceptance criteria

- **AC1:** The fixture is written with mode `0o755`. `git diff main -- tests/` shows only that setup change, and no assertion changes.
- **AC2:** Docs:
  - a `CHANGELOG.md` `[Unreleased]` **Fixed** line for the last Linux case (or an update to the existing Linux CI entry);
  - the "Linux CI failures" follow-up in `docs/phases/phase-04-progress.md` says that the last case is fixed by `p4-ci-linux-fix-2`.
- **AC3:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally. The pull request's CI run is green on every job, including `check (Linux)`; that run is checked after the push.

## Open questions

- None.
