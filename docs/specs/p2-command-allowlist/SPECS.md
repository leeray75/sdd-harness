---
status: done
ticket:
---

# p2-command-allowlist

## Problem

`run_command` is in the writer's and the reviewer's tool sets, but the policy's command check denies every command (D30), and on Windows the runner refuses `.cmd`/`.bat` programs such as the `pnpm` shim (D29). So no job can run the project's tests or build. D6 and the PRD's risk table also require, before commands are allowed, that:

- the spec folder is read-only while a command runs;
- changed files are checked after each command, and anything outside the rules is reverted;
- the code writer has no network.

## Goals

- **G1 (allowlist):** the test and build commands are detected from the project (Node, Python, Go and Rust). The writer may run test and build forms, and the reviewer test forms only, exactly as detected, from the root. Every other command is denied with a fixed reason and logged as a Rule event.
- **G2 (Windows):** allowlisted commands that resolve to a `.cmd`/`.bat` shim run through `cmd.exe` with a command line built only from allowlisted, safe tokens. No agent-chosen string reaches cmd's parser.
- **G3 (file protection):** while a command runs, `docs/specs/` is read-only. Afterwards, changes outside the job's rules are reverted: `docs/specs/**` and the `.git` key files for both jobs, and for the reviewer every file that is not git-ignored.
- **G4 (network):** the writer's commands run with no network, as strongly as the OS allows, and the level reached is reported.
- **G5 (reporting):** every revert, `.git` restore and network level is a Rule event, and the agent's tool result says which areas were reverted.

## Non-goals

- Job prompts and advertising tools to models (`p2-jobs-and-prompts`).
- The human-only channel (`p2-human-only-channel`).
- Real workflow states and the feature slug from the workflow (Phase 3).
- A project settings file and user-edited allowlists (Phase 4).
- Makefiles and other build systems; extra arguments to allowed commands.
- An OS sandbox or container per build (a later option in D6).
- Any UI.

## Design

### Detection (`src/main/commands/detect.ts`)

`detectCommands(files)` takes a small reader over the root (`exists(relPath)`, `readText(relPath)` with a size cap) and returns `{ test: CommandForm[]; build: CommandForm[] }`, where a `CommandForm` is `{ program: string; args: readonly string[] }` and `program` is a bare name. Every type that matches contributes; a missing, unreadable or unparseable marker contributes nothing and never throws.

| Type | Marker | Test forms | Build forms |
| --- | --- | --- | --- |
| Node | `package.json` whose `scripts` has `test` / `build` (string values) | `<pm> test`, `<pm> run test` | `<pm> run build`; also `<pm> build` when `<pm>` is `pnpm`, `yarn` or `bun` |
| Python | `pytest.ini`, a root `conftest.py`, or `[tool.pytest` in `pyproject.toml` | `pytest`; `python -m pytest` | `python -m build`, when `pyproject.toml` contains `[build-system]` |
| Go | `go.mod` | `go test ./...` | `go build ./...` |
| Rust | `Cargo.toml` | `cargo test` | `cargo build` |

`<pm>` is the name before `@` in `package.json`'s `packageManager` field when it is one of `pnpm`, `npm`, `yarn`, `bun`. Otherwise it comes from the lockfile, in this order: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb` or `bun.lock` → `bun`, `package-lock.json` → `npm`. With no lockfile it is `npm`. Node's test forms exist only when `scripts.test` exists, and its build forms only when `scripts.build` exists.

### The command check (`src/main/policy/command-allowlist.ts`, pure)

`makeCommandCheck(detected)` returns a `CommandCheck` that decides in this order, with these fixed reasons:

