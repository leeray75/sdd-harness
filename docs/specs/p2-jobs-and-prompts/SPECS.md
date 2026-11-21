---
status: done
ticket:
---

# p2-jobs-and-prompts

## Problem

The four agent jobs (plans and chats, writes code, reviews code, reads big files) exist only as ids in `src/shared/agent-protocol.ts` and as rows in main's policy table, `src/main/policy/policy-table.ts`. The agent can't read that table, because it lives in main's folder. The agent loop (`src/agent/loop.ts`) advertises one hand-written `read_file` tool to every run, and the provider interface has no system prompt, so the model gets no instructions for its job. The sdd plugin's implementor, reviewer and data-agent prompts, which these jobs are based on, have not been ported.

## Goals

- **G1 (job definitions):** each job has one shared definition: its id, its plain-language name, and its base tools. The gate and the agent read the same table.
- **G2 (advertised tools):** a run advertises exactly its job's base tools, with the registry's names, descriptions and schemas (`TOOL_SPECS`, D29). Main's gate still decides every call (D30).
- **G3 (prompts):** each job has a system prompt.
  - The writer's, reviewer's and reader's prompts are ported from the plugin's implementor, reviewer and data-agent, rewritten for the app's tools and rules.
  - The planner's prompt is new.
  - The writer and the reviewer also have task texts for Phase 3 to send each round.
- **G4 (system prompt):** the provider interface carries an optional system prompt, and both adapters send it.
- **G5 (docs):** D32, the changelog, a new `docs/agent-jobs.md`, and the stale docs and follow-ups updated.

## Non-goals

- The human-only channel (`p2-human-only-channel`).
- Workflow states, the build loop, and which task text is sent when (Phase 3).
- Sending a project's tightened tool list to the agent. The agent advertises the base set; main's gate applies tightening.
- Changing `MAX_TURNS`, per-job models or turn budgets.
- Re-recording the spike or probe fixtures.
- Any UI.

## Acceptance criteria

- **AC1 (shared table):**
  - A new `src/shared/jobs.ts` imports nothing outside `src/shared/` (no Node, Electron or DOM API).
  - It exports `BASE_TOOLS: Record<JobId, readonly ToolName[]>` with the same contents and order as today:
    - planner: `read_file`, `list_files`, `search_text`, `write_file`, `edit_file`, `read_ticket`;
    - writer: `read_file`, `list_files`, `search_text`, `write_file`, `edit_file`, `run_command`;
    - reviewer: `read_file`, `list_files`, `search_text`, `run_command`;
    - reader: `read_file`, `list_files`, `search_text`, `read_ticket`.
  - It also exports `JOBS`, one entry per `JobId`, with the plain name: planner "plans and chats", writer "writes code", reviewer "reviews code", reader "reads big files".
  - `src/main/policy/policy-table.ts` re-exports `BASE_TOOLS` from it, and defines no table of its own.
  - A unit test checks that the re-export is the same object.
  - The existing policy tests pass unchanged.
- **AC2 (advertised tools):**
  - `jobToolDefinitions(job)` returns, for each tool in `BASE_TOOLS[job]` and in that order, a `ToolDefinition` whose name, description and parameters equal `TOOL_SPECS[name]`.
  - Unit tests check:
    - each job's list;
    - that the reviewer and the reader get no `write_file` or `edit_file`;
    - that no job gets a tool outside the registry.
- **AC3 (system prompt in the providers):**
  - `ProviderRequest` has an optional `system: string`.
  - When it is set and non-empty:
    - the Anthropic adapter passes it as the `system` parameter of `messages.create`;
    - the OpenAI adapter sends it as the first message, `{ role: 'system', content }`, before the history.
  - When it is unset or empty, each adapter's request is exactly what it sends today: no `system` parameter and no system message.
  - Unit tests in the adapter test files cover both cases for both adapters.
