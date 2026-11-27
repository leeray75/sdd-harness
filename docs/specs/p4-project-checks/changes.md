# Changes: p4-project-checks

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/git/git.ts | edited | Adds `originUrl(root)` to the `Git` interface and `createGit` (`config --local --default '' --get remote.origin.url`, empty is null), exports it from the local instance, and widens `NOT_A_REPO` to git's `--local` outside-a-repository message so that case maps to `not-a-repo`. | T1 |
| src/main/env/types.ts | edited | Adds `originUrl` to `GitPart`, so every backend's git part carries the call. | T1 |
| src/main/env/local.ts | edited | Maps `originUrl` in the local git part to the git module. | T1 |
| tests/unit/git.test.ts | edited | Adds an `originUrl` block: origin set gives the URL, unset gives null, outside a repository gives `not-a-repo`. | T1 |
| src/shared/project-checks.ts | created | The check ids, statuses, `ProjectCheck` and `ProjectChecks` types, `parseOrigin` (host only, credential-free), `codeHostOf` and `inferTracker`. No Node import. | T2 |
| src/main/projects/checks.ts | created | `runProjectChecks(env, root)`: the unreachable short-cut, the per-check try/catch and the state read before each check, and the five checks with the spec's titles, details and fixes. Imports no node:fs, node:fs/promises or node:child_process. | T3 |
| tests/unit/project-checks.test.ts | created | Unit tests for the shared helpers, the git, code host, tracker, test command and earlier-specs checks, the fixed failures, the unreachable short-cut, the mid-run state change, the credential-absence checks for every URL with a user or token, and the call counts. Uses a recording fake environment over the local files. | T4 |
| docs/decisions.md | edited | Adds D45 · Project checks after D44: the five checks and statuses, `originUrl` and the host-only rule, the tracker inferred and never connected, no network or sign-in, unreachable as not checked, results not stored. | T5 |
| docs/environments.md | edited | Adds `originUrl` to the git part's list of calls and a "Project checks (D45)" section. Prettier reflowed the file's table on the format check. | T5 |
| CHANGELOG.md | edited | Adds the Added entry for project checks under `[Unreleased]`. | T5 |
| docs/PRD.md | edited | F3 "Built so far": one sentence naming the five checks and that the wizard and the projects screen show them later. | T5 |
| CLAUDE.md | edited | Reading list: D1–D45 in item 2 (was D1–D44), and D41 to D45 with the project checks in item 6. | T5 |
| README.md | edited | Status names the sixth subtask (`p4-project-checks`, D45), and the decisions row reads D1–D45 (it read D1–D43, already stale). | T5 |
| docs/phases/phase-04-progress.md | edited | Adds a D45 bullet to "Decisions added" and a "From `p4-project-checks`" follow-up block (rows 7 and 8, the signed-in line, the Connect tracker button, the container cost). The table row 6 is not changed, per the after-merge rule. | T5 |
| docs/specs/p4-project-checks/tasks.md | edited | Ticks T1 to T6 as their checks pass. | T1, T2, T3, T4, T5, T6 |
| docs/specs/p4-project-checks/changes.md | created | This record of the files touched. | T1, T2, T3 |
