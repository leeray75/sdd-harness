# Phase 9: Usage, cost and pilot release (F7)

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-09-usage-and-pilot.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

Usage and cost tracking, budgets, the states not drawn, an accessibility pass, and signed pilot builds for Windows, macOS and Linux.

**Before this phase:** Phases 0–8 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F7, NFR rows Accessibility and Updates, Success metrics, Open questions
- **Decisions:** `docs/decisions.md`: D9, D12
- **Design:** design-notes sections 9 "States not drawn" and 10 "Accessibility"
- **Workflow:** `docs/workflow.md`

## In scope

- Tokens and cost per feature, job and model; pricing configuration; self-hosted shows tokens only
- Optional monthly budget per provider with an 80% warning
- Every state in design-notes section 9
- Accessibility pass against section 10
- Signed builds and auto-update for the pilot; metrics needed for the success table

## Out of scope

- Public release (D9)

## Decide during planning

- Code-signing accounts and certificates (PRD open question)
- How pilot metrics are collected without telemetry by default

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| # | Feature | Delivers |
| --- | --- | --- |
| 1 | `p9-usage-tracking` | Usage and cost model and display |
| 2 | `p9-budgets` | Budgets and warnings |
| 3 | `p9-states-and-a11y` | States not drawn and the accessibility pass |
| 4 | `p9-pilot-builds` | Signed builds, auto-update, pilot checklist |

## Definition of done

- [ ] F7 acceptance criteria pass
- [ ] Signed pilot builds install on all three OSes
- [ ] The pilot can measure every metric in the PRD success table

## Instructions for Claude (follow these in order)

You are running **Phase 9** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-09-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p9-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
   Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-09-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 9 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 9 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 9. Read docs/phases/phase-09-usage-and-pilot.md and docs/phases/phase-09-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/the next roadmap item (all v1 phases are done)`.

## Progress file template

```markdown
# Phase 9 progress: Usage, cost and pilot release (F7)

Status: in progress · Started: <date>

| # | Feature | Goal | Status | Spec | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | p9-... | ... | pending | | |

## Decisions added
- (none yet)

## Follow-ups
- (none yet)

## Phase summary
(written when the phase is done)
```
