# Phase 4: Projects and environments (F3)

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-04-projects.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

Users add repo folders on this computer, in WSL, on an SSH server or in a dev container, see every project's stage, and act on a single "Needs you" queue.

**Before this phase:** Phases 0–3 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F3 (all); Platforms row of the NFRs
- **Decisions:** `docs/decisions.md`: D6, D12
- **Design:** `docs/design/screens/Projects.dc.html`, `Projects2Env.dc.html`, `Projects3Setup.dc.html` (and their PNGs); design-notes section 7 "Projects"
- **Workflow:** `docs/workflow.md`

## In scope

- Project store (add, remove without deleting files, persist)
- Environment backends for files and commands: local, WSL, SSH, dev container
- Automatic checks: git repo, code host from origin, tracker, test command, earlier specs
- Per-project rules (round limit, model policy, commit format) feeding the engine
- Projects screen with stage bars and one action per card; Needs you panel; Add project wizard (where, checks, rules and models)
- Unreachable environment: Reconnect and read-only sessions

## Out of scope

- Model routing UI beyond the per-project select (phase 8)

## Decide during planning

- SSH library and how credentials are handled
- How dev containers are attached (docker exec vs devcontainer CLI)

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| #   | Feature                    | Delivers                                                                   |
| --- | -------------------------- | -------------------------------------------------------------------------- |
| 1   | `p4-project-store`         | Persisted projects and per-project rules                                   |
| 2   | `p4-env-local-and-wsl`     | File and command backends for local and WSL                                |
| 3   | `p4-env-ssh-and-container` | Backends for SSH and dev containers, with reconnect                        |
| 4   | `p4-project-checks`        | Automatic checks and their results                                         |
| 5   | `p4-projects-ui`           | Projects screen, Needs you panel, Add project wizard, matching the designs |

## Definition of done

- [ ] All F3 acceptance criteria pass
- [ ] The three Projects screens match the designs
- [ ] A project in each environment type runs the phase 3 headless flow

## Instructions for Claude (follow these in order)

You are running **Phase 4** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-04-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p4-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
     Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-04-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 4 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist). The acceptance criteria include the docs item: the CHANGELOG entry under `## [Unreleased]`, every stale doc (`CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the phase doc and the progress file's follow-ups), and any useful new doc named in the spec, all done in the build on the feature branch.
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 4 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 4. Read docs/phases/phase-04-projects.md and docs/phases/phase-04-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-05-workspace-shell-chat.md`.

## Progress file template

```markdown
# Phase 4 progress: Projects and environments (F3)

Status: in progress · Started: <date>

| #   | Feature | Goal | Status  | Spec | Commit |
| --- | ------- | ---- | ------- | ---- | ------ |
| 1   | p4-...  | ...  | pending |      |        |

## Decisions added

- (none yet)

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
```
