# Plan: p1-secrets-ci

Ticket: none (vibe planning; Phase 1, fix for subtask 2)
Status: approved
Date: 2026-11-19

## Objective

PR #8 (`p1-secrets`) was merged while CI was still running, and `main` is now red. The spike e2e test (`tests/e2e/spike-agent.spec.ts`) passes on Windows and fails on Linux and macOS. On Linux, seeding the store through the secrets mode exits 1. On macOS the seed works, but the app's chat requests don't carry `Bearer <sentinel>`. This subtask makes the test explain its own failures, fixes both causes, and gets CI green on all three OSes before `p1-provider-interface` starts.

## Scope

- **In:** the spike e2e test prints the (redacted) app output and says which check failed; the Linux fix for the test-only weak-backend override; a CI diagnosis of the macOS failure and the fix that follows from it; the docs, CHANGELOG and phase progress notes that the fix touches.
- **Out:** moving to the async `safeStorage` calls (a follow-up); a real keyring in Linux CI; any change to the store's rules for real users (a weak backend is still refused without the override); the other `p1-secrets` notes (`secrets:delete` exit code, escaped-quote headers, the duplicated socket server in the test).

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p1-secrets-ci`, sdd-harness, `main` → `feature/p1-secrets-ci` | (defaults, not asked) |
| Linux fix | When `HARNESS_ALLOW_WEAK_SECRETS=1` and the platform is Linux, main calls `safeStorage.setUsePlainTextEncryption(true)` once, after ready and before the store is first used. Without the override nothing changes | Install and unlock gnome-keyring in the Linux CI job (closer to a real desktop, more CI setup; the override path stays untested) |
| macOS fix | Diagnose in CI first: the test prints the redacted app output and reports whether the header was missing, the no-key placeholder, or another value (never printing the value). That commit runs in CI, and the fix follows from the real cause | Assume the cause and seed through Playwright's launch (faster if right, another round trip if wrong); skip the test on macOS (green quickly, but the store is untested on macOS) |
| Async `safeStorage` calls | Not in this subtask | Switch the store to the async API now (wider change) |
| Merge rule | The PR merges only after all CI jobs pass on Windows, macOS and Linux | (standing rule since PR #7) |

## Approach

1. **Diagnostics in the test.** On failure, `spike-agent.spec.ts` attaches the seed run's and the app run's output to the assertion message (the sentinel cannot appear there, since main redacts every line and the test also checks this). The header check reports a classification (`missing`, `placeholder`, `sentinel`, `other`) instead of comparing to a string that GitHub masks in the log.
2. **Linux.** `src/main/secrets/electron.ts` gains the plain-text switch, behind the override and `process.platform === 'linux'`. A unit test covers the decision as a pure function (switch on only for Linux with the override).
3. **CI diagnosis (a pause in the build).** The build stops after steps 1 and 2 with a spec question. Agents never run git, so you push the branch (or tell me in chat to push it) and open a draft PR, and CI runs. The macOS output names the cause.
4. **macOS fix.** A spec revision records the cause and the fix. If the cause is the two launches using different keychain modes, the seed run uses the same launch path and flags as the app run. If it needs something larger (signing, a keychain prompt), the revision says so and you choose.
5. **Docs.** CHANGELOG `[Unreleased]` (Fixed), the `HARNESS_ALLOW_WEAK_SECRETS` note in D25 and README/CLAUDE.md where they describe the override, and the follow-ups in `docs/phases/phase-01-progress.md`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Linux fails while seeding, before the app run | CI run 44467429956, ubuntu job: `expect(seed.code).toBe(0)` received 1 at `spike-agent.spec.ts:162` |
| macOS seeds, runs the spike, and fails on the header | macOS job: failure at `spike-agent.spec.ts:197` (`expect(header).toBe(...)`), after the spike-finished checks passed |
| GitHub masks the header in the log | macOS log shows `Expected: "***"`, `Received: "***"` |
| Windows passes | `windows-latest` job: pass |
| Electron 45.3.4 has `safeStorage.setUsePlainTextEncryption` (Linux only; no-op elsewhere) | `node_modules/electron/electron.d.ts:12861` |
| The store is built in one place | `src/main/secrets/electron.ts` (`createElectronSecretStore`) |
| The test doesn't print app output on failure | `tests/e2e/spike-agent.spec.ts:161-163`, `189-206` |

## Risks

- Electron's docs say plain-text mode uses an "in memory password". If that key differs per process, a value saved in the seed run won't decrypt in the app run. The Linux CI run in step 3 shows this; if it happens, it becomes the spec question at that pause.
- The macOS cause is unconfirmed until step 3; the fix may be larger than a launch change.

## Open questions

none
