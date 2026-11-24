# Plan: p3-build-loop

Ticket: none (vibe planning, Phase 3 subtask 4)
Status: approved
Date: 2026-11-23

## Objective

Run the sdd build loop in the app (F2, D4). A writer job implements the approved spec's tasks, and an independent reviewer job checks the result. They alternate for up to the round limit: 3 by default, and a project can lower it but never raise it.

The app writes the build ledger and SUMMARY in `docs/specs/<feature>/`, and the writer keeps `changes.md`. A spec problem pauses the build and waits for a person's choice. Change rounds the user asks for after the build are counted separately.

Agents never run git, and nothing is committed here. Committing is `p3-ship`.

## Scope

- **In:**
  - **The build controller** (`src/main/workflow/build-loop.ts`): a main-side orchestrator for one feature's build, holding its workflow node and moving it only through `transition()` (D34). Its steps:
    - **Implement:** the writer runs in Mode 1.
    - **Review round n:** the reviewer runs.
    - **Decide:**
      - PASS ends the build clean.
      - ISSUES at the limit ends it with open issues remaining.
      - ISSUES below the limit sends every finding, unedited, to the writer in Mode 2, and then a new review follows.

    One writer and one reviewer serve the whole build. Each keeps its own conversation history across rounds, as a "session".
  - **An injected job runner:** a `JobRunner` interface that runs one job with a task text and the job's history, and returns the final text.
    - This subtask ships an in-process runner: `runAgentLoop`, main's gate-backed tool runner (`makeToolRunner`) and a provider.
    - Running jobs in the agent process is left to `p3-headless-e2e`.
  - **Loop options:** `runAgentLoop` gets an optional `maxTurns`, with 4 as the default so the spike is unchanged, and an optional prior `history`. It returns the run's messages, so the next round continues the same conversation.
    - Build jobs pass fixed caps: 40 turns for the writer and 20 for the reviewer.
    - A run that hits its cap counts as an unfinished step.
  - **Report parsers** (`src/shared/build-reports.ts`, pure), for the three formats in `docs/agent-jobs.md`:
    - the Implementation report: tasks done and not done, checks, and concerns, including `NEEDS-SPEC-CHANGE` lines;
    - the Findings analysis: a decision per finding (ACCEPT, REJECT or NEEDS-SPEC-CHANGE);
    - the Review: the round, `Verdict: PASS | ISSUES`, and findings with id, type, severity, location, problem, evidence and suggested fix.

    A report that does not parse gets one request to restate it in the format. If the second answer fails too, the build ends with an "unreadable report" open issue.
  - **The round limit:**
    - a pure `roundLimit(value)` takes the build option;
    - absent gives 3, and 1, 2 or 3 is used as given;
    - anything higher, or invalid, is refused with a fixed reason before any job runs;
    - no fourth review ever runs.
  - **Spec-problem pause:**
    - **Trigger:** a `NEEDS-SPEC-CHANGE` from the writer, or a `spec-change` finding from the reviewer.
    - **What happens:** the current step finishes, and then SPEC_PROBLEM moves the build to `paused`. The ledger shows `state: paused-for-revision` with the problem and the step it came from, and every other finding of that step is carried.
    - **The person's choice** arrives through `controller.resume(choice)`:
      - `continue`: a documented deviation. CONTINUE moves back to the step that paused. The counter is not reset.
      - `revise`: REVISE moves to `spec-changed`, and the ledger sets `resume on approve: yes` and adds one to `revision`. The controller waits for `approve-spec` (p3-spec-lock), which is REAPPROVE. Then the writer runs in Mode 3 with the carried findings, and the review counter resets.
      - `stop`: STOP_BUILD moves to `build-done`, with the ledger `done` and "stopped by the user".
    - There is no revision cap.
  - **User change rounds:** `controller.requestChanges(text)` raises REQUEST_CHANGES from `build-done`. The same writer runs in Mode 2 with the user's items, numbered U1, U2 and so on, and then the same reviewer reviews. These rounds are labelled `User-requested change round U<n>` and are not counted against the limit. The ledger ends `done` again.
  - **Ledger and SUMMARY** (`src/shared/build-docs.ts` pure, plus main-side writes):
    - The app writes `build-ledger.md` in the plugin's format, which `parseLedger` and `detectFolder` read. It sets the `phase:` line before each step and keeps the round tables.
    - The app writes `SUMMARY.md` in the plugin's format when the build ends: clean, open issues, or stopped.
    - Every write goes through a temp file and a rename.
  - **Writer files in the gate (D30 amendment):** while the spec is approved, the writer may write only its own feature's `tasks.md` and `changes.md`.
    - `SPECS.md`, `PLAN.md` and `SUBTASK.md`, `build-ledger.md`, `SUMMARY.md` and the state file stay denied to every agent.
    - The reviewer still writes nothing.
  - **Workflow events (D34 amendment):** two new user-kind events, both taking their targets from the table:
    - CONTINUE: from `paused` to the step that paused;
    - STOP_BUILD: from `paused` to `build-done`.

    Issues at the limit use REVIEW_PASSED, as the plugin does.
  - **EDIT_SPEC:** when `edit-approved-spec` succeeds, the controller raises EDIT_SPEC if its feature is in `spec-approved`, which moves it to `spec-changed`.
    - It is illegal while a build runs or is paused. The handler then refuses with `refused`, and the spec stays approved.
    - During a build, a spec change goes through the pause and its revise path.
  - **A scripted provider** (`tests/support/scripted-provider.ts`): it replays canned model turns, both tool calls and final text, per job and in order, so the loop runs headless with no network. It fails loudly when the script runs out. `p3-headless-e2e` builds on it.
  - **Docs**, done in the build on the feature branch:
    - the CHANGELOG under `## [Unreleased]`;
    - D37, which records this design and amends D30 and D34;
    - a "Build loop" section in `docs/workflow-engine.md`;
    - `docs/agent-jobs.md`, for the writer's two files, the turn caps and the report parsing;
    - stale docs checked and updated: `CLAUDE.md`, `README.md`, `docs/PRD.md` (F2: tick "After the last allowed round the build stops and asks the user" if the tests show it), `docs/workflow.md`, the phase-03 doc and the progress follow-ups. The check is recorded in `changes.md`.
