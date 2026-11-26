# Plan: p4-env-wsl

Ticket: none (vibe planning, Phase 4 subtask 3)
Status: approved
Date: 2026-11-25

## Objective

A project can live inside a WSL distribution. The WSL backend implements the environment interface (D41) for one distribution and a Linux root: files, programs, watching and git. The project store and the registry accept a WSL project, so the phase 3 headless walk runs on a project inside WSL with no change to any tool, command, lock or ship module. How the backend reaches WSL is recorded as D42.

## Scope

- **In:**
  - **Detection** (`src/main/env/wsl-detect.ts`, never run at import time): `detectWsl()` reports whether WSL is installed, the distributions with their WSL version, and the default one. It runs `wsl.exe --list --verbose` and decodes its UTF-16LE output. It answers `{ installed: false }` off Windows and when `wsl.exe` is missing, and it never throws. The add wizard (`p4-add-project-wizard`) will call it; nothing calls it at start.
  - **The WSL backend** (`src/main/env/wsl.ts`), made by `createWslEnvironment({ distribution, transport })`. The transport is injectable, so the tests use a fake one; the app's transport runs `wsl.exe` and maps the Linux tree to the share.
    - `path` is `path.posix`, with `sep` `/`.
    - `files` uses `node:fs` on the distribution's share, `\\wsl.localhost\<distro>` with `\\wsl$\<distro>` as the fallback (D42). Linux paths map to share paths, and back again for `realpath` and `readlink`, inside this module only. Node codes pass through, and `readFile` with a cap stats before it reads and refuses a larger file with `EFBIG`. A method the share cannot do faithfully (for example `symlink` or `chmod` over 9P) runs a fixed Linux command through the transport instead, and maps its failure to the Node code.
    - `process.platform` is `linux`. `spawn` runs `wsl.exe -d <distro> --cd <cwd> --exec sh -c '<fixed launcher>' sh <file> <args…>`. The launcher script is a constant: it prints the new session's process id, then runs the program with `setsid`, passing the arguments as positionals, so no argument is ever parsed by a shell. On timeout or abort, a second `wsl.exe` call kills that process group before the result resolves. Environment variables cross through `WSLENV`, never in argv. Only the variables the caller set or changed relative to the app's own environment cross; the Windows `PATH` never does.
    - `networkLevel()` and `network: 'none'` probe `unshare --user --map-root-user --net true` in the distribution once, through the transport. The level is `os` with the unshare wrapper (the existing `chooseNetwork` and `wrapCommand` for Linux in `src/main/commands/network.ts`), or `proxy-only` otherwise. The dead proxy variables cross through `WSLENV`.
    - `watch.watchDir` polls the one folder through `files` (about every second) and reports added, removed and changed names. A listing that fails goes to `onError` once, and `close()` stops the timer, so no event follows it.
    - `git` reuses `src/main/git/git.ts`. Its runner takes an injected program launcher, with the existing `execFile('git', …)` as the local default. The WSL backend supplies a launcher that runs git inside the distribution through its transport. The argument lists, the parsing, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, the timeouts and the four failure codes are unchanged. git missing in the distribution maps to `git-missing`, and a timeout maps to `timeout`.
    - A failing transport (the distribution is stopped or missing, or `wsl.exe` is gone) gives a result for each call (`{ started: false }`, a git code, or a Node code such as `ENOENT`), never a throw that escapes and never a fallback to local.
  - **`environmentFor`** builds the WSL backend for `{ kind: 'wsl', distribution }` on Windows. Off Windows, or for a distribution name that fails the name check, it refuses with a fixed reason.
  - **Store and registry** (`src/main/projects/store.ts`, `registry.ts`): `ProjectEnvironment` becomes `{ kind: 'local' } | { kind: 'wsl'; distribution: string }`.
    - The distribution name must match a fixed pattern (letters, digits, `.`, `_`, `-`; up to 64 characters).
    - A WSL root is an absolute, normalized POSIX path, and is checked as an existing folder through the project's environment, not local `fs`.
    - Duplicates compare kind, distribution and root, with Linux roots compared exactly.
    - Loading checks WSL entries the same way, without touching WSL.
    - The registry passes the environment it made to the store's root check. The dev project stays local.
  - **Tests:**
    - unit tests on every OS with a fake transport and a temp folder standing in for the share: path, every files method and its codes, the cap, the spawn argv and `WSLENV` (no argument joined, no Windows PATH), timeout and abort calling the group kill, the network level, polling watch (events, `onError`, `close`), git argument lists and codes through the launcher, detection parsing (UTF-16LE, default marker, missing `wsl.exe`), `environmentFor` refusals, and the store and registry WSL cases;
    - the recording backend (`tests/support/recording-env.ts`) over a WSL backend with the fake transport, showing a tool, `run_command`, the lock and ship reach their results through the interface;
    - the boundary scans still pass. They gain a check that only `src/main/env/wsl.ts` and `wsl-detect.ts` name `wsl.exe`;
    - an opt-in live test (`tests/live/wsl-walk.live.test.ts`, in `pnpm test:live`) that runs the headless walk on a temp repo inside the distribution (`HARNESS_WSL_DISTRO`, or the default distribution). It is skipped off Windows, without WSL, or without git in the distribution, and never runs in CI. The walk body moves to a shared helper (`tests/support/headless-walk.ts`), so `tests/unit/headless-e2e.test.ts` keeps every assertion and runs as before.
  - **Docs:** D42 in `docs/decisions.md`, a WSL section and the checklist status in `docs/environments.md`, how the network limit applies in WSL in `docs/agent-commands.md`, a `CHANGELOG.md` Unreleased entry, `CLAUDE.md` (the read list names D42 and the live WSL walk command), `README.md` and `docs/PRD.md` (F3 progress), `docs/phases/phase-04-projects.md`, and row 3 and the follow-ups in `docs/phases/phase-04-progress.md`.
