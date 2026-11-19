---
status: approved
ticket:
---

# p1-secrets-ci

## Problem

PR #8 (`p1-secrets`) was merged before CI finished, and `main` is red. `tests/e2e/spike-agent.spec.ts` passes on Windows and fails on Linux and macOS (CI run 44467429956). On Linux the seed run in the secrets mode exits 1, most likely because, with no keyring, Electron 45's plain-text backend reports encryption as unavailable, so the test-only `HARNESS_ALLOW_WEAK_SECRETS=1` never takes effect. On macOS the seed run succeeds and the spike finishes, but the chat requests don't carry `Bearer <sentinel>`. The cause is unconfirmed: the test prints no app output, and GitHub masks the header comparison as `***`.

## Goals

- **G1:** The spike e2e test explains its own failures without printing the sentinel.
- **G2:** The test-only weak-backend override works on Linux, so a key saved in the seed run is read in the app run.
- **G3:** The macOS cause is diagnosed from a real CI run and fixed.
- **G4:** CI passes on Windows, macOS and Linux, and the docs match the code.

## Non-goals

- Moving the store to the async `safeStorage` calls.
- A real keyring (gnome-keyring) in Linux CI.
- Changing what real users can do: without the override, a weak Linux backend is still refused.
- The other `p1-secrets` notes: the `secrets:delete` exit code for a missing name, escaped-quote header forms, the socket server duplicated in the test.

## Acceptance criteria

- **AC1 (test output on failure):** In `tests/e2e/spike-agent.spec.ts`, every assertion about the seed run and the app run carries a message with that run's captured stdout and stderr (the seed check names the exit code). Before any output is put in a message, the test checks that it doesn't contain the sentinel; if it does, the message says the sentinel leaked and shows no output. The sentinel is never printed.
- **AC2 (header classification):** The test reduces each recorded `Authorization` header to one of `missing`, `placeholder` (`Bearer no-key-set`), `sentinel` (`Bearer <sentinel>`) or `other`, and asserts that every class is `sentinel`. The failure message lists the classes, never a header value.
- **AC3 (Linux plain-text switch):** A pure function in `src/main/secrets/` decides whether to turn on plain-text encryption: true only when the platform is `linux` and the override is on (`HARNESS_ALLOW_WEAK_SECRETS === '1'`). `createElectronSecretStore` calls `safeStorage.setUsePlainTextEncryption(true)` when it is true, once per process, before the store's first use; otherwise it never calls it. A unit test covers `linux`, `darwin` and `win32`, each with the override on and off. The store's refusal rules (AC2 of `p1-secrets`) are unchanged.
- **AC4 (CI checkpoint):** After AC1–AC3 pass locally (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and `pnpm e2e` on Windows), the implementor stops and reports `NEEDS-SPEC-CHANGE: CI checkpoint` so the build pauses. The user (or the orchestrator, only on the user's explicit chat instruction) commits, pushes `feature/p1-secrets-ci` and opens a draft PR. The CI output from that run is the evidence for AC5. If the Linux job still fails, its new output is evidence for the same revision.
- **AC5 (macOS fix):** To be settled in revision 1 from the AC4 CI evidence: the cause, the fix, and how the test proves it. Until then, no macOS-specific change is made.
- **AC6 (docs):** `CHANGELOG.md` `[Unreleased]` has a Fixed entry for each fix. D25 in `docs/decisions.md` says that on Linux the override also turns on Electron's plain-text encryption. README and CLAUDE.md say the same wherever they describe the override. `docs/phases/phase-01-progress.md` records the fixes under Follow-ups.
- **AC7 (full check):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass, `pnpm e2e` passes locally on Windows, and the PR's CI passes on all three OSes before it is merged.

## Open questions

none