- **Out:**
  - approve-result, commit, push and mark-done, including clearing the state file on close (`p3-ship`);
  - running the jobs in the agent process over IPC, and the full headless end-to-end test on a fixture repo (`p3-headless-e2e`);
  - any UI;
  - project settings storage for the round limit (Phase 4);
  - the data-agent overlay in builds;
  - tracker writes (D8);
  - changing the plugin's files.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Where jobs run | Injected `JobRunner`; an in-process runner (loop, gate-backed tool runner, provider) here; agent-process IPC in `p3-headless-e2e` | Add run-job and job-result protocol messages now and run in the utility process |
| Turn limit for build jobs | Per-run `maxTurns` and `history` on `runAgentLoop`; the spike keeps 4, the writer gets 40 and the reviewer 20 | Raise the global `MAX_TURNS` |
| Writer's `tasks.md` and `changes.md` | The gate allows the writer its own feature's two files while the spec is approved; the ledger, SUMMARY, the planning docs and the state file stay denied | The app writes the ticks and `changes.md` from the writer's report, which would change the report formats |
| Where the round limit comes from | A build option, checked by a pure `roundLimit` (1–3; higher is refused); Phase 4 stores it | A config file in `docs/specs/` |
| Ways out of `paused` | New user events CONTINUE (to the step that paused) and STOP_BUILD (to build-done), amending D34 | Ledger-only, as the plugin does |
| Issues at the round limit | REVIEW_PASSED to build-done, as the plugin does; the outcome is in the ledger and SUMMARY | A new ROUND_LIMIT event |
| How the pause choice arrives | `controller.resume('continue' \| 'revise' \| 'stop')`, user-kind choices that the UI calls later; revise waits for approve-spec (REAPPROVE) | New D33 human actions for continue and stop |
| Revision cap | No cap | A cap of 2 revisions, as in the plugin |
| Branch | `feature/p3-build-loop` from `main` (carries the unpushed progress commit `710bb1a`) | n/a |

Defaults stated, not asked:

- **Unreadable report:** a report that does not parse gets one restate request. If that fails too, the build ends with an "unreadable report" open issue.
- **EDIT_SPEC during a build:** illegal while a build runs or is paused, so the handler refuses. A spec change during a build goes through the pause.
- **The changes file:** `changes.md` stays the writer's file. The app reads it for SUMMARY's Files changed table and does not compare it with git, since the app runs no git here.

