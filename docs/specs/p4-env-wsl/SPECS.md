---
status: done
ticket:
---

# p4-env-wsl

## Problem

F3 needs projects that live inside a WSL distribution. Since `p4-env-local`, every module that works in a project reaches it through an `Environment` (D41), but the only backend is local. `environmentFor` refuses any other kind, and the project store accepts only `{ kind: 'local' }`, with roots checked by local `fs.stat` and `node:path`. A repository at `/home/<user>/project` inside Ubuntu cannot be added, and no tool, command, lock, watcher or git call can reach it.

## Goals

- **G1:** A WSL backend implements the whole `Environment` interface for one distribution and a Linux root. It keeps the backend contract and meets every item in the checklist in `docs/environments.md`.
- **G2:** WSL detection (installed, the distributions with their versions, the default one) is available for the add wizard. It runs only when called.
- **G3:** The project store and registry accept a WSL project, `{ kind: 'wsl', distribution }`, with a Linux root checked through its environment.
- **G4:** git in a WSL project runs from `src/main/git/` with the same argument lists, parsing and failure codes as locally.
- **G5:** The phase 3 headless walk runs on a project inside WSL, through the registry, in an opt-in live test.
- **G6:** The docs are updated in the same change, with D42 for how the backend reaches WSL.

## Non-goals

- SSH and dev container backends.
- The unreachable and read-only project state, and Reconnect (`p4-env-ssh`).
- The add wizard UI and its use of `detectWsl` (`p4-add-project-wizard`), and any project UI or IPC (`p4-projects-screen`).
- Starting a stopped distribution on purpose. `wsl.exe` may start it as a side effect of a call.
- Any change to the tools, commands, agent host, spec lock, watcher or ship modules beyond what the store and registry need. They already take an `Environment`. The one exception is the spec lock's atomic write, which gets the shared writer's rename retry (revision 1, see "Spec lock atomic write").
- A change to the local backend's behaviour.

## Design

### D42: how the backend reaches WSL

- **Files** use `node:fs` on the distribution's share: `\\wsl.localhost\<distro>`, or `\\wsl$\<distro>` when the first is missing. The share root is found once, when the backend is made, not at import.
- **Programs and git** run through `wsl.exe`.
- **Watching** polls one folder.
- The mapping between Linux paths and share paths lives only in `src/main/env/wsl.ts`.

### Detection (`src/main/env/wsl-detect.ts`)

`detectWsl(): Promise<WslInfo>`, where `WslInfo` is either `{ installed: false }` or `{ installed: true, distributions: { name, version: 1 | 2, isDefault }[] }`.

- It runs `wsl.exe --list --verbose` with an argument array, no shell and a timeout. The output is decoded from UTF-16LE, without a BOM, and parsed: the `*` marks the default distribution.
- Off Windows, when `wsl.exe` is missing, or when the call fails or times out, it returns `{ installed: false }` and never throws.
- A distribution whose name fails `isDistributionName` is left out of the list.
- Nothing calls it at import time or at app start.

`isDistributionName(name)` checks the pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. It lives in the same module and is shared with the store and `environmentFor`.

### The WSL backend (`src/main/env/wsl.ts`)

`createWslEnvironment({ distribution, transport }): Environment`. Its `WslTransport` has two members:

- `shareRoot`: the folder that stands for the distribution's `/`. In the app this is the UNC share root; in tests it is a temp folder.
- `run(argv, { env, timeoutMs, signal, onOutput, stdin? })`: starts `wsl.exe` with the given argument array and no shell. It resolves `{ started: false }` or `{ started: true, code, signal, stdout?, timedOut, aborted }` and never rejects.

`appWslTransport(distribution)` is the app's transport. It is the only code that spawns `wsl.exe`, apart from detection.

**path.** `path.posix`, with `sep` `/`.

**files.**
- Each Linux path must be absolute POSIX. It maps to `shareRoot` plus its segments. A path that is not absolute fails with `ENOENT`.
- `stat`, `lstat`, `access`, `readFile`, `open`, `writeFile`, `mkdir`, `readdir`, `rm`, `rmdir` and `rename` call `node:fs` on the mapped path. The Node codes pass through unchanged.
- `realpath` and `readlink` map the result back to a Linux path. A result outside the share fails with `ENOENT`.
- `readFile` with `maxBytes` stats the file first and refuses a larger file with `EFBIG`, before any byte is read.
- `symlink` and `chmod` run a fixed Linux command through the transport: `ln -s -- <target> <path>`, or `chmod <octal> -- <path>`. Exit 0 is success. Anything else fails with a Node-coded error: `EEXIST` when the path exists, `ENOENT` when its folder does not, otherwise `EIO`.

