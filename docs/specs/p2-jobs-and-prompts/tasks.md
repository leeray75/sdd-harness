# Tasks: p2-jobs-and-prompts

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Shared job table.** Create `src/shared/jobs.ts` with `JOBS` and `BASE_TOOLS` (contents and order unchanged). Make `src/main/policy/policy-table.ts` re-export `BASE_TOOLS`. Add a unit test that the re-export is the same object, and test `JOBS`' plain names (AC1). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/policy-*.test.ts tests/unit/jobs*.test.ts` passes.
- [x] **T2: Advertised tools.** Add `jobToolDefinitions(job)` built from `TOOL_SPECS` in base-set order, with unit tests (AC2). **Check:** its tests pass.
- [x] **T3: Provider `system`.** Add `system?: string` to `ProviderRequest`. The Anthropic adapter passes it as `system`; the OpenAI adapter adds a leading system message. Nothing is sent when it is unset or empty. Add tests to both adapter test files (AC3). **Check:** `pnpm exec vitest run tests/unit/agent-provider-*.test.ts` passes.
- [x] **T4: Prompts.** Create `src/agent/jobs/`:
  - a shared rules block covering (a)–(f);
  - writer, reviewer, reader and planner system prompts, ported or written as AC4 says;
  - `JOB_PROMPTS`, `WRITER_TASKS` and `REVIEWER_TASKS`.

  Add the AC4 unit tests: the rules are present, the tool names match `BASE_TOOLS`, there are no plugin-only references, and nothing tells the agent to run git or to commit, push, approve or close. **Check:** the prompt tests pass.
- [x] **T5: Loop and spike.**
  - `runAgentLoop` takes `job` and sends the job's system prompt and tools.
  - Remove `READ_FILE_TOOL`.
  - The spike passes `job: 'reader'`, and `callToolViaMain` uses the run's job.
  - Update `tests/unit/agent-loop.test.ts` (AC5).

  **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/agent-loop.test.ts` passes, and `grep -rn READ_FILE_TOOL src tests` finds nothing.
- [x] **T6: Docs.**
  - D32 in `docs/decisions.md`;
  - the new `docs/agent-jobs.md`;
  - `CHANGELOG.md` entries;
  - the phase-02 progress follow-up struck and D32 listed;
  - the stale-doc check recorded in `changes.md`, with any stale mention fixed.

  Run `pnpm exec prettier --write` on the edited docs (AC6). **Check:** `git diff --stat` lists the docs, and `pnpm format:check` passes.
- [x] **T7: Full checks.** Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC7; CI is checked on the PR). **Check:** all pass.
