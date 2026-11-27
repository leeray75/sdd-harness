# Project checks: git, code host, tracker, test command and earlier specs, run through the environment

**Parent:** none: no parent chosen
**Spec:** docs/specs/p4-project-checks/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-project-checks

## Context

F3's Add project wizard shows five automatic checks: Git repository, Code host, Tracker, Test command and Earlier specs. Nothing in the app computes them, and the git part cannot read the origin remote. This work adds one runner in main, `runProjectChecks(env, root)`. It returns the five results through the project's environment, on any backend, and it never throws. It adds `originUrl` to the git part, and no credential from the URL ever reaches a result. An unreachable environment runs nothing and reports every check as not checked. The rules are recorded as D45.

## Required work

- T1 originUrl in the git part
- T2 Shared types and helpers
- T3 The runner
- T4 Unit tests
- T5 Docs
- T6 Full checks

## Acceptance criteria

- **AC1 — Result type:** `src/shared/project-checks.ts` exports the ids, the statuses, `ProjectCheck`, `ProjectChecks`, `parseOrigin`, `codeHostOf` and `inferTracker` as designed. It has no Node import. `runProjectChecks` always returns five checks in `CHECK_IDS` order.
- **AC2 — originUrl:** the git part has `originUrl` on every backend.
  - Unit tests on the launcher show: an origin gives the URL, an unset origin gives `null`, and outside a repository gives `not-a-repo`.
  - The local backend maps it.
  - Typecheck passes with every `GitPart` fake updated.
- **AC3 — Git check:** unit tests cover:
  - clean;
  - `n` changed files, with `1 changed file` for one;
  - detached;
  - not-a-repo, git-missing and timeout, each with the status, detail and fix from the design.
- **AC4 — Code host and credentials:**
  - unit tests cover the forms https (with and without `user:token@`), ssh with a port, scp-like, `git://`, and the local paths;
  - they also cover the four named hosts and Other;
  - they cover no origin, an unreadable origin, and `not-checked` when git failed.
  - For every URL with a user or token, no field of any check contains the user, the token or the URL.
- **AC5 — Tracker:** unit tests cover:
  - Jira from spec ticket ids;
  - GitHub Issues and GitLab Issues from the host;
  - null;
  - always `warn`, with "not connected".
- **AC6 — Test command and earlier specs:** unit tests cover:
  - a found test command, with its form in the detail;
  - none found (`warn`);
  - specs found (`info`, with the count, singular for one);
  - none yet.
- **AC7 — Robustness:**
  - a check whose environment call throws gives `fail` with the fixed detail, and the other checks still return;
  - the runner never rejects;
  - an unreachable environment gives five `not-checked` results, with no program run and no file read (the fake records the calls);
  - a state change to `unreachable` mid-run turns the remaining checks `not-checked`.
- **AC8 — Boundary:**
  - `src/main/projects/checks.ts` imports no `node:fs`, `node:fs/promises` or `node:child_process`, and `tests/unit/env-boundary.test.ts` passes;
  - no reconnect is called;
  - no network or sign-in call is added.
- **AC9 — Docs:**
  - D45 is in `docs/decisions.md`;
  - the "Project checks" section and `originUrl` are in `docs/environments.md`;
  - the CHANGELOG `[Unreleased]` entry;
  - PRD F3 "Built so far", the CLAUDE.md reading list and the progress follow-ups, all updated;
  - no other doc is stale.
- **AC10 — Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.

## Out of scope

- IPC, preload or any UI: no renderer channel calls the runner in this subtask.
- Connecting a tracker, and any sign-in or network probe of the code host (`git ls-remote`, fetch, API calls).
- Storing check results in the project store or anywhere on disk.
- Reconnecting an unreachable environment.
- Running the test command; it is only detected.
- Changing the detector (`src/main/commands/detect.ts`) or the spec scanner beyond reading their results.

## Links

- Plan: docs/specs/p4-project-checks/PLAN.md
- Spec and tasks: docs/specs/p4-project-checks/SPECS.md, docs/specs/p4-project-checks/tasks.md
