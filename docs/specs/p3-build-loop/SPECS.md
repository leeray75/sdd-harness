---
status: approved
ticket:
---

# p3-build-loop

## Problem

The harness can lock an approved spec (D36) and tell which node a feature folder is at (D35), but nothing runs a build. No code drives the writer and the reviewer in rounds, and nothing enforces the round limit (D4).

Several pieces are also missing:

- nothing pauses on a spec problem or counts the user's change rounds separately;
- nothing writes the build ledger and SUMMARY that the detector reads;
- the agent loop forgets everything between runs and stops after 4 turns;
- the gate denies the writer the two spec-folder files its prompt tells it to keep;
- the workflow table has no way out of `paused` except revising the spec;
- nothing raises `EDIT_SPEC`.

## Goals

- **G1:** A main-side build controller runs one feature's build: writer Mode 1, review round n, decide, and writer Mode 2 with every finding. Every node change goes through `transition()` (D34).
- **G2:** The round limit is 3 by default. A build option can lower it and never raise it, and no review runs past it.
- **G3:** A spec problem from either job pauses the build, with the other findings carried. The person's choice (continue, revise, stop) resumes or ends the build, and a revision resets the review counter. There is no revision cap.
- **G4:** User-requested change rounds after the build use the same writer and reviewer and are not counted against the limit.
- **G5:** The app writes `build-ledger.md` and `SUMMARY.md` in the plugin's formats, which `parseLedger` and `detectFolder` read. The writer keeps `changes.md` and ticks `tasks.md`, and no agent can write the ledger, SUMMARY, the planning docs or the state file.
- **G6:** The writer and the reviewer each keep their own conversation across rounds. Build runs get larger turn caps, and the spike is unchanged.
- **G7:** A scripted provider replays canned turns, so the whole loop runs in unit tests with no network.
- **G8:** `edit-approved-spec` leads to `EDIT_SPEC` when it is legal. Agents never run git, and the loop commits nothing.
- **G9:** The docs are updated in the same change.

## Non-goals

- `approve-result`, commit, push and `mark-done`, including clearing the state file on close (`p3-ship`).
- Running jobs in the agent process over IPC, and the full headless end-to-end test on a fixture repo (`p3-headless-e2e`).
- Any UI or IPC for the build controller.
- Storing the round limit in project settings (Phase 4).
- The data-agent overlay during a build (`DATA_START` and the stop events).
- Tracker writes (D8).
- Changing the sdd plugin's files.

## Design

### Loop options (`src/agent/loop.ts`)

- `LoopInput` gets optional `maxTurns` (a positive integer, default `MAX_TURNS` = 4) and optional `history: Message[]`.
- The run's messages are the history, then a new user message with `prompt`.
- `LoopResult` gets `messages`, the full list after the run: the history, the prompt, the assistant turns and the tool results. It can be passed as the next run's history.
- With neither option, behaviour and request contents are unchanged.
- `maxTurns` below 1 or not an integer is treated as the default.

### Report parsers (`src/shared/build-reports.ts`, pure)

Each parser returns `{ ok: true, report }` or `{ ok: false, reason }` with a fixed reason. It never throws, reads CRLF as LF, and ignores text before its heading.

- **`parseImplementationReport(text)`** needs a `## Implementation report` heading. It returns:
  - `completed: string[]` and `notCompleted: string[]`, the task ids;
  - `concerns: string`;
  - `specProblems: string[]`, every line or bullet holding `NEEDS-SPEC-CHANGE`, with that text.
- **`parseFindingsAnalysis(text)`** needs a `## Findings analysis` heading and a table. It returns:
  - `round: number | null`;
  - `rows: { finding, decision, reasoning, action }[]`, where `decision` is `ACCEPT`, `REJECT` or `NEEDS-SPEC-CHANGE`. A row with another decision fails the parse.
  - `specProblems`, the rows that are NEEDS-SPEC-CHANGE.
- **`parseReview(text)`** needs a `## Review round <n>` heading, where `<n>` is a number or, for a user change round, `U<k>` (revised in revision 1). The returned `round` is a number, or the string `U<k>`. It also needs and a `Verdict: PASS` or `Verdict: ISSUES` line. It returns:
  - `round`, `verdict` and `summary`;
  - `findings: { id, type: 'defect' | 'spec-change', severity, location, problem, evidence, suggestedFix, specLine }[]`, from the `- id:` blocks under `### Findings`;
  - `runtimeNotes: string[]`.

  ISSUES with no findings, or PASS with any finding, fails the parse.
