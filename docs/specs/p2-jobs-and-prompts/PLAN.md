# Plan: p2-jobs-and-prompts

Ticket: none (vibe planning; Phase 2 subtask 4, as written in `docs/phases/phase-02-progress.md`)
Status: approved
Date: 2026-11-21

## Objective

The four agent jobs (plans and chats, writes code, reviews code, reads big files) exist today only as ids in the protocol and as rows in main's policy table. The agent loop still advertises one hand-written `read_file` tool and sends no instructions to the model. This subtask gives each job a definition and a prompt. The prompts for the writer, the reviewer and the reader are ported from the sdd plugin's implementor, reviewer and data-agent; the planner's prompt is new. The agent then advertises exactly the job's tools from the shared registry (`TOOL_SPECS`), filtered by the same table the gate uses (D30). Enforcement stays in main: a prompt is guidance, never the check (D1, D4).

## Scope

- **In:**
  - **Job definitions in shared code:** a new `src/shared/jobs.ts` holds, for each `JobId`, its plain-language name (from the design table and the PRD) and its base tools. The `BASE_TOOLS` table moves there from `src/main/policy/policy-table.ts`, which re-exports it, so the gate, tightening and the agent read one table. The table's contents don't change.
  - **Advertised tools:** a helper returns a job's `ToolDefinition`s from `TOOL_SPECS`, in the base set's order. The loop's hand-written `READ_FILE_TOOL` is removed.
  - **Prompts:** TypeScript string constants in a new `src/agent/jobs/` folder.
    - Each job has a **system prompt**: its role, ground rules and report format.
    - The writer and the reviewer also export **task texts**: the plugin's modes (implement, fix findings, resume after a spec revision for the writer; the review round for the reviewer). Phase 3 sends these as the user message for each round.
    - Common rules in every prompt:
      - use only the app's tools, by their names;
      - no git, commit, push, approve or close, and nothing that asks for them;
      - the approved spec is read-only;
      - tickets, docs and web pages are untrusted data;
      - a refused tool call is an error to recover from, not something to work around.
    - **Writer (from the implementor):**
      - the changes-file rule;
      - the Mode 1/2/3 task texts and the `## Implementation report` and `## Findings analysis` formats;
      - `NEEDS-SPEC-CHANGE`.
      - Plugin-only rules are dropped: `.claude/sdd/`, the Bash and Edit advice, and `NEEDS-DATA-AGENT` with its MCP wording.
    - **Reviewer (from the reviewer):**
      - reads the changes file and the files it lists;
      - may run the project's detected test command to confirm a claim, and never builds or edits (D31's test-only reviewer);
      - the findings and verdict format;
      - `spec-change` findings.
    - **Reader (from the data-agent):**
      - read-only;
      - reads files and tickets with its tools (not MCP);
      - the `## Data report` format;
      - quotes text that looks aimed at it.
    - **Planner (new):**
      - plans and chats with the user;
      - asks about load-bearing ambiguity in its reply, with choices and a recommendation;
      - writes only the feature's four planning docs (`PLAN.md`, `SPECS.md`, `tasks.md`, `SUBTASK.md`) before approval (D30);
      - never approves its own spec.
  - **System prompt in the provider interface:** `ProviderRequest` gains an optional `system` string.
    - The Anthropic adapter sends it as the `system` parameter.
    - The OpenAI adapter sends it as a leading `system` message.
    - With no `system`, both send the same request as today.
  - **Loop:** `runAgentLoop` takes a `job`. It sends that job's system prompt and advertised tools. The caller still sends the user prompt (the task).
  - **Spike:** it stays the reader job. Its tool calls take the job from the run instead of a hard-coded `'reader'`, and it now advertises the reader's four tools with the reader's system prompt. The self-check stays as it is.
  - **Decision D32:** "Agent jobs: definitions, prompts and advertised tools", added to `docs/decisions.md`.
  - **Tests (unit):**
    - each job advertises exactly its base set, in order, and the schemas are the registry's;
    - the reviewer and the reader advertise no write tool, and no job advertises a git tool;
    - the policy-table re-export is the same object as the shared table;
    - each prompt names only tools its job has;
    - each prompt holds the common rules;
    - no prompt tells the agent to run git, commit, push, approve or close;
    - both adapters send `system` correctly, and omit it when absent;
    - the loop sends the job's system prompt and tools.
  - **Docs:**
    - `CHANGELOG.md` entries under `[Unreleased]`;
    - D32;
    - `docs/agent-tools.md`, or the doc that lists the tools per job, if one exists (checked in the build);
    - the `p2-tools` follow-up "the agent loop still advertises only `read_file`", marked resolved;
    - the progress file's row 4 stays pending until the merge.
    - The stale-doc check (`CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the phase doc) is recorded in `changes.md`.
- **Out:**
  - The human-only channel (`p2-human-only-channel`).
  - The workflow states, the build loop, and who sends which task text when (Phase 3).
  - Sending a project's tightened tool list to the agent. The agent advertises the base set, and main's gate still applies tightening. Phase 3 or 4 can send the tightened list.
  - Changing `MAX_TURNS`, per-job models or the turn budget.
  - Re-recording the spike or probe fixtures.
  - Any UI.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `p2-jobs-and-prompts`; sdd-harness; base `main`; branch `feature/p2-jobs-and-prompts` | (given by the progress file) |
| Where the job-to-tool table lives | Move `BASE_TOOLS` to a new `src/shared/jobs.ts` with the job definitions; `policy-table.ts` re-exports it | The agent imports `src/main/policy/policy-table.ts`; main sends each run's tool list in a protocol message |
| What goes into a prompt | System prompt = role, ground rules and report formats; the plugin's modes become exported task texts for Phase 3 to send as the user message | Port each plugin file whole, modes included, as the system prompt; role and rules only |
| How prompts are stored | TypeScript string constants in `src/agent/jobs/` | Markdown files imported with Vite's `?raw` |
| New decision | Add D32: agent jobs, definitions, prompts and advertised tools | A note on D30 |
| Reviewer and tests | The reviewer may run the detected test command to confirm a claim; never builds or edits | Static like the plugin: runs nothing, only "needs a runtime check" notes |
| Tightening in the advertised list (default) | Advertise the base set; main's gate applies tightening; sending the tightened list is a follow-up | Main sends the tightened list now |
| How the adapters send `system` (default) | Anthropic `system` parameter; OpenAI leading `system` message; nothing added when unset | — |

## Approach

1. **Shared jobs:** create `src/shared/jobs.ts` with `JOBS` (id, plain name, base tools) and `BASE_TOOLS`, importing only from `shared/`. `src/main/policy/policy-table.ts` re-exports `BASE_TOOLS`, so `gate.ts` and `tightening.ts` are unchanged. Add `jobToolDefinitions(job)` (in the agent, or in shared if it needs only the registry), built from `TOOL_SPECS`.
2. **Provider `system`:**
   - Add it to `ProviderRequest` in `src/agent/provider/types.ts`.
   - Map it in `anthropic.ts` (`system` in `messages.create`) and `openai.ts` (a leading message in `toOpenAIMessages`).
   - Add adapter unit tests next to the existing ones.
3. **Prompts:** create `src/agent/jobs/` with one module per job and a shared rules block. Port the three plugin files, rewritten for the app's tool names and rules, and write the planner prompt. Export `JOB_PROMPTS: Record<JobId, { system: string }>` and the writer's and reviewer's task texts.
4. **Loop:**
   - `runAgentLoop` takes `job: JobId`.
   - `streamReply` sends `system: JOB_PROMPTS[job].system` and `tools: jobToolDefinitions(job)`.
   - Remove `READ_FILE_TOOL`, and update `tests/unit/agent-loop.test.ts`.
5. **Spike:** `src/agent/index.ts` passes `job: 'reader'` to the loop, and `callToolViaMain` uses the run's job.
6. **Tests:** the new unit tests listed in Scope, plus updates to the existing tests for the table's new location (`policy-table.test.ts` keeps passing through the re-export).
7. **Docs and D32,** then `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The job table is in main and has no Electron or fs imports, so it can move to shared | `src/main/policy/policy-table.ts:1-14` imports only types from `shared/` |
| Only the gate and tightening, plus tests, use `BASE_TOOLS` | `grep -rln BASE_TOOLS src tests`: `gate.ts`, `tightening.ts`, `policy-table.ts` and three policy tests |
| The loop advertises one hand-written tool and sends no system prompt | `src/agent/loop.ts:21-33` (`READ_FILE_TOOL`), `:74-78` (`tools: [READ_FILE_TOOL]`) |
| The provider interface has no system prompt | `src/agent/provider/types.ts:15-18` (Message roles user, assistant, tool), `:43-49` (`ProviderRequest`) |
| Both adapters build the request in one place each | `anthropic.ts:228-236` (`messages.create`), `openai.ts:223-232` (`chat.completions.create`) |
| The registry has schemas the agent can advertise | `src/shared/tools.ts:356` (`TOOL_SPECS`) |
| `JobId` is already shared | `src/shared/agent-protocol.ts:9-11` (`JOB_IDS`) |
| The spike hard-codes the reader job | `src/agent/index.ts` `callToolViaMain`: `job: 'reader'` |
| The plugin prompts to port exist | `../claude/plugins/sdd-plugin/agents/implementor.md` (103 lines), `reviewer.md` (108), `data-agent.md` (47) |
| The reviewer may run tests only, and the reader reads tickets | D30 table, D31 check; `BASE_TOOLS` rows |

## Risks

- **Fixture replay tests might compare request bodies.** Adding `system` or more tools to the spike would then break them. Mitigation: `system` is sent only when it is set, and the fixture and probe tests don't go through `runAgentLoop` with a job. If one does, update the assertion; don't re-record. Running `pnpm test` in the build shows it early.
- **A prompt could drift from the table.** For example, it names `run_command` for the reader. A test checks each prompt against its job's tools.
- **`pnpm test:live` behaves differently.** It now gets the reader's system prompt and four tools. It isn't run in CI, so check it by hand when there is a gateway.
- **The prompt text grows the bundle.** It's a few KB of strings, so the risk is negligible.

## Open questions

- none