- **Out:**
  - SSH and dev containers.
  - The unreachable and read-only project state, and Reconnect (`p4-env-ssh`).
  - The add wizard UI and its use of `detectWsl` (`p4-add-project-wizard`).
  - Any UI or IPC for projects (`p4-projects-screen`).
  - Starting a stopped distribution on purpose. `wsl.exe` may start it as a side effect of a call, which is fine.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p4-env-wsl`, this repo, branch `feature/p4-env-wsl` from `main` | none (from the brief) |
| How files are reached (D42) | `node:fs` on the share `\\wsl.localhost\<distro>` (fallback `\\wsl$`), with Linux paths mapped inside the WSL module; commands and git through `wsl.exe` | Every file call as a Linux command through `wsl.exe` (no share needed, but slower, with hand-mapped error codes) |
| How the spec folder is watched | Poll the one folder through `files` about every second; errors to `onError`; `close()` stops it | `inotifywait` in the distribution (needs inotify-tools); `fs.watch` on the share (misses changes made inside Linux) |
| Tree kill on timeout or abort | A fixed `sh` launcher passes the arguments as positionals, runs the program with `setsid` and prints its id; a second `wsl.exe` call kills the group | GNU `timeout` on the Linux side (abort only kills `wsl.exe`, which can leave Linux processes running) |
| Store scope | The store and registry accept `{ kind: 'wsl', distribution }` with a Linux root checked through the environment; the walk runs through the registry | Only `environmentFor` builds it, and the store stays local-only until the wizard |
| How git reaches WSL (default, not asked) | `git.ts`'s runner takes an injected launcher. The WSL module supplies one over its transport, and `execFile('git'` stays in `git.ts` | A second git module for WSL (two copies of the argument lists) |
| Environment variables (default, not asked) | Through `WSLENV`, only the ones the caller set or changed; never in argv, never the Windows PATH | Passing every variable (leaks Windows paths); `env NAME=value` in argv (values visible in the process list) |

## Approach

1. **git launcher.** Refactor `src/main/git/git.ts` so `runGit` and `ignoredEntries` run through a launcher (`(args, { cwd, env, timeoutMs, maxBuffer }) => result`). Export `createGit(launcher)` and keep the existing functions as the local instance. `git-boundary.test.ts` still finds `execFile('git'` in `git.ts`. The local backend's behaviour and the tests' assertions are unchanged.
2. **Transport and backend.** `src/main/env/wsl.ts` holds the transport interface, the app transport (spawns `wsl.exe`, maps paths to the share), the path, files, process, watch and git parts, and `createWslEnvironment`. `src/main/env/wsl-detect.ts` holds detection. Both are new files in `src/main/env/`, so the boundary scan's allowed set already covers them.
3. **environmentFor.** It builds the WSL backend for the `wsl` kind on Windows and refuses otherwise.
4. **Store and registry.** The descriptor union, its validation, the WSL root check through the environment, duplicates and load. The registry passes its environment to the store's add.
5. **Tests.** A fake transport (`tests/support/fake-wsl-transport.ts`) and `tests/unit/env-wsl.test.ts`, the detection tests, the store, registry and recording-backend cases, the boundary scan addition, the shared walk helper and the live WSL walk.
6. **Docs.** As listed under Scope.
7. **Full checks.** typecheck, lint, format:check, test and e2e, plus `pnpm test:live` with the WSL walk on this machine.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The interface and the local backend are in `src/main/env/`, and `environmentFor` refuses unknown kinds | `src/main/env/index.ts:23` |
| `node:fs` and `node:child_process` are allowed anywhere in `src/main/env/` | `docs/environments.md` (only `src/main/env/`, `src/main/git/` and the two stores); `tests/unit/env-boundary.test.ts:52` |
| Only `src/main/env` may import the network module, so `wsl.ts` may reuse `chooseNetwork` and `wrapCommand` | `tests/unit/env-boundary.test.ts:69` |
| git-boundary looks for `execFile('git'` in `git.ts` and refuses a git program started anywhere else | `tests/unit/git-boundary.test.ts:54-59` |
| git's argument lists live in `runGit` and `ignoredEntries`'s own `execFile` | `src/main/git/git.ts:61`, `src/main/git/git.ts:240` |
| The store only accepts `{ kind: 'local' }` and checks roots with local `fs.stat` and `node:path` | `src/main/projects/store.ts:27`, `:127-131`, `:292-305` |
| The registry calls `environmentFor` before `store.add`, and the dev project is built the same way | `src/main/projects/registry.ts:146`, `:212` |
| This machine has WSL 2 with a default distribution (`Ubuntu`), so the live walk can run here | `wsl.exe -l -v`: `* Ubuntu Running 2` |
| `pnpm test:live` has its own config, so a new live file joins it | `package.json:19` (`vitest.live.config.mts`) |

## Risks

- **Symlinks and modes over the share.** 9P may refuse `symlink` or ignore `chmod`. The protected-set restore needs both. The unit tests cannot show this, because they use a temp folder; the live walk and a live files check will. Mitigation: those methods run a Linux command through the transport.
- **Share path and realpath.** `realpath` on the share returns a UNC path that must map back to the Linux path exactly, or containment checks fail. Unit tests cover the mapping; the live walk shows it on the real share.
- **Speed.** Every git call and command starts `wsl.exe`, about 100 to 300 ms each. The live walk's time limit may need more room than the local walk's 120 s.
- **Polling cost.** Polling the specs folder every second costs one listing a second per WSL project. That is acceptable for one folder; recorded as a follow-up if it matters.
- **Network probe on WSL 1.** `unshare` usually fails there, which gives `proxy-only`, reported honestly.

## Open questions

None.
