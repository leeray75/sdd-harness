# Phase 6: Workspace part 2: documents pane, Next bar and the full flow (F4)

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-06-workspace-docs-next.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

Finish the Workspace: the stage stepper, the always-visible documents pane, the Next bar, and every step from plan approval to shipped wired to the engine.

**Before this phase:** Phases 0–5 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F4 (all remaining), D8 ticket draft behaviour
- **Decisions:** `docs/decisions.md`: D3, D8, D11
- **Design:** `docs/design/screens/Main.dc.html`, `Flow3Approved.dc.html` to `Flow6Closed.dc.html`; design-notes section 6 "Stage stepper", "Documents pane", "Next bar", "Tasks panel" and section 7 "Workspace" steps 3–7
- **Workflow:** `docs/workflow.md`

## In scope

- Feature header with the stage stepper
- Documents pane: tabs with statuses, live markdown preview, highlighted changes, collapse and resize, facts column, Ticket draft with Copy
- Next bar driven by engine state; amber human-only buttons through the human-only channel
- Plan and spec approval, Start build with the "Who does what" card, live build card, Review result with editable commit message, Approve and push, Mark as done, Start next feature with summary carry-over

## Out of scope

- The full Build view (phase 7)
- Settings screens (phase 8)

## Decide during planning

- How "Start next feature" builds its summary and what context it drops

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| # | Feature | Delivers |
| --- | --- | --- |
| 1 | `p6-stepper-and-header` | Stage stepper and feature header with lock state |
| 2 | `p6-documents-pane` | Tabs, statuses, preview, highlights, collapse/resize, ticket draft copy |
| 3 | `p6-next-bar` | Next bar states and human-only actions |
| 4 | `p6-flow-wiring` | Every step from plan approval to shipped, wired end to end |

## Definition of done

- [ ] All F4 acceptance criteria pass
- [ ] Main and Flow3–Flow6 match their designs
- [ ] A full feature can be run with clicks only

## Instructions for Claude (follow these in order)

You are running **Phase 6** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-06-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p6-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
   Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-06-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 6 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 6 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 6. Read docs/phases/phase-06-workspace-docs-next.md and docs/phases/phase-06-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-07-build-view.md`.

## Progress file template

```markdown
# Phase 6 progress: Workspace part 2: documents pane, Next bar and the full flow (F4)

Status: in progress · Started: <date>

| # | Feature | Goal | Status | Spec | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | p6-... | ... | pending | | |

## Decisions added
- (none yet)

## Follow-ups
- (none yet)

## Phase summary
(written when the phase is done)
```
