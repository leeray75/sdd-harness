# SDD Harness — Product Requirements

Draft v0.3 · 17 Nov 2026 · Owner: Ray Lee

SDD Harness is an Electron desktop app that runs a spec-driven workflow (plan, approve the spec, build and review, approve the result, ship) across many projects, with any hosted or self-hosted model per job. The workflow rules are built into the app and each agent gets only the tools its job needs, so the app does not depend on Claude Code hooks. All product decisions are settled (see [Decisions](#decisions) and [`decisions.md`](decisions.md)).

Related: [`design-notes.md`](design-notes.md) · [`workflow.md`](workflow.md) · [`design/`](design/README.md)

## Summary and problem

The sdd plugin proves the loop works, but it is tied to Claude Code. Hooks enforce its rules, slash commands drive it, only Claude models run its agents, and its state is spread across hook output, files and a side pane.

Four gaps:

- **Usability.** Users must learn eight `/sdd:` commands and read terminal text to notice that a step is waiting on them.
- **Model choice.** Agents are limited to the `haiku` and `sonnet` aliases; teams that want open-weight models for cost or privacy can't use them.
- **Multi-project work.** One terminal per repo; no single view of what needs a decision.
- **Fragile enforcement.** Hooks need bash and jq; where they can't run (native Windows without bash), nothing is guarded.

The harness keeps the plugin's workflow and rules and moves them into the product: a workflow engine, an agent runtime where each job has a fixed tool set, and buttons in place of commands.

## Goals and non-goals

**Goals (v1)**

1. Anyone can run the whole workflow with clicks: no commands to learn, one clear next action on every screen.
2. The app enforces the rules in code: tools per job, a locked spec after approval, human-only approvals, a review round limit, no commit before the result is approved.
3. Any model for any job, hosted or self-hosted, tested before it can be used.
4. Every document (story, plan, spec, tasks, ticket, report) stays visible and updates live.
5. Many projects across this computer, WSL, SSH servers and dev containers, with one "needs you" queue.

**Non-goals (v1)**

- A general IDE or code editor.
- Running on Claude Code or its plugin hooks.
- Team features: shared sessions, multi-user approval, cloud sync.
- Hosting or serving models.
- Mobile or web versions.

## Users and core use cases

| User                            | Need                                                          | Use case                                                                             |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Developer on a team using SDD   | Ship tickets through the gated loop without learning commands | Pick a ticket, answer questions, approve the spec, watch the build, approve and push |
| Tech lead running several repos | See which features wait on a human                            | Open Projects, act on the "Needs you" queue                                          |
| Privacy- or cost-sensitive team | Keep code on their own network                                | Add a vLLM or Ollama server, set a project to "self-hosted only"                     |
| Windows developer               | The same safety on every machine                              | Rules work the same everywhere because the app enforces them, not shell hooks        |

## Decisions

All decisions are settled as of 17 Nov 2026. The full record, with reasons, is in [`decisions.md`](decisions.md).

| #   | Decision                   | Outcome                                                                                                                                                                                                                                                             |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | What runs the agents       | The harness's own agent runtime with provider adapters. Workflow rules and tool permissions live in code; no Claude Code hooks at runtime                                                                                                                           |
| D2  | How models are reached     | Adapters for the Anthropic Messages API and OpenAI-compatible APIs. LiteLLM and agentgateway are supported as gateway providers                                                                                                                                     |
| D3  | Human-only actions         | Approve spec, approve result, close, change rules and edit an approved spec exist only as UI actions. No agent tool exists for them, and the main process accepts them only from a user gesture (a click, or an Enter or Space press) in the app's own window (D33) |
| D4  | Rule enforcement           | In code: review round limit (3 by default, a project can lower it), commit and push done by the app only after result approval, spec files read-only to every agent after approval                                                                                  |
| D5  | Reuse from the sdd plugin  | Port the prompts, the document templates (PLAN, SPECS, tasks, SUBTASK), the tracker guides and the workflow states and events. Keep the `docs/specs/<feature>/` layout so existing specs open as history                                                            |
| D6  | Limits on running commands | Per-project allowlist (detected test and build commands), spec folder read-only while commands run, no network for the code writer. An OS sandbox or container per build is a later option                                                                          |
| D7  | Where state lives          | Workflow state and the approved spec's hash in the repo (`docs/specs/<feature>/` plus a small state file). Sessions, providers and routing in app data; secrets in the OS keychain                                                                                  |
| D8  | Tracker scope              | v1 reads tickets for planning. Creating the child ticket and moving ticket status come in v1.1                                                                                                                                                                      |
| D9  | Distribution               | Internal first: signed builds for the pilot team. Decide on a public release after the success metrics are measured                                                                                                                                                 |
| D10 | Theme                      | Dark only in v1; colors are tokens, so a light theme can follow                                                                                                                                                                                                     |
| D11 | Typed commands             | None. Every workflow action is a button; there are no slash commands, hidden or otherwise                                                                                                                                                                           |
| D12 | Pilot platforms            | Windows, macOS and Linux builds for the first pilot                                                                                                                                                                                                                 |
| D13 | Pilot providers            | Anthropic, any OpenAI-compatible server, LiteLLM and agentgateway. Cloud platforms (Bedrock, Azure, Vertex) come later                                                                                                                                              |

## Scope: v1 features

Seven features, each small enough for one spec. F1 and F2 are the core and come first; the screens build on them.

Tracker writes are out of v1 (D8): the ticket picker and story reading ship in v1, while the child ticket stays as a draft in the Ticket tab for the user to copy until v1.1 adds creating it and moving its status.

### F1 · Agent runtime and tool policy

Design: the "What each agent can do" table on `design/screens/Providers.dc.html`; Rule lines in the build activity log.

- Four jobs: plans and chats, writes code, reviews code, reads big files. Each has a fixed tool set from the policy table.
- Path rules: the spec folder is writable only by the planner and only before approval; source files only by the code writer and only after approval; no agent can run git, commit, push or approve.
- Commands: per-project allowlist of the detected test and build commands (D6, D31). The writer's commands get no network where the OS allows it (Linux and macOS); elsewhere that is best effort, and the level each command ran with is logged.
- Every tool call is checked in the app's main process, not in the prompt. A blocked call is logged as a Rule event and returned to the agent as an error it can recover from.
- A project can remove tools from a job, never add them.

Acceptance:

- [ ] The code writer's edit to an approved SPECS.md is blocked and logged.
- [ ] The reviewer has no write tool at all.
- [ ] No agent can trigger commit, push, approve or close, even when a ticket or doc tells it to.

### F2 · Workflow engine

- States and events ported from the plugin (D5) into a hand-written table in `src/shared/workflow.ts` (D34), shown to users as six stages: Start, Plan, Spec, Build, Review, Done. Reference: [`workflow-engine.md`](workflow-engine.md).
- Documents: the plugin's four templates and the `docs/specs/<feature>/` layout, with parsers, and a folder detector that gives each existing folder its node and stage from its files (D35, `p3-spec-docs`). The approval comes from the spec lock (D36, `p3-spec-lock`).
- Spec lock by hash; editing an approved spec moves it to "approve again".
- Review loop with the round limit; pause when the reviewer reports a spec problem; Ask for changes after the build (counted separately); close.

Acceptance:

- [x] After the last allowed round the build stops and asks the user. Checked by `tests/unit/build-loop.test.ts` (a limit of 1 stops after one ISSUES review; a round-3 limit ends with open issues).
- [x] Nothing is committed before the user approves the result. Approve-result commits and pushes only after the approval (D38, `p3-ship`). Checked by the headless walk: no commit or push before approve-result, one after it, and one more after mark-done (`tests/unit/headless-e2e.test.ts`, `tests/unit/ship.test.ts`).
- [x] Existing `docs/specs/<feature>/` folders open with the right stage. Folders are detected from their files (D35, `p3-spec-docs`), and the approval comes from the spec lock (D36, `p3-spec-lock`). Checked by `tests/unit/plugin-folder-states.test.ts` (the `p3-ship` plugin files in every state) and `tests/unit/spec-folders.test.ts` (the `p3-state-machine` folder).

### F3 · Projects and environments

Design: `Projects.dc.html`, `Projects2Env.dc.html`, `Projects3Setup.dc.html`.

Built so far: the project store and the per-project rules (`p4-project-store`, D40), and the environment interface with the local backend, which every project's files, commands, git and watching go through (`p4-env-local`, D41; [`environments.md`](environments.md)). The WSL backend and WSL projects (`p4-env-wsl`, D42; detection runs only when called, and the add wizard that uses it is `p4-add-project-wizard`). The SSH backend (`p4-env-ssh`, D43): saved servers with their secrets in the secret store, pinned host keys, and the connection state. A project whose environment cannot be reached stays listed and removable, its actions are refused, and Reconnect brings it back; the screen that shows this is `p4-projects-screen`. The container backend is the later subtask.

- Project cards with the stage and one action; a "Needs you" queue across projects.
- Add a project in three steps: where (this computer, WSL, SSH server, dev container), folder and automatic checks (git, code host, tracker, test command, earlier specs), rules and models.

Acceptance:

- [ ] An unreachable environment shows Reconnect and opens sessions read-only.
- [ ] Removing a project never deletes files.

### F4 · Workspace: chat, documents and the Next bar

Design: page 1, seven screens from `Flow0Empty.dc.html` to `Flow6Closed.dc.html` (planning and spec approval is `Main.dc.html`).

- Documents pane always on top: Story, Plan, Spec, Tasks, Ticket, Report, each with a status and a live preview.
- Next bar above the message box with the one recommended action as buttons; amber for human-only actions.
- Ticket picker, question cards with choices, click receipts in the chat, streaming replies, chat history per feature.
- "Start next feature" carries a short summary forward and drops the rest of the context.

Acceptance:

- [ ] No step needs a typed command.
- [ ] The documents pane reflects a file change within 2 seconds.
- [ ] Reopening the app restores every session.

### F5 · Build view

Design: `Build.dc.html`, `Build2Paused.dc.html`, `Build3Limit.dc.html`.

- A Tasks panel like a to-do list: progress bar, done tasks checked and struck through, the current task highlighted with who is working on it, paused or problem tasks in amber, and tasks a spec change would add shown as proposed. Also rounds, agents with their models and allowed tools, issues, files changed (checked against git), activity log filtered by files, tests and rules.
- Paused for a spec problem: both texts side by side, a suggested spec change, three choices.
- Round limit reached: the open issue and three choices.

Acceptance:

- [ ] A task is marked done only after the reviewer confirms it.
- [ ] The current task and its worker update within 2 seconds of a change.
- [ ] A proposed task joins the list only after the user approves the spec change.

### F6 · Models and agents

Design: `Providers.dc.html`, `Models2Add.dc.html`, `Models3Test.dc.html`.

- Pilot providers (D13): Anthropic; any OpenAI-compatible server (OpenAI, vLLM, LM Studio, llama.cpp, TGI, SGLang, and Ollama through its OpenAI-compatible endpoint); the LiteLLM and agentgateway gateways. Presets fill in the address format.
- Three tests per model (chat, use tools, edit a file and run tests); a model that fails tool use can't write or review code.
- "Who does what" with a backup model per job; per-project override including "self-hosted only".

Acceptance:

- [ ] Keys never appear in logs, project files or exported sessions.
- [ ] With "self-hosted only", no request leaves the configured hosts.

### F7 · Usage and cost

- Tokens and cost per feature, job and model; self-hosted models show tokens only.
- Optional monthly budget per provider with a warning at 80%.

## Non-functional requirements

| Area               | Requirement                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platforms          | Windows 10/11 (local and WSL projects), macOS 13+, Ubuntu 22.04+; SSH servers and dev containers as project environments                                                         |
| Agent isolation    | Agents run in a separate process; every tool call is checked by the main process against the policy before it runs; commands run with the spec folder read-only                  |
| Human-only actions | Accepted only from a user gesture (a click, or an Enter or Space press) in the app's own window, checked in main (D33); never reachable from an agent tool, a file or a web page |
| Secrets            | Keys in the OS keychain via `safeStorage`; never written to logs, sessions, exports or repos                                                                                     |
| Privacy            | No telemetry by default; "self-hosted only" is enforced in the provider client, not just in settings                                                                             |
| Untrusted input    | Tickets, docs and web pages are passed to agents as data; reader agents have no write tools                                                                                      |
| Fidelity           | The approved spec's hash, stored with the repo, is the source of truth for the lock                                                                                              |
| Performance        | Cold start under 3 s; document changes visible under 2 s; smooth streaming with 20 open sessions                                                                                 |
| Accessibility      | WCAG 2.2 AA contrast, full keyboard use, visible focus, `prefers-reduced-motion` respected                                                                                       |
| Updates            | Signed builds, auto-update with release notes                                                                                                                                    |

## Success metrics

Targets for the first 90 days after v1; baselines come from a two-week pilot without the harness.

| Metric                                                                         | Target                            |
| ------------------------------------------------------------------------------ | --------------------------------- |
| New users who ship a first feature without help or docs                        | At least 80%                      |
| Time from spec ready to human approval (median)                                | 50% lower than the pilot baseline |
| Features shipped without a missed gate (commit before approval, stale spec)    | 100%                              |
| Tool calls blocked by the policy that should have been allowed                 | Under 1%                          |
| Share of code-writing tokens on self-hosted models, for teams that enable them | At least 60%                      |

## Delivery plan

Build the core headless first, then the screens. Until the Workspace works, develop the harness with Claude Code and the sdd plugin; after that, use the harness to build itself.

1. Record all decisions in `docs/decisions.md` (done).
2. This PRD is `docs/PRD.md`; the designs are in `docs/design/` (each `.dc.html`, a PNG of each) with `docs/design-notes.md` and `docs/workflow.md` (done).
3. Follow [`roadmap.md`](roadmap.md): ten phases, each run in its own chat from a document in [`phases/`](phases/README.md). Phase 0 scaffolds the app; phase 1 starts with the agent loop spike (two providers) before the provider layer; phases 2 and 3 build F1 and F2 headless, with tests; phases 4–9 build F3–F7 and the pilot.
4. Each phase is split into subtasks; each subtask is one sdd cycle: plan from its PRD section and design files, approve the spec, build, approve the result, close, then `/compact`.

Example request when planning F4: "F4 from docs/PRD.md: the Workspace. Match docs/design/screens/Flow0Empty.dc.html to Flow6Closed.dc.html, the PNGs in docs/design/png/, and docs/design-notes.md."

## Risks and open questions

| Risk                                                                     | Effect                                   | Mitigation                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Building an agent runtime is a large job                                 | F1 slips and blocks everything           | Spike first; look at existing multi-provider agent libraries before writing one; keep v1 to four jobs                  |
| A command writes where an agent may not (a test script editing the spec) | Policy bypassed through the shell        | Spec folder read-only while commands run; check changed files after each command and revert anything outside the rules |
| Open-weight models use tools poorly                                      | Builds loop or edit the wrong files      | Model tests before use; backup model per job; reviewer stays on a strong model                                         |
| Instructions hidden in a ticket or doc                                   | An agent is steered to do something else | Inputs passed as data; readers can't write; no agent can approve, commit or push                                       |
| Drift from the sdd plugin's workflow                                     | Old specs open in the wrong stage        | Port its states and templates (D5); compatibility tests on real `docs/specs` folders                                   |

Open questions:

- [ ] Who is on the pilot team, and when does the two-week baseline start?
- [ ] Default monthly budget per provider, if any?
- [ ] Code-signing accounts for Windows and macOS (needed for internal builds too).
