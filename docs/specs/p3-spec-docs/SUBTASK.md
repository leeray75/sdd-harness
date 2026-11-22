# Port the sdd document templates and layout, and detect an existing feature folder's node and stage

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-spec-docs/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-spec-docs

## Context

The harness cannot yet write or read sdd documents. Nothing creates a feature's PLAN, SPECS, tasks or SUBTASK file, and nothing tells which node an existing `docs/specs/<feature>/` folder is at. This work does four things:

- bundles the plugin's v0.18.0 templates verbatim, with a fill function;
- codes the layout and safe path helpers;
- adds parsers that never throw;
- adds a pure detector, ported from the plugin's precedence with approval as an input, and a main-side scanner.

With these, plugin-written folders open with the right stage (D5, F2). The docs are updated in the same change.

## Required work

- T1 Templates and fill
- T2 Layout and paths
- T3 Parsers
- T4 Detector
- T5 Scanner
- T6 Docs
- T7 Full checks

## Acceptance criteria

- **AC1: Templates match the plugin, and filling works.** `TEMPLATES` equals the vendored v0.18.0 fixtures, with CRLF normalized and no deliberate changes. The fixtures are kept out of Prettier. `fillTemplate` replaces every given value of the five known placeholders (`<Feature name>`, `<feature>`, `<STORY-ID>`, `<story title>`, `<YYYY-MM-DD>`). It leaves fields that were left out, and other guidance text, unchanged, and it refuses an invalid slug without throwing.
- **AC2: Layout and paths.** `SPECS_DIR` and the seven `SPEC_FILES`. `isFeatureSlug` uses the shared pattern and length. `specFilePath` returns null for a bad slug, an unknown name or any traversal.
- **AC3: Parsers never throw.** PLAN Status, SPECS frontmatter (status, ticket), tasks counts, and the ledger fields (state, revision, resume on approve, current round, phase). Each reports present, absent and malformed input, with tests including CRLF.
- **AC4: The detector follows the plugin's precedence.**
  - `changed` gives `spec-changed`.
  - `none` gives `closed`, `spec-drafted`, `plan-approved`, `planning` or `idle`.
  - `approved` and `unchecked` give `paused`, `build-done`, the running phase or `implementing`, or `spec-approved`.
  - `round` and `source` are set as specified, and there is a fixture for every branch.
- **AC5: Existing folders open with the right stage.** A vendored copy of `p3-state-machine`, and every finished `docs/specs/` folder in this repo (at least 20), are detected with approval `none` as `closed` (Done).
- **AC6: Scanning, and pure shared modules.** `scanSpecFolders` returns valid folders sorted by slug, with their files, detection and mtime, and `approvalOf` defaults to `none`. It skips invalid slugs, plain files, symlinks and folders with no known file. A missing `docs/specs` gives an empty list, and an unreadable file is reported. The shared modules pass the import scan.
- **AC7: Docs.** In the build on the feature branch:
  - the CHANGELOG entry;
  - D35;
  - `docs/workflow-engine.md` extended;
  - the new `tests/fixtures/sdd-plugin/README.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD, `workflow.md`, the phase-03 doc and the progress follow-ups, recorded in `changes.md`.
- **AC8: Checks pass.** typecheck, lint, format:check and test pass, and CI on the PR is green on every job before the merge.

## Out of scope

- The state file, the hash lock and file watching.
- Choosing the active feature.
- Writing the ledger, changes or SUMMARY during a build.
- Git, commit, push and close.
- Any UI or IPC, and tracker writes (D8).
- Unifying the policy slug pattern.
- Changing the plugin's own files.

## Links

- Plan: docs/specs/p3-spec-docs/PLAN.md
- Spec and tasks: docs/specs/p3-spec-docs/SPECS.md, docs/specs/p3-spec-docs/tasks.md
