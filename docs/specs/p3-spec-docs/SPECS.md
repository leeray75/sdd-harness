---
status: done
ticket:
---

# p3-spec-docs

## Problem

The harness cannot yet write or read sdd documents. The workflow table (`src/shared/workflow.ts`, D34) knows the nodes and stages. But nothing creates a feature's PLAN, SPECS, tasks or SUBTASK file, and nothing can tell which node an existing `docs/specs/<feature>/` folder is at. D5 requires the plugin's templates and layout, so repos that already use the sdd plugin open with their specs as history. F2 requires that existing folders open with the right stage.

## Goals

- **G1:** The plugin's four document templates (v0.18.0) are bundled verbatim. A fill function substitutes the placeholders the harness knows.
- **G2:** The `docs/specs/<feature>/` layout exists as code: the known file names, slug validation, and path helpers that refuse traversal.
- **G3:** Parsers read PLAN.md, SPECS.md, tasks.md and build-ledger.md, and report missing or malformed input without throwing.
- **G4:** A pure detector maps a parsed folder and an approval input to a `PathId` and its stage. It follows the plugin's `hooks/detect.ts` precedence, without the session-marker and seen-subagent inputs.
- **G5:** A main-side scanner lists a project's feature folders, reads each one, and detects its node, so plugin-written folders open with the right stage.
- **G6:** The docs are updated in the same change.

## Non-goals

- The state file, the approved-spec hash and lock, and file watching (`p3-spec-lock`). Approval is an input here.
- Choosing the current or active feature (`p3-spec-lock`).
- Writing the ledger, `changes.md` or SUMMARY during a build (`p3-build-loop`).
- Git, commit, push and close (`p3-ship`).
- Any UI, any IPC change, and tracker writes (D8).
- Unifying `src/main/policy/context.ts`'s slug pattern with the shared one.
- Changing the sdd plugin's own files in the separate `repos/claude` repo.

## Acceptance criteria

- **AC1: Templates match the plugin, and filling works.**
  - Templates and parity:
    - `src/shared/spec-docs.ts` exports `TEMPLATES` with `plan`, `specs`, `tasks` and `subtask`.
    - The four v0.18.0 templates are copied verbatim to `tests/fixtures/sdd-plugin/templates/{PLAN,SPECS,tasks,SUBTASK}.md`. A `README.md` there names the plugin version and source path.
    - `tests/fixtures/sdd-plugin/` is listed in `.prettierignore`, so the copies stay byte for byte.
    - A test shows each constant equals its fixture after CRLF is normalized to LF. The list of deliberate changes is empty.
  - `fillTemplate(kind, fields)`:
    - It replaces every occurrence of the five known placeholders, from `feature` (required) and the optional `title`, `ticket`, `storyTitle` and `date`:
      - `<Feature name>` from `title`, defaulting to `feature`;
      - `<feature>` from `feature`;
      - `<STORY-ID>` from `ticket`;
      - `<story title>` from `storyTitle`;
      - `<YYYY-MM-DD>` from `date`.
    - A test shows that a filled template contains none of the placeholders it was given values for.
    - An optional field the caller leaves out stays as its placeholder, and other `<...>` guidance text is unchanged.
    - An invalid `feature` slug is refused with an error result, not thrown.
- **AC2: Layout and paths.**
  - `SPECS_DIR` is `docs/specs`, and `SPEC_FILES` lists exactly `PLAN.md`, `SPECS.md`, `tasks.md`, `SUBTASK.md`, `build-ledger.md`, `changes.md` and `SUMMARY.md`.
  - `isFeatureSlug` uses `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH` from `src/shared/human-actions.ts`.
  - `specFilePath(feature, file)` returns `docs/specs/<feature>/<file>` only for a valid slug and a known name. Otherwise it returns null. Tests cover: `..`, `.`, `/` and `\` inside either argument, absolute paths, an empty string, uppercase, a name not in the list, and a non-string.
- **AC3: Parsers never throw.**
  - There are four parsers:
    - PLAN.md: the first `Status:` value;
    - SPECS.md: the frontmatter `status` and `ticket`;
    - tasks.md: the checked and open checkbox counts, as the plugin counts them;
    - build-ledger.md: `state`, `revision`, `resume on approve` (yes/no), `current round` and `phase` (`implementing`, `reviewing` or empty).
  - Each takes the file text or `null` (missing). It returns a result marked present or absent, plus a list of problems for malformed content (for example, no Status line, unterminated frontmatter, a non-numeric revision, or an unknown phase word).
  - Unit tests cover present, missing and malformed input for each parser, including CRLF text, and show that none throws.
- **AC4: The detector follows the plugin's precedence.**
  - `src/shared/spec-detect.ts` exports `Approval` (`none`, `approved`, `changed` and `unchecked`) and `detectFolder(input)`. `detectFolder` returns `{ node, stage, round, source }`, where `node` is a `PathId` and `stage` comes from `stageOf`.
  - Precedence:
    - `changed` gives `spec-changed`.
    - `none` gives:
      - `closed` (SUMMARY.md);
      - else `spec-drafted` (SPECS.md);
      - else `plan-approved` (PLAN.md with Status `approved`);
      - else `planning` (PLAN.md);
      - else `idle`.
    - `approved` and `unchecked` give:
      - `paused` (ledger `paused-for-revision`);
      - else `build-done` (ledger `done`, or SUMMARY.md with a ledger that is not `running`);
      - else, for a ledger in state `running`, the `phase` value (source `phase`), or `implementing` when the phase is empty (source `ledger`);
      - else `spec-approved`.
  - `round` is the ledger's current round while implementing or reviewing, and null otherwise. `source` is null unless the build is running.
  - There is a unit fixture for every branch above, including `unchecked`.
- **AC5: Existing folders open with the right stage.**
  - A verbatim copy of one plugin-written folder (`p3-state-machine`) is vendored under `tests/fixtures/sdd-plugin/specs/`. It is read with approval `none` and detected as `closed`, stage Done.
  - Every folder in this repo's `docs/specs/` that has SUMMARY.md and a ledger in state `done` is detected as `closed` (Done), and at least 20 such folders are found.
- **AC6: Scanning, and pure shared modules.**
  - `src/main/workflow/spec-folders.ts` exports `readSpecFolder(projectRoot, feature)` and `scanSpecFolders(projectRoot, approvalOf?)`. The scan returns every valid folder sorted by slug, each with:
    - its parsed files;
    - its detection;
    - its newest known-file mtime.
  - `approvalOf` defaults to `none`.
  - Temp-dir tests show the scan:
    - skips entries that are not valid slugs, files at the folder level, symlinks, and folders with none of the known files;
    - returns an empty list when `docs/specs` is missing;
    - reports, without throwing, a file that cannot be read.
  - `src/shared/spec-docs.ts` and `src/shared/spec-detect.ts` import nothing outside `src/shared/` and use no Node, Electron or DOM API. An import-scan test checks this.
- **AC7: Docs.** Done in the build on the feature branch:
  - the `CHANGELOG.md` entry under `## [Unreleased]`;
  - D35 in `docs/decisions.md`;
  - `docs/workflow-engine.md` extended with a "Document layer" section and a "Detecting a folder's node" section that gives the precedence;
  - the new `tests/fixtures/sdd-plugin/README.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the phase-03 doc and the progress file's follow-ups, recorded in `changes.md`.
- **AC8: Checks pass.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. CI on the PR is green on every job before the merge.

## Open questions

- (none)
