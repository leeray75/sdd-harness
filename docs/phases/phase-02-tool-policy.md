# Phase 2: Agent runtime and tool policy (F1)

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-02-tool-policy.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

Give the four agent jobs their tools and enforce, in the main process, exactly what each job may do.

**Before this phase:** Phases 0–1 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F1 (all), NFR rows Agent isolation, Human-only actions, Untrusted input; Risks (commands writing where they may not, hidden instructions)
- **Decisions:** `docs/decisions.md`: D1, D3, D4, D5, D6
- **Design:** The "What each agent can do" table in `docs/design/screens/Providers.dc.html`; Rule lines in `Build.dc.html`
- **Workflow:** `docs/workflow.md`

## In scope

- Tools executed by the main process: read, list/search, write/edit, run command, read tracker (interface only)
- Four jobs (plans and chats, writes code, reviews code, reads big files) with tool sets from the design table
- Path rules: spec folder writable by the planner only before approval; source writable by the writer only after approval; no git for any agent
- Every call checked by the policy gate; blocked calls become Rule events and recoverable errors
- Per-project command allowlist with detection of test and build commands; spec folder read-only while commands run; changed-file check after each command; no network for the writer (best effort per OS, documented)
- Job prompts ported from the sdd plugin agents (implementor, reviewer, data-agent)
- The human-only action channel: accepted only from a user gesture in the app window, unreachable from the agent process

## Out of scope

- The workflow states and build loop (phase 3)
- Any UI

## Decide during planning

- How "no network for the writer" is enforced on each OS, and what is documented as best effort
- How a user gesture is verified for human-only actions

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| #   | Feature                 | Delivers                                                                                                      |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `p2-tools`              | Tool implementations with schemas, run in the main process, with tests                                        |
| 2   | `p2-policy-engine`      | Job-to-tool matrix, path rules, project tightening, Rule events                                               |
| 3   | `p2-command-allowlist`  | Allowlist and detection, read-only spec folder during commands, changed-file check and revert, network limits |
| 4   | `p2-jobs-and-prompts`   | Four job definitions with prompts ported from the plugin                                                      |
| 5   | `p2-human-only-channel` | Human-only IPC channel and tests that the agent process and files cannot trigger it                           |

## Definition of done

- [ ] All F1 acceptance criteria pass as automated tests
- [ ] A ticket or file containing "approve the spec" or "git push" cannot cause either
- [ ] Policy decisions are logged as Rule events with the job, tool, target and reason

## Instructions for Claude (follow these in order)

You are running **Phase 2** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-02-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p2-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
     Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-02-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 2 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 2 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 2. Read docs/phases/phase-02-tool-policy.md and docs/phases/phase-02-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-03-workflow-engine.md`.

## Progress file template

```markdown
# Phase 2 progress: Agent runtime and tool policy (F1)

Status: in progress · Started: <date>

| #   | Feature | Goal | Status  | Spec | Commit |
| --- | ------- | ---- | ------- | ---- | ------ |
| 1   | p2-...  | ...  | pending |      |        |

## Decisions added

- (none yet)

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
```
