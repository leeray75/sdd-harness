# Summary Report: p4-env-local

Ticket: none   Date: 2026-11-25
Outcome: Clean
Review rounds: 2 of 3 in revision 1 (0 in revision 0); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

One environment interface (`Environment`, in `src/main/env/`) now covers paths, files, programs, watching and git for a project. Its local backend keeps today's behaviour: the same error codes, containment and symlink rules, Windows shim, timeouts, tree kill (now async, without `execFileSync`) and network limit (G1, G2).

- Every module that touched a project reaches it only through the environment, which it gets as a required first parameter (G3). The tools, the command runner and the agent host get `ToolEnvironment`, which has no git part. Git still runs only from `src/main/git/` (G4).
- The project registry makes and holds one environment per project, adds `environmentOf`, and refuses a project whose environment cannot be made.
- The phase 3 headless walk now runs through the registry's environment and handlers (G5).
- The docs are updated, with D41 and the new `docs/environments.md` (G6).

## Files changed

Product files (group 1):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/env/types.ts | created | `Environment` and `ToolEnvironment` and their parts; `files` also has `readlink`, `symlink`, `rmdir` for the protected-set restore | T1, T4 |
| src/main/env/local.ts | created | Local backend: node:path, node:fs, spawn with timeout and async tree kill, the network limit, git bound from git.ts; a capped `readFile` raises `EFBIG` | T1 |
| src/main/env/index.ts | created | `environmentFor` (local only, a fixed refusal otherwise), `localEnvironment`, `toolEnvironment` | T1 |
| src/main/env/probes.ts | created | The `unshare` and `sandbox-exec` probes, moved here so commands/network.ts is pure | T9 |
| src/main/tools/atomic-write.ts | edited | `writeFileAtomic(files, …)`, same steps and constants | T2 |
| src/main/tools/paths.ts | edited | Containment over `env.path` and `env.files`; the rules and reasons are unchanged | T2 |
| src/main/tools/walk.ts | edited | Walks through the environment | T2 |
| src/main/projects/store.ts | edited | The save uses the shared writer with `localEnvironment().files`. The secret store is unchanged (revision 1) | T2, T8 |
| src/main/tools/read-file.ts | edited | Takes the tool environment first | T3 |
| src/main/tools/write-file.ts | edited | Takes the tool environment first | T3 |
| src/main/tools/edit-file.ts | edited | Takes the tool environment first | T3 |
| src/main/tools/list-files.ts | edited | Takes the tool environment first | T3 |
| src/main/tools/search-text.ts | edited | Takes the tool environment first | T3 |
| src/main/tools/run-command.ts | edited | Spawns through `env.process.spawn` with the `network` option; the spawn, timeout and kill code moved to the backend; the checks, rule events and reasons are unchanged | T4 |
| src/main/commands/detect.ts | edited | `rootMarkerFiles(env, root)` is async | T4 |
| src/main/commands/lookup.ts | edited | `resolveProgram(env, …)` is async over `files` | T4 |
| src/main/commands/protect.ts | edited | Over `files` and `env.ignoredEntries`; no longer imports git | T4 |
| src/main/commands/network.ts | edited | Pure: no child_process or fs import | T4, T9 |
| src/main/agent/host.ts | edited | `commandPolicyFor(env, root, live?)` and `startAgentHost(env, live?)` are async; the tool dispatch passes the environment | T3, T5 |
| src/main/workflow/job-runner.ts | edited | Options take `env` | T5 |
| src/main/workflow/app-runner.ts | edited | Options take `env`; `createAppJobRunner` is async | T5 |
| src/main/workflow/spec-folders.ts | edited | Takes the environment first | T6 |
| src/main/workflow/spec-lock.ts | edited | Takes the environment first | T6 |
| src/main/workflow/spec-watch.ts | edited | Watches through `env.watch.watchDir` | T6 |
| src/main/workflow/build-loop.ts | edited | Controller options take `env`, for the lock helpers | T6 |
| src/main/human/spec-handlers.ts | edited | Deps gain `env` | T6 |
| src/main/workflow/ship.ts | edited | Git through `env.git`, files through `env.files` and `env.path`; reasons and steps unchanged | T7 |
| src/main/human/ship-handlers.ts | edited | Deps gain `env` | T7 |
| src/main/projects/registry.ts | edited | Takes `environmentFor`; one environment per project; `environmentOf`; refuses a project whose environment fails | T8 |
| src/main/index.ts | edited | Passes `environmentFor`, and builds the watcher, handlers and agent host with the environment | T5, T8 |
| tests/support/recording-env.ts | created | AC6 recording backend | T9 |
| tests/unit/env-local.test.ts | created | AC5 local backend tests, including the atomic writer | T1, T9 |
| tests/unit/env-boundary.test.ts | created | AC2 scans. Round 1 widened them to every import form and to `./network` | T9, R1-1, R1-2 |
| tests/unit/env-recording.test.ts | created | AC6: tools, run_command, the lock and the watcher through the recording backend | T9 |
| tests/unit/headless-e2e.test.ts | edited | The walk runs through a registry, `environmentOf` and `handlerFor`; assertions unchanged | T9 |
| tests/unit/project-registry.test.ts | edited | New deps; the AC8 cases added | T8 |
| tests/unit/ship.test.ts | edited | Passes the environment; an AC6 approve-result case through the recording backend | T7, T9 |
| tests/unit/tool-files.test.ts | edited | Passes the environment; three list_files cap tests get a 60 s timeout | T3, T11 |
| tests/unit/command-network.test.ts, command-acceptance.test.ts | edited | Import `probeNetwork` from env/probes.ts; pass and await the environment; assertions unchanged | T4, T5, T9 |
| tests/unit/{app-runner, build-loop, command-detect, command-lookup, command-protect, host-context, human-text-acceptance, job-runner, plugin-folder-states, policy-acceptance, read-file, ship-handlers, spec-folders, spec-handlers, spec-lock, spec-watch, tool-command, tool-paths, tool-reachability, tool-write}.test.ts, tests/live/spike.live.test.ts | edited | Wiring only: pass or await the environment; assertions unchanged (AC3) | T2–T7 |
| docs/environments.md | created | The interface, the backend contract, and the checklist for the WSL, SSH and container backends | T10 |
| docs/decisions.md | edited | D41, with notes under D29, D31 and D38; the secret store's save stated in D41 and under D29 | T10, T2 |
| docs/workflow-engine.md | edited | The lock, ship, registry and headless run with the environment; the code map | T10 |
| docs/agent-commands.md | edited | Where the network limit is applied, and what a remote backend must do | T10 |
| docs/phases/phase-04-progress.md | edited | Row 2, D41 and this subtask's follow-ups | T10, T2 |
| docs/phases/phase-04-projects.md | edited | Points to the adopted split and to D41 | T10 |
| CLAUDE.md | edited | The read list and the rule that every project is reached through its environment | T10 |
| README.md | edited | The phase 4 status and a link to docs/environments.md | T10 |
| docs/PRD.md | edited | F3 progress and a link to docs/environments.md | T10 |
| CHANGELOG.md | edited | An Unreleased (Changed) entry for the environment interface | T10, T2 |

