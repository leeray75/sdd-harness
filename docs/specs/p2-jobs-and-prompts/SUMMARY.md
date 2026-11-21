# Summary Report: p2-jobs-and-prompts

Ticket: none Date: 2026-11-21
Outcome: Clean
Review rounds: 1 of 3 per revision; revisions: 0 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

- **G1 (job definitions):** the four jobs now have one shared definition in `src/shared/jobs.ts`: `JOBS` holds the plain names, and `BASE_TOOLS` holds the same tools in the same order as before. Main's policy table re-exports it, so the gate and the agent read the same table.
- **G2 (advertised tools):** `jobToolDefinitions(job)` advertises exactly the job's base tools, using the registry's names, descriptions and schemas. Main's gate still decides every call.
- **G3 (prompts):** `src/agent/jobs/` gives each job a system prompt built from a shared role-and-rules block.
  - The writer, reviewer and reader prompts are ported from the plugin's implementor, reviewer and data-agent.
  - The planner prompt is new.
  - `WRITER_TASKS` and `REVIEWER_TASKS` hold the per-round texts for Phase 3.
- **G4 (system prompt):** `ProviderRequest.system` reaches Anthropic as the `system` parameter and OpenAI as a leading system message. The loop takes a job, and the spike runs as the reader.
- **G5 (docs):**
  - D32;
  - the new `docs/agent-jobs.md`;
  - CHANGELOG entries;
  - the `p2-tools` follow-up resolved;
  - the README's stale spike sentence fixed.

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/shared/jobs.ts | created | `JOBS` (plain names) and `BASE_TOOLS`, moved unchanged; imports only from `src/shared/` | T1 |
| src/main/policy/policy-table.ts | edited | Now only re-exports `BASE_TOOLS` from `src/shared/jobs.ts` | T1 |
| tests/unit/jobs-table.test.ts | created | Names, table contents and order, the re-export is the same object, shared-only imports | T1 |
| src/agent/jobs/tools.ts | created | `jobToolDefinitions(job)` from `TOOL_SPECS`, in table order, as a copy | T2 |
| tests/unit/jobs-tools.test.ts | created | Each job's list, registry schemas, no write tool for the reviewer or reader, no tool outside the registry | T2 |
| src/agent/provider/types.ts | edited | Optional `system` on `ProviderRequest` | T3 |
| src/agent/provider/anthropic.ts | edited | Sends `system` only when set and non-empty | T3 |
| src/agent/provider/openai.ts | edited | Leading system message only when set and non-empty | T3 |
| tests/unit/agent-provider-anthropic.test.ts | edited | `system` set, unset and empty | T3 |
| tests/unit/agent-provider-openai.test.ts | edited | `system` set, unset and empty | T3 |
| src/agent/jobs/rules.ts | created | Common rules (b)–(f) and `systemPrompt(role, body)` | T4 |
| src/agent/jobs/writer.ts | created | Writer prompt (from the implementor) and `WRITER_TASKS` | T4 |
| src/agent/jobs/reviewer.ts | created | Reviewer prompt (from the reviewer) and `REVIEWER_TASKS.review` | T4 |
| src/agent/jobs/reader.ts | created | Reader prompt (from the data-agent) | T4 |
| src/agent/jobs/planner.ts | created | New planner prompt | T4 |
| src/agent/jobs/index.ts | created | `JOB_PROMPTS`, `JOB_ROLES` and re-exports | T4 |
| tests/unit/jobs-prompts.test.ts | created | AC4 checks per prompt and task text | T4 |
| src/agent/loop.ts | edited | `runAgentLoop` takes `job`, sends its prompt and tools; `READ_FILE_TOOL` removed | T5 |
| src/agent/index.ts | edited | Spike as `SPIKE_JOB = 'reader'`; tool calls carry the run's job; self-check unchanged | T5 |
| tests/unit/agent-loop.test.ts | edited | Job prompt and tools on every request, per job | T5 |
| tests/unit/agent-provider-factory.test.ts | edited | Passes `job: 'reader'` | T5 |
| tests/live/spike.live.test.ts | edited | Passes `job: 'reader'` (not run; needs a gateway) | T5 |
| docs/decisions.md | edited | D32 | T6 |
| docs/agent-jobs.md | created | The jobs, their tools, what each prompt says, the task texts, gate enforcement | T6 |
| CHANGELOG.md | edited | Added and Changed entries under `[Unreleased]` | T6 |
| docs/phases/phase-02-progress.md | edited | Follow-up struck and resolved; D32 under Decisions added; row 4 stays pending | T6 |
| README.md | edited | Stale spike sentence now names the reader's four tools | T6 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p2-jobs-and-prompts/PLAN.md | created | Approved plan | planning |
| docs/specs/p2-jobs-and-prompts/SPECS.md | created | Approved spec | planning |
| docs/specs/p2-jobs-and-prompts/SUBTASK.md | created | Child-ticket draft, not published (no tracker) | planning |
| docs/specs/p2-jobs-and-prompts/tasks.md | created | T1–T7, all ticked | T1–T7 |
| docs/specs/p2-jobs-and-prompts/build-ledger.md | created | Build ledger | build |
| docs/specs/p2-jobs-and-prompts/changes.md | created | Change rows, stale-doc table, checks run | build |
| docs/specs/p2-jobs-and-prompts/SUMMARY.md | created | This report | build |

