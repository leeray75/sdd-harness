# Summary Report: p3-spec-docs

Ticket: none Date: 2026-11-22
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **Templates (G1):** the sdd plugin's four v0.18.0 templates are bundled verbatim in `src/shared/spec-docs.ts`. `fillTemplate` fills the five known placeholders and refuses a bad slug.
- **Layout and parsers (G2, G3):** the module also holds the `docs/specs/<feature>/` layout, with seven known files and a path helper that refuses traversal. It has parsers for PLAN, SPECS, tasks and the ledger, which never throw.
- **Detector (G4):** `src/shared/spec-detect.ts` ports the plugin's detection precedence, minus the session-marker and seen-subagent inputs. It takes approval as an input and returns a node, stage, round and source.
- **Scanner (G5):** `src/main/workflow/spec-folders.ts` scans a project's `docs/specs/` on the main side. It skips symlinks, invalid slugs and empty folders. All 20 finished plugin-written folders in this repo, and a vendored copy of one, open as Done.
- **Docs (G6):** updated in the same change: D35, the extended `docs/workflow-engine.md`, the CHANGELOG, the stale-doc fixes and a new fixture README.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/spec-docs.ts | created | `TEMPLATES`, `fillTemplate`, `SPECS_DIR`, `SPEC_FILES`, `isFeatureSlug`, `specFilePath` and the four parsers. Pure; imports only `./human-actions`. | T1–T3 |
| src/shared/spec-detect.ts | created | `Approval` and `detectFolder`, with the plugin's precedence minus the marker and subagent inputs. Pure; imports only `./workflow`. | T4 |
| src/main/workflow/spec-folders.ts | created | `readSpecFolder`, `readSpecFolderAt` (extra export), `scanSpecFolders`. lstat, no symlink or junction following, a 256 KiB cap per file, never throws. | T5 |
| tests/unit/spec-docs-templates.test.ts | created | Template parity with the fixtures; fill behaviour and refusals (AC1) | T1 |
| tests/unit/spec-docs-paths.test.ts | created | Layout constants, slugs, traversal and invalid inputs (AC2) | T2 |
| tests/unit/spec-docs-parse.test.ts | created | Present, missing, malformed and CRLF input for each parser (AC3) | T3 |
| tests/unit/spec-detect.test.ts | created | A fixture for every precedence branch; the purity import scan (AC4, AC6) | T4 |
| tests/unit/spec-folders.test.ts | created | Temp-dir scans, the vendored folder, and this repo's finished folders, at least 20 (AC5, AC6) | T5 |
| tests/fixtures/sdd-plugin/templates/{PLAN,SPECS,tasks,SUBTASK}.md | created | The plugin's v0.18.0 templates, byte for byte (4 files) | T1 |
| tests/fixtures/sdd-plugin/specs/p3-state-machine/* | created | A plugin-written folder, byte for byte (7 files) | T5 |
| tests/fixtures/sdd-plugin/README.md | created | New doc: the version, source paths and what the tests check | T1 |
| .prettierignore | edited | `tests/fixtures/sdd-plugin/`, so the copies stay byte for byte | T1 |
| docs/decisions.md | edited | D35 | T6 |
| docs/workflow-engine.md | edited | "Document layer" and "Detecting a folder's node" sections; the new files listed | T6 |
| CHANGELOG.md | edited | Entry under `## [Unreleased]` | T6 |
| CLAUDE.md | edited | Decisions D1–D35; the engine reference line names the document layer | T6 |
| README.md | edited | Decisions D1–D35; the engine table row | T6 |
| docs/PRD.md | edited | F2 Documents bullet. The acceptance item stays unchecked until `p3-spec-lock` supplies the live approval. | T6 |
| docs/workflow.md | edited | One sentence and a link to folder detection | T6 |
| docs/phases/phase-03-workflow-engine.md | edited | D35 under "Decided during planning"; a note on the subtask split | T6 |
| docs/phases/phase-03-progress.md | edited | D35 under "Decisions added"; `p3-spec-docs` follow-ups | T6 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-spec-docs/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-spec-docs/SPECS.md | created | Approved spec | n/a |
| docs/specs/p3-spec-docs/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-spec-docs/tasks.md | created | Tasks T1–T7, all ticked | T1–T7 |
| docs/specs/p3-spec-docs/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-spec-docs/changes.md | created | The implementor's file record and stale-doc check | n/a |
| docs/specs/p3-spec-docs/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree: every changed file is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | The reviewer's `cmp` shows the fixtures are byte-identical to the plugin. The parity and fill tests pass. `.prettierignore` lists the fixtures. |
| AC2 | Pass | `spec-docs-paths.test.ts` covers traversal, separators, absolute, empty, uppercase, unknown and non-string inputs. |
| AC3 | Pass | `spec-docs-parse.test.ts` covers present, missing, malformed, CRLF and BOM input, plus a no-throw sweep. |
| AC4 | Pass | `spec-detect.test.ts` has a fixture per branch, including `unchecked`. The reviewer checked it against `hooks/detect.ts`. |
| AC5 | Pass | The vendored `p3-state-machine` copy (identical, by `diff -r`) and the repo's 20 finished folders are detected as closed, Done. |
| AC6 | Pass | The temp-dir scan cases pass and the import scan passes. The file-symlink case is skipped on this Windows account; see below. |
| AC7 | Pass | D35, the engine doc sections, the CHANGELOG, the fixture README and the stale-doc check are all recorded in `changes.md`. |
| AC8 | Pass locally | typecheck, lint and format:check pass. `pnpm test` gives 62 files, 1294 passed, 13 skipped (re-run by the orchestrator). CI is checked on the PR. |

## Needs a runtime check

- CI on the pull request: the `check` job, and `e2e` on Windows, macOS and Linux.
- The file-symlink scan test is skipped on this Windows account (EPERM without the symlink privilege). It should run and pass on the Linux `check` job.

## Review ledger

Covers every revision, copied from `docs/specs/p3-spec-docs/build-ledger.md`.

### Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

## Spec revisions

none

## Rejected findings

none

## Open issues

none.

Noted, not a defect: `scanSpecFolders` does not guard the caller's `approvalOf` callback, so a callback that throws would reject the scan. `p3-spec-lock` supplies that callback, and could guard it there.

Left alone on purpose:

- PLAN.md's assumption table says SUBTASK has three `<feature>` placeholders. It has four, and the test asserts four. The plan is not edited after approval.
- The progress row's status and commit are filled in after the merge. `docs/roadmap.md` is unchanged.

## Git state

Branch `feature/p3-spec-docs`; approved; committed and pushed in the commit that adds this report.

## Next steps

Open a pull request, and merge it only when CI is green on every job. Then run `/sdd:close`.
