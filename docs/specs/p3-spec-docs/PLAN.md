# Plan: p3-spec-docs

Ticket: none (vibe planning, Phase 3 subtask 2)
Status: approved
Date: 2026-11-22

## Objective

Give the harness the sdd document layer. That means three things:

- the plugin's four document templates (PLAN, SPECS, tasks, SUBTASK), ported and fillable;
- the `docs/specs/<feature>/` layout as code;
- a reader that turns a feature folder, including one written by the sdd plugin, into a workflow node and stage from `src/shared/workflow.ts`.

With that, existing specs open as history (D5), and later subtasks can write and read the same files. This covers the F2 acceptance item "Existing `docs/specs/<feature>/` folders open with the right stage", except for the real approval state, which `p3-spec-lock` supplies.

## Scope

- **In:**
  - The templates as bundled TypeScript constants, verbatim from the plugin v0.18.0, with a fill function.
  - Known file names, slug validation and path helpers that refuse traversal.
  - Parsers for PLAN.md `Status:`, SPECS.md frontmatter (`status`, `ticket`), tasks.md checkbox counts, and build-ledger.md (`state`, `revision`, `resume on approve`, `current round`, `phase`).
  - A pure detector ported from the plugin's `hooks/detect.ts` precedence, with approval as an input.
  - A main-side scanner of `docs/specs/`.
  - Docs, done in the build on the feature branch: CHANGELOG, the extended `docs/workflow-engine.md`, D35, stale-doc updates, and the vendored-fixture README.
- **Out:**
  - The state file, the approved-spec hash and lock, and file watching (`p3-spec-lock`).
  - Choosing the current feature (`p3-spec-lock`).
  - Writing the ledger, changes or SUMMARY during a build (`p3-build-loop`).
  - Git (`p3-ship`).
  - Any UI or IPC, and tracker writes (D8).
  - Changing the plugin's own files in `repos/claude`.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Where the modules live | Shared and main split. `src/shared/spec-docs.ts` holds the templates, fill, file names, path helpers and parsers. `src/shared/spec-detect.ts` holds the detector. Both are pure, like `workflow.ts`. `src/main/workflow/spec-folders.ts` does the fs scan. | One shared file with everything pure; everything in `src/main/workflow/` (the renderer would need a copy later) |
| The plugin's session marker and seen-subagent inputs | Drop both. The ledger's `phase:` line alone picks `implementing` or `reviewing` (source `phase`). A running ledger with no phase line falls back to `implementing` (source `ledger`). New work with no file is `idle`. `p3-build-loop` will write `phase:` on every step. The plugin's pane text `approvalText` is UI copy and is also dropped. | Keep them as optional, unused inputs so the port stays line for line |
| Template parity check | Vendored fixtures. The four v0.18.0 templates are copied verbatim to `tests/fixtures/sdd-plugin/templates/`, with a README naming the version and source. The test compares the constants with them. | A literal copy inside the test, as `workflow-machine.test.ts` does |
| Scanner output | Every valid folder, sorted by slug, each with its parsed files, its detection (node, stage, round, source) and its newest known-file mtime. Approval per folder comes from an optional callback, defaulting to `none`. Choosing the current feature is left to `p3-spec-lock`. | Also return the plugin's "newest folder" choice now |
| Deliberate template changes | None. The text is verbatim, and the test's list of changes is empty. | Harness-specific wording now (no need yet) |
| Placeholders the fill function knows | These five, each replaced everywhere it appears: `<Feature name>` (a title, default the slug), `<feature>` (the slug), `<STORY-ID>` (the ticket id), `<story title>` and `<YYYY-MM-DD>` (the date). Every other `<...>` is guidance for the writer and stays. A field the caller leaves out also stays. A slug that fails validation is refused. | Fill guidance placeholders too (they are prose for the planner, not data) |
| SPECS.md frontmatter `status` in detection | Parsed and reported, but not used for the node, as in the plugin | Use `status: done` as a closed signal (breaks parity) |
| Slug pattern | Reuse `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH` from `src/shared/human-actions.ts`. `src/main/policy/context.ts` has its own looser pattern, which is not touched here. | Unify the two patterns now (out of scope; noted as a follow-up) |
| New decision | D35 records the document layer: the module split, the precedence port, the dropped marker and subagent inputs, approval as an input, and the vendored fixtures | No new decision (these choices would go unrecorded) |
| Repo and branch | `sdd-harness`. Base `main`, feature branch `feature/p3-spec-docs` (created). | (default) |

## Approach

