# Plan: p3-headless-e2e

Ticket: none (vibe planning, Phase 3 subtask 6, the last of the phase)
Status: approved
Date: 2026-11-25

## Objective

Show that the workflow engine runs a whole feature headless, with no network and no UI, and close Phase 3's Definition of done. One test drives a fixture repo from plan to closed:

- the spec approval goes through the D33 channel;
- the build loop runs the writer and the reviewer through the scripted provider, with an ISSUES round, a spec-problem pause that is revised and re-approved, and one change round;
- `approve-result` commits and pushes to a local bare remote;
- `mark-done` closes the feature.

The test checks the node at every step and that nothing is committed before `approve-result`.

The subtask also shows that real plugin-written folders open at the right stage in every state. It settles the two open follow-ups: where build jobs run (D39), and where the Rule-event log is wired.

## Scope

- **In:**
  - **The headless walk** (`tests/unit/headless-e2e.test.ts`), in Vitest so it runs in the CI `check` job. It uses a temp git repo with a local bare remote as `origin`, a feature branch, and the scripted provider (`tests/support/scripted-provider.ts`).
    - **Planning steps.** The planner job is not wired in the engine yet, so the test writes the plugin-format files itself and checks the detected node after each one: PLAN.md as draft (planning), PLAN.md approved (plan-approved), then SPECS.md, tasks.md and SUBTASK.md (spec-drafted).
    - **Spec approval.** `approve-spec` goes through `createHumanActionChannel` with a gesture, and gives spec-approved.
    - **The build.** The controller (`createBuildController`) runs with the app runner factory below, the real gate and real tools in the temp root. The writer's scripted tool calls write a product file and `changes.md`.
      - Round 1 ends with ISSUES. The writer fixes it in Mode 2.
      - Round 2 raises a spec-change finding, and the build pauses.
      - The person chooses revise. The test edits SPECS.md, and `approve-spec` re-approves through the channel. The build then resumes in Mode 3 with a new review counter.
      - The next review passes, and the node is build-done.
      - One user change round (`requestChanges`) runs and passes, back to build-done.
    - **Ship.** `approve-result` through the channel commits and pushes. The bare remote has the commit, with the commit-format message and only the allowed paths.
    - **Close.** `mark-done` through the channel closes the feature and pushes the close. The folder then detects as closed.
    - **No early commit.** After every step before `approve-result`, HEAD, the commit count and the remote are unchanged. Exactly one commit follows `approve-result`, and one more follows `mark-done`.
    - **Rule events.** The runner's rule events are captured through the factory's log sink. The walk shows at least one allowed write and one denied call: the scripted writer tries a write under `docs/specs/<feature>/SPECS.md` after approval, and the gate refuses it.
  - **The app runner factory** (`src/main/workflow/app-runner.ts`): `createAppJobRunner({ root, provider, model, live, log })`.
    - It builds `createInProcessJobRunner` with the live policy context (`contextFor`, as the agent host does) and `onRuleEvent: logRuleEvent(log)`.
    - Nothing in `index.ts` calls it yet. The first build start in the app uses it, so the log cannot be left out.
    - A unit test shows that every decision reaches the logger, through `formatRuleEvent`.
  - **Plugin folders in every state.**
    - The plugin-written `docs/specs/p3-ship/` files are copied byte for byte from the work commit `c580d56` into `tests/fixtures/sdd-plugin/specs/p3-ship/`, and the fixture README is updated.
    - A test builds each state in a temp root from a subset of those files, plus a state file where the state needs one, and checks `scanSpecFolders`' node and stage:
      - planning, plan-approved and spec-drafted;
      - spec-approved and spec-changed;
      - implementing and reviewing (a running ledger with each `phase:` line);
      - paused, build-done and closed.
    - Where a state needs one line of a real file changed (PLAN's Status for planning; the ledger's `state:` and `phase:` lines), the test changes it in the temp copy, so the fixtures stay byte for byte.
  - **D39:** build jobs run in the main process through the in-process runner for v1. Every tool call is checked in main by the gate either way (D1, D4). The agent utility process keeps the spike loop only. A move to the agent process is a later decision, if a need shows. The app builds runners only through the factory, so every rule event is logged (D30).
  - **Docs,** done in the build on the feature branch:
    - the CHANGELOG entry under [Unreleased];
    - D39 in `docs/decisions.md`;
    - `docs/workflow-engine.md`: a "Headless run" section, and the job-runner placement;
    - `docs/agent-jobs.md`: where the jobs run;
    - stale docs checked and updated: CLAUDE.md (D1–D39, and the engine line), README.md, `docs/PRD.md` F2 (all items checked against the tests), `docs/workflow.md`, the phase-03 doc (the subtask note, and each Definition of done item ticked with its evidence), and the progress follow-ups (the IPC and Rule-log items resolved).
