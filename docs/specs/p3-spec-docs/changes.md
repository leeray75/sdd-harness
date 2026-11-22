# Changes: p3-spec-docs

Mode 1 build of tasks T1 to T7. Uncommitted, on branch `feature/p3-spec-docs`.

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| tests/fixtures/sdd-plugin/templates/PLAN.md | created | Copy of the plugin's v0.18.0 PLAN template, byte for byte (`cp`); parity fixture for `TEMPLATES.plan` | T1 |
| tests/fixtures/sdd-plugin/templates/SPECS.md | created | Copy of the plugin's v0.18.0 SPECS template, byte for byte; parity fixture for `TEMPLATES.specs` | T1 |
| tests/fixtures/sdd-plugin/templates/tasks.md | created | Copy of the plugin's v0.18.0 tasks template, byte for byte; parity fixture for `TEMPLATES.tasks` | T1 |
| tests/fixtures/sdd-plugin/templates/SUBTASK.md | created | Copy of the plugin's v0.18.0 SUBTASK template, byte for byte; parity fixture for `TEMPLATES.subtask` | T1 |
| tests/fixtures/sdd-plugin/README.md | created | Names the plugin version (0.18.0), the source paths, and what the tests check (AC1, AC7) | T1 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/PLAN.md | created | Vendored copy of a plugin-written feature folder, byte for byte (`cp -r`); read as closed (AC5) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/SPECS.md | created | Vendored copy, byte for byte (AC5) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/SUBTASK.md | created | Vendored copy, byte for byte (AC5) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/SUMMARY.md | created | Vendored copy, byte for byte (AC5) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/build-ledger.md | created | Vendored copy, byte for byte (AC5, and the ledger parser test) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/changes.md | created | Vendored copy, byte for byte (AC5) | T5 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/tasks.md | created | Vendored copy, byte for byte (AC5) | T5 |
| .prettierignore | edited | Added `tests/fixtures/sdd-plugin/` so the copies stay byte for byte (AC1) | T1 |
| src/shared/spec-docs.ts | created | `TEMPLATES`, `fillTemplate`, `SPECS_DIR`, `SPEC_FILES`, `isFeatureSlug`, `specFilePath` and the four parsers; pure, imports only `./human-actions` (AC1, AC2, AC3) | T1, T2, T3 |
| src/shared/spec-detect.ts | created | `Approval`, `detectFolder` and its types, with the plugin's precedence minus the marker and subagent inputs; pure, imports only `./workflow` (AC4) | T4 |
| src/main/workflow/spec-folders.ts | created | Main-side scanner: `readSpecFolder`, `readSpecFolderAt` (extra export, used for the vendored folder), `scanSpecFolders`, on `node:fs/promises` with lstat, no symlink or junction following, a 256 KiB cap per file, and no throws (AC5, AC6) | T5 |
| tests/unit/spec-docs-templates.test.ts | created | Parity of the four constants with the fixtures after CRLF normalization; the fill behaviour and the refusals (AC1) | T1 |
| tests/unit/spec-docs-paths.test.ts | created | Layout constants, `isFeatureSlug` and `specFilePath` with traversal, separators, absolute, empty, uppercase, unknown and non-string inputs (AC2) | T2 |
| tests/unit/spec-docs-parse.test.ts | created | Present, missing, malformed and CRLF input for each parser, the vendored ledger, and a no-throw sweep (AC3) | T3 |
| tests/unit/spec-detect.test.ts | created | A fixture for every precedence branch including `unchecked`, and the purity import scan of both shared modules (AC4, AC6) | T4 |
| tests/unit/spec-folders.test.ts | created | Temp-folder scans (missing docs/specs, sorting, skipped entries, junction, approvalOf, unreadable file, byte cap, file symlink), the vendored folder as closed, and this repo's finished folders as closed with a count of at least 20 (AC5, AC6) | T5 |
| docs/specs/p3-spec-docs/tasks.md | edited | Ticked T1 to T7 as each check passed | T1, T2, T3, T4, T5, T6, T7 |
| docs/decisions.md | edited | D35 appended in the D34 format: outcome, why, alternatives not taken from the PLAN, date 2026-11-22 (AC7) | T6 |
| docs/workflow-engine.md | edited | Added "Document layer" and "Detecting a folder's node" sections, the new files in "Where the code is", and a pointer in the intro (AC7) | T6 |
| CHANGELOG.md | edited | Entry under `## [Unreleased]` / Added for the document layer (AC7) | T6 |
| CLAUDE.md | edited | Decisions range D1–D35; the workflow-engine reference line now names the document layer and its modules (AC7, stale-doc check) | T6 |
| README.md | edited | Decisions range D1–D35; the workflow-engine table row names the document layer and folder detection (AC7, stale-doc check) | T6 |
| docs/PRD.md | edited | F2 gains a Documents bullet (D35); the "existing folders open with the right stage" acceptance item stays unchecked, with a note that the live approval comes with `p3-spec-lock` (AC7, stale-doc check) | T6 |
| docs/workflow.md | edited | One sentence and a link: a folder's state is read from its files by the document layer (D35) (AC7, stale-doc check) | T6 |
| docs/phases/phase-03-workflow-engine.md | edited | D35 added under "Decided during planning"; a note under the suggested subtasks that subtask 2 was split into `p3-spec-docs` and `p3-spec-lock` (AC7, stale-doc check) | T6 |
| docs/phases/phase-03-progress.md | edited | D35 added under "Decisions added"; follow-ups from `p3-spec-docs` added. The row 2 status stays `pending` and its commit stays blank, as the close step fills them (AC7, stale-doc check) | T6 |

## Stale-doc check (AC7)

Each file below was checked against the change. Only the files marked "edited" above were changed.

- `CLAUDE.md`: stale (decision range, workflow-engine line). Updated.
- `README.md`: stale (decision range, engine table row). Updated. The status line ("Phase 3 in progress") is still true, so it is unchanged.
- `docs/PRD.md`: F2 gained the document bullet and the acceptance note. Updated.
- `docs/workflow.md`: the stage table and the "who can do what" table are unchanged. One sentence and a link were added. Updated.
- `docs/phases/phase-03-workflow-engine.md`: the planning decisions and the subtask split note were stale. Updated. The definition of done is still open (it needs `p3-headless-e2e`), so it is unchanged.
- `docs/phases/phase-03-progress.md`: D35 added under "Decisions added"; follow-ups added. The row 2 status is left `pending`, as instructed.
- `docs/roadmap.md`: not changed, as instructed.
- `docs/human-actions.md`, `docs/agent-jobs.md`, `docs/agent-commands.md`: checked; they name no document-layer behaviour, so nothing is stale. Unchanged.
- `tests/fixtures/sdd-plugin/README.md`: new, as AC7 asks. Created.

## Check results

- `pnpm typecheck`: passes.
- `pnpm lint`: passes (no output).
- `pnpm format:check`: passes.
- `pnpm test`: 62 files passed; 1294 tests passed, 13 skipped. The skip is the file-symlink test, which this Windows account cannot create (EPERM); it runs where the OS allows file symlinks, including the Linux `check` job.
- `grep -n "D35" docs/decisions.md CLAUDE.md`: both files match.
- Finished folders in this repo (SUMMARY.md and a `done` ledger): 20, all detected as closed (Done). `p3-spec-docs` itself is open and excluded.