- The texts the parsers keep are capped at 2,000 characters each, and the finding lists at 50 entries.

### Build documents (`src/shared/build-docs.ts`, pure)

- **`renderLedger(state)`** writes the plugin's ledger format.
  - The header lines:
    - `# Build ledger: <feature>`;
    - `state:`, `revision:` and `resume on approve:`;
    - `current round: <n> of <limit>, in revision <r>`;
    - `phase:`;
    - `Writer: <model>    Reviewer: <model>`;
    - `Turn caps: writer 40, reviewer 20`.
  - The sections, in order:
    - `## Implementation, revision <r> (Mode 1|3)`, with the parsed report;
    - one `## Revision <r>, round <n> (PASS|ISSUES)` per round, with the table `| Finding | Severity | Location | Implementor decision | Reasoning | Action |`;
    - `## User-requested change round U<n> (PASS|ISSUES)`;
    - `## Spec problems`;
    - `## Carried findings`, with `none` when empty.
  - Table cells have `|` escaped and newlines replaced with spaces.
- **`renderSummary(state, changesText)`** writes the plugin's SUMMARY format.
  - The header lines are the title, `Ticket:`, `Date:`, `Outcome: Clean | Open issues remain | Stopped by the user`, `Review rounds:` and `Models:`.
  - The sections are:
    - `## What was built`;
    - `## Files changed`, with the rows copied from `changes.md`, or `not recorded` when it is missing;
    - `## Acceptance criteria`;
    - `## Needs a runtime check`;
    - `## Review ledger`;
    - `## Spec revisions`;
    - `## Rejected findings`;
    - `## Open issues`;
    - `## Git state`, which says `uncommitted; the app commits after the result is approved`;
    - `## Next steps`.
- Both are pure. Main writes the text with the temp-file-and-rename helper from `spec-lock.ts` (`writeAtomic`).

### Workflow table (`src/shared/workflow.ts`, amends D34)

- Three events are added to `EVENT_IDS`:
  - `CONTINUE` (kind `user`): in `paused`, it leads to `implementing`;
  - `STOP_BUILD` (kind `user`): in `paused`, it leads to `build-done`;
  - `END_BUILD` (kind `app`, revised in revision 1): in `implementing`, `reviewing` and `paused`, it leads to `build-done`. The controller raises it when a build ends without a review verdict to act on. That happens on a failed step (see "Unreadable reports") and on a `continue` that leaves nothing to run (see `resume`). No fake IMPLEMENTED step is ever raised.
- CONTINUE enters `implementing` only when there is a writer step to run:
  - **The pause came from a review:** the controller re-runs that round's decision with the carried findings, so the writer analyzes them in Mode 2.
  - **The pause came from the writer:** the controller re-sends the writer's step with the carried findings.
- Issues at the limit use `REVIEW_PASSED`, as the plugin does. The outcome is in the ledger and SUMMARY.
- The table's tests, the event list in `docs/workflow-engine.md`, and the count comments ("eighteen events") are updated.

### Gate (`src/main/policy/path-areas.ts`, `gate.ts`, amends D30)

- `SPEC_DOC_NAMES` gets `changes.md`.
- In `writeReason`, a writer with `context.spec === 'approved'` may write a `spec-doc` whose feature is the effective feature and whose name is `tasks.md` or `changes.md`.
- Every other `spec-doc` or `spec-other` path is still denied to the writer, with the existing reasons. That covers `specs.md`, `plan.md`, `subtask.md`, `build-ledger.md`, `summary.md` and `.sdd-state.json`.
- The planner rules, the locked rule and the reviewer (no write tools) are unchanged. A planner may not write `changes.md` before approval, since the planner's own docs stay the four planning files.

### Job runner (`src/main/workflow/job-runner.ts`)

- `JobRunner` is `(request: { job: 'writer' | 'reviewer'; task: string; history: Message[] }) => Promise<JobRunResult>`. `JobRunResult` is one of:
  - `{ ok: true; text; messages; stopped }`;
  - `{ ok: false; reason }`.