- **Out:**
  - any UI, and a build start in the app (`index.ts` does not build a runner or a controller);
  - moving jobs to the agent process, or new IPC messages;
  - a planner job in the engine;
  - pull requests, or any git-host API;
  - tracker writes (D8);
  - changing the plugin or its files;
  - the phase close itself: the roadmap, and the phase summary in the progress file. These are done after the merge, as the phase doc's step 7 says.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Where build jobs run | Stay in main through the in-process runner, recorded as D39. The headless test runs the real runner in Vitest. | Move jobs to the agent utility process over IPC now (new protocol messages; testable only under Electron) |
| The Rule-event log | An app runner factory that always passes `logRuleEvent(log)` and the live context, used by the headless test and by the future build start | Record only why it waits, with no code |
| Plugin folders in each state | Byte copies of p3-ship's plugin-written files; each state built from a subset plus a state file, with one-line edits made in the temp copy | Only the states git history holds (build-done and closed) |
| Depth of the walk | Happy path plus an ISSUES round, a spec-problem pause revised and re-approved, and one change round | Happy path only |
| Where the walk runs | `tests/unit/headless-e2e.test.ts` in Vitest, so the `check` job runs it (stated default) | A separate suite or Playwright |
| Branch and slug | `feature/p3-headless-e2e` from `main`, slug `p3-headless-e2e` (stated default) | n/a |

## Approach

1. **The factory** (`src/main/workflow/app-runner.ts`) and its unit test.
2. **The fixtures:** copy `docs/specs/p3-ship/` at `c580d56` into `tests/fixtures/sdd-plugin/specs/p3-ship/` with `git show`, keeping the bytes. Update the fixture README. Prettier already skips the folder.
3. **The plugin-state test** (`tests/unit/plugin-folder-states.test.ts`): a temp root per state, `scanSpecFolders`, and the expected node and stage.
4. **The headless walk** (`tests/unit/headless-e2e.test.ts`):
   - a helper makes the temp repo: `git init` with `user.name`, `user.email`, `init.defaultBranch=main` and `core.autocrlf=false`; a bare remote as `origin`; an initial commit pushed; and the feature branch.
   - The scripted turns are built from the report shapes `build-loop.test.ts` already uses.
   - The channel's gesture is a test tracker, as in `ship-handlers.test.ts`.
   - Git state is read with the git CLI in the test only. Product code still runs git only in `src/main/git/`.
   - The test gets an explicit timeout, as the other temp-repo tests do.
5. **Docs,** as in Scope, with D39.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The scripted provider picks the job from the system prompt and replays turns with tool calls | `tests/support/scripted-provider.ts:37-88` |
| The runner takes `onRuleEvent`, and `logRuleEvent(logger)` makes a sink from a logger | `src/main/workflow/job-runner.ts:44-58`; `src/main/policy/rule-event.ts:180` |
| `contextFor(base, live)` builds the live policy context, and index.ts already supplies a `LiveSupplier` | `src/main/agent/host.ts:84-90`; `src/main/index.ts:266-274` |
| No runner or controller is built in the app, and the jobs run in main | `src/main/index.ts:170-215`; progress file, p3-build-loop and p3-ship follow-ups |
| The controller has start, resume, approved, requestChanges and node | `src/main/workflow/build-loop.ts:80-93` |
| The four human handlers are reachable through `createHumanActionChannel` with a gesture tracker | `src/main/human/channel.ts:52`; `tests/unit/ship-handlers.test.ts:139-150` |
| The detector maps every state from the files, the ledger and the approval | `src/shared/spec-detect.ts:58-80` |
| The only plugin-written fixture folder is the closed `p3-state-machine` | `tests/fixtures/sdd-plugin/README.md`; `find tests/fixtures/sdd-plugin` |
| `docs/specs/p3-ship/` at `c580d56` is a full plugin-written folder at build-done (PLAN, SPECS, tasks, SUBTASK, ledger `done`, changes, SUMMARY) | `git log --diff-filter=A -- docs/specs/*/build-ledger.md` lists `c580d56`; `docs/specs/p3-ship/` |
| F2's three acceptance items are already ticked; the Definition of done has three open items | `docs/PRD.md:98-102`; `docs/phases/phase-03-workflow-engine.md` |

## Risks

- **The walk is long and slow on Windows** under full parallel load, since it makes many git calls and real tool calls. Give it an explicit timeout (as in p3-build-loop U1), and keep the repo small.
- **Scripted reports must match the parsers exactly.** Reuse the shapes from `build-loop.test.ts`, where they already pass.
- **The revise path crosses three parts:** the controller's resume, the spec edit and `approve-spec`. If they do not compose as D36 and D37 describe, the build pauses on a spec problem rather than the walk being bent to pass.
- **git differs between systems** (line endings, the default branch, identity on CI). The repo helper sets them, as `ship.test.ts` does.

## Open questions

none
