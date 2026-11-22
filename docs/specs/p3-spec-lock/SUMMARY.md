# Summary Report: p3-spec-lock

Ticket: none Date: 2026-11-22
Outcome: Clean
Review rounds: 1 of 3 per revision, plus 1 user-requested change round; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **State file (G1, G2):** approval now lives in the repo at `docs/specs/.sdd-state.json`. It holds the feature, the SHA-256 of SPECS.md (BOM dropped, CRLF→LF), the approval time and an `editing` flag. It is versioned and read with a 4 KiB cap. It is written atomically with a temp file and a rename, and its parse never throws.
- **Approval (G2):** `approvalFor` turns the file and a fresh hash into `none`, `approved`, `changed` or `unchecked`.
- **Watcher (G3):** a debounced `fs.watch` watcher re-hashes on change, and every refresh re-hashes as well.
- **Handlers (G4):** `approve-spec` checks the headings, writes `status: approved`, hashes the spec and writes the lock, and restores the spec if the lock write fails. `edit-approved-spec` sets `editing`. Both refuse with the new `refused` code and never throw.
- **Scan (G5):** the folder scan gets the real approval and the current feature, and a throwing callback gives `unchecked`.
- **Gate (G6):** the policy gate reads the live spec state, mapped as approved→approved, changed→draft and unchecked→a new fail-closed `locked`. It uses the shared slug rules.
- **Docs (G7):** updated in the same change, with D36.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/spec-state.ts | created | Pure state-file module: constants, parse and serialize, normalization, the approval table, the frontmatter setter, the headings check | T1 |
| tests/unit/spec-state.test.ts | created | Parse problems, the approval table, normalization, frontmatter, headings and the purity scan (AC2, AC8) | T1 |
| src/main/workflow/spec-lock.ts | created | Capped read, atomic write, hash, `approvalOf`, `currentFeature`, `scanSpecFoldersWithLock` | T2 |
| src/main/workflow/spec-folders.ts | edited | `approvalOf` is wrapped in try/catch, so a throw gives `unchecked` | T2 |
| tests/unit/spec-lock.test.ts | created | AC1 round trip, AC2 read and write, AC5 scan and current feature (symlink cases skip where they are refused) | T2 |
| src/main/workflow/spec-watch.ts | created | The debounced `fs.watch` watcher: `current`, `refresh`, `close`, change-only `onChange` | T3 |
| tests/unit/spec-watch.test.ts | created | Real `fs.watch`: changed within 2 s, refresh after a missed event, nothing after close (AC3) | T3 |
| src/shared/human-actions.ts | edited | `refused` added to `HumanActionRefusal` | T4 |
| src/main/human/spec-handlers.ts | created | The `approve-spec` and `edit-approved-spec` handlers | T4 |
| tests/unit/spec-handlers.test.ts | created | Through `channel.handle`: blocked calls, refusals, success writes, restore (AC4) | T4 |
| src/main/index.ts | edited | Registers the handlers and starts the watcher when `HARNESS_SPIKE_ROOT` is set, and passes the live value to the agent host | T4, T5 |
| src/main/policy/context.ts | edited | `locked`, `LiveSpec`, `specStateOf`, and the shared slug pattern and length | T5 |
| src/main/policy/gate.ts | edited | The `locked` rule, before the job rules | T5 |
| src/main/agent/host.ts | edited | An optional live supplier merged into each call's context (`contextFor`) | T5 |
| tests/unit/policy-gate.test.ts | edited | AC6: the mapping, the approved, draft and locked denials, the state file, the slug cases | T5 |
| tests/unit/host-context.test.ts | created | The per-call context follows the supplier; the default without one | T5 |
| docs/decisions.md | edited | D36, and an amendment note on D34 (EDIT_SPEC from `edit-approved-spec`) | T6 |
| docs/workflow-engine.md | edited | "Spec lock" section, detection sentence, code list, Limits | T6 |
| docs/human-actions.md | edited | Status, the `refused` code, log example, registration section | T6 |
| CHANGELOG.md | edited | Added and Changed entries. The Added bullet was moved after the Document layer bullet's sub-bullets in change round U1. | T6, U1 |
| CLAUDE.md | edited | D1–D36, the engine line, the role of `HARNESS_SPIKE_ROOT` | T6 |
| README.md | edited | D1–D36, the engine row, the `HARNESS_SPIKE_ROOT` row | T6 |
| docs/PRD.md | edited | F2 "Existing folders open with the right stage" ticked; the approval line cites D36 | T6 |
| docs/workflow.md | edited | The approval paragraph cites the lock (D36) | T6 |
| docs/agent-jobs.md | edited | The spec state comes from the lock; unchecked blocks spec and source writes | T6 |
| docs/phases/phase-03-workflow-engine.md | edited | State file name and format decided (D36) | T6 |
| docs/phases/phase-03-progress.md | edited | D36, the planning decision, p3-spec-docs follow-ups resolved, p3-spec-lock follow-ups | T6 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p3-spec-lock/PLAN.md | created | Approved plan | n/a |
| docs/specs/p3-spec-lock/SPECS.md | created | Approved spec | n/a |
| docs/specs/p3-spec-lock/SUBTASK.md | created | Child-ticket draft (no tracker) | n/a |
| docs/specs/p3-spec-lock/tasks.md | created | T1–T7, all ticked | T1–T7 |
| docs/specs/p3-spec-lock/build-ledger.md | created | Build ledger | n/a |
| docs/specs/p3-spec-lock/changes.md | created | The implementor's file record and stale-doc check | n/a |
| docs/specs/p3-spec-lock/SUMMARY.md | created | This report | n/a |

