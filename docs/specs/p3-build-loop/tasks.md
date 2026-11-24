# Tasks: p3-build-loop

Work in order. After each task, run its check, then tick the box.

- [x] **T1: Loop options.** In `src/agent/loop.ts`, add the optional `maxTurns` and `history` to `LoopInput`, and `messages` to `LoopResult`, as the spec's Design says. The defaults stay unchanged. Extend the loop tests (AC8). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/agent-loop.test.ts tests/unit/agent-spike-provider.test.ts` passes.
- [x] **T2: Report parsers.** _Revised in revision 1: `parseReview` also accepts a `## Review round U<k>` heading, and its round is then the string `U<k>`. Add tests for it._ Create `src/shared/build-reports.ts`, pure, with `parseImplementationReport`, `parseFindingsAnalysis` and `parseReview`. Add `tests/unit/build-reports.test.ts`, covering every format from `writer.ts` and `reviewer.ts`, the bad cases, the caps and the purity scan (AC8, AC10). **Check:** `pnpm exec vitest run tests/unit/build-reports.test.ts` passes.
- [x] **T3: Build documents.** Create `src/shared/build-docs.ts`, pure, with `renderLedger` and `renderSummary`. Add `tests/unit/build-docs.test.ts`. It covers the round trip through `parseLedger` and `detectFolder` (running with each phase, paused and done), every SUMMARY section, the cell escaping and the purity scan (AC5). **Check:** `pnpm exec vitest run tests/unit/build-docs.test.ts` passes.
- [x] **T4: Workflow events.** _Revised in revision 1: also add END_BUILD, kind `app`, from `implementing`, `reviewing` and `paused` to `build-done`._ Add CONTINUE and STOP_BUILD to `src/shared/workflow.ts` (ids, transitions, kinds and the count comments), and update the table tests (AC6). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/workflow-events.test.ts tests/unit/workflow-machine.test.ts tests/unit/workflow-stages.test.ts tests/unit/spec-detect.test.ts` passes.
- [x] **T5: Gate.** Add `changes.md` to `SPEC_DOC_NAMES`, and allow the writer its own feature's `tasks.md` and `changes.md` while the spec is approved. Extend `tests/unit/policy-gate.test.ts` and `tests/unit/policy-paths.test.ts`: the allowed pair, and the denied ledger, SUMMARY, SPECS.md, another feature's files and the state file, for every job. Include the planner-before-approval case (AC5). **Check:** `pnpm exec vitest run tests/unit/policy-gate.test.ts tests/unit/policy-paths.test.ts` passes.
- [x] **T6: Scripted provider and job runner.** Create `tests/support/scripted-provider.ts` and `src/main/workflow/job-runner.ts` (`JobRunner` and `createInProcessJobRunner`). Add `tests/unit/job-runner.test.ts`, covering:
  - gated tool calls reaching the tool runner;
  - a denied `run_command` `git commit`;
  - the turn-limit failure;
  - a provider error;
  - an exhausted script (AC7).

  **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/job-runner.test.ts` passes.
- [x] **T7: Build controller.** _Revised in revision 1:_
  - _a failed step raises END_BUILD, so the node is `build-done` and agrees with the files;_
  - _a `continue` with nothing left to run (no carried findings, or a pause at the last round) raises END_BUILD from `paused`, with no fake IMPLEMENTED;_
  - _change rounds use the label `U<k>` as the round in both prompts;_
  - _the carried findings after a writer pause are the step's findings minus the NEEDS-SPEC-CHANGE ones._

  _Add or adjust tests for each._ Create `src/main/workflow/build-loop.ts` (`roundLimit` and `createBuildController`). Add `tests/unit/build-loop.test.ts`, using temp repos with an approved lock and the scripted provider:
  - every path in AC1–AC4;
  - the ledger and detection at each step (AC5);
  - refused illegal calls and a concurrent call (AC6);
  - the restate-once and unreadable-report paths;
  - a check that no new module imports `child_process` or names `git` (AC7).

  **Check:** `pnpm exec vitest run tests/unit/build-loop.test.ts` passes.
- [x] **T8: EDIT_SPEC wiring.** Add the optional `onEditRequested` hook to `src/main/human/spec-handlers.ts`, and pass a hook in `src/main/index.ts`. Extend `tests/unit/spec-handlers.test.ts`: the hook allows, the hook refuses, and the behaviour with no hook is unchanged. Add a controller test showing `requestEdit()` moves `spec-approved` to `spec-changed` and is refused during a build (AC6). **Check:** `pnpm typecheck && pnpm exec vitest run tests/unit/spec-handlers.test.ts tests/unit/build-loop.test.ts` passes.
- [x] **T9: Docs.** _Revised in revision 1: D37, `docs/workflow-engine.md`, `docs/workflow.md` and the CHANGELOG cover END_BUILD and the `U<k>` round label, and the event counts are updated._
  - D37 in `docs/decisions.md`, amending D30 and D34;
  - a "Build loop" section in `docs/workflow-engine.md`, with the event list updated;
  - `docs/agent-jobs.md`;
  - the `CHANGELOG.md` entry;
  - stale docs checked and fixed: `CLAUDE.md`, `README.md`, `docs/PRD.md` (F2: tick the round-limit item), `docs/workflow.md`, the phase-03 doc and the progress follow-ups. Record the check in `changes.md`.

  Run `pnpm exec prettier --write` on the edited docs (AC9). **Check:** `pnpm format:check` passes, and `grep -n "D37" docs/decisions.md CLAUDE.md` finds both.
- [x] **T10: Full checks.** _Revised in revision 1: run again after the revision._ Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (AC10; CI is checked on the PR). **Check:** all pass.
