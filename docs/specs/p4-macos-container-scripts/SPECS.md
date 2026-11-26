---
status: approved
ticket:
---

# p4-macos-container-scripts

## Problem

PR #33 (`p4-macos-ci-fix`) runs `pnpm test` in the macOS CI job, and that step fails in `tests/unit/container-scripts.test.ts` (run `45897046086`). The test runs the container backend's fixed files scripts through the host's `/bin/sh` as well as through the fake docker. The stat scripts (`src/main/env/container.ts:120`, `:125`) call `stat -c`, which is GNU and BusyBox syntax, and macOS BSD `stat` rejects it. So three scenarios fail there: stat of a file, stat of a folder, and lstat of a dangling link. The backend runs the scripts inside a Linux container, so only the test assumes a GNU host.

## Goals

- **G1:** The real-shell AC4 test passes on a host whose `stat` rejects `-c`, by skipping only the stat scenarios there, with no product change and no assertion changed.
- **G2:** On hosts whose `stat` accepts `-c` (Linux CI), all 51 scenarios run as before.

## Non-goals

- Product code: `src/main/env/container.ts` keeps `stat -c`.
- The CI workflow, and PR #33's own files and texts.
- Other tests.

## Design

- In `tests/unit/container-scripts.test.ts`, next to `SH`, add `STAT_C`.
  - When `SH` is not null, it runs `SH -c 'stat -c %s "$1"' sh <file>` once, on a file in a temp folder made for the probe and removed afterwards.
  - It is true only when that exits 0. When `SH` is null it is false, which does not matter, because the block is skipped then.
- A scenario is a stat scenario when its `body` is `FILES_SCRIPTS.stat` or `FILES_SCRIPTS.statFollow`. Each stat scenario's `it` is `it.skipIf(!STAT_C)`, and every other scenario keeps its plain `it`. The scenario list, the names, the bodies and the two `expect` lines do not change.
- The header comment says that the stat scenarios are skipped where the host's `stat` rejects `-c` (macOS BSD `stat`), and that the scripts run inside a Linux container in the product.

## Acceptance criteria

- **AC1:** `git diff main -- tests/unit/container-scripts.test.ts` shows only the probe, the skip condition on the stat scenarios and the comment. No scenario, name, body or `expect` line changes, and no other test file or `src/` file changes.
- **AC2:** On a host where `stat -c` works (Linux), all 51 scenarios run. On a host where it does not, exactly the 6 stat scenarios are reported as skipped and the rest run. Where there is no `/bin/sh` (Windows), the block is skipped as before. The Linux behaviour is checked by a local Linux run if one is available, and in CI. The macOS behaviour is checked by PR #33's macOS job after this merges.
- **AC3:** Docs:
  - a `CHANGELOG.md` `[Unreleased]` **Fixed** line;
  - a follow-up under the phase 4 follow-ups in `docs/phases/phase-04-progress.md`. It says that after PR #33 merges, its CHANGELOG macOS entry and its `docs/environments.md` checklist line should say `realpathSync.native(tmpdir())`, not `realpathSync(tmpdir())`.
- **AC4:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally. This pull request's CI is green on every job.

## Open questions

- None.