1. **`src/shared/spec-docs.ts`:**
   - `TEMPLATES` (`plan`, `specs`, `tasks`, `subtask`): the verbatim text, as constants.
   - `fillTemplate(kind, { feature, title?, ticket?, storyTitle?, date? })`: returns the filled text, or an error for a bad slug.
   - `SPECS_DIR = 'docs/specs'` and `SPEC_FILES`, the seven known names.
   - `isFeatureSlug`, and `specFilePath(feature, file)`, which returns a relative POSIX path or null for a bad slug, an unknown name or any traversal.
   - Parsers that take text and never throw. Each returns a parsed result with a `problems` list, so a malformed file is reported. A missing file is the caller's `null` input, and it gives an "absent" result.
2. **`src/shared/spec-detect.ts`:**
   - `Approval = 'none' | 'approved' | 'changed' | 'unchecked'`.
   - `detectFolder(input)` returns `{ node: PathId, stage: StageView, round, source }`, following the plugin's precedence without the marker and subagent branches.
   - Imports only `./workflow`.
3. **`src/main/workflow/spec-folders.ts`:**
   - `readSpecFolder(projectRoot, feature)` and `scanSpecFolders(projectRoot, approvalOf?)`, using `node:fs/promises`.
   - They skip entries that aren't directories or valid slugs, and folders with none of the known files.
   - Unreadable files and folders are reported, never thrown.
   - Symlinked folders and files are not followed.
4. **Tests in `tests/unit/`:**
   - `spec-docs-templates.test.ts`: parity with the fixtures; fill leaves none of the given placeholders.
   - `spec-docs-paths.test.ts`: slugs, names, traversal.
   - `spec-docs-parse.test.ts`: present, missing and malformed input for each parser.
   - `spec-detect.test.ts`: a fixture for every branch of the precedence.
   - `spec-folders.test.ts`: temp-dir scans, a vendored copy of one plugin folder under `tests/fixtures/sdd-plugin/specs/`, and every real `docs/specs/` folder of this repo reading as closed (Done).
   - The purity import scan for both shared modules.
5. **Docs:**
   - D35 in `docs/decisions.md`.
   - `docs/workflow-engine.md` gets "Document layer" and "Detecting a folder's node" sections.
   - A CHANGELOG entry.
   - `CLAUDE.md`: the reference line names the new modules, and the decisions count becomes D1–D35.
   - `README.md`: the decisions count, and the status line if stale.
   - `docs/PRD.md` F2 and `docs/workflow.md`: a link to the detection section.
   - The phase-03 doc and the progress file's follow-ups.
   - `tests/fixtures/sdd-plugin/README.md` (new).
   - Everything checked is recorded in `changes.md`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The plugin is v0.18.0, and its templates and detector are at the paths named | `repos/claude/plugins/sdd-plugin/.claude-plugin/plugin.json` `"version": "0.18.0"`; `skills/sdd/templates/{PLAN,SPECS,tasks,SUBTASK}.md`; `hooks/detect.ts` (last commit 431b7a1) |
| The detector precedence is as in the brief | `hooks/detect.ts` `detect()`: changed comes first; for none, summary, specs, approved plan, plan, idle; then paused, done or summary-not-running, running with phase, else spec-approved |
| The plugin's parsers use these regexes | `parsePlanStatus`, `parseLedger`, `countTasks` in `hooks/detect.ts` |
| The template placeholders are as listed | PLAN: `<Feature name>`, `<STORY-ID>`, `<story title>`, `<YYYY-MM-DD>`. SPECS: `<Feature name>`. tasks: `<feature>`. SUBTASK: `<feature>` (×3 paths). |
| `PathId`, `StageView` and `stageOf` exist | `src/shared/workflow.ts:35,159,179` |
| A shared slug pattern exists | `src/shared/human-actions.ts:22` `FEATURE_SLUG_PATTERN` |
| All 20 repo folders hold every known file and are finished | Each of the 20 `docs/specs/*/` holds all seven files: `status: done`, `Status: approved`, ledger `state: done`, and SUMMARY.md present |
| `src/main/workflow/` doesn't exist yet, and D35 is free | `ls` and `grep D35 docs/decisions.md` both found nothing |

## Risks

- **The real-folder test grows with each closed spec,** and an open feature folder on a branch would fail it. Mitigation: the test covers folders with SUMMARY.md and a `done` ledger, and the vendored fixture keeps a fixed check. The active feature's own folder (`p3-spec-docs`, still open during this build) is excluded by that filter. Revealed by a run on the feature branch.
- **Line endings:** a Windows checkout with CRLF could make the parity test fail. Mitigation: normalize CRLF to LF before comparing, and parse with `\r?\n`.
- **Symlinks or huge files in a project's `docs/specs`:** use `lstat`, skip symlinks, and cap the bytes read per file.

## Open questions

- Follow-up, not this subtask: unify `src/main/policy/context.ts`'s slug pattern with the shared `FEATURE_SLUG_PATTERN`.