**process.**
- `platform` is `'linux'`.
- `spawn(file, argv, options)` calls `transport.run`. The arguments are `-d <distro> --cd <cwd> --exec sh -c <LAUNCHER> sh <file> <args…>`.
  - `LAUNCHER` is a constant script. It prints one line with a fixed marker and the id of the process group it creates, then runs `"$@"` under `setsid --wait`, or the equivalent that keeps the program as the group leader, and passes on its exit status.
  - The arguments are positionals, so the shell never parses them.
  - The marker line is taken out of the output and not passed to `onOutput`.
- **Environment.** Only the variables in `options.env` that are missing from, or differ from, the app's own `process.env` are put on the `wsl.exe` process. Their names are joined into `WSLENV`, with no path translation flags. `PATH`/`Path` never cross. No value appears in the argument array.
- **Timeout or abort.** The backend runs `transport.run(['-d', <distro>, '--exec', 'kill', '-KILL', '--', '-<pgid>'])`, then kills the `wsl.exe` child, then resolves `{ timedOut }` or `{ aborted }`. Output that arrives after that is not passed on. If the group id never arrived, it kills the `wsl.exe` child only, and still resolves.
- **Network.** `network: 'none'` uses the result of a probe that runs once per backend: `unshare --user --map-root-user --net true` through the transport, where exit 0 means it works.
  - When the probe works, the level is `os`, and the program is wrapped with `chooseNetwork('linux', …)` and `wrapCommand` from `src/main/commands/network.ts` inside the launcher's `"$@"`.
  - When it fails, the level is `proxy-only`.
  - Either way, `writerNetworkEnv()` is added, and crosses through `WSLENV`.
  - `networkLevel()` returns the same level.
- A transport that cannot start gives `{ started: false }`.

**watch.** `watchDir(path, onEvent, onError)` lists the folder through `files.readdir` and `files.stat` about every 1,000 ms, and compares the names, sizes and mtimes with the last listing.
- A new name or a removed name is reported as `rename`, and a changed size or mtime as `change`.
- The first listing is the baseline and reports nothing.
- A failed listing calls `onError` once for each run of failures, with no events, and the polling goes on.
- `close()` clears the timer, and no callback runs after it.

**git.** `src/main/git/git.ts` gains a `GitLauncher` type, which takes `(args, { cwd, env, timeoutMs, maxBuffer })` and resolves `{ ok: true, stdout } | { ok: false, kind: 'missing' | 'timeout' | 'failed', stderr }`.
- It also gains `createGit(launcher)`, which returns the eight operations.
- The existing exported functions are the local instance: their launcher is today's `execFile('git', …)`, which stays in `git.ts`.
- The argument lists, `GIT_ENV`, `GIT_LITERAL_PATHSPECS`, the timeouts, the parsing and `classify` keep their behaviour. `ignoredEntries` goes through the same launcher, keeping its own timeout and size.
- The WSL backend's git part is `createGit(wslLauncher)`. `wslLauncher` lives in `src/main/env/wsl.ts`, and runs `-d <distro> --cd <cwd> --exec git <args…>` through the transport, with the environment crossing through `WSLENV` as above.
  - git missing in the distribution maps to `missing`. `wsl.exe` reports it as exit code 1 with an exec error on stderr; the exact text is checked live and kept in the fake transport.
  - A timeout maps to `timeout`.
- No credential is passed in an argument or logged.

**Failures.** Every method resolves or rejects with the interface's own result:
- files reject with a Node-coded error;
- spawn resolves `{ started: false }`;
- git resolves a code.

A missing distribution or a stopped transport never throws out of a part, and never falls back to the local backend.

### environmentFor (`src/main/env/index.ts`)

- `{ kind: 'wsl', distribution }` on `win32`, with a valid name, gives `createWslEnvironment({ distribution, transport: appWslTransport(distribution) })`.
- Off Windows, it refuses with the fixed `WSL_UNAVAILABLE` reason: "WSL projects are available only on Windows".
- A bad or missing distribution name is refused with `UNSUPPORTED_ENVIRONMENT`.
- Neither reason echoes a value. The local kind is unchanged.

### Store and registry

