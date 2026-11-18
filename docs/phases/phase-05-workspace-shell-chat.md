# Phase 5: Workspace part 1: shell, sidebar and chat (F4)

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-05-workspace-shell-chat.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

The Workspace frame and a real chat: sidebar, feature header, streaming messages, receipts, question cards, the ticket picker and the New feature start screen.

**Before this phase:** Phases 0–4 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F4 (chat, sessions and start parts)
- **Decisions:** `docs/decisions.md`: D8, D11
- **Design:** `docs/design/screens/Flow0Empty.dc.html`, `Flow1Start.dc.html`, and the chat area of `Main.dc.html`; design-notes sections 6 "Chat blocks", "Lists" and 7 "Workspace" steps 1–3
- **Workflow:** `docs/workflow.md`

## In scope

- Workspace layout and icon-rail navigation between the four pages
- Sidebar: project switcher, New feature, search, In progress and History
- Chat: user bubbles, assistant cards with streaming and cost, copy, message box
- Chat blocks: click receipts, event lines, progress steps, question cards with choices, pickers
- New feature screen with three ways in; ticket picker (tracker read only); describe-an-idea and import-a-spec paths
- Sessions saved and restored per feature

## Out of scope

- Documents pane, Next bar and stage stepper (phase 6)
- Build card details (phase 6/7)

## Decide during planning

- Chat state management and message persistence format

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| # | Feature | Delivers |
| --- | --- | --- |
| 1 | `p5-workspace-shell` | Layout, navigation, sidebar |
| 2 | `p5-chat-core` | Messages, streaming, message box, session persistence and restore |
| 3 | `p5-chat-blocks` | Receipts, events, progress steps, question cards, pickers |
| 4 | `p5-new-feature-flow` | Start screen, ticket picker, idea and import paths into planning |

## Definition of done

- [ ] Flow0 and Flow1 match their designs
- [ ] Planning questions appear as cards and answers drive the engine
- [ ] Reopening the app restores every session
- [ ] No step in these screens needs a typed command

## Instructions for Claude (follow these in order)

You are running **Phase 5** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-05-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p5-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
   Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-05-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 5 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 5 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 5. Read docs/phases/phase-05-workspace-shell-chat.md and docs/phases/phase-05-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-06-workspace-docs-next.md`.

## Progress file template

```markdown
# Phase 5 progress: Workspace part 1: shell, sidebar and chat (F4)

Status: in progress · Started: <date>

| # | Feature | Goal | Status | Spec | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | p5-... | ... | pending | | |

## Decisions added
- (none yet)

## Follow-ups
- (none yet)

## Phase summary
(written when the phase is done)
```
