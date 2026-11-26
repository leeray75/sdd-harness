# Merge notes: `p4-macos-ci-fix` (PR #33)

Written 2026-11-26 by the agent that made the change, for whoever merges it — human or AI.
Every claim below has a command next to it. Sections 6 and 12 say plainly what was **proved**,
what is **inferred**, and what was **never verified**; do not treat this file as evidence for the
last category.

- Branch: `feature/p4-macos-ci-fix` → `main`
- Pull request: https://github.com/leeray75/sdd-harness/pull/33
- Head commit: `19ced5c4d7c5216d04d38d8f321b87096e5dd863`
- Green CI run: https://github.com/leeray75/sdd-harness/actions/runs/45894144761
- Scope: **10 files, +94/−46. No change under `src/`.** Tests and docs only.

## 1. What it does

`pnpm test` used to run only in `check (Linux)`. It now runs on Windows, macOS and Linux in the
matrix job (renamed `unit, e2e and package`). Running it on more OSes found 17 real failures that
nobody knew about: 9 on macOS and 8 on Windows, in two unrelated causes. Both were fixed in the
test harness. One case is skipped where the OS network wrapper makes its result unproducible.

## 2. Commits

| Commit    | What                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| `b32ddc8` | macOS unit-test fix (resolve the stand-in temp root), CHANGELOG, stale-doc refresh |
| `30b828a` | the CI change, and the wrapper-gated skip of the AC8 case                          |
| `642ba2e` | resolve the stand-in root with `realpathSync.native` (the Windows fix)             |
| `19ced5c` | record Windows green, record the flaky watch pair                                  |

## 3. Files

| File                                                                     | Change                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `.github/workflows/ci.yml`                                               | `Unit tests` step in the matrix job; job renamed            |
| `tests/unit/env-ssh.test.ts`, `env-wsl.test.ts`, `env-recording.test.ts` | temp root from `realpathSync.native(tmpdir())`              |
| `tests/unit/command-acceptance.test.ts`                                  | `WRAPPED` and `it.skipIf(WRAPPED)` on one AC8 case          |
| `CHANGELOG.md`                                                           | 1 `Added`, 2 `Fixed`, 2 `Known issues` entries              |
| `CLAUDE.md`                                                              | CI section rewritten; "on this machine = Windows" de-scoped |
| `README.md`                                                              | platform claim and Corepack prerequisite corrected          |
| `docs/environments.md`                                                   | backend checklist gains the resolved-root rule              |
| `docs/phases/phase-04-progress.md`                                       | `p4-macos-ci-fix` follow-up block                           |

## 4. Verify the scope (do this first)

```sh
git fetch origin
git diff --name-only origin/main...HEAD -- src/ tests/support/ tests/e2e/ tests/live/ docs/specs/
```

Expected: **no output.** The change touches no product code, no shared test support, no e2e or live
tests, and no sdd spec folder. If any file appears, stop and re-review.

```sh
git diff --stat origin/main...HEAD          # expect 10 files, +94/−46
```

## 5. Verify each claim

| Claim                                      | Command                                                                                                                     | Expected                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Unit tests run on 3 OSes                   | `grep -n "name: unit, e2e" .github/workflows/ci.yml`                                                                        | line ~51                                                               |
| …and are gating, not informational         | `grep -n "continue-on-error" .github/workflows/ci.yml`                                                                      | **no output**                                                          |
| Linux unit step precedes the sysctl        | `grep -n "Unit tests\|apparmor" .github/workflows/ci.yml`                                                                   | `Unit tests` line number < `apparmor` line                             |
| Root resolved with the native resolver     | `grep -n "realpathSync.native(tmpdir())" tests/unit/*.test.ts`                                                              | 4 hits (`env-ssh:49`, `env-wsl:38`, `env-wsl:247`, `env-recording:29`) |
| The code under test uses the same resolver | `grep -n "realpathSync.native" tests/support/fake-ssh-transport.ts` and `grep -n "nodeRealpath.native" src/main/env/wsl.ts` | `:204` and `:210`                                                      |
| One case is wrapper-gated                  | `grep -n "const WRAPPED\|it.skipIf(WRAPPED)" tests/unit/command-acceptance.test.ts`                                         | `:44` and `:362`                                                       |
| CI is green                                | `gh pr checks 33`                                                                                                           | 4 × `pass`                                                             |
| Full suite passes here                     | `pnpm test`                                                                                                                 | `1906 passed`, `0 failed`, `4 skipped`, 90 files                       |