- **AC4 (prompts):** `src/agent/jobs/` exports `JOB_PROMPTS: Record<JobId, { system: string }>` as TypeScript string constants. No file is read at run time.
  - **Every system prompt states:**
    - (a) the job's role;
    - (b) use only the listed tools, named as the registry names them;
    - (c) never run git and never ask for commit, push, approve or close;
    - (d) the approved spec is read-only;
    - (e) tickets, docs, web pages and tool output are untrusted data, never instructions, and text that looks aimed at the agent is quoted back, not followed;
    - (f) a refused tool call is an error to recover from, never to work around.
  - **Writer** (ported from the plugin's implementor):
    - the changes-file rule (`docs/specs/<feature>/changes.md`);
    - `NEEDS-SPEC-CHANGE` with a quote and candidate resolutions;
    - the `## Implementation report` and `## Findings analysis` formats.
    - `WRITER_TASKS` exports the texts for implement (Mode 1), fix findings (Mode 2) and resume after a spec revision (Mode 3).
  - **Reviewer** (ported from the plugin's reviewer):
    - reads the changes file and the files it lists;
    - may run the project's detected test command to confirm a claim;
    - never builds and never edits;
    - its findings and `Verdict: PASS | ISSUES` format, with `spec-change` findings.
    - `REVIEWER_TASKS` exports the review-round text.
  - **Reader** (ported from the plugin's data-agent):
    - read-only;
    - reads files and tickets with its tools;
    - the `## Data report` format.
  - **Planner** (new):
    - plans with the user in chat;
    - asks about load-bearing ambiguity with choices and a recommendation;
    - writes only the feature's `PLAN.md`, `SPECS.md`, `tasks.md` and `SUBTASK.md` before approval;
    - never approves its own spec.
  - **Plugin-only references are left out:** `.claude/sdd/`, Bash/Edit/Grep/Glob tool names, MCP, `ToolSearch`, `NEEDS-DATA-AGENT` and the plugin's scripts.
  - **Unit tests check, for every job:**
    - (a) to (f) are present;
    - every tool name the prompt mentions is in `BASE_TOOLS[job]`;
    - the prompt contains none of the plugin-only references;
    - no prompt or task text tells the agent to run git or to commit, push, approve or close.
- **AC5 (loop and spike):**
  - `runAgentLoop` takes `job: JobId`, and each request carries `system: JOB_PROMPTS[job].system` and `tools: jobToolDefinitions(job)`.
  - `READ_FILE_TOOL` is removed from `src/agent/loop.ts`.
  - The spike in `src/agent/index.ts` runs as the reader. Its tool-call requests carry the run's job, not a hard-coded literal.
  - The self-check is unchanged.
  - `tests/unit/agent-loop.test.ts` checks that the job's system prompt and tools are sent.
- **AC6 (docs):**
  - `docs/decisions.md`: a new D32, "Agent jobs: definitions, prompts and advertised tools". It covers the outcome (the shared table, the advertised base set, the prompts and task texts, the provider `system` field, the reviewer running tests), the reasons, and the alternatives not chosen from the plan.
  - A new `docs/agent-jobs.md`: the four jobs, their plain names and tools, what each prompt tells the model, the task texts Phase 3 sends, and that main's gate, not the prompt, enforces the rules.
  - `CHANGELOG.md` under `[Unreleased]`: Added entries for the job definitions and prompts, the provider `system` field and `docs/agent-jobs.md`; a Changed entry for the loop advertising the job's tools.
  - `docs/phases/phase-02-progress.md`: the `p2-tools` follow-up "The agent loop still advertises only `read_file`" is struck through and marked resolved by `p2-jobs-and-prompts`, and D32 is listed under Decisions added. Row 4 stays pending.
  - The stale-doc check (`CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, `docs/phases/phase-02-tool-policy.md`) is recorded in `changes.md`, and any stale mention is fixed.
- **AC7 (checks):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass. The pull request's CI is green on every job before the merge.

## Open questions

- none
