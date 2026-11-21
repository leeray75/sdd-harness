# Changes: p2-jobs-and-prompts

Record of what the implementor touched (Mode 1, all tasks T1 to T7). Rows are one per file.

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/jobs.ts | created | Shared job table: `JOBS` (plain names) and `BASE_TOOLS` moved here unchanged from the policy table. Imports only from `src/shared/`. | T1 |
| src/main/policy/policy-table.ts | edited | Its table is removed; it now re-exports `BASE_TOOLS` from `src/shared/jobs.ts`, so the gate and tightening are unchanged. | T1 |
| tests/unit/jobs-table.test.ts | created | Checks `JOBS` names, the `BASE_TOOLS` contents and order, that the policy re-export is the same object, and that `jobs.ts` imports only from `src/shared/`. | T1 |
| src/agent/jobs/tools.ts | created | `jobToolDefinitions(job)`: each base tool's registry name, description and schema from `TOOL_SPECS`, in table order, as a copy. | T2 |
| tests/unit/jobs-tools.test.ts | created | Checks each job's advertised list, the registry schemas, no write or edit tool for the reviewer and reader, no tool outside the registry, and that the copy cannot change the registry. | T2 |
| src/agent/provider/types.ts | edited | Adds the optional `system` field to `ProviderRequest`. | T3 |
| src/agent/provider/anthropic.ts | edited | Sends `system` as the `messages.create` parameter only when it is set and non-empty. | T3 |
| src/agent/provider/openai.ts | edited | Puts a leading `{ role: 'system' }` message before the history only when `system` is set and non-empty. | T3 |
| tests/unit/agent-provider-anthropic.test.ts | edited | Adds tests for `system` set, unset and empty: the parameter is sent, or the request matches the unset request exactly. | T3 |
| tests/unit/agent-provider-openai.test.ts | edited | Adds tests for `system` set, unset and empty: the leading system message is sent, or the request matches the unset request exactly. | T3 |
| src/agent/jobs/rules.ts | created | The five common rules (AC4 b to f) as a list, and `systemPrompt(role, body)`, which joins the role, the rules and the job's part. | T4 |
| src/agent/jobs/writer.ts | created | Writer system prompt ported from the implementor (changes file, NEEDS-SPEC-CHANGE, report formats), and `WRITER_TASKS` (implement, fixFindings, resume). Plugin-only parts left out. | T4 |
| src/agent/jobs/reviewer.ts | created | Reviewer system prompt ported from the reviewer (changes file first, test command only, spec-change, verdict format), and `REVIEWER_TASKS.review`. | T4 |
| src/agent/jobs/reader.ts | created | Reader system prompt ported from the data agent (read-only, Data report format). | T4 |
| src/agent/jobs/planner.ts | created | Planner system prompt, new: plans in chat, asks with choices and a recommendation, writes only the four planning docs before approval, never approves. | T4 |
| src/agent/jobs/index.ts | created | `JOB_PROMPTS` (one `{ system }` per job), `JOB_ROLES`, and re-exports of the task texts and helpers. | T4 |
| tests/unit/jobs-prompts.test.ts | created | AC4 checks for every prompt and task text: the rules and role present, tool names within `BASE_TOOLS[job]`, no plugin-only references, and no git, commit, push, approve or close instruction (each such line must be negated). Plus per-job content checks. | T4 |
| src/agent/loop.ts | edited | `runAgentLoop` takes `job`; each request carries `JOB_PROMPTS[job].system` and `jobToolDefinitions(job)`. `READ_FILE_TOOL` is removed. | T5 |
| src/agent/index.ts | edited | The spike runs as `SPIKE_JOB = 'reader'`; `callToolViaMain` takes the run's job and sends it on each tool-call request. The self-check is unchanged. | T5 |
| tests/unit/agent-loop.test.ts | edited | Calls pass `job: 'reader'`; the replay test checks the reader's four tools and system prompt; new tests check each job's system prompt and tools on every request, the writer's `run_command`, and the reviewer's lack of write tools. | T5 |
| tests/unit/agent-provider-factory.test.ts | edited | The `runAgentLoop` call passes `job: 'reader'` (required by the new field). | T5 |
| tests/live/spike.live.test.ts | edited | The `runAgentLoop` call passes `job: 'reader'` (required by the new field). Not run in CI; needs a gateway. | T5 |
| docs/specs/p2-jobs-and-prompts/tasks.md | edited | Ticked T1 to T7 after each check passed. | T1, T2, T3, T4, T5, T6, T7 |
| docs/decisions.md | edited | Adds D32, "Agent jobs: definitions, prompts and advertised tools", after D31. | T6 |
| docs/agent-jobs.md | created | The four jobs and their tools, what each prompt tells the model, the task texts Phase 3 sends, and that main's gate enforces the rules. | T6 |
| CHANGELOG.md | edited | Under `[Unreleased]`: Added entries for the job definitions, advertised tools, prompts and task texts, the provider `system` field and `docs/agent-jobs.md`; Changed entries for the loop's job-based tools and the table move. | T6 |
| docs/phases/phase-02-progress.md | edited | The `p2-tools` follow-up "The agent loop still advertises only `read_file`" is struck through and marked resolved by `p2-jobs-and-prompts` (D32); D32 is listed under Decisions added. Row 4 stays pending. | T6 |
| README.md | edited | Stale-doc fix: the spike paragraph said the model may ask for `read_file`; it now names the reader's four tools (D32). | T6 |

## Stale-doc check (AC6)

| Doc | Result |
| --- | --- |
| CLAUDE.md | Checked. No change: the agent loop, spike variables and the tool-policy rule are still accurate. |
| README.md | Stale sentence fixed (see the table above). |
| docs/PRD.md | Checked. No change: the Rule-event and recover-from-error text still holds. |
| docs/workflow.md | Checked. No change: "each agent job has a fixed tool set that the app checks on every call" still holds. |
| docs/phases/phase-02-tool-policy.md | Checked. No change: the row 4 scope is unchanged and still pending in the progress file. |
| docs/agent-commands.md | Checked. No change: no mention of the loop, the prompts or the advertised tools. |
| CHANGELOG.md, earlier entries | Historical entries describing earlier states are left as they were. The new `[Unreleased]` entries record this change. |
| docs/phases/phase-02-progress.md | Updated (see the table above). |

## Checks run

- `pnpm typecheck`: pass
- `pnpm lint`: pass
- `pnpm format:check`: pass
- `pnpm test`: pass, 49 files; 1070 passed, 12 skipped (existing platform and capability gates)
- `pnpm exec vitest run tests/unit/policy-*.test.ts tests/unit/jobs*.test.ts`: pass, 9 files, 191 tests
- `pnpm exec vitest run tests/unit/agent-provider-*.test.ts`: pass, 6 files, 139 tests
- `pnpm exec vitest run tests/unit/agent-loop.test.ts`: pass
- `grep -rn READ_FILE_TOOL src tests`: no match