1. The job is not `writer` or `reviewer`: "this job may not run commands".
2. `cwd` is present and not `.`: "commands run only from the project root".
3. The program contains `/` or `\`, or is empty: "this command is not on the project's allowlist".
4. The call matches a test form: allowed.
5. It matches a build form: allowed for the writer. For the reviewer: "the reviewer may run tests only".
6. Otherwise: "this command is not on the project's allowlist".

A call matches a form when the program's lower-cased base name, with any trailing `.exe`, `.cmd` or `.bat` dropped, equals the form's program, and the arguments equal the form's arguments exactly (same length, same strings, case-sensitive). Reasons never echo the program or arguments.

### Running a command (`src/main/tools/run-command.ts`, `src/main/commands/`)

The router passes the job to the runner: the `ToolRunner` call becomes `{ job, tool, args }`. For `run_command`, the runner does the following, in order. Any refusal returns `failed` with a fixed reason, before anything is started or changed.

1. **Allowlist again:** the runner gets the same `CommandCheck` from the host and refuses a call it denies (a second layer under the gate).
2. **Lookup** (`resolveProgram`): main searches the bare program name in the minimal environment's `PATH`, in order. On Windows it tries each `PATHEXT` extension (default `.COM;.EXE;.BAT;.CMD`) and the name as given. It returns the first regular file found (on POSIX, an executable one), or refuses with "the program was not found on PATH". Git stays refused by name, as in D29.
3. **Windows shims:** when the resolved file ends in `.cmd` or `.bat`, the runner spawns `cmd.exe` (from `%SystemRoot%\System32`) with `['/d', '/s', '/c', line]` and `windowsVerbatimArguments: true`. `line` is `"<resolved path>" token1 token2 ...`, built only when every token matches `^[A-Za-z0-9:_./-]+$` and the resolved path has none of `" % ! ^ & | < > ( )` or a newline. Otherwise it is refused with "this command can't run safely through cmd.exe". Any `.cmd`/`.bat` reached in another way stays refused.
4. **Snapshot and lock:**
   - Collect the protected set for the job:
     - both jobs: every file under `docs/specs/`, and `.git/HEAD`, `.git/config`, `.git/packed-refs`, `.git/hooks/**`, `.git/refs/**`;
     - reviewer only: every other file in the root that is not under `.git` or `node_modules` and not git-ignored.
   - The snapshot holds each file's path, bytes and mode. It is limited to 256 MiB in total; over the cap, the command is refused with "the project is too large to protect while this command runs".
   - Git-ignored files come from main running git read-only (an argument array, `shell: false`, the minimal environment): `git -C <root> ls-files -z --others --ignored --exclude-standard --directory`. If git is missing, or the root is not a repository, only `node_modules` and `.git` are skipped.
   - Make the `docs/specs/` tree read-only: on POSIX, remove every write bit from its files and folders; on Windows, set the read-only attribute on its files.
5. **Network** (writer only; `src/main/commands/network.ts`):
   - Linux: when a one-time probe (`unshare --user --map-root-user --net true` exits 0) succeeds, wrap the program in `unshare --user --map-root-user --net`, bringing loopback up first. The level is `os`.
   - macOS: when `/usr/bin/sandbox-exec` exists, wrap in it with a profile that allows everything except outbound network to non-loopback addresses. The level is `os`.
   - Otherwise, the level is `proxy-only`.
   - On every OS, the writer's environment also gets dead proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and their lower-case forms, set to `http://127.0.0.1:9`; `NO_PROXY` and `no_proxy` empty) and offline flags (`npm_config_offline=true`, `YARN_ENABLE_OFFLINE_MODE=1`, `CARGO_NET_OFFLINE=true`, `GOPROXY=off`, `PIP_NO_INDEX=1`).
   - The reviewer's commands get no network limit.
6. **Run** as in D29: argument array, timeout and tree kill, output tail.
7. **Restore** (always, after exit, timeout or a start failure, once anything was locked):
   - put back the original modes of the locked tree;
   - compare the protected set with the snapshot: restore changed files' bytes and mode, re-create deleted files (with their folders), and delete created files (in the protected areas, including empty folders created there);
   - one Rule event for each restored or deleted path.
8. **Result:** the tool output as in D29, followed by one fixed line per area that was reverted: "reverted changes in docs/specs", "reverted changes in .git", "reverted changes to project files".

### Rule events

`RuleEvent` gains two kinds next to the allow and deny decision events, reported through the same sink and sanitized as in D30:

- **revert:** `{ kind: 'revert', job, tool: 'run_command', target: <path>, reason }`, with the reason "a command changed a protected file" (the action is `restored`, `re-created` or `deleted`). Logged as an error.
- **network:** `{ kind: 'network', job: 'writer', tool: 'run_command', target: <program>, level: 'os' | 'proxy-only' }`. Logged as info for `os` and as a warning for `proxy-only`.

`formatRuleEvent` renders them as `rule reverted: ...` and `rule network: ...` lines, in the same field style.

### Host wiring

`startAgentHost` detects the commands once from the root and builds the policy context with `makeCommandCheck(detected)` in place of `denyAllCommands`, and gives the runner the same check. With no root, the host keeps `DEFAULT_POLICY_CONTEXT`, which stays deny-all.

## Acceptance criteria

- **AC1 (detection):**
  - `detectCommands` returns the forms in the Detection table for each type, and each package manager from the `packageManager` field and from each lockfile.
  - Missing scripts, a missing marker, and an invalid `package.json` or `pyproject.toml` give no forms and don't throw.
  - A mixed repo gets every matching type.