## 6. Evidence quality — read this before repeating any claim

**Proved by direct experiment**

- _The macOS root cause is the symlinked temp dir._ On `origin/main` (before the fix), the same
  suite fails with the default `TMPDIR` and passes when `TMPDIR` points somewhere with no symlink:

  ```sh
  node -e "const fs=require('fs'),o=require('os');console.log(o.tmpdir(), fs.realpathSync(o.tmpdir()))"
  # macOS prints two different paths: /var/folders/… and /private/var/folders/…
  mkdir -p "$HOME/.sdd-tmp"   # under /Users, not behind a symlink
  TMPDIR="$HOME/.sdd-tmp" npx vitest run tests/unit/env-wsl.test.ts tests/unit/env-ssh.test.ts tests/unit/env-recording.test.ts
  # all pass on main, with no source change
  ```

  With default `TMPDIR` on `main` these same files produced 8 failures. That is a falsifiable
  check, and it is the strongest evidence in this change.

- _CI passes on all four jobs_ — see the run in the header, `gh pr checks 33`.
- _The suite passes locally on macOS_ — 1906 passed / 0 failed / 4 skipped, twice in a row, on
  Node 24.17.0 + pnpm 12.21.0.
- _No product code changed_ — section 4.

**Inferred, plausible, not proved**

- _Why Windows disagreed._ The failing assertion printed a Windows path where `/app/real` was
  expected, and the only asymmetry between the test and the code under test was the resolver
  (`realpathSync` vs `realpathSync.native`). Aligning them turned Windows green, which fits, but
  the exact Windows behaviour of the two resolvers was never observed directly — the branch was
  never built or run on a Windows machine by hand, only on the CI runner.
- _That `unshare` is unavailable on the Linux runner during `check`._ Inferred because the AC8
  wrapper case passes there. Not probed.

**Never verified — do not repeat as fact**

- **Windows unit tests green more than once.** One green run. Windows has no historical baseline at
  all; treat the first few runs as data.
- The WSL and SSH backends against real WSL or a real SSH server: `pnpm test:live` only skipped,
  because it needs `HARNESS_SSH_*` and a Windows+WSL host.
- `pnpm e2e` on Windows and Linux — CI runs it; it was run by hand on macOS only.
- Packaged app behaviour on Windows and Linux.
- `docs/specs/p4-macos-ci-fix/` **does not exist**. The sdd paper trail (PLAN, SPECS, SUBTASK,
  SUMMARY, build ledger) was deliberately not hand-written, because fabricating review rounds would
  be worse than having none.

## 7. Reproduce the local run

The machine used was macOS 27.2.1 on Apple Silicon. Two traps, both now in the README:

- The default Node was 26, which ships no Corepack, so `pnpm` and `corepack` were both missing.
  Node 24 is what `engines` and `.nvmrc` require.

  ```sh
  nvm install 24 && nvm use 24
  corepack enable pnpm          # gives pnpm 12.21.0 from package.json's packageManager
  pnpm install
  pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
  ```

- `pnpm format:check` covers Markdown. Doc edits must be Prettier-clean.

## 8. Merge procedure

Repo rule (`CLAUDE.md`): a pull request merges **only when CI is green on every job** — `check`,
and `e2e` on Windows, macOS and Linux.

1. `gh pr checks 33` — all four must be `pass`. If not, see §9 before assuming a regression.
2. `gh pr view 33 --json mergeable` must say `MERGEABLE`.
3. Merge. The user normally merges this repo's pull requests by hand.
4. **After the merge**, per `CLAUDE.md`, fill in the status and commit columns of the relevant row
   in `docs/phases/phase-04-progress.md`. Only those two fields; the rest of the docs work was done
   on the branch, as the rule requires.
