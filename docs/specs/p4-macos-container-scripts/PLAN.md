# Plan: p4-macos-container-scripts

Ticket: none (vibe planning; unblocks PR #33, `p4-macos-ci-fix`)
Status: approved
Date: 2026-11-26

## Objective

PR #33 adds `pnpm test` to the macOS CI job, and that step fails in `tests/unit/container-scripts.test.ts` (from `p4-env-container`, already on `main`). The test runs the container's fixed files scripts through the host's `/bin/sh` as well as the fake. The stat scripts call `stat -c`, which is GNU and BusyBox syntax, and macOS BSD `stat` rejects it (`stat: illegal option -- c`). So three cases fail on macOS: stat of a file, stat of a folder, and lstat of a dangling link. The backend runs these scripts inside a Linux container, so the product is not affected; only the test assumes a GNU host. This change makes the test skip the stat scenarios where the host's `stat` cannot take `-c`.

## Scope

- **In:**
  - **Probe:** in `tests/unit/container-scripts.test.ts`, run the host's `stat -c %s` once on a temp file, through the same POSIX `sh`. `STAT_C` is true when it exits 0.
  - **Skip:** the real-shell scenarios whose script is `FILES_SCRIPTS.stat` or `FILES_SCRIPTS.statFollow` (6 of 51) are skipped with `it.skipIf(!STAT_C)`. The other scenarios and the connect check still run on every host with a POSIX `sh`. On Linux (CI's `check` job, and the Linux matrix job once PR #33 lands) all 51 run as before.
  - **The test's header comment** says why the stat scenarios are skipped on macOS.
  - **Docs:**
    - a `CHANGELOG.md` `[Unreleased]` **Fixed** line;
    - a follow-up in `docs/phases/phase-04-progress.md`.

    PR #33 is not merged when this lands, so the `realpathSync(tmpdir())` → `realpathSync.native(tmpdir())` correction in its CHANGELOG entry and in `docs/environments.md` is recorded in that follow-up instead of being made here. Both texts exist only on PR #33's branch.
- **Out:**
  - Product code (`src/main/env/container.ts` keeps `stat -c`, which is right inside a Linux container).
  - Any assertion change.
  - The CI workflow, and PR #33's own files.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| What to skip where `stat -c` is refused | Only the 6 stat and statFollow scenarios. The other 45 scripts keep running through macOS `sh` | The whole real-shell block (simpler, but macOS loses 45 passing cases) |
| How to detect it | A probe of the host's `stat -c %s` on a temp file, run once | `process.platform === 'darwin'` (wrong for a Mac with GNU coreutils on `PATH`, and for BSDs) |
| The realpath doc correction | A follow-up in the progress file, since PR #33 has not merged | Editing those texts now (they are not on `main`) |
| Defaults stated, not asked | Feature `p4-macos-container-scripts` on `feature/p4-macos-container-scripts` from `main`. After it merges, PR #33's CI is re-run and #33 is merged once all four jobs are green | — |

## Approach

1. Add the probe and `STAT_C` near `SH` in `tests/unit/container-scripts.test.ts`.
2. Mark the stat scenarios (by their script body), and use `it.skipIf` for them when `STAT_C` is false.
3. Update the header comment, the CHANGELOG and the progress follow-up.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`. On Windows the block is skipped as before. Run the file through WSL's or a Linux `sh` if a Node 24 Linux run is handy. The proof is PR #33's macOS job after the merge.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The stat scripts use `stat -c` and `stat -L -c` | `src/main/env/container.ts:120`, `:125` |
| Six scenarios use those scripts | `tests/unit/container-scripts.test.ts:34-64` (`FILES_SCRIPTS.stat` ×4, `statFollow` ×2) |
| The real-shell block is gated only on `/bin/sh` | `tests/unit/container-scripts.test.ts:16`, `:354` |
| macOS fails 3 of 51 there, from BSD `stat` | PR #33 run `45897046086`, macOS `Unit tests` failed; merge notes §0 |
| PR #33 merges cleanly into `main` | A trial merge in a temp worktree: no conflicts |

## Risks

- **No local macOS run.** The fix is proven only by PR #33's macOS job after this merges. If the probe passes on the runner for some other reason, the job would still fail, and that would show at once.
- **Silent skips.** A host without `stat -c` skips the stat scenarios silently. Vitest reports them as skipped, and Linux CI runs them all.

## Open questions

None.