`CLAUDE.md`, `docs/PRD.md`, `docs/workflow.md`, `docs/phases/phase-02-tool-policy.md` and `docs/agent-commands.md` were checked and left unchanged. The reasons are in `changes.md`.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 shared table | Met | `src/shared/jobs.ts`; `policy-table.ts` is a one-line re-export; `jobs-table.test.ts`; policy tests unchanged and passing |
| AC2 advertised tools | Met | `src/agent/jobs/tools.ts`; `jobs-tools.test.ts` |
| AC3 provider system | Met | Both adapters send `system` only when it's set and non-empty; set, unset and empty cases are tested in both adapter test files |
| AC4 prompts | Met | `src/agent/jobs/*`; `jobs-prompts.test.ts` checks the rules, tool names against `BASE_TOOLS`, that no plugin-only references remain, and that no git or commit instruction is given |
| AC5 loop and spike | Met | `loop.ts` and `index.ts`; `agent-loop.test.ts`; `grep READ_FILE_TOOL` finds nothing |
| AC6 docs | Met | D32, `docs/agent-jobs.md`, CHANGELOG, the progress follow-up and D32 line, the README fix, the stale-doc table |
| AC7 checks | Local met; CI pending | Rerun by the orchestrator: typecheck, lint and format:check pass; test passes (49 files; 1070 passed, 12 skipped). CI is checked on the PR |

## Needs a runtime check

- **AC7 on the PR:** CI green on `check`, and on `e2e` on Windows, macOS and Linux.
- **The spike with a live gateway** (`pnpm test:live`): it now sends the reader's system prompt and four tools. It hasn't been run, because no gateway is available here.
- **Phase 3:** that the writer's `run_command` and the reviewer's test run behave as the prompts say through main's gate, and that `changes.md` is supplied to the reviewer.

## Review ledger

### Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

## Spec revisions

none

## Rejected findings

none

## Open issues

None. Points from the implementor for you to check:

- **Planner documents:** the planner prompt's document shapes (frontmatter, Problem and Goals sections, `- [ ]` boxes with a Check) follow this repo's own `SPECS.md` and `tasks.md`, because the spec doesn't fix them.
- **Line-based test:** the "no git, commit, push, approve or close" test works line by line. Each such rule sits on its own negated line, so a sentence split across two lines would get past it.
- **API shapes:** `JOBS` is `Record<JobId, { name }>`, with no id field. `jobToolDefinitions` lives in `src/agent/jobs/tools.ts`, because it returns the agent's `ToolDefinition` type.

## Git state

feature/p2-jobs-and-prompts; approved; committed and pushed in the commit that adds this report

## Next steps

Approve, then commit and push, open the PR, and check that its CI is green on every job before the merge. Or request changes, or say not yet.
