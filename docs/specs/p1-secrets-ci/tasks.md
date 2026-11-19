# Tasks: p1-secrets-ci

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Test diagnostics.** In `tests/e2e/spike-agent.spec.ts`, add failure messages with each run's captured output (sentinel-checked first) and the header classification (`missing`, `placeholder`, `sentinel`, `other`) (AC1, AC2). **Check:** `pnpm e2e tests/e2e/spike-agent.spec.ts` passes on Windows; temporarily changing the expected class shows a message with the classes and output and no sentinel (revert afterwards).
- [x] **T2 — Linux plain-text switch.** Add the pure decision function in `src/main/secrets/` and call `safeStorage.setUsePlainTextEncryption(true)` from `createElectronSecretStore` when it says so, once per process; add its unit test (AC3). **Check:** `pnpm test` and `pnpm typecheck` pass.
- [x] **T3 — Docs for the Linux fix.** CHANGELOG Fixed entry; D25, README and CLAUDE.md on the override's plain-text switch (AC6, the Linux part). **Check:** `pnpm format:check` passes.
- [x] **T4 — CI checkpoint.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e`, then stop with `NEEDS-SPEC-CHANGE: CI checkpoint` (AC4). **Check:** all commands pass locally.
- [x] **T5 — Seed with Playwright's switches.** _Revised in revision 1._ In `tests/e2e/spike-agent.spec.ts`, the seed run's spawn args add `--use-mock-keychain` and `--password-store=basic`, from a named constant with a comment pointing at Playwright's loader (AC5). **Check:** `pnpm e2e tests/e2e/spike-agent.spec.ts` passes on Windows; CI after the commit is the macOS and Linux evidence.
- [x] **T6 — Remaining docs.** CHANGELOG entry for the seed-switch fix, and the follow-ups (including that the e2e uses Playwright's mock keychain, so the real macOS keychain is a runtime check) in `docs/phases/phase-01-progress.md` (AC6). **Check:** `pnpm format:check` passes.
- [x] **T7 — Full check.** (AC7) **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows; CI is green on all three OSes before merge.
