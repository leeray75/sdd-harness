# Tasks: p1-secrets-ci

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Test diagnostics.** In `tests/e2e/spike-agent.spec.ts`, add failure messages with each run's captured output (sentinel-checked first) and the header classification (`missing`, `placeholder`, `sentinel`, `other`) (AC1, AC2). **Check:** `pnpm e2e tests/e2e/spike-agent.spec.ts` passes on Windows; temporarily changing the expected class shows a message with the classes and output and no sentinel (revert afterwards).
- [x] **T2 — Linux plain-text switch.** Add the pure decision function in `src/main/secrets/` and call `safeStorage.setUsePlainTextEncryption(true)` from `createElectronSecretStore` when it says so, once per process; add its unit test (AC3). **Check:** `pnpm test` and `pnpm typecheck` pass.
- [x] **T3 — Docs for the Linux fix.** CHANGELOG Fixed entry; D25, README and CLAUDE.md on the override's plain-text switch (AC6, the Linux part). **Check:** `pnpm format:check` passes.
- [x] **T4 — CI checkpoint.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e`, then stop with `NEEDS-SPEC-CHANGE: CI checkpoint` (AC4). **Check:** all commands pass locally.
- [ ] **T5 — macOS fix.** Settled in revision 1 from the CI evidence (AC5). **Check:** settled in revision 1.
- [ ] **T6 — Remaining docs.** CHANGELOG entry for the macOS fix and the follow-ups in `docs/phases/phase-01-progress.md` (AC6). **Check:** `pnpm format:check` passes.
- [ ] **T7 — Full check.** (AC7) **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` passes on Windows; CI is green on all three OSes before merge.