Git and `changes.md` agree: every changed file is listed, and every listed file shows in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Pass | `spec-lock.test.ts` and `spec-handlers.test.ts` cover approve, edit, a CRLF-only save, no lock, another feature, missing or unreadable spec, malformed state, `editing` and re-approve. The reviewer checked `approvalFor` against the table. |
| AC2 | Pass | `spec-state.test.ts` covers the parse problems. `spec-lock.test.ts` covers absent, oversized, symlinked and unreadable files, and that a write leaves no temp file. The reviewer confirmed the `wx` temp file, the rename and the cleanup. |
| AC3 | Pass | `spec-watch.test.ts` with real `fs.watch`: changed within 2 s, refresh after a missed event, `unchecked` before the first refresh, nothing after close. Passed twice in a row. |
| AC4 | Pass | `spec-handlers.test.ts` goes through `channel.handle`, and blocked calls never reach a handler. Refusals change no file, a failed state write restores the spec, and the boundary tests still pass. |
| AC5 | Pass | `spec-lock.test.ts`: locked gives spec-approved, edited gives spec-changed, the current feature follows the file or the newest folder, and a throwing callback gives `unchecked`. |
| AC6 | Pass | `policy-gate.test.ts` and `host-context.test.ts`: approved, draft and locked denials, the state file denied to every job, the slug cases, and the per-call context follows the supplier. |
| AC7 | Pass | D36, the engine and human-action docs, the CHANGELOG entries (placement fixed in round U1), the stale-doc check recorded in `changes.md`, and the PRD item ticked. |
| AC8 | Pass locally | Purity scan passes. typecheck, lint and format:check pass. `pnpm test` gives 67 files, 1380 passed, 15 skipped (re-run by the orchestrator). CI is checked on the PR. |

## Needs a runtime check

- CI on the pull request: the `check` job, and `e2e` on Windows, macOS and Linux.
- On Windows, a `rename` over SPECS.md or the state file can fail with EPERM or EBUSY while an editor or watcher holds the file. The handler then refuses, and restores the spec if needed.
- The gate reads the watcher's cached value. A missed event leaves a stale `approved` until the next event or refresh, which is documented as a limit.
- The watcher's error-then-re-arm path, and a `docs/specs` created after startup, are covered by reading the code only.
- `tests/e2e/human-action.spec.ts` (c), (d) and (e) expect `not-available` for approve-spec. They hold only while e2e sets no `HARNESS_SPIKE_ROOT`.
- The file-symlink tests skip on this Windows account (EPERM). They run on the Linux `check` job.

## Review ledger

Covers every revision, copied from `docs/specs/p3-spec-lock/build-ledger.md`.

### Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

### User-requested change round U1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| U1: the Spec lock bullet split the Document layer bullet from its sub-bullets | minor (docs) | CHANGELOG.md, Unreleased, Added | ACCEPT | Before the fix, line 114 was the Spec lock bullet, and lines 115–118 were the Document layer sub-bullets | Moved the bullet and updated the changes.md row. `format:check` passes. Reviewer: PASS. |

## Spec revisions

none

## Rejected findings

none

## Open issues

none. The CHANGELOG placement, which the orchestrator found after round 1, was fixed in the user-requested round U1.

Noted, not defects:

- The gate reads the cached lock value.
- An unreadable state file is `unchecked` for every folder, until approve-spec replaces it.
- The handlers are reachable only when `HARNESS_SPIKE_ROOT` is set, until Phase 4 adds projects.

## Git state

Branch `feature/p3-spec-lock`; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, then commit and push, open a pull request, and merge only when CI is green on every job. Then run `/sdd:close`.
