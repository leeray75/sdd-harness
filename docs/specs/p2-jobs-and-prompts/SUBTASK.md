# Four agent jobs with ported prompts and their advertised tools (p2-jobs-and-prompts)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/p2-jobs-and-prompts/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/p2-jobs-and-prompts`

## Context

The four jobs exist only as ids and as rows in main's policy table. The agent advertises one hand-written `read_file` tool and sends the model no instructions. This subtask:

- moves the job table to shared code;
- makes each run advertise exactly its job's tools from the registry;
- adds a system prompt per job: ported from the sdd plugin's implementor, reviewer and data-agent, plus a new planner prompt;
- adds the writer's and reviewer's task texts for Phase 3;
- carries the system prompt through both provider adapters.

Main's gate still enforces every rule (D1, D4, D30).

## Required work

- T1 Shared job table
- T2 Advertised tools
- T3 Provider `system`
- T4 Prompts
- T5 Loop and spike
- T6 Docs
- T7 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1: `src/shared/jobs.ts` holds `JOBS` and `BASE_TOOLS`, unchanged; `policy-table.ts` re-exports them.
- AC2: `jobToolDefinitions(job)` gives the job's base tools from `TOOL_SPECS`, in order.
- AC3: `ProviderRequest.system` is sent by both adapters, and nothing changes when it is unset.
- AC4: system prompts for all four jobs with the common rules; the writer's and reviewer's task texts; no plugin-only references; tests check them against `BASE_TOOLS`.
- AC5: the loop takes a job; `READ_FILE_TOOL` is gone; the spike runs as the reader with the run's job.
- AC6: D32, `docs/agent-jobs.md`, CHANGELOG, the progress follow-up resolved, the stale-doc check.
- AC7: typecheck, lint, format:check and test pass; CI green on the PR.

## Out of scope

- The human-only channel; Phase 3's workflow and build loop.
- Sending tightened tool lists; `MAX_TURNS`; per-job models.
- Re-recording fixtures; UI.

## Links

- Plan: docs/specs/p2-jobs-and-prompts/PLAN.md
- Spec and tasks: docs/specs/p2-jobs-and-prompts/SPECS.md, docs/specs/p2-jobs-and-prompts/tasks.md
