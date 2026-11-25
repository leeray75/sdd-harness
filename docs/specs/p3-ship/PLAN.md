# Plan: p3-ship

Ticket: none (vibe planning, Phase 3 subtask 5)
Status: approved
Date: 2026-11-24

## Objective

Finish a feature in the app (F2, D4, D7). After the build, a person approves the result. The app then commits the work with the commit format and pushes the feature branch. Later the person marks the feature done, and the app commits and pushes the close.

Nothing is committed before the result is approved, git is run only by main, and agents never run git. The p3-build-loop follow-up for D30 is also closed: the build jobs' Rule events reach the log.

## Scope

- **In:**
  - **A typed git module** (`src/main/git/git.ts`, main only). It runs the user's `git` CLI through `execFile`, with no shell, from the project root, with a fixed set of commands. Each function builds its own argument list, and no free-form argument is passed.
    - The commands:
      - the current branch, and whether HEAD is detached;
      - the remote's default branch (`origin/HEAD`);
      - `status --porcelain` (`-z`);
      - `add` and `rm` of a given list of repo-relative paths, after `--`;
      - `commit -m`;
      - `push` of the current branch to origin, setting its upstream;
      - the upstream and ahead count, read from local refs only.
    - The environment: `GIT_TERMINAL_PROMPT=0`, plus a timeout. A missing credential therefore fails rather than hangs, and credentials stay in the user's git setup.
    - git's stdout and stderr are never logged or returned. A failure comes back as a fixed reason code.
  - **The ship module** (`src/main/workflow/ship.ts`): the approve and close steps, on top of the git module and the spec lock. They also do the file work:
    - the Git state line of SUMMARY;
    - SPECS.md's status;
    - removing the state file.
  - **The `approve-result` handler** on the D33 channel.
    - **When it's legal:** the folder detects as `build-done`. That means the ledger is `done`, SUMMARY is present, and the lock is `approved` for this feature. It is refused while a build controller for the feature exists and is not at `build-done`. Elsewhere it refuses with a fixed reason and changes nothing.
    - **The branch check** refuses a detached HEAD and the remote's default branch, or `main` and `master` when `origin/HEAD` is unknown.
    - **Staging:** the files listed in the feature's `changes.md`, plus the feature's spec folder, plus `docs/specs/.sdd-state.json`, the approval record (D7). If git shows any other changed or new file, it refuses with a fixed reason and commits nothing.
    - **Then:** it rewrites SUMMARY's Git state line to "approved; committed and pushed in the commit that adds this report", commits with the commit-format message, and pushes.
  - **The commit message:** `{ticket}: {summary}`, or `{summary}` with no ticket.
    - The ticket comes from SPECS.md's `ticket:` frontmatter.
    - The summary is the first `# ` heading of SUBTASK.md. It falls back to SPECS.md's first heading, then to the slug. It is flattened to one line and capped.
    - The format is fixed for now. A project setting is later.
  - **Push failure and retry:** the commit is kept, and the refusal says "the push failed; the commit is kept". A second `approve-result` on a feature whose work is already committed only pushes. "Already committed" means the Git state line says approved, and the tree has nothing to commit.
  - **The `mark-done` handler:** CLOSE, from `build-done` to `closed`, through `transition()`.
    - **When it's legal:** the work is committed and pushed. That means the Git state line says approved, the tree has no change for this feature, and the branch has an upstream and is not ahead of it.
    - **What it does:**
      - sets SPECS.md's status to `done`;
      - removes the state file when it names this feature;
      - commits that change as `Close <feature> spec`, staging SPECS.md and the state file's removal only;
      - pushes.

      With the file removed, the folder then detects as `closed` (D35).
  - **Rule events:** `createInProcessJobRunner` gets an `onRuleEvent` option. It forwards each gate decision, and passes it to `makeToolRunner` for the revert and network events. index.ts would wire it to `logRuleEvent(log)` when a runner is built.
  - **Wiring:** both handlers are registered next to the spec handlers when a project root exists. No build controller is created at startup: it stays test-only until the UI. The handlers find `build-done` from the files and the lock.
  - **Workflow table:** unchanged. `approve-result` raises no event, and the feature stays at `build-done` (D34). `CLOSE` comes from `mark-done`, and `START_NEXT` is left alone. D34 is not amended.
  - **Tests:** unit tests on a temp git repo, with a local bare remote for the push and no network. They cover:
    - approve and its refusals: wrong node, a controller mid-build, a detached HEAD, the default branch, unrelated changes;
    - the commit message with and without a ticket;
    - the Git state line written before the commit;
    - a push failure, with the commit kept, then a retry that only pushes;
    - mark-done, with its refusals before the commit and before the push, the state-file clear and the closed detection;
    - Rule events forwarded by the job runner;
    - a scan showing that only `src/main/git/` runs git, and that no agent tool or job reaches it.
  - **Docs,** done in the build on the feature branch:
    - the CHANGELOG entry under [Unreleased];
    - D38;
    - a "Ship and close" section in `docs/workflow-engine.md`;
    - the two handlers in `docs/human-actions.md`;
    - stale docs checked and updated: CLAUDE.md (D1–D38, and the git rule line), README.md, `docs/PRD.md` F2 ("Nothing is committed before the user approves the result" ticked), `docs/workflow.md`, the phase-03 doc and the progress follow-ups.
- **Out:**
  - the headless end-to-end test, and running jobs in the agent process (`p3-headless-e2e`);
  - opening pull requests, or any git-host API;
  - any UI, and a build start in the app;
  - a commit format set in project settings;
  - tracker writes, including a comment on the child ticket (D8);
  - changing the plugin's files;
  - `change-rules`.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| How git runs | The git CLI through `execFile` with fixed arguments, no shell, `GIT_TERMINAL_PROMPT=0` and a timeout. It uses the user's credentials, hooks and config, and adds no dependency. | isomorphic-git (the app would handle credentials and skip hooks; a new dependency); simple-git (a wrapper over the same binary; a new dependency) |
