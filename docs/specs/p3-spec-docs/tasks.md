# Tasks: p3-spec-docs

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Templates and fill.** Copy the plugin's four v0.18.0 templates verbatim from `C:/Users/hoyen/Documents/Roo Code Workspace/repos/claude/plugins/sdd-plugin/skills/sdd/templates/` to `tests/fixtures/sdd-plugin/templates/`. Add `tests/fixtures/sdd-plugin/README.md`, naming the version and source. Add `tests/fixtures/sdd-plugin/` to `.prettierignore`. Create `src/shared/spec-docs.ts` with `TEMPLATES` and `fillTemplate`. Add `tests/unit/spec-docs-templates.test.ts`, covering parity with the fixtures and the fill behaviour (AC1). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/spec-docs-templates.test.ts` passes.
- [x] **T2: Layout and paths.** Add `SPECS_DIR`, `SPEC_FILES`, `isFeatureSlug` and `specFilePath`, and `tests/unit/spec-docs-paths.test.ts` (AC2). **Check:** `pnpm exec vitest run tests/unit/spec-docs-paths.test.ts` passes.
- [x] **T3: Parsers.** Add the PLAN, SPECS, tasks and ledger parsers, and `tests/unit/spec-docs-parse.test.ts`, covering present, missing, malformed and CRLF input (AC3). **Check:** `pnpm exec vitest run tests/unit/spec-docs-parse.test.ts` passes.
- [x] **T4: Detector.** Create `src/shared/spec-detect.ts` with `Approval` and `detectFolder`. Add `tests/unit/spec-detect.test.ts`, with a fixture for every precedence branch, plus the import scan of both shared modules (AC4, part of AC6). **Check:** `pnpm exec vitest run tests/unit/spec-detect.test.ts` passes.
- [x] **T5: Scanner.** Create `src/main/workflow/spec-folders.ts` with `readSpecFolder` and `scanSpecFolders`. Vendor `docs/specs/p3-state-machine/` verbatim to `tests/fixtures/sdd-plugin/specs/p3-state-machine/`. Add `tests/unit/spec-folders.test.ts`, covering the temp-dir cases, the vendored folder and the repo's finished folders (AC5, AC6). **Check:** `pnpm exec vitest run tests/unit/spec-folders.test.ts` passes.
- [x] **T6: Docs.**
  - D35 in `docs/decisions.md`;
  - the "Document layer" and "Detecting a folder's node" sections in `docs/workflow-engine.md`;
  - the `CHANGELOG.md` entry;
  - the stale-doc check of `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the phase-03 doc and the progress follow-ups, with fixes, recorded in `changes.md`.

  Run `pnpm exec prettier --write` on the edited docs (AC7). **Check:** `pnpm format:check` passes, and `grep -n "D35" docs/decisions.md CLAUDE.md` finds both.
- [x] **T7: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC8; CI is checked on the PR). **Check:** all pass.
