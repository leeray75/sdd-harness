# Agent commands

A reference for developers and pilot users: which commands the agents may run, what is protected while a command runs, what is reverted afterwards, the network limit on each OS, and how to recover after a crash. The rules are set in [decisions.md](decisions.md): D6 (limits on running commands), D29 (agent tools) and D31 (this page's rules).

## Which commands each job may run

The app reads the project's markers once, when it starts, and builds an allowlist from them. A command runs only when its program and its arguments match a detected form exactly, from the project root. Case is ignored for the program name, and a `.exe`, `.cmd` or `.bat` ending on the program is ignored too. Extra or changed arguments are refused.

| Project marker                                                                    | Test commands                | Build commands                                             |
| --------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| Node: `package.json` with a `test` script                                         | `<pm> test`, `<pm> run test` |                                                            |
| Node: `package.json` with a `build` script                                        |                              | `<pm> run build`, plus `<pm> build` for pnpm, yarn and bun |
| Python: `pytest.ini`, a root `conftest.py`, or `[tool.pytest` in `pyproject.toml` | `pytest`, `python -m pytest` |                                                            |
| Python: `[build-system]` in `pyproject.toml`                                      |                              | `python -m build`                                          |
| Go: `go.mod`                                                                      | `go test ./...`              | `go build ./...`                                           |
| Rust: `Cargo.toml`                                                                | `cargo test`                 | `cargo build`                                              |

`<pm>` is the package manager. It comes from the `packageManager` field of `package.json` when that names pnpm, npm, yarn or bun. Otherwise it comes from the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` or `bun.lock`, or `package-lock.json`. With no lockfile it is npm. A project with several markers gets the commands of each.

Who may run what:

- **Code writer:** every detected test command and every detected build command.
- **Reviewer:** the detected test commands only. A build command is refused with the reason "the reviewer may run tests only".
- **Planner and reader:** no commands.
- Every other program, including `git` (which is never run), is refused, and the refusal is logged as a rule event.

A marker that is missing, unreadable or invalid gives no commands. It never stops the app.

## What is protected while a command runs

While a command runs, `docs/specs/` is read-only. Its files and folders have their write bits removed on macOS and Linux, and their read-only attribute set on Windows. A command that tries to change a spec file fails with a permission error.

Before the command starts, the app also records the protected files. Both jobs protect:

- everything under `docs/specs/`;
- the `.git` key files: `.git/HEAD`, `.git/config`, `.git/packed-refs`, and everything under `.git/hooks/` and `.git/refs/`. `.git/index` is not protected.

The reviewer also protects every other file in the project that git does not ignore. It does not protect `node_modules/` or `.git/`.

If the protected files together are larger than 256 MiB, the command is refused before it starts.

## What is reverted afterwards

When the command exits, times out or cannot start, the app restores the protected set:

- a changed file gets back its original bytes and mode;
- a deleted file or folder is re-created;
- a new file or folder in the protected set is removed.

The writer's changes to project files (outside the protected set) are kept. The reviewer's changes to project files are reverted, except to git-ignored files and `node_modules/`, which are kept.

The result of the command names each area that was reverted: "reverted changes in docs/specs", "reverted changes in .git" or "reverted changes to project files". Each reverted path is also logged as a `rule reverted:` line with its action (`restored`, `re-created` or `deleted`).

Git's ignore rules come from a read-only git query: `git ls-files --others --ignored --exclude-standard --directory`. If git is missing, or the project is not a repository, the reviewer skips only `node_modules/` and `.git/`.

## Network limit on each OS

The writer's commands get the network limit. The reviewer's do not.

| OS                                           | What the writer's command gets                                                                                                               | Level in the log |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Linux                                        | When unprivileged user namespaces work (a one-time check with `unshare`), the command runs in its own network namespace, with only loopback. | `os`             |
| macOS                                        | When `/usr/bin/sandbox-exec` exists, the command runs under a profile that denies outbound network to any address except localhost.          | `os`             |
| Windows, and any OS without the method above | Only the dead proxy variables and the offline flags (below).                                                                                 | `proxy-only`     |

**Where the limit is applied (D41).** The local environment backend applies it (`src/main/env/local.ts`), and its two probes are in `src/main/env/probes.ts`. Commands run from the project root through the environment's process part, which kills the whole process tree on timeout. The protected files are read and reverted through the environment's files part. A remote backend (WSL, SSH, a dev container) applies the limit as far as its own system allows and reports the level it got, in the same two values; see [environments.md](environments.md).

**Over SSH (D43).** On a Linux server the limit is `os` when `unshare --user --map-root-user --net true` works for the signed-in user, probed once per connection; otherwise it is `proxy-only`. On a macOS server it is always `proxy-only`: the proxy variables and offline flags are set, but outbound network is not blocked by the OS. A command's network is therefore best effort on macOS over SSH, as on a local macOS project without `sandbox-exec`.

**In a dev container (D44).** A command in a dev container project runs inside the container, as the container's remote user. The same `unshare` probe runs there, once per connection: when unprivileged user namespaces work in the container, the command gets the `os` level with its own network namespace and only loopback. Many dev containers do not allow them (Docker's default seccomp profile blocks them), and then the level is `proxy-only`, and the log says so. The dead proxies and the offline flags are passed into the container as variables with `docker exec -e`.

**On WSL (D42).** A command in a WSL project runs inside its distribution. The same `unshare` probe runs there, once per backend: when unprivileged user namespaces work in the distribution, the command gets the `os` level with its own network namespace and only loopback, as on Linux. When they do not (for example on WSL 1, or with the feature disabled), the level is `proxy-only`, and the log says so. The dead proxies and the offline flags are passed to the distribution through `WSLENV`.

Every writer command logs one `rule network:` line with its level. An `os` level is logged as info, and `proxy-only` as a warning.

On every OS the writer's command also gets:

- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and their lower-case forms) set to `http://127.0.0.1:9`, where nothing listens, and `NO_PROXY` and `no_proxy` empty;
- offline flags: `npm_config_offline=true`, `YARN_ENABLE_OFFLINE_MODE=1`, `CARGO_NET_OFFLINE=true`, `GOPROXY=off` and `PIP_NO_INDEX=1`.

**The limit is best effort.** The proxy variables and the offline flags only help tools that read them. A program that ignores them can still open a network connection at `proxy-only`. On Linux, a distribution that disables unprivileged user namespaces gives `proxy-only` too. Use the level in the log to judge how much a command was limited.

## Recovering after a crash

If the app stops while a command runs, the restore may not have finished. The spec folder can stay read-only, and a file may keep a change the restore would have reverted. Check and repair it by hand:

1. Find out what changed. Run `git status` and `git diff` in the project. Look at `docs/specs/` and at the `.git` key files listed above.
2. Clear the read-only state:
   - On Windows, in a terminal at the project root: `attrib -R docs\specs\* /S /D`
   - On macOS or Linux: `chmod -R u+w docs/specs`
3. Put back changed files from git. For a tracked file under `docs/specs/`, use `git restore -- <path>`. Do not edit an approved spec by hand: the approved spec's hash is the source of truth (D4, D7).
4. Remove files that a command created in `docs/specs/`, if git does not track them and they were not there before the run.
5. Check `.git/HEAD`, `.git/config`, `.git/packed-refs` and the hooks. If one changed, restore it from a clean copy of the repository, not by hand.

Then run `git status` again and confirm that only the changes you mean to keep are left.