| What is staged | The files in `changes.md`, the feature's spec folder and the state file. Any other changed or new file refuses the approval, and nothing is committed. | `git add -A` as the plugin does (sweeps in unrelated edits); stage the listed files and leave the others (easy to miss) |
| Commit summary | SUBTASK.md's first heading, falling back to SPECS.md's heading, then the slug. The ticket comes from SPECS.md's `ticket:`. | SPECS.md's title; fixed text with the slug |
| Branch check | Refuse a detached HEAD and the default branch (`origin/HEAD`, or `main` and `master` when that is unknown). | Allow only `feature/<feature>` |
| Push failure | The commit is kept, with a fixed reason. A second `approve-result` on committed work only pushes. | A new retry-push action (changes D33); report only, with no retry |
| What close needs | The work is committed and pushed. Close then commits and pushes the close. | Committed only; the result approved, with no git check |
| Build controller in index.ts | Test-only until the UI. The handlers read `build-done` from the files and the lock, and refuse while a controller is mid-build. | Create one at startup now |
| Knowing the push succeeded | Ask git: an upstream on origin, and not ahead, from local refs only. | Record it in SUMMARY (that would need an amend) |
| Close commit message | `Close <feature> spec`, as in this repo's history (stated default) | n/a |
| Branch and slug | `feature/p3-ship` from `main`, slug `p3-ship` (stated default) | n/a |

## Approach

1. **The git module** (`src/main/git/git.ts`): typed functions over one private `runGit(root, args)`. It uses `execFile('git', args, { cwd: root, shell: false, env, timeout, maxBuffer })`. Paths are checked as repo-relative, inside the root, and passed after `--`. Results are `{ ok: true, ... } | { ok: false, code }`, where `code` comes from a fixed set (`not-a-repo`, `git-missing`, `failed`, `timeout`). No output is echoed.
2. **The ship module** (`src/main/workflow/ship.ts`): `approveResult(root, feature)` and `markDone(root, feature)`.
   - Both read the folder with `readSpecFolder` and the lock (`readSpecState` and `hashSpec`), and check the node with `detectFolder`.
   - Both write through `writeAtomic` (spec-lock.ts). SUMMARY's line is rewritten under the `## Git state` heading only.
   - The status is set with `setFrontmatterStatus`, and the state file is removed only when it names this feature.
   - Both return the D33 result shape with fixed reasons.
3. **The handlers** (`src/main/human/ship-handlers.ts`): `createShipHandlers({ root, onLockChanged, controllerNode? })`. They wrap the ship module, and never throw. They are registered in `index.ts`'s `startSpecLock`, next to the spec handlers, using the existing `buildControllers` map.
4. **The job runner:** the `onRuleEvent` option, forwarded from `checkToolCall`'s `event` and passed to `makeToolRunner`.
5. **Tests** in `tests/unit/`: `git.test.ts`, `ship.test.ts`, `ship-handlers.test.ts`, a `job-runner.test.ts` addition, and a scan test. They use temp repos made with the git CLI and a bare remote in a temp folder.
6. **Docs** as in Scope, and D38.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| A folder with the lock approved, a `done` ledger and SUMMARY detects as `build-done`; with no lock for it and SUMMARY it detects as `closed` | `src/shared/spec-detect.ts:58-73` |
| `CLOSE` is human-only, maps to `mark-done`, and is legal only from `build-done` to `closed`; `approve-result` has no event | `src/shared/workflow.ts:119,225,256`; D34 |
| The SUMMARY renderer writes a fixed Git state line under `## Git state` | `src/shared/build-docs.ts:275-277` |
| The gate's decision carries a Rule event, and `makeToolRunner` accepts `onRuleEvent`, but the job runner passes neither on | `src/main/policy/gate.ts:21-25`; `src/main/agent/host.ts:140-180,265`; `src/main/workflow/job-runner.ts` |
| index.ts has a `buildControllers` map, empty at startup, and registers the spec handlers only with a root | `src/main/index.ts:173-203` |
| `approve-result` and `mark-done` are D33 ids with no handler | `src/shared/human-actions.ts:9-15`; `docs/human-actions.md` |
| The state file is tracked: `.gitignore` ignores only `.claude/sdd/`, not `docs/specs/.sdd-state.json` | `.gitignore` |
| Only the command modules use `child_process` today | `grep -rln child_process src` gives `commands/network.ts`, `commands/protect.ts` and `tools/run-command.ts` |
| git is on this machine (2.36.1) and on the GitHub runners | `git --version` |
| The plugin stages every file of the work, rewrites the Git state line before the commit, and pushes; close sets `status: done` and clears the approval | the plugin's `skills/build/SKILL.md` "Finish" section; its close script |

## Risks

- **git differs between systems** (a default branch name, `core.autocrlf`, user identity on CI). The tests set `user.name`, `user.email`, `init.defaultBranch` and `core.autocrlf=false` in each temp repo, and the `check` job shows the Linux side.
- **A user's git hook** may change files or fail. A failed commit is reported with a fixed reason. A hook that changes files leaves them for the next approval.
- **The changes.md list** may not match git's paths: the case, the separators, a rename. A mismatch refuses the approval with a fixed reason rather than committing a guess. The tests cover a rename and a file listed but not changed.
- **Temp-repo tests are slow on Windows** under full parallel load, as in p3-build-loop U1. Keep the repos small, and give the slow tests an explicit timeout.

## Open questions

none