- `createInProcessJobRunner({ root, provider, model, contextNow, toolRunner?, maxTurns? })` runs `runAgentLoop` for each request.
  - **Tool calls:** each call goes to `checkToolCall(request, contextNow())` and, when allowed, to the tool runner (by default `makeToolRunner(root, { commandCheck })`). A denied call goes back to the model as a tool error with the gate's reason.
  - **Turn caps:** the writer gets 40 turns and the reviewer 20, unless `maxTurns` overrides them in tests.
  - **Turn limit:** a run that stops at its cap returns `ok: false` with the reason `the <job> did not finish within its turn limit`.
  - **Provider errors:** a provider error becomes `ok: false` with the error's own message, which never holds a key (`ProviderError`).
- The runner never runs git. The tool registry has no git tool, and `run_command` goes through the D31 allowlist.

### Build controller (`src/main/workflow/build-loop.ts`)

- **`roundLimit(value: unknown)`** returns:
  - `{ ok: true, limit: 3 }` for `undefined`;
  - `{ ok: true, limit: value }` for 1, 2 or 3;
  - otherwise `{ ok: false, reason: 'the round limit must be 1, 2 or 3' }`.
- **`createBuildController({ root, feature, runner, roundLimit?, models, now })`** first checks:
  - the feature slug;
  - that the lock's approval for the feature is `approved`, using `approvalOf` from `spec-lock.ts`;
  - the round limit.

  A failure returns `{ ok: false, reason }`, and nothing runs. The controller starts at node `spec-approved`.
- **`start()`:**
  1. START_BUILD.
  2. Writer Mode 1, with `WRITER_TASKS.implement` and the placeholders filled. Before every writer step, the ledger is written with `state: running`, `phase: implementing` and the current round.
  3. IMPLEMENTED, then review round n with `REVIEWER_TASKS.review`. The earlier findings and the writer's decisions follow the text. Before every review, the ledger is written with `phase: reviewing`.
  4. Decide:
     - **PASS:** REVIEW_PASSED, with the outcome Clean.
     - **ISSUES at the limit:** REVIEW_PASSED, with the outcome Open issues remain.
     - **ISSUES below the limit:** REVIEW_ISSUES, then writer Mode 2 with `WRITER_TASKS.fixFindings` and every finding unedited, then IMPLEMENTED and review round n+1.

  When the build ends, the ledger is set to `state: done` and SUMMARY.md is written. `start()` resolves with the outcome: `{ kind: 'done', outcome }`, `{ kind: 'paused', problem }` or `{ kind: 'failed', reason }`.
- **Sessions.** The controller keeps one history for the writer and one for the reviewer, and passes each back on every run.
- **Unreadable reports.** A report that fails its parser gets one follow-up run in the same history, with the fixed text `Your last answer did not follow the required report format. Restate it exactly in that format.` If the restatement fails too, or a run returns `ok: false`, the build ends:
  - the ledger becomes `done` and the SUMMARY's outcome is Open issues remain, with the reason under Open issues;
  - the workflow event is END_BUILD, from `implementing` or `reviewing`, so the node is `build-done` and agrees with the files (revised in revision 1).
  - `start()` resolves `{ kind: 'failed', reason }`.
- **Spec problems.**
  - **Trigger:** any `specProblems` from the writer's report or analysis, or any `spec-change` finding in a review. The step that produced it is allowed to finish.
  - **Pause:** SPEC_PROBLEM moves to `paused`. The ledger is written with `state: paused-for-revision` and `resume on approve: no`, and gains a `## Spec problems` entry quoting the problem and naming the step.
  - **Carried findings:** the step's other findings go under `## Carried findings`. A `spec-change` finding itself is not carried.
    - **A writer pause:** a NEEDS-SPEC-CHANGE in a Findings analysis carries that step's findings, minus the ones the writer marked NEEDS-SPEC-CHANGE.
    - **A pause in Mode 1:** carries none.

    (Revised in revision 1.)
  - `start()` resolves `{ kind: 'paused', problem }`.
- **`resume(choice)`**, legal only while paused:
  - **`continue`:** the problem is recorded as a deviation, with "user chose: continue". Then CONTINUE, `state: running`, and the loop goes on from the step that paused. The counter is not reset.
    - **Nothing left to run** (revised in revision 1). This happens when the pause came from a review and either there are no carried findings, because every finding was spec-change, or the review was the last allowed round. The controller then raises END_BUILD from `paused`. The ledger becomes `done`, and SUMMARY.md is written with the outcome Open issues remain. The deviation and any remaining findings are listed under Open issues.
  - **`revise`:** REVISE moves to `spec-changed`. The ledger sets `resume on approve: yes` and adds 1 to `revision`. It resolves `{ kind: 'awaiting-approval' }` and runs no agent.
  - **`stop`:** STOP_BUILD. The ledger becomes `done` with "stopped by the user", and SUMMARY.md is written with the outcome Stopped by the user and the problem under Open issues.

  Any other call is refused with a fixed reason and changes nothing.
