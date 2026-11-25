---
status: approved
ticket:
---

# p3-headless-e2e

## Problem

Each part of the workflow engine is tested on its own: the table (D34), the documents (D35), the spec lock (D36), the build loop (D37) and the ship step (D38). No test runs one feature through all of them together, from plan to closed, as the phase goal asks. So Phase 3's Definition of done is still open.

Only one plugin-written folder is in the fixtures, and it is closed. The other stages have never been read from real plugin files.

Two follow-ups are open:

- where build jobs run (main, or the agent process over IPC);
- where the Rule-event log is wired, since no runner is built in the app.

## Goals

- **G1:** One headless test drives a feature through the engine on a temp git repo, with a local bare remote and no network:
  - the planning files, then `approve-spec` through the D33 channel;
  - a build with an ISSUES round, a spec-problem pause that is revised and re-approved, a clean review, and one change round;
  - `approve-result`, then `mark-done`, ending at `closed`.

  The node is checked at every step.
- **G2:** The test shows that nothing is committed or pushed before `approve-result`. It then shows exactly one commit after `approve-result` and one more after `mark-done`, both on the remote.
- **G3:** An app runner factory builds the job runner with the live policy context and `logRuleEvent(log)`, so every runner the app builds logs every rule event (D30). The headless test uses it.
- **G4:** Real plugin-written files, copied byte for byte, open at the right node and stage in every state the detector knows.
- **G5:** D39 records that build jobs run in the main process for v1.
- **G6:** The docs are updated in the same change, and the phase's Definition of done is checked against the tests.

## Non-goals

- Any UI, and a build start in the app. `index.ts` builds no runner and no controller.
- Moving jobs to the agent utility process, or new IPC messages.
- A planner job in the engine. The test writes the planning files itself.
- Pull requests, or any git-host API.
- Tracker writes (D8).
- Changing the sdd plugin or its files.
- Closing the phase: the roadmap and the phase summary are written after the merge (phase doc, step 7).
- Any change to the workflow table, the build loop, the ship step or the handlers' behaviour. If the walk shows they do not compose, the build pauses on a spec problem instead.

## Design

### App runner factory (`src/main/workflow/app-runner.ts`)

- `createAppJobRunner({ root, provider, model, live, log, maxTurns? })` returns a `JobRunner`.
- It calls `createInProcessJobRunner` with:
  - `contextNow: () => contextFor(base, live)`, where `base` is the root's command context, as the agent host builds it (D31, D36);
  - `onRuleEvent: logRuleEvent(log)`.
- `log` is a `RuleLogger` (info, warn, error). The app passes its `log`, and tests pass a recording logger.
- Nothing in `index.ts` calls the factory in this subtask. Its header comment says the build start must use it.

### Headless walk (`tests/unit/headless-e2e.test.ts`)

- **The repo.** A temp git repo with `user.name`, `user.email`, `init.defaultBranch=main` and `core.autocrlf=false` set, and a bare repo in a temp folder as `origin`. It has an initial commit on `main`, pushed, with `origin/HEAD` set. The test then switches to `feature/<feature>`. The test reads git state with the git CLI itself (HEAD, the commit count, the remote's refs, the commit's file list).
- **The pieces.** The real spec handlers and ship handlers are registered on a real `createHumanActionChannel`, with a test gesture tracker. The real build controller runs with the factory's runner, the scripted provider (`tests/support/scripted-provider.ts`), the real gate and real tools in the temp root.
  - The handlers' `onEditRequested` and `controllerNode` read that one controller, as `index.ts` does through `buildControllers`.
  - `contextNow`'s live supplier reads the lock from the files, so the gate sees the current approval.
- **The steps,** with the node checked after each one (`detectFolder` over the scanned folder, and `controller.node()` while a controller exists):
  1. PLAN.md, draft: planning. PLAN.md, approved: plan-approved. SPECS.md, tasks.md and SUBTASK.md: spec-drafted.
  2. `approve-spec` through the channel: spec-approved. Then, with no controller created yet, `edit-approved-spec` through the channel succeeds (spec-changed), and `approve-spec` re-approves (spec-approved). Only then is the controller created (revision 1).
  3. `start()`. The writer's Mode 1 turns make tool calls that write a product file and `changes.md`.
     - One call tries to write the approved `SPECS.md`, and the gate denies it.
     - Review round 1 is ISSUES, and the writer fixes it in Mode 2.
     - Review round 2 has a spec-change finding: the build pauses (paused).
  4. `resume('revise')`: the build awaits approval (spec-changed).
     - `edit-approved-spec` through the channel is refused here: the controller allows `EDIT_SPEC` only from spec-approved (revision 1).
     - The test edits SPECS.md directly, and the lock reads it as `changed` by hash (D36).
     - `approve-spec` through the channel re-approves it, and `approved()` resumes in Mode 3.
     - The next review passes (build-done).
  5. `requestChanges([...])`: one change round runs, with its writer step and its review, and passes (build-done).
  6. `approve-result` through the channel: the work is committed and pushed (build-done, with the Git state line approved).
  7. `mark-done` through the channel: the close is committed and pushed (closed).
- **No early commit.** Before step 6, after every step, HEAD, the commit count and the remote's branch ref equal their values after the branch was created. After step 6 there is exactly one new commit, on the remote too, with the commit-format message and only allowed paths. After step 7 there is one more, the close.
- **Rule events.** The factory's recording logger has an allow line for a writer write and an error line for the denied SPECS.md write. No line holds file content.
- **Time.** The walk has an explicit per-test timeout, like the other temp-repo tests.