## Approach

1. **Loop options:** `src/agent/loop.ts` gets `maxTurns`, `history`, and a returned `messages`. Tests cover the default 4, a larger cap and continued history.
2. **Report parsers:** `src/shared/build-reports.ts` holds the three parsers and their result types, with unit tests on the formats in `src/agent/jobs/writer.ts` and `reviewer.ts`.
3. **Ledger and SUMMARY renderers:** `src/shared/build-docs.ts` is pure.
   - It renders the ledger header, the round tables, the spec-problem and carried-findings sections, and the SUMMARY sections.
   - A test feeds each rendered ledger to `parseLedger` and `detectFolder`.
4. **The workflow table:** CONTINUE and STOP_BUILD are added to `src/shared/workflow.ts`, with their kinds, and the table tests and docs are updated.
5. **The gate:**
   - the writer is allowed its own feature's `tasks.md` and `changes.md` while the spec is approved, in `src/main/policy/gate.ts` and `path-areas.ts` (which adds `changes.md` as a named spec doc);
   - the gate tests are updated;
   - `build-ledger.md`, `SUMMARY.md` and the state file stay denied.
6. **The controller and runner:**
   - `src/main/workflow/build-loop.ts` holds `createBuildController` and `roundLimit`;
   - `src/main/workflow/job-runner.ts` holds the in-process runner;
   - `tests/support/scripted-provider.ts` holds the scripted provider;
   - unit tests run each path in a temp repo: clean, a fix then clean, open issues at the limit, a lower limit, a refused higher one, each pause choice, revise with re-approval and the counter reset, user change rounds, an unreadable report, and a refused illegal event.
7. **EDIT_SPEC:** an `onEditRequested` hook joins `edit-approved-spec` to the controller in `src/main/human/spec-handlers.ts` and `src/main/index.ts`. Tests cover both a legal and a refused edit.
8. **Docs and full checks.**

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The loop has no history between runs and a fixed 4-turn cap | `src/agent/loop.ts:15` `MAX_TURNS = 4`; `runAgentLoop` builds `messages` from `input.prompt` only |
| No main→agent message runs a job yet; only the spike runs the loop | `src/agent/index.ts` handles `ping`, `model-key` and `tool-call-result` only |
| The writer is denied every spec-folder write once approved | `src/main/policy/gate.ts` `writeReason`: writer with `spec-doc`/`spec-other` gives SPEC_APPROVED or WRITER_SPEC |
| `changes.md` and `build-ledger.md` are `spec-other` today | `src/main/policy/path-areas.ts` `SPEC_DOC_NAMES` is plan, specs, tasks and subtask only |
| The table has no way out of `paused` except REVISE and REAPPROVE, and the plugin uses REVIEW_PASSED for the limit | `src/shared/workflow.ts` TRANSITIONS; the plugin's `hooks/machine.ts:44,77` |
| The ledger parser reads state, revision, resume on approve, current round and phase | `src/shared/spec-docs.ts` `parseLedger` |
| `detectFolder` maps ledger running with a phase to implementing or reviewing, with the round | `src/shared/spec-detect.ts` `detectFolder`, `result` |
| The task texts and report formats exist | `src/agent/jobs/writer.ts` WRITER_TASKS and its reports; `src/agent/jobs/reviewer.ts` REVIEWER_TASKS and its format |
| The approve-spec and edit-approved-spec handlers exist and refuse with `refused` | `src/main/human/spec-handlers.ts` (D36) |

## Risks

- **Malformed reports:** real models may not follow the report formats exactly. Lenient parsers and the one restate request limit this. The live pilot will show it.
- **Gate rule for two files:** the writer could, in theory, rewrite all of `tasks.md`, not just tick its boxes. That is accepted for now and recorded as a follow-up. `SPECS.md` stays protected by the hash.
- **EDIT_SPEC refusal:** refusing EDIT_SPEC during a build changes the behaviour of `edit-approved-spec`. The p3-spec-lock tests that call it with no controller must still pass, so the hook is optional.
- **History size:** a long history across rounds can grow large. It is bounded by the turn caps and at most 3 rounds per revision. Context trimming is left for later.

## Open questions

- none