- **AC2 (check):** `makeCommandCheck` follows the six ordered steps with their exact reasons:
  - the writer may run every detected test and build form;
  - the reviewer may run test forms only, and gets "the reviewer may run tests only" for a build form;
  - planner and reader are denied;
  - extra arguments, changed arguments, a path as the program, and a `cwd` other than `.` are denied.
  - Matching ignores case and `.exe`/`.cmd`/`.bat` on the program's base name only.
  - Reasons don't echo the call.
- **AC3 (gate and host):** through the gate with a context built from a detected allowlist, an allowed `run_command` gives an allow Rule event, and a denied one gives a deny event with the check's reason. The host uses the detected check, and the deny-all default remains for no root.
- **AC4 (lookup and Windows):**
  - `resolveProgram` finds a program on `PATH` (with `PATHEXT` on Windows, tested with the platform as a parameter), and refuses a missing one with the fixed reason.
  - The `cmd.exe` line is built only from safe tokens and a safe resolved path. A token or path with any listed metacharacter or a space in a token is refused.
  - On Windows, an allowlisted command that resolves to a `.cmd` stub in a temp folder runs and returns its output; elsewhere this test is skipped.
- **AC5 (spec lock and restore):** on a temp root, a stub command (a Node script on the allowlist) that edits, creates and deletes files under `docs/specs/` leaves the folder byte-for-byte and mode-for-mode as it was. The tool result has "reverted changes in docs/specs", and there is one revert event per path. During the run, the spec files are read-only, checked by the stub.
- **AC6 (`.git` key files):** a stub command that changes `.git/HEAD`, a ref and a hook, and adds a hook, has them restored or removed. `.git/index` is not touched by the check.
- **AC7 (reviewer revert):**
  - For the reviewer, a stub that edits a tracked source file, creates a new non-ignored file and deletes one has all three reverted.
  - A file it writes to a git-ignored path and under `node_modules` is kept.
  - For the writer, the same source changes are kept.
  - Without git, only `node_modules` is skipped.
  - Over the snapshot cap (lowered for the test), the reviewer's command is refused before it starts.
- **AC8 (restore always):** restore runs after a timeout and after a start failure, and the modes of `docs/specs/` are back to their originals in every case.
- **AC9 (network):**
  - The wrapper choice is a pure function of the platform and probe results: Linux with a working probe gives `unshare` and `os`; macOS with `sandbox-exec` gives `os`; anything else gives `proxy-only`.
  - The writer's environment has the proxy and offline variables, and the reviewer's doesn't.
  - Where the OS method is available (otherwise skipped), a writer's stub that tries to connect to a non-loopback address fails, and one that opens a loopback server succeeds.
  - Each writer command gives one network Rule event with the level.
- **AC10 (router):** the router passes the job to the runner; the existing router and reachability tests still pass.
- **AC11 (docs):** `docs/decisions.md` has D31, covering:
  - the allowlist and detection;
  - the Windows rule;
  - the lock, snapshot and revert per job;
  - main's read-only git query;
  - how "no network for the writer" is enforced on each OS, and what is best effort;
  - the crash note.

  D29's open question names D31 as settling it.
- **AC12 (changelog and project docs):** updated in the build, on the feature branch, not after the merge.
  - **`CHANGELOG.md`:** entries under `## [Unreleased]` for this subtask, under Added, Changed and Known issues as they apply, naming the feature and D31. The Known issue about `run_command` refusing `.cmd`/`.bat` on Windows is removed. New known issues are added, such as the best-effort network level and the read-only bits a crash can leave behind.
  - **New reference page, `docs/agent-commands.md`:** for developers and pilot users. It covers:
    - which commands each job may run, per project type;
    - what is protected while a command runs, and what is reverted;
    - the network limit on each OS and what is best effort;
    - how to recover read-only bits left by a crash.

    It links to D6, D29 and D31.
  - **Stale docs:** every other doc that this work makes stale is updated in the same change. At least these are checked:
    - `CLAUDE.md`;
    - `README.md`;
    - `docs/PRD.md`;
    - `docs/workflow.md`;
    - `docs/phases/phase-02-tool-policy.md`;
    - the follow-ups in `docs/phases/phase-02-progress.md`: the Windows `.cmd` and the network items are marked settled, and the subtask's status and commit are left for after the merge.

    The summary lists each doc checked and whether it changed.
- **AC13 (checks):** typecheck, lint, format check and unit tests pass.

## Open questions

- none
