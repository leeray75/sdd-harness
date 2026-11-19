# Changes: p1-secrets-ci

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/e2e/spike-agent.spec.ts | edited | Every seed and app-run assertion carries that run's captured output (withheld when the sentinel is in it); the sentinel checks are boolean so no failure prints it; the chat Authorization headers are reduced to missing, placeholder, sentinel or other, and only the classes are printed (AC1, AC2). Revision 1: the seed run's spawn args add `--use-mock-keychain` and `--password-store=basic` from the named constant `PLAYWRIGHT_KEYCHAIN_SWITCHES`, which points at Playwright's loader (AC5). | T1, T5 |
| docs/specs/p1-secrets-ci/tasks.md | edited | Ticked T1, T2, T3 and T4 after each check passed (T4: typecheck, lint, format:check, test and e2e all passed locally on Windows). Revision 1: ticked T5, T6 and T7 (T7: local checks only; the CI part is checked after the commit). | T1, T2, T3, T4, T5, T6, T7 |
| src/main/secrets/plain-text.ts | created | Pure `shouldUsePlainTextEncryption(platform, overrideValue)`: true only on `linux` with the override `'1'` (AC3). | T2 |
| src/main/secrets/electron.ts | edited | `createElectronSecretStore` calls `safeStorage.setUsePlainTextEncryption(true)` when the pure function says so, once per process (module flag), before the store is first used; otherwise never (AC3). | T2 |
| tests/unit/secret-plain-text.test.ts | created | Unit test of the decision on linux, darwin and win32, override on and off, plus empty and `0` overrides (AC3). | T2 |
| CHANGELOG.md | edited | Added a `### Fixed` section under `[Unreleased]` with the Linux plain-text fix and the spike e2e output change (T3); revision 1 adds the seed-switch fix entry (AC6). | T3, T6 |
| docs/decisions.md | edited | D25 says the Linux override also turns on Electron's plain-text encryption, once per process, and names the pure function (AC6). | T3 |
| docs/phases/phase-01-progress.md | edited | Follow-ups: the two p1-secrets-ci fixes, and that the e2e uses Playwright's mock keychain so the real macOS keychain is a runtime check. Nothing else in the file changed (AC6). | T6 |
