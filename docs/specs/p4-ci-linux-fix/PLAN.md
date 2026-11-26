# Plan: p4-ci-linux-fix

Ticket: none (vibe planning; CI fix during Phase 4)
Status: approved
Date: 2026-11-26

## Objective

Since `p4-env-wsl` (PR #29), the `check (Linux)` CI job fails in its Unit tests step. Windows, macOS and every e2e job pass. The failures come from code that only works when the host is Windows. This work fixes the CI errors only, so `check (Linux)` is green again, with no other change in behaviour.

## Scope

- **In:**
  - **`src/main/env/wsl.ts`, `linuxResult`:** it treats every `realpath` or `readlink` result that starts with `/` as already being a Linux path. That is true in the app, where the share root is a UNC path (`\\wsl.localhost\<distro>`), but not on a Linux host, where the test's fake share root is itself a POSIX path (`/tmp/.../share`). The fix:
    - map a result that lies inside the share root back to its Linux path first;
    - treat a `/`-prefixed result as a Linux path only when the share root is not a POSIX path (a UNC root);
    - otherwise, a host path outside the share is `ENOENT`, as the contract says.

    This fixes `tests/unit/env-wsl.test.ts` (the `realpath` case at line 109, and the symlink cases at lines 257 and 263, which run only where symlinks can be made) and the WSL cases in `tests/unit/env-recording.test.ts` (lines 162, 174 and 188), which fail the root check that goes through `realpath`.
  - **`src/main/env/index.ts`, `environmentFor`:** it checks the platform before the WSL distribution name. So off Windows, `{ kind: 'wsl' }` with no name gives `WSL_UNAVAILABLE`, while `tests/unit/env-local.test.ts:173` expects `UNSUPPORTED_ENVIRONMENT`. The fix: check the name first, then the platform. The existing WSL cases still hold: a valid name off Windows is `WSL_UNAVAILABLE`, and a bad name on Windows is `UNSUPPORTED_ENVIRONMENT`.
  - **Any other failure in `check (Linux)` on the merge of PR #30** (`4965bb1`, the SSH work), once that run reports. Each is fixed the same way, in the product code or test support, with no existing assertion changed. A failure that cannot be fixed without changing an assertion pauses the build as a spec problem.
  - **Docs:** a `CHANGELOG.md` Unreleased **Fixed** entry, and one line under the `p4-env-wsl` follow-ups in `docs/phases/phase-04-progress.md` saying the Linux CI failures are fixed. The shared-root rule goes in `docs/environments.md`, in the WSL section's Share bullet, because it changes how a result is mapped back.
- **Out:**
  - Any change to behaviour on Windows, or to the app's real WSL or SSH paths, beyond the two rules above.
  - Any other cleanup, refactor or new test beyond what a fix needs.
  - CI workflow changes (`.github/workflows/ci.yml`).
  - The live-walk leftovers, `bash.exe.stackdump`, and the runtime checks listed in earlier summaries.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Scope | Fix the CI errors only (the user's words) | Fix them and also clean up related code |
| Feature slug and branch | `p4-ci-linux-fix` on `feature/p4-ci-linux-fix` from `main` (`026c76c`) | (default, not asked) |
| How `linuxResult` tells a Linux result from a host path | Inside the share root → map back; else `/`-prefixed counts as Linux only with a UNC share root; else `ENOENT` | Branch on `process.platform` (the platform is a host detail, and the share root already says it); skip the cases on Linux (would hide a real mapping bug) |
| `environmentFor` order | The name check first, then the platform | Change the `env-local` assertion (refused: no existing assertion changes) |
| The SSH run's failures, if any | Fixed in this same work, with no assertion changed | A separate spec |
| How to verify | The pull request's CI run, green on every job. A Windows host cannot run the Linux job; the local checks still run | Running the suite in WSL (the repo's `node_modules` are built for Windows) |

## Approach

1. Fix `linuxResult` in `src/main/env/wsl.ts`, keeping `linuxFor` and `shareFor` as they are.
2. Reorder the checks in `environmentFor` in `src/main/env/index.ts`.
3. When the run on `4965bb1` (or this branch's pull request) shows more `check (Linux)` failures, read each one and fix it under the same rules.
4. Docs: the CHANGELOG, `docs/environments.md` and the progress follow-up.
5. Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` locally. The pull request's CI run is the proof that `check (Linux)` passes.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Only `check (Linux)` fails, in Unit tests, on PR #29 and its merge | GitHub API, jobs of runs `45759188885` and `45759278127`: e2e on all three OSes pass |
| The failing assertions | Check-run annotations of job `139705383837`: `env-wsl.test.ts` 109, 257, 263; `env-recording.test.ts` 162, 174, 188; `env-local.test.ts` 173 |
| `linuxResult` returns any `/`-prefixed result unchanged | `src/main/env/wsl.ts` `linuxResult`: `if (result.startsWith('/')) return result;` comes first |
| `environmentFor` checks the platform before the name | `src/main/env/index.ts`: `if (platform !== 'win32') return { ok: false, reason: WSL_UNAVAILABLE }` comes before `isDistributionName` |
| The WSL tests agree with the name-first order | `tests/unit/env-wsl.test.ts:855-881`: a valid name off Windows is `WSL_UNAVAILABLE`, and a bad name on `win32` is `UNSUPPORTED_ENVIRONMENT` |

## Risks

- **The run on `4965bb1` is still queued,** so the SSH work's behaviour on Linux is unknown. It may add failures (the symlink case and the real POSIX shell quote test only run on Linux). Those are taken in under the same scope.
- **Linux cannot be reproduced locally,** so a fix is only proven by CI. That may take more than one push of the pull request.

## Open questions

None.
