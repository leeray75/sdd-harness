# Run a whole feature headless: plan to close on a fixture repo, plus plugin folders in every state

**Parent:** none: no parent chosen
**Spec:** docs/specs/p3-headless-e2e/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p3-headless-e2e

## Context

The workflow engine's parts are tested one by one: the table (D34), the documents (D35), the spec lock (D36), the build loop (D37) and the ship step (D38). No test runs a whole feature through them. Phase 3's Definition of done also asks for a real plugin `docs/specs` folder to open at the right stage. Only a closed one is in the fixtures.

This work adds:

- **A headless walk.** It is one Vitest test on a temp git repo with a local bare remote, and no network.
  - It writes the planning files and approves the spec through the D33 channel.
  - It runs a build with the scripted provider: an ISSUES round, a spec-problem pause that is revised and re-approved, a clean review and a change round.
  - It approves the result, which commits and pushes, then marks the feature done.
  - The node is checked at every step, and the git state shows no commit before `approve-result`.
- **An app runner factory** (`createAppJobRunner`). It always passes the live policy context and `logRuleEvent(log)`, so the first build start in the app logs every rule event.
- **Plugin folders in every state.** Byte copies of p3-ship's plugin-written files are made into each state, from planning to closed, and opened with the scanner.
- **D39:** build jobs run in the main process for v1.

No product behaviour changes. The docs are updated in the same change, and the phase's Definition of done is checked against the tests.

## Required work

- T1 App runner factory
- T2 Plugin fixtures
- T3 Plugin folder states
- T4 Headless walk, setup
- T5 Headless walk, build
- T6 Headless walk, ship and close
- T7 Docs
- T8 Full checks

## Acceptance criteria

- **AC1: The walk.** The seven steps run on a temp repo with a bare remote and no network, and every node from planning to closed is checked.
- **AC2: Human actions only through the channel.** Every approval, edit and close goes through the D33 channel with a gesture. A call without one is refused and changes nothing.
- **AC3: No commit before approval.** HEAD, the commit count and the remote are unchanged until `approve-result`. Then there is one pushed commit with the commit-format message and allowed paths only, and one more for the close.
- **AC4: The gate in the walk.** A scripted write to the approved SPECS.md is denied. The logger records the allow and deny lines.
- **AC5: The factory.** Every decision reaches `logRuleEvent(log)`, and each call reads the live context.
- **AC6: Plugin folders.** The p3-ship fixtures equal the commit's files, and each state opens at its node and stage.
- **AC7: No product behaviour change.** Only `app-runner.ts` is added under `src/`.
- **AC8: Docs.** In the build on the feature branch:
  - the CHANGELOG entry;
  - D39;
  - `workflow-engine.md` ("Headless run") and `agent-jobs.md`;
  - stale docs checked and updated: `CLAUDE.md`, `README.md`, the PRD F2 items, `workflow.md`, the phase-03 doc (with the Definition of done ticked) and the progress follow-ups, recorded in `changes.md`.
- **AC9: Checks.** typecheck, lint, format:check and test pass. CI on the PR is green on every job before the merge.

## Out of scope

- Any UI, and a build start in the app.
- Moving jobs to the agent process over IPC.
- A planner job in the engine.
- Pull requests, or any git-host API.
- Tracker writes (D8).
- Changing the plugin.
- The phase close (the roadmap and the phase summary), which comes after the merge.

## Links

- Plan: docs/specs/p3-headless-e2e/PLAN.md
- Spec and tasks: docs/specs/p3-headless-e2e/SPECS.md, docs/specs/p3-headless-e2e/tasks.md