- **`approved()`** is called by main after a successful `approve-spec` for this feature, which is REAPPROVE. It is legal only from `spec-changed` with `resume on approve: yes`. Then:
  1. The ledger becomes `state: running` and `resume on approve: no`.
  2. The review counter resets to 0.
  3. Writer Mode 3 runs with `WRITER_TASKS.resume`, followed by the carried findings.
  4. The loop goes on with review round 1 of the new revision.

  The controller checks the lock's approval again before it runs. If it is not `approved`, it refuses.
- **`requestChanges(items: string[])`**, legal only at `build-done`:
  1. REQUEST_CHANGES, and the ledger becomes `state: running`.
  2. The items become findings U<k>-1, U<k>-2 and so on. They go to the same writer in Mode 2, then the same reviewer reviews once.
  3. The round is recorded as `User-requested change round U<k>`. The round counter and limit are not touched.
  4. The label `U<k>` is also the round in the prompts: the `<n>` of `WRITER_TASKS.fixFindings` and `REVIEWER_TASKS.review`. The reviewer's heading is `## Review round U<k>`, so the ledger, the prompts and the reports use the same label (revised in revision 1).

  It ends with REVIEW_PASSED or, on ISSUES, still with REVIEW_PASSED and the issues listed under Open issues, so one change request gives one review. SUMMARY is rewritten, and a spec problem pauses as usual. An empty or non-string list is refused.
- **`requestEdit()`** is the EDIT_SPEC hook. It is legal only from `spec-approved`, before `start()`, and moves to `spec-changed`. Anywhere else it returns a refusal.
- **`node()`** returns the current node. Every event goes through `transition()`, and an illegal one is refused and changes nothing.
- The controller runs one step at a time. A call made while a step runs is refused with `a build step is already running`.
- It runs no git and makes no commit. Its only file writes are `build-ledger.md` and `SUMMARY.md` in the feature's folder.

### EDIT_SPEC wiring (`src/main/human/spec-handlers.ts`, `src/main/index.ts`)

- `SpecHandlersDeps` gets an optional `onEditRequested(feature): { ok: true } | { ok: false; reason }`.
- `edit-approved-spec` calls it before writing the state file, and refuses with that reason when it says no.
- With no hook, the behaviour is unchanged.
- `src/main/index.ts` passes a hook that finds the feature's controller, if any, and calls `requestEdit()`. With no controller it allows the edit. No controller is created at startup in this subtask, so the app's runtime behaviour is unchanged.

### Scripted provider (`tests/support/scripted-provider.ts`)

- `createScriptedProvider(script: Record<'writer' | 'reviewer', ScriptedTurn[]>)` returns a `Provider`.
  - A `ScriptedTurn` is `{ text?: string; toolCalls?: { name, args }[] }`.
  - Each `stream()` call picks the job from the request's system prompt (the writer or reviewer prompt), and replays that job's next turn as `text`, `tool-call` and `done` events.
- It records each request: its job, its messages and its tools.
- It throws `script exhausted for <job>` when a job has no turns left, and `listModels()` returns `[]`.
- It lives under `tests/`, so it is not in the app build.

## Acceptance criteria

- **AC1: Rounds.** With the scripted provider in a temp repo, unit tests show:
  - writer, then a PASS review, ends Clean after 1 round;
  - ISSUES, then a Mode 2 fix with every finding unedited, then a PASS review, ends Clean after 2 rounds;
  - ISSUES at round 3 ends Open issues remain, with no fourth review.

  The workflow events in each run follow the table, and the scripted provider shows the writer and the reviewer each continued their own history.
