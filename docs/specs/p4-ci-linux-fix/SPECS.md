---
status: done
ticket:
---

# p4-ci-linux-fix

## Problem

The `check (Linux)` CI job has failed its Unit tests step since `p4-env-wsl` (PR #29 and its merge, runs `45759188885` and `45759278127`). Windows, macOS and every e2e job pass. Two pieces of code assume a Windows host:

- `linuxResult` in `src/main/env/wsl.ts` returns any `/`-prefixed `realpath` or `readlink` result unchanged, so on a Linux host, where the test's share root is a POSIX path, a share path is never mapped back.
- `environmentFor` in `src/main/env/index.ts` checks the platform before the WSL distribution name.

A main branch with a red required job breaks the project's merge rule (CLAUDE.md: CI green on every job).

## Goals

- **G1:** `check (Linux)` passes again, with no change in behaviour on Windows and no existing assertion changed.
- **G2:** The fix covers every failure that `check (Linux)` reports on `main` after the merge of PR #30 (`4965bb1`, the SSH work), under the same rules.

## Non-goals

- Any other cleanup, refactor or new feature.
- Changes to `.github/workflows/ci.yml`.
- The live-walk leftovers, `bash.exe.stackdump`, and the runtime checks recorded in earlier summaries.

## Design

### `linuxResult` (`src/main/env/wsl.ts`)

A result from `realpath` or `readlink` becomes a Linux path by these rules, in order:

1. **Inside the share root:** a native-absolute result that lies inside the share root (`linuxFor` gives non-null) maps back to its Linux path.
2. **A Linux path:** a `/`-prefixed result counts as a Linux path, returned unchanged, only when the share root is not itself POSIX-absolute, that is, a UNC root as in the app.
3. **Relative:** a relative link target is kept as written, as today.
4. **Anything else** is a host path outside the share: `ENOENT`.

On Windows with a UNC share root, the result is the same as today for every input. `shareFor` and `linuxFor` are unchanged.

### `environmentFor` (`src/main/env/index.ts`)

For `{ kind: 'wsl' }`, check the distribution name first (`UNSUPPORTED_ENVIRONMENT` for a bad or missing name), then the platform (`WSL_UNAVAILABLE` off `win32`). Every other kind is unchanged.

### Further `check (Linux)` failures

Every other Unit tests failure on `main` at `4965bb1` (or on this work's pull request) is fixed in the product code or the test support, with its cause stated in `changes.md`. A failure that cannot be fixed without changing an existing assertion is a spec problem, and the build pauses.

## Acceptance criteria

- **AC1:** With a POSIX share root, `realpath` and `readlink` give the Linux path for a result inside the share, and `ENOENT` for a host path outside it. With a UNC share root, a `/`-prefixed result is returned unchanged, as before. New unit cases cover both roots, with no symlink needed for the UNC case (it can call the mapping through an exported helper or a fake).
- **AC2:** `environmentFor({ kind: 'wsl' })` gives `UNSUPPORTED_ENVIRONMENT` on every platform; a valid name off Windows gives `WSL_UNAVAILABLE`; the existing `env-wsl` and `env-local` cases pass unchanged.
- **AC3:** Every other `check (Linux)` Unit tests failure on `main` at `4965bb1` is fixed, or the summary says that run reported none.
- **AC4:** No existing test assertion changes (`git diff main -- tests/` shows only added cases or dependency wiring).
- **AC5:** Docs:
  - a `CHANGELOG.md` `[Unreleased]` **Fixed** entry;
  - the share-result rule in the WSL "Share" bullet of `docs/environments.md`;
  - a line under the `p4-env-wsl` follow-ups in `docs/phases/phase-04-progress.md`, saying the Linux CI failures are fixed by `p4-ci-linux-fix`.
- **AC6:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally. The pull request's CI run is green on every job, including `check (Linux)`; that run is the evidence for G1, checked after the push.

## Open questions

- None.