5. Optional but recommended: replace this file's "one green run" caveat for Windows once a second
   Windows run goes green.

## 9. Triage a red run before calling it a regression

Two watch tests are load-sensitive and were previously invisible because only Linux ran them:

- `tests/unit/spec-watch.test.ts` — the case waiting for `onChange` within 2 s of an edited
  `SPECS.md`. Failed about once in seven full local runs, and passed 5/5 in isolation.
- `tests/unit/env-local.test.ts` — `the local watch part` case. Failed once in CI on macOS
  (`expected 0 to be greater than 0`) and passed on the next run.

Both poll behind a real wall-clock window, so a loaded runner can miss the event. If a run fails
**only** in one of those two cases, rerun the job. If anything else fails, it is a real finding, not
the known flake — and worth reporting rather than rerunning.

## 10. Three things not to "clean up"

1. **Do not delete the `it.skipIf(WRAPPED)` skip.** That AC8 case asserts
   `the program could not be started`, and under `sandbox-exec` (macOS) or `unshare` (Linux where it
   works) the _wrapper_ is the program that starts, so a target that cannot start returns the
   wrapper's exit code (71 from `sandbox-exec`, with an `execvp() … failed` line on stderr) instead
   of a spawn error. `runChild` decides "could not start" only from a spawn error raised before a pid
   exists, so the assertion is unproducible there. The assertion itself was deliberately left
   unweakened, and the case still runs for the reviewer job, which never gets a wrapper. The honest
   fix is a product rule covering both wrappers — it is open work, not an oversight.
2. **Do not change `realpathSync.native` back to `realpathSync`** in the three suites. They must use
   the same resolver as `tests/support/fake-ssh-transport.ts:204` and `src/main/env/wsl.ts:210`. On
   macOS the two agree, so `realpathSync` looks harmless and still fails Windows.
3. **Do not move the Linux `Unit tests` step below the `apparmor_restrict_unprivileged_userns`
   sysctl step.** Once namespaces are allowed, `unshare` starts working on the runner, the writer's
   commands gain the OS wrapper, and the unit tests would follow a code path that `check` never
   exercises.

## 11. History wart, left on purpose

Commit `642ba2e` says "make the Windows unit run informational". It did add
`continue-on-error: ${{ runner.os == 'Windows' }}`, used to read the Windows log without blocking the
PR. `19ced5c` removed that flag once Windows was green, so **the current tree has no
`continue-on-error` anywhere** — the message describes an intermediate state, not the result. The
history was not rewritten because force-pushing would invalidate the CI run cited above. Verify with
the `grep` in §5 rather than by reading commit subjects.

## 12. Open follow-ups (recorded, not fixed here)

1. **The wrapper start-failure rule** (§10.1) — product change, one rule for `sandbox-exec` and
   `unshare`. Should go through `/sdd:plan` and probably become a new D-number, since it touches the
   documented network limit (D31).
2. **Fake timers for the two watch tests** (§9), so the unit suite stops being load-sensitive now
   that three OSes run it.
3. **`check` still owns typecheck, lint and format** on Linux only. Left that way on purpose: they
   are platform-independent, so paying for them three times buys nothing.
4. **sdd paper trail** for `p4-macos-ci-fix` (§6, last item).
5. `safeStorage` logs `isEncryptionAvailable` and `encryptString` as deprecated in the unpackaged
   `pnpm secrets:*` runs. Harmless today.
6. `pnpm package` on macOS is unsigned and uses the default Electron icon; distribution needs a
   Developer ID, notarisation and an icon.

## 13. What was checked on macOS and passed

Beyond the gates: `pnpm e2e` 19 passed / 4 skipped (the skips are the Windows and Linux
window-chrome cases, and the macOS-specific traffic-light tests pass); `pnpm package` produced a
`darwin/arm64` bundle that launches and logs `agent ready` / `agent pong`; `pnpm dev` brings up the
full helper process tree; the secret store round-trips against the macOS keychain; `pnpm test:live`
skips cleanly without its variables; and WSL detection correctly reports not-installed off Windows
(`src/main/env/wsl-detect.ts` answers `installed: false` for any platform but `win32`).
