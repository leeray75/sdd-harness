# Changes: p4-env-local

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/env/types.ts | created | The `Environment` and `ToolEnvironment` interface and its parts (paths, files, process, watch, git), with no Electron import. `files` also carries `readlink`, `symlink` and `rmdir`, which the protected-set restore needs (not in the Design's list). | T1, T4 |
| src/main/env/local.ts | created | The local backend: node:path, node:fs, the spawn with timeout and tree kill (taskkill now async, and the timeout reports after the kill), the network limit through commands/network.ts, and the git functions bound from git.ts. `readFile` with a byte cap raises `EFBIG`. | T1 |
| src/main/env/index.ts | created | `environmentFor` (local only, fixed refusal otherwise), re-export of `localEnvironment`, and `toolEnvironment`. | T1 |
| src/main/env/probes.ts | created | The `unshare` and `sandbox-exec` probes moved out of commands/network.ts, so that module has no child_process or fs import (AC2). | T9 |
| tests/unit/env-local.test.ts | created | AC5 checks on temp folders: error codes, spawn with no shell and tree kill, watcher close, environmentFor refusal, and writeFileAtomic over the local files (atomic write and busy-rename retry). | T1, T9 |
| tests/support/recording-env.ts | created | AC6 recording backend: wraps the local backend and records every call by part and method. | T9 |
| tests/unit/env-boundary.test.ts | created | AC2 scans: only the environment and the two stores import node:fs, node:fs/promises or node:child_process; only the environment imports the network module; tools, commands, the agent and the agent side never name git. Round 1: the import scan also covers side-effect imports, require() and dynamic import(), with or without node:; the network scan also covers './network' inside commands. | T9, R1-1, R1-2 (round 1) |
| tests/unit/env-recording.test.ts | created | AC6 checks through the recording backend: file tools through files, run_command through process.spawn, the spec lock through files, the watcher through watch. | T9 |
| docs/environments.md | created | The interface parts, the backend contract, how environmentFor and the registry pick and hold a backend, and the checklist for the WSL, SSH and container backends (AC9). | T10 |
| docs/specs/p4-env-local/changes.md | created | The record of the files this build touched. | T1, T10 |
| docs/specs/p4-env-local/tasks.md | edited | Ticked T1 after its check passed, then T3 to T11 as each check passed. Revision 1: T2 ticked once the secret store's own save was confirmed unchanged and its check passed. | T1, T3–T11, T2 (revision 1) |
| src/main/tools/atomic-write.ts | edited | `writeFileAtomic(files, path, bytes, options)` keeps the same steps and constants, over the environment's files part. | T2 |
| src/main/tools/paths.ts | edited | `resolveInRoot` and `isInside` take the tool environment and use its path and files parts; the rules and reasons are unchanged. The native realpath is kept through the local files part. | T2 |
| src/main/tools/walk.ts | edited | `walkFiles` takes the tool environment and walks through its files and path parts. `globToRegExp` is unchanged. | T2 |
| src/main/projects/store.ts | edited | The save calls the shared atomic writer with `localEnvironment().files`. The store's own reads and set-aside renames stay on node:fs. | T2, T8 |
| src/main/tools/read-file.ts | edited | `readFileInRoot` takes the tool environment as its first parameter and reads through its files part. | T3 |
| src/main/tools/write-file.ts | edited | `writeFileInRoot` takes the tool environment first; its checks go through files and path, and its write through the atomic writer. | T3 |
| src/main/tools/edit-file.ts | edited | `editFileInRoot` takes the tool environment first; reads, stats and the atomic write go through it. | T3 |
| src/main/tools/list-files.ts | edited | `collectMatchingFiles` and `listFilesInRoot` take the tool environment first. | T3 |
| src/main/tools/search-text.ts | edited | `searchTextInRoot` takes the tool environment first and reads through its files part. | T3 |
| src/main/tools/run-command.ts | edited | `runCommandInRoot` takes the tool environment first. Its own spawn, timeout and tree-kill code moved to the local backend; it spawns through `env.process.spawn` with the `network` option, and keeps its checks, rule events, reasons and output shaping. | T4 |
| src/main/commands/detect.ts | edited | `rootMarkerFiles(env, root)` is async: it reads the root's own files once through the environment, so `detectCommands` stays pure. | T4 |
| src/main/commands/lookup.ts | edited | `resolveProgram(env, program, vars, platform)` is async and checks files through `files.stat` and `access`. Its pure helpers are unchanged. | T4 |
| src/main/commands/protect.ts | edited | Snapshot, lock and restore take the tool environment and use its files, path and `ignoredEntries`; the git import is gone. The reasons and the restore order are unchanged. | T4 |
| src/main/commands/network.ts | edited | Pure again: the probes moved to env/probes.ts, so the module has no child_process or fs import. Choice, wrappers and proxy values are unchanged. | T4, T9 |
| src/main/agent/host.ts | edited | `makeToolRunner(env, root, options)` takes the environment and passes the tool view to each tool; `commandPolicyFor(env, root, live?)` is async; `startAgentHost(env, live?)` reads the policy before the fork. | T3, T5 |
| src/main/workflow/job-runner.ts | edited | `JobRunnerOptions` takes `env`, which the tool runner uses. | T5 |
| src/main/workflow/app-runner.ts | edited | `AppJobRunnerOptions` takes `env`; `createAppJobRunner` is async, since the policy is read first. | T5 |
| src/main/workflow/spec-folders.ts | edited | `readSpecFolderAt`, `readSpecFolder` and `scanSpecFolders` take the environment first and read through its files and path parts. | T6 |
| src/main/workflow/spec-lock.ts | edited | Every read, hash and write takes the environment first and goes through its files part. `writeAtomic` keeps its temp name and its reasons. | T6 |
| src/main/workflow/spec-watch.ts | edited | `createSpecLockWatcher` takes `env` in its options and watches through `env.watch.watchDir`. A watcher that errors is still closed, and the next refresh arms it again. | T6 |
| src/main/workflow/build-loop.ts | edited | `BuildControllerOptions` and the controller take `env`, passed to the lock helpers. The spec said build-loop changes only where a caller's signature does; it calls the lock helpers, so it takes the environment too. | T6 |
| src/main/human/spec-handlers.ts | edited | `SpecHandlersDeps` gains `env`, which the handlers pass to the lock helpers. | T6 |
| src/main/workflow/ship.ts | edited | `approveResult` and `markDone` take the environment first; git calls go through `env.git` and file calls through `env.files`/`env.path`. Reasons, step order and commit messages are unchanged. Only `isRepoPath` and the failure type are still imported from git.ts. | T7 |
| src/main/human/ship-handlers.ts | edited | `ShipHandlersDeps` gains `env`, passed to each step. | T7 |
| src/main/projects/registry.ts | edited | Takes `environmentFor` and `startLock(env, root)`. Each project's environment is made once and held with its root; `environmentOf` is added; a project whose environment cannot be made gets no entry, and `addProject` refuses it before storing. | T8 |
| src/main/index.ts | edited | Passes `environmentFor` to the registry, builds the watcher and both handler sets with the project's environment, and starts the agent host with the dev project's environment. | T5, T8 |
| tests/unit/project-registry.test.ts | edited | Deps gain `environmentFor` and the new `startLock` signature; the AC8 cases are appended (environmentOf, and a refused environment refused by handlerFor with no watcher). | T8 |
| tests/unit/headless-e2e.test.ts | edited | Builds a registry with one local project in the temp repo, takes the environment with `environmentOf`, and runs the walk through the registry's handlers and lock watcher. Assertions are unchanged; the walk's live supplier reads the watcher, and the temp registry is closed after each test. | T9 |
| tests/unit/ship.test.ts | edited | Calls pass `localEnvironment()`; a new AC6 case runs approve-result through the recording backend (git calls, SUMMARY.md read and rename). | T7, T9 |
| tests/unit/ship-handlers.test.ts | edited | Handler deps gain `env`. | T7 |
| tests/unit/command-network.test.ts | edited | Imports `probeNetwork` from its new module (env/probes.ts); the assertions are unchanged. | T9 |
| tests/unit/command-acceptance.test.ts | edited | Runner and policy calls pass the environment and await `commandPolicyFor`; imports `probeNetwork` from env/probes.ts. Assertions are unchanged. | T4, T5 |
| tests/unit/command-detect.test.ts | edited | `rootMarkerFiles` calls pass the environment and are awaited. Assertions are unchanged. | T4 |
| tests/unit/command-lookup.test.ts | edited | `resolveProgram` takes the environment (fake files from the same path set) first and is awaited; runner calls pass the environment. Assertions are unchanged. | T4 |
| tests/unit/command-protect.test.ts | edited | Snapshot, lock, restore and ignored-entries calls pass the environment. Assertions are unchanged. | T4 |
| tests/unit/tool-command.test.ts | edited | The local runner wrapper passes the tool environment. Assertions are unchanged. | T4 |
| tests/unit/tool-files.test.ts | edited | File-tool calls pass the tool environment; the list_files cap tests (1,000 entries) get a 60 s timeout, since they time out at the default under full parallel load. Assertions are unchanged. | T3, T11 |
| tests/unit/tool-write.test.ts | edited | Write and edit calls pass the tool environment; the atomic-write calls pass `localEnvironment().files`. Assertions are unchanged. | T2, T3 |
| tests/unit/tool-paths.test.ts | edited | `resolveInRoot` calls pass the tool environment. Assertions are unchanged. | T2 |
| tests/unit/tool-reachability.test.ts | edited | The host runner is built with the environment. Assertions are unchanged. | T3 |
| tests/unit/read-file.test.ts | edited | `readFileInRoot` calls pass the tool environment. Assertions are unchanged. | T3 |
| tests/live/spike.live.test.ts | edited | The spike's `readFileInRoot` call passes the tool environment. | T3 |
| tests/unit/app-runner.test.ts | edited | The app runner is built with the environment and awaited. Assertions are unchanged. | T5 |
| tests/unit/job-runner.test.ts | edited | Runner options carry the environment. Assertions are unchanged. | T5 |
| tests/unit/build-loop.test.ts | edited | Controller and runner options carry the environment; the lock helpers take it. Assertions are unchanged. | T5, T6 |
| tests/unit/host-context.test.ts | edited | `commandPolicyFor` calls pass the environment and are awaited; the three tests are async. Assertions are unchanged. | T5 |
| tests/unit/human-text-acceptance.test.ts | edited | Setup builds the policy and the runner with the environment; setup is async and awaited. Assertions are unchanged. | T5 |
| tests/unit/policy-acceptance.test.ts | edited | The runner is built with the environment. Assertions are unchanged. | T5 |
| tests/unit/spec-folders.test.ts | edited | Folder reads pass the environment. Assertions are unchanged. | T6 |
| tests/unit/spec-handlers.test.ts | edited | Handler deps and lock reads pass the environment. Assertions are unchanged. | T6 |
| tests/unit/spec-lock.test.ts | edited | Lock helpers pass the environment. Assertions are unchanged. | T6 |
| tests/unit/spec-watch.test.ts | edited | Watchers are built with the environment; lock helpers pass it. Assertions are unchanged. | T6 |
| tests/unit/plugin-folder-states.test.ts | edited | Lock helpers pass the environment. Assertions are unchanged. | T6 |
| docs/workflow-engine.md | edited | Spec lock, ship and the registry note the environment (D41); the headless run describes the registry walk; the code map lists src/main/env and its tests. | T10 |
| docs/agent-commands.md | edited | The network limit section says where the limit is applied (the local backend and its probes) and what a remote backend must do. | T10 |
| docs/decisions.md | edited | D41 added; short notes under D29, D31 and D38 point to it. Revision 1: D41 and the D29 note now both state that the secret store keeps its own synchronous `0o600` save. | T10, T2 (revision 1) |
| docs/phases/phase-04-progress.md | edited | Row 2 is in build with its spec link; D41 is listed under decisions added; the follow-ups for this subtask are added (the interface additions, the moved probes, node:path imports, the registry refusal, and the flaky-load note). Revision 1: the secret-store follow-up now records the decision. | T10, T2 (revision 1) |
| docs/phases/phase-04-projects.md | edited | A note under the suggested subtasks points to the adopted split and to D41. | T10 |
| CLAUDE.md | edited | The read list points to D41 and docs/environments.md; a rule states that every project is reached through its environment. | T10 |
| README.md | edited | The phase 4 status names this subtask and links docs/environments.md. | T10 |
| docs/PRD.md | edited | F3 notes what is built so far (the interface and local backend) and links docs/environments.md. | T10 |
| CHANGELOG.md | edited | An entry under Unreleased (Changed) for the environment interface. Revision 1: the entry states that the secret store keeps its own save. | T10, T2 (revision 1) |