- **AC2: Round limit.** `roundLimit` gives 3 for undefined, and 1, 2 or 3 as given. It refuses 0, 4, 2.5, `'3'` and `null`. A build with limit 1 stops after 1 ISSUES review. A refused limit runs nothing and writes no file.
- **AC3: Pause.**
  - A writer `NEEDS-SPEC-CHANGE` and a reviewer `spec-change` finding each pause the build after the step finishes. The ledger is `paused-for-revision`, and the review's other findings are carried.
  - `continue` resumes from the step that paused, without resetting the counter.
  - `stop` ends with `done` and "stopped by the user", and SUMMARY.md has the outcome Stopped by the user.
  - `revise` goes to `spec-changed` with `resume on approve: yes` and the revision raised. `approved()` then runs writer Mode 3 with the carried findings, and review rounds restart at 1.
  - A second revision is allowed (no cap).
  - `resume` while not paused, and `approved()` without a revise, are refused.
- **AC4: Change rounds.** After a Clean build, `requestChanges` sends U1 items to the same writer and then the same reviewer. The ledger records `User-requested change round U1`. The round counter is unchanged, so a build that used 3 rounds can still take a change round. An empty list is refused.
- **AC5: Documents.**
  - At each step, `parseLedger` on the written ledger, fed to `detectFolder` with approval `approved`, gives `implementing` or `reviewing` with the current round. A paused build gives `paused`, and a finished one gives `build-done`.
  - `renderLedger` and `renderSummary` output round-trips through `parseLedger`.
  - SUMMARY.md has every section.
  - Gate tests show the writer is allowed its feature's `tasks.md` and `changes.md`, and denied `build-ledger.md`, `SUMMARY.md`, `SPECS.md` and another feature's `tasks.md`. Every job is denied the ledger and SUMMARY.
- **AC6: Events.** CONTINUE and STOP_BUILD are in the table with kind `user`, and END_BUILD with kind `app` from `implementing`, `reviewing` and `paused`. A failed step, and a `continue` with nothing left to run, end with END_BUILD at `build-done`, so the node and the ledger agree, and no IMPLEMENTED event is raised without a writer step (revised in revision 1). The table tests are updated. An illegal controller call is refused and leaves the node and the files unchanged. `edit-approved-spec` with the hook calls `requestEdit()`, which moves `spec-approved` to `spec-changed`, and it refuses while a build is running.
- **AC7: No git, no commit.** No new module imports `child_process` or names `git`. Tests assert that a scripted `run_command` of `git commit` is denied by the gate and that the loop commits nothing.
- **AC8: Loop and reports.** Loop tests show:
  - the default of 4 turns is unchanged;
  - `maxTurns` raises the cap;
  - `history` is sent before the prompt;
  - `messages` is returned.

  The parser tests cover every report format, the bad cases, the caps and the restate-once path.
- **AC9: Docs.** In the build on the feature branch:
  - the `CHANGELOG.md` entry under `## [Unreleased]`;
  - D37 in `docs/decisions.md`. It records the controller, the injected runner, the turn caps, the round limit option, the pause choices with no revision cap, the change rounds, the documents, and the writer's two files. It amends D30 (the gate) and D34 (CONTINUE, STOP_BUILD and END_BUILD);
  - a "Build loop" section in `docs/workflow-engine.md`;
  - `docs/agent-jobs.md`, covering the writer's files, the turn caps and the parsed formats;
  - stale docs checked and updated: `CLAUDE.md` (D1–D37, the engine line), `README.md`, `docs/PRD.md` (F2: tick "After the last allowed round the build stops and asks the user"), `docs/workflow.md`, the phase-03 doc and the progress follow-ups.

  The check is recorded in `changes.md`.
- **AC10: Checks.**
  - The new shared modules pass the import scan.
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.
  - CI on the pull request is green on every job before the merge.

## Open questions

All five are settled on 2026-11-23, revision 1. The implementor raised them as NEEDS-SPEC-CHANGE after implement round 1.

- **A failed step:** a provider error, the turn limit, or a report still unreadable after one restate. It raises a new app event, END_BUILD, from `implementing` or `reviewing` to `build-done`. The outcome is Open issues remain, so the node and the files agree. Not chosen: pausing and asking.
- **A continue with nothing left to run:** every finding was spec-change, or the pause was at the last round. It raises END_BUILD from `paused`, with the outcome Open issues remain and the deviation under Open issues. No fake IMPLEMENTED is raised. Not chosen: Clean with the deviation recorded.
- **Change-round numbering:** the label `U<k>` is used in the prompts and in the reviewer's heading, and `parseReview` accepts it. Not chosen: the counter + 1.
- **Carried findings after a writer pause:** the step's findings minus the NEEDS-SPEC-CHANGE ones, as implemented. Not chosen: carrying every finding.