Workflow files (group 2):

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p4-env-local/PLAN.md | created | The approved plan | plan |
| docs/specs/p4-env-local/SPECS.md | created | The approved spec; revision 1 amended the secret store's save | plan, revision 1 |
| docs/specs/p4-env-local/SUBTASK.md | created | Child-ticket draft (no tracker) | plan |
| docs/specs/p4-env-local/tasks.md | created | T1–T11, all ticked; T2 revised in revision 1 | plan, all |
| docs/specs/p4-env-local/build-ledger.md | created | The build ledger | build |
| docs/specs/p4-env-local/changes.md | created | The implementor's record of touched files | build |
| docs/specs/p4-env-local/SUMMARY.md | created | This report | build |

Git and `changes.md` agree: every file git shows is in `changes.md`, and every row is in git.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 interface types | Met | `src/main/env/types.ts`; the extra members are listed under Deviations |
| AC2 boundary scan | Met | `tests/unit/env-boundary.test.ts`, widened in round 1; only env, git and the two stores import fs or child_process |
| AC3 behaviour unchanged | Met | Full suite: 1682 passed, 15 skipped. The implementor's diff review and the reviewer's per-file expect counts found no changed assertion |
| AC4 git-boundary unchanged | Met | `tests/unit/git-boundary.test.ts` is not in the diff |
| AC5 local backend tests | Met | `tests/unit/env-local.test.ts` |
| AC6 recording backend | Met | `tests/support/recording-env.ts`, `env-recording.test.ts` and the approve-result case in `ship.test.ts` |
| AC7 headless walk through the registry | Met locally | `headless-e2e.test.ts` passes; CI on three OSes runs after the push |
| AC8 registry cases | Met | `project-registry.test.ts` (13 tests) |
| AC9 docs | Met | CHANGELOG, D41 and its notes, docs/environments.md, workflow-engine.md, agent-commands.md, CLAUDE.md, README, PRD, the phase doc and the progress file |
| AC10 checks | Met locally | typecheck, lint, format:check, test, e2e (21 passed, 2 skipped, macOS-only); CI not yet run |

