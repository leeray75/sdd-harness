# Lock the approved spec by hash in the repo, detect spec changes, and register the approve-spec and edit-approved-spec handlers

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-spec-lock/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-spec-lock

## Context

The folder detector (D35) always gets `none` as its approval input. Nothing records an approval in the repo (D7) or notices an edited approved spec. The two spec human actions have no handlers (D33), and the policy gate uses a placeholder spec state (F1, D4). This work adds:

- a versioned state file, `docs/specs/.sdd-state.json`, holding the active feature, the SHA-256 of its SPECS.md (BOM dropped, CRLF→LF), the time and an `editing` flag, read with a cap and written atomically;
- the approval value (none, approved, changed, unchecked) and the current-feature choice;
- an `fs.watch` watcher, with a re-hash on every read;
- the `approve-spec` and `edit-approved-spec` handlers on the D33 channel;
- the live spec state for the gate: changed→draft, and unchecked→a new fail-closed `locked` state.

The docs are updated in the same change, with D36.

## Required work

- T1 State file module
- T2 Lock on disk and scan
- T3 Watcher
- T4 Handlers
- T5 Policy
- T6 Docs
- T7 Full checks

## Acceptance criteria

- **AC1: Approval round trip.** approve gives approved; an edit gives changed; a CRLF-only re-save stays approved; no file, or another feature, gives none; a missing or unreadable spec, or a malformed state, gives unchecked; editing gives changed; re-approve gives approved.
- **AC2: The state file is safe.** Parse problems are reported (malformed, wrong-version, invalid). The read reports absent, oversized, symlinked and unreadable files. The write is a temp file and a rename, with no leftover temp file.
- **AC3: Watcher.** An edit is reported as changed within 2 s. `refresh()` catches a missed event. `current()` is unchecked before the first refresh, and nothing fires after `close()`.
- **AC4: Handlers.** Registered on the channel and tested through `handle`. Blocked calls never reach them. Refusals return `refused` with a reason, change no file and throw nothing. A successful approve writes the frontmatter status and the state file. A failed state write restores SPECS.md. No agent route names them.
- **AC5: Detection and scan.** A locked folder reads spec-approved, and an edited one spec-changed. The current feature follows the state file, else the newest folder. A throwing approval callback gives unchecked for that folder only.
- **AC6: Policy.**
  - approved: agents are denied writes to SPECS.md;
  - changed (as draft): the writer is denied source writes;
  - locked: every spec and source write is denied;
  - the state file is denied to every job;
  - the shared slug pattern is used;
  - the host's context follows the live supplier.
- **AC7: Docs.** In the build on the feature branch:
  - the CHANGELOG entry;
  - D36 (amending D34 for EDIT_SPEC);
  - the "Spec lock" section in `docs/workflow-engine.md`;
  - `docs/human-actions.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD (F2 item ticked), `workflow.md`, `agent-jobs.md`, the phase-03 doc and the progress follow-ups, recorded in `changes.md`.
- **AC8: Checks.** The shared module passes the import scan. typecheck, lint, format:check and test pass. CI on the PR is green on every job before the merge.

## Out of scope

- The build loop, the ledger writes, the round limits and the revise path.
- approve-result, commit, push, mark-done, and clearing the state on close.
- The headless end-to-end test.
- Any UI or IPC beyond registering the handlers, and tracker writes (D8).
- Changing the plugin, or migrating its `.claude/sdd/` files.

## Links

- Plan: docs/specs/p3-spec-lock/PLAN.md
- Spec and tasks: docs/specs/p3-spec-lock/SPECS.md, docs/specs/p3-spec-lock/tasks.md
