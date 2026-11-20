# Per-job tool policy, path rules and Rule events (p2-policy-engine)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/p2-policy-engine/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/p2-policy-engine`

## Context

The gate allows only the reader's `read_file`, so the seven registry tools from `p2-tools` can't be used. This work replaces it with the F1 policy, enforced in main:

- each job's tool set, from the "What each agent can do" table;
- write rules: the planner may write the four planning docs before approval, and the writer may write source after approval; spec files are read-only once approved;
- project tightening, which can remove tools but never add them;
- a Rule event for every decision.

The workflow state is an input: the caller passes the feature and the spec state, and Phase 3 supplies the real ones. `run_command` goes to a command check that denies everything until `p2-command-allowlist`.

## Required work

- T1 Policy table and context
- T2 Path areas
- T3 Tightening
- T4 Rule events
- T5 Gate
- T6 Router and host
- T7 Tool-layer checks (the symlink re-check, `node_modules`)
- T8 Acceptance test
- T9 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1 (table): the base tool sets match the design table. The reviewer and the reader never get a write tool, only the planner and the reader read tickets, and only the writer and the reviewer reach the command check.
- AC2 (path areas): normalized paths are classified as `outside`, `git`, `spec-doc`, `spec-other` or `source`, tested with a table of at least 25 cases.
- AC3 (planner): it may write only `PLAN.md`, `SPECS.md`, `tasks.md` and `SUBTASK.md` of the current feature, and only before approval. It never writes the app's files.
- AC4 (writer): it may write source only after approval, and never `docs/specs/**`. Its edit of an approved `SPECS.md` is denied and logged as a Rule event.
- AC5 (commands): `run_command` is decided by the context's command check, which denies everything by default.
- AC6 (tightening): `parseTightening` accepts only a removal list and refuses an add or allow key, unknown jobs or tools, and wrong types, with fixed reasons. No context can add a tool.
- AC7 (Rule events): exactly one event for each validated tool call, carrying the job, tool, sanitized target and reason, never the content or other arguments. It is logged as info for an allow and as an error for a deny.
- AC8 (denied calls): a denied call returns `denied` with a fixed reason, and the runner is never called.
- AC9 (symlink re-check): the write and edit runners refuse a write that a symlink moves into a different area.
- AC10 (`node_modules`): `list_files` and `search_text` refuse paths inside `node_modules`.
- AC11 (human-only actions): an acceptance test shows that text saying "approve the spec" or "git push" can't cause any commit, push, approval or close, or a write to the app's files.
- AC12 (wiring): the host uses the default context and the logger sink, and the reachability test is updated to the table.
- AC13 (checks): typecheck, lint, format check and unit tests pass.

## Out of scope

- The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check, network limits, and Windows `.cmd` runs (`p2-command-allowlist`).
- Job prompts and advertising tools (`p2-jobs-and-prompts`).
- The human-only channel (`p2-human-only-channel`).
- Real workflow states and the spec hash (Phase 3).
- A project settings file (Phase 4).
- Any UI.

## Links

- Plan: docs/specs/p2-policy-engine/PLAN.md
- Spec and tasks: docs/specs/p2-policy-engine/SPECS.md, docs/specs/p2-policy-engine/tasks.md