## Needs a runtime check

- Windows async `taskkill` timeout path: the timeout result now returns after taskkill finishes. Confirm that a timed-out tree is dead before the result. `env-local.test.ts` covers this and passed locally.
- `headless-e2e` failed once under full parallel load with "the build step could not finish". It did not reproduce. Watch for it in CI; repeated loaded runs would settle it.

## Review ledger

### Revision 1, round 1 (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor (optional) | tests/unit/env-boundary.test.ts:50 | ACCEPT | The fs scan missed unprefixed, side-effect, require() and dynamic import() forms | Added `SYSTEM_IMPORT` covering every form |
| R1-2 | minor (optional) | tests/unit/env-boundary.test.ts:65 | ACCEPT | The network scan missed `./network` inside commands | Added that check |
| note: index.ts hardcodes `{ kind: 'local' }` | note | src/main/index.ts | REJECT, no change | The spec's App section names the dev project as local; the host can start without one | none |
| note: `options.platform` | note | src/main/tools/run-command.ts | AGREE, no change | A test seam; production never passes it | none |

### Revision 1, round 2 (PASS)

No findings. The reviewer confirmed both fixes and checked that the new patterns don't match legitimate imports.

## Spec revisions

- Revision 1 (paused before any review): the spec routed the secret store's save through the async shared writer, which would have dropped its `0o600` mode. The user chose to revise the spec, with this decision: the secret store keeps its own synchronous save, and only the project store uses `writeFileAtomic`. The options not taken were a mode option with an async secret store, and a synchronous writer in the local backend.

## Rejected findings

- The reviewer's note on the hardcoded `{ kind: 'local' }` in `src/main/index.ts` for the agent host. The implementor kept it: the spec says the dev project is local, and the host must start even without a dev project, so `environmentOf` (which can return null) does not fit. The reviewer accepted this in round 2.

## Open issues

None. Deviations noted for your review, all recorded in the progress file's follow-ups:
- interface members beyond the Design's list: `files.readlink`, `symlink`, `rmdir`, `process.networkLevel()`, and `EFBIG` on a capped read;
- the probes moved to `src/main/env/probes.ts`;
- `node:path` is still imported in `commands/lookup.ts` and `agent/host.ts`, for non-project paths;
- three list_files cap tests got a 60 s timeout;
- the AC8 cases were appended with a Bash heredoc.

## Git state

feature/p4-env-local; approved; committed and pushed in the commit that adds this report.

## Next steps

Approve, commit and push; or request changes; or not yet.