### Plugin folders in every state

- **The fixtures.** The files of `docs/specs/p3-ship/` at the work commit `c580d56` are copied byte for byte (`git show c580d56:<path>`) into `tests/fixtures/sdd-plugin/specs/p3-ship/`: PLAN.md, SPECS.md, tasks.md, SUBTASK.md, build-ledger.md, changes.md and SUMMARY.md. The fixture README lists the source and the commit. The test holds each file's SHA-256, taken from `git show c580d56` output when the fixtures are made, and checks the copies against those values. It needs no git history, so it runs in CI's shallow clone (revision 1).
- **The states** (`tests/unit/plugin-folder-states.test.ts`): each is built in a temp root from a subset of those files, plus `docs/specs/.sdd-state.json` where the approval needs one, and checked with `scanSpecFolders`'s node and stage.

  | State | Files and lock |
  | --- | --- |
  | planning | PLAN.md, its Status line set to `draft` in the temp copy; no lock |
  | plan-approved | PLAN.md; no lock |
  | spec-drafted | PLAN, SPECS, tasks, SUBTASK; no lock |
  | spec-approved | the same, with a lock holding SPECS.md's hash |
  | spec-changed | the same lock, with SPECS.md changed in the temp copy |
  | implementing, reviewing | plus the ledger, with `state: running` and the `phase:` line set in the temp copy |
  | paused | plus the ledger, with `state: paused-for-revision` |
  | build-done | all seven files, with the lock |
  | closed | all seven files; no lock |

- Only the temp copies are edited. Each edit is one line, made by the test.

### D39

- **Outcome:** build jobs run in the main process through `createInProcessJobRunner`, for v1. The agent utility process keeps the spike loop. The app builds runners only through `createAppJobRunner`, so every rule event is logged.
- **Why:** the gate checks every call in main either way (D1, D4), so moving jobs changes no enforcement. In main, the headless test runs the real runner in Vitest, and the job runner needs no new IPC messages or protocol.
- **Not in this decision:** moving jobs to the agent process later, if a need shows (isolation or CPU), as a new decision.

## Acceptance criteria

- **AC1: The walk.** One test runs the seven steps of the Design on a temp repo with a bare remote and no network, and checks the expected node after each one. It covers planning, plan-approved, spec-drafted, spec-approved, implementing, reviewing, paused, spec-changed, build-done and closed.
- **AC2: Human actions only through the channel.** `approve-spec`, `edit-approved-spec`, `approve-result` and `mark-done` are called only through `createHumanActionChannel` with a gesture. One call without a gesture is refused and changes nothing.
- **AC3: No commit before approval.** After each step before `approve-result`, HEAD, the commit count and the remote's branch ref are unchanged. After `approve-result`: one new commit, pushed, with the commit-format message, and only paths in the allowed set. After `mark-done`: one more commit, the close, pushed. The folder then detects as `closed`.
- **AC4: The gate in the walk.** The writer's scripted write to the approved SPECS.md is denied and the file is unchanged. The factory's logger records the allow and the deny lines.
- **AC5: The factory.** `createAppJobRunner` passes every gate decision to `logRuleEvent(log)`, through `formatRuleEvent`, and uses the live context for each call (a change in the live supplier is seen by the next call). A unit test shows both.
- **AC6: Plugin folders.** The p3-ship fixtures match the SHA-256 values recorded in the test, taken from `git show c580d56` output (revision 1). Each state in the Design's table opens at its node and stage through `scanSpecFolders`.
- **AC7: No product behaviour change.** `src/shared/workflow.ts`, `build-loop.ts`, `ship.ts`, the handlers and `index.ts` are unchanged, apart from comments.
- **AC8: Docs.** In the build on the feature branch:
  - the CHANGELOG entry under [Unreleased], as top-level bullets;
  - D39 in `docs/decisions.md`;
  - `docs/workflow-engine.md`: a "Headless run" section, and where the job runner runs;
  - `docs/agent-jobs.md`: where the jobs run;
  - stale docs checked and updated: CLAUDE.md (D1–D39), README.md, `docs/PRD.md` F2 (each item checked against a test), `docs/workflow.md`, the phase-03 doc (the subtask note, and each Definition of done item ticked with its evidence), and the progress follow-ups (the IPC and Rule-log items resolved);
  - all recorded in `changes.md`, with the stale-doc check.
- **AC9: Checks.** typecheck, lint, format:check and test pass, with no network. CI on the PR is green on every job before the merge.

## Open questions

- 2026-11-25, revision 1: decisions from the build's first pause, which came from the implement step.
  - **The fixture check.** CI's checkout is shallow, so `c580d56` is absent there. The test compares each p3-ship fixture with a SHA-256 recorded in the test, taken from `git show c580d56` output, instead of running `git show` (AC6, Design).
  - **The revise edit.** After `resume('revise')`, `edit-approved-spec` is refused, because `EDIT_SPEC` is legal only from spec-approved (`src/shared/workflow.ts:98`). The walk asserts that refusal, then edits SPECS.md directly, and the lock reads `changed` by hash (D36). A successful `edit-approved-spec` is shown before the build instead, at spec-approved with no controller yet: the edit sets `changed`, `approve-spec` re-approves, and only then is the controller created (step 2). No product code changes.
