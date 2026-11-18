# Phase 0: Project scaffold

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-00-scaffold.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

An Electron + TypeScript app skeleton that builds, tests and opens a window on Windows, macOS and Linux, with the process layout and design tokens every later phase builds on.

**Before this phase:** This is the first phase; the repo has docs only and no remote. Each sdd cycle ends by committing and pushing a feature branch, so create the remote repository (for example on GitHub) and add it as `origin` before the first `/sdd:close`.

## Inputs

- **PRD:** `docs/PRD.md`: Non-functional requirements (all rows); Delivery plan
- **Decisions:** `docs/decisions.md`: D1, D3, D10, D12
- **Design:** `docs/design-notes.md` sections 2–6 (tokens, type, spacing, layout, buttons, chips); `docs/design/png/Flow0Empty.png` for the window chrome
- **Workflow:** `docs/workflow.md`

## In scope

- Toolchain: package manager, bundler/packager, UI framework, test runners, lint and format
- Secure Electron defaults: context isolation, sandboxed renderer, no Node in the renderer, typed preload bridge
- Process layout: main process, renderer, and a separate agent process stub talking over a typed channel; a main-process "policy gate" stub that every future tool call must pass through
- Frameless window with the custom title bar (Windows/Linux caption buttons, macOS traffic lights)
- Design tokens as code, bundled Inter and JetBrains Mono, base Button and Chip components
- CI on Windows, macOS and Linux; the Commands section of `CLAUDE.md` filled in

## Out of scope

- Any provider, agent or workflow logic
- Any real screen beyond an empty shell

## Decide during planning

- Package manager (recommend pnpm)
- Build tooling (recommend electron-vite + electron-builder, or Electron Forge)
- UI framework (recommend React + TypeScript)
- Unit and end-to-end test runners (recommend Vitest, and Playwright for Electron)
- Record each choice as a new D-number in `docs/decisions.md`

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| #   | Feature                     | Delivers                                                                                                                                                                     |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `p0-toolchain-and-skeleton` | Toolchain decided and recorded; app boots with secure defaults and the typed preload bridge; one unit test and one e2e smoke test pass                                       |
| 2   | `p0-process-layout`         | Agent process stub (e.g. utilityProcess) with a typed message channel; main-process policy gate stub that rejects everything by default, with tests                          |
| 3   | `p0-window-chrome`          | Frameless window, 40px custom title bar per OS, drag regions, window controls                                                                                                |
| 4   | `p0-design-tokens`          | Tokens from design-notes sections 2–4 as CSS variables/TS constants; bundled fonts; Button (primary, gate, secondary, ghost, danger) and Chip components with a gallery page |
| 5   | `p0-ci`                     | Lint, format, unit and e2e jobs on a Windows/macOS/Linux matrix; CLAUDE.md Commands section; suggested SDD_TEST_CMD                                                          |

## Definition of done

- [ ] `<install>`, `<test>` and `<e2e>` commands pass locally and in CI on all three OSes
- [ ] The app opens a frameless window with the title bar from the designs
- [ ] The renderer cannot reach Node or the filesystem; a test proves it
- [ ] The policy gate exists and denies by default
- [ ] New decisions are recorded in `docs/decisions.md`; `CLAUDE.md` lists the commands

## Instructions for Claude (follow these in order)

You are running **Phase 0** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-00-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p0-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
     Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-00-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 0 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 0 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 0. Read docs/phases/phase-00-scaffold.md and docs/phases/phase-00-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-01-providers.md`.

## Progress file template

```markdown
# Phase 0 progress: Project scaffold

Status: in progress · Started: <date>

| #   | Feature | Goal | Status  | Spec | Commit |
| --- | ------- | ---- | ------- | ---- | ------ |
| 1   | p0-...  | ...  | pending |      |        |

## Decisions added

- (none yet)

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
```