- `ProjectEnvironment` is `{ kind: 'local' } | { kind: 'wsl'; distribution: string }`. A descriptor has exactly these keys. `copyOf` copies the descriptor.
- **Add.**
  - A WSL root must be a string, absolute in POSIX, and equal to `path.posix.resolve(root)`.
  - It must be an existing folder, as `env.files.stat` reports through the environment the registry passes in.
  - `store.add(input, env?)` uses `env` for the WSL root check and local `fs` for local roots. A WSL add without an environment is refused with `STORE_REASONS.root`.
  - `STORE_REASONS.environment` becomes "the environment must be local or a WSL distribution".
- **Duplicates.** Two projects are the same folder when they have the same kind, the same distribution (compared exactly) and the same root. Local roots keep today's comparison by platform; WSL roots are compared exactly.
- **Load** accepts a WSL entry with a valid name and a normalized absolute POSIX root, without touching WSL.
- **Registry.** `addProject` passes the environment it made to `store.add`. Startup builds each stored WSL project's environment through `environmentFor`, as for local. The dev project stays local.

### Spec lock atomic write (revision 1)

A rename over an existing file on the WSL share fails with `EPERM` a few percent of the time (22 of 300 in a probe). The same failure also shows locally under the parallel test suite. `writeAtomic` in `src/main/workflow/spec-lock.ts` renames once, so one such failure fails a build step or refuses an approval.

- `writeAtomic` uses the app's shared atomic writer, `writeFileAtomic(env.files, …)` in `src/main/tools/atomic-write.ts`, with its rename retry: `RENAME_ATTEMPTS` attempts, waiting `RENAME_RETRY_MS × attempt` between them. There is again one atomic writer and one retry budget (D41).
- Its signature and result shape are unchanged. A success is `{ ok: true }`. A failure removes the temporary file and returns `{ ok: false, reason }`, where `reason` is the same value as today: the Node code of the last error, from `errorCode`. This holds for a failed first write too. If the shared writer cannot report that code as it is, it may gain an optional way to report the last error, with its default result unchanged.
- No other module changes. The WSL files part's `rename` still passes the Node code through unchanged on a single attempt.

### Tests

- `tests/support/fake-wsl-transport.ts` is a fake transport. Its `shareRoot` is a temp folder. `run` records each argument array and environment, and answers from a script the test sets: the launcher's id line and output, exit codes, the probe result, git output for given argument lists, a stall for timeouts, and `{ started: false }`. It never spawns `wsl.exe`.
- `tests/unit/env-wsl.test.ts`, `tests/unit/wsl-detect.test.ts`, the store and registry cases, the recording-backend cases, the boundary addition, and the live walk are listed under the acceptance criteria.
- `tests/support/headless-walk.ts` holds the walk body, taking a setup (root, environment, a git reader). `headless-e2e.test.ts` calls it with the local setup and keeps every assertion.

## Acceptance criteria

- **AC1 detection:** `tests/unit/wsl-detect.test.ts`, with the program run injected, shows:
  - UTF-16LE output parsed into names, versions and the default;
  - names failing `isDistributionName` dropped;
  - `{ installed: false }` off Windows, for a missing program, a failing exit and a timeout.

  A scan shows the module runs nothing at import.
- **AC2 path and files:** `tests/unit/env-wsl.test.ts`, with the fake transport, shows:
  - `path` is `path.posix` and `sep` is `/`;
  - every `files` method works on the temp share;
  - `ENOENT`, `ENOTDIR`, `EISDIR`, `EEXIST` and `ENOTEMPTY` pass through;
  - a capped read refuses a larger file with `EFBIG`, with no read;
  - `realpath` and `readlink` give Linux paths, and a result outside the share gives `ENOENT`;
  - `symlink` and `chmod` send the fixed commands and map their failures to codes.
- **AC3 process:** the same file shows:
  - the spawn argument array has the launcher form, with every argument as its own element (an argument with spaces, quotes, `$` or `;` reaches the transport unchanged);
  - only changed variables cross through `WSLENV`, never `PATH`, and no value is in argv;
  - the marker line is not passed to `onOutput`;
  - on timeout and on abort, the group kill call is made before the result resolves, and nothing reaches `onOutput` afterwards;
  - a transport that cannot start gives `{ started: false }`;
  - `platform` is `linux`;
  - `network: 'none'` reports `os` with the unshare wrapper when the probe passes and `proxy-only` when it fails, the probe runs once, and `networkLevel()` agrees.
- **AC4 watch:** the same file shows:
  - added, removed and changed files in the folder are reported, and nothing from a subfolder;
  - the first listing reports nothing;
  - a failing listing calls `onError` once per run of failures;
  - no callback runs after `close()`.
- **AC5 git:** the same file shows that each of the eight operations sends the same argument list as the local instance, through `-d <distro> --cd <root> --exec git`, with `GIT_TERMINAL_PROMPT` and `GCM_INTERACTIVE` crossing through `WSLENV`, and parses the scripted output to the same values. git missing gives `git-missing`, a stall gives `timeout`, and other failures give `failed`.

  `tests/unit/git.test.ts` and `tests/unit/git-boundary.test.ts` pass with no assertion changed.
- **AC6 no throw, no fallback:** with a transport whose `run` always gives `{ started: false }` and a share root that does not exist:
  - every files method rejects with a Node code;
  - spawn gives `{ started: false }`;
  - every git operation gives a code;
  - nothing throws out of a part, and nothing touches the local backend.
- **AC7 environmentFor:** a test shows WSL is built on `win32` (with the platform and transport injected, not run), refused with `WSL_UNAVAILABLE` elsewhere, refused with `UNSUPPORTED_ENVIRONMENT` for a bad name, and that the local kind is unchanged.
- **AC8 store and registry:** `tests/unit/project-store.test.ts` and `project-registry.test.ts` gain cases:
  - a WSL project is added with its root checked through the environment;
  - a missing root, a relative root, an unnormalized root, a bad name, extra descriptor keys, and a WSL add without an environment are each refused with their fixed reasons;
  - duplicates compare kind, distribution and root;
  - load keeps a valid WSL entry and sets aside an invalid one;
  - the registry builds a WSL project's environment through `environmentFor`.

  The existing cases pass unchanged.
- **AC9 recording backend:** a WSL backend over the fake transport, wrapped like `tests/support/recording-env.ts`, shows a file tool, `run_command`, the spec lock and `approveResult` reach their results through the interface.
- **AC10 boundary:** `tests/unit/env-boundary.test.ts` passes, and gains a check that no file under `src/` outside `src/main/env/wsl.ts` and `src/main/env/wsl-detect.ts` names `wsl.exe`.
- **AC11 headless walk:**
  - `tests/unit/headless-e2e.test.ts` runs the walk through the shared helper with no assertion changed.
  - `tests/live/wsl-walk.live.test.ts` runs the same walk on a temp repo with a bare remote inside the distribution (`HARNESS_WSL_DISTRO`, else the default). The project is added through the store and registry as a WSL project, and the test reads git through `wsl.exe` in the test only.
  - It is skipped off Windows, without WSL, or without git in the distribution.
  - It passes on this machine with `pnpm test:live`, and the result is reported in the summary. It never runs in CI.
- **AC12 docs:**
  - `CHANGELOG.md` has an Unreleased (Added) entry;
  - `docs/decisions.md` has D42, and a note under D41 that the WSL backend exists;
  - `docs/environments.md` has a WSL section (transport, share, launcher, `WSLENV`, polling, git launcher, detection) and the checklist status for WSL;
  - `docs/agent-commands.md` says how the network limit applies in WSL;
  - `CLAUDE.md` names D42 in its read list, and mentions the live WSL walk under the commands;
  - `README.md` and `docs/PRD.md` update the F3 progress;
  - `docs/phases/phase-04-projects.md` is updated;
  - row 3 and the follow-ups of `docs/phases/phase-04-progress.md` are filled in.
- **AC13 checks:**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm e2e` pass;
  - `git diff main -- tests/` changes no existing `expect` line, except moving the walk body into the helper as it is;
  - the local backend's tests pass unchanged.
- **AC14 spec lock retry (revision 1):** a test in `tests/unit/spec-lock.test.ts`, with a files part whose `rename` fails with `EPERM` a set number of times, shows:
  - a rename that fails fewer than `RENAME_ATTEMPTS` times succeeds;
  - one that always fails returns `{ ok: false }` with the reason `EPERM`, and leaves no temporary file;
  - a failed first write returns its own code as today.

  The existing spec-lock, spec-watch, spec-handlers and atomic-write tests pass with no assertion changed. The full `pnpm test` passes in its default parallel mode on this machine, and the live WSL walk passes on repeated runs (at least 3 in a row, reported in the summary).

## Open questions

- None. The decisions are recorded in `PLAN.md`.
- 2026-11-25, revision 1: a rename over an existing file on the WSL share, and locally under parallel load, fails with `EPERM` now and then, and the spec lock's `writeAtomic` renamed only once. Decision: `writeAtomic` uses the shared `writeFileAtomic` and its rename retry, with its result and reasons unchanged. Not taken: a retry only in the WSL files part (it leaves the local parallel failure); WSL `rename` through `mv -f` in Linux (one `wsl.exe` start per rename, local failure unchanged); keeping the spec and accepting a flaky walk.
