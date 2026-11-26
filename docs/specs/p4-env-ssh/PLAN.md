# Plan: p4-env-ssh

Ticket: none (vibe planning, Phase 4 subtask 4)
Status: approved
Date: 2026-11-26

## Objective

A project can live on an SSH server. An SSH backend implements the environment interface (D41) for one saved server and a remote root: files over SFTP, programs and git over exec channels, and a polled watch. Saved servers keep their connection details in app data and their secrets in the secret store (`safeStorage`), never in a file, argument or log line. Main also learns that an environment can be unreachable: a project whose server (or WSL distribution) cannot be reached stays listed, becomes read-only, and comes back with Reconnect. The phase 3 headless walk runs on a project on an SSH server. The SSH library, credential handling and host key policy are recorded as D43.

## Scope

- **In:**
  - **Library:** the `ssh2` npm package (1.17.x) as a runtime dependency of main. Only the SSH transport module imports it.
  - **Saved servers** (`src/main/projects/servers.ts`): `ssh-servers.json` in app data, `{ "version": 1, "servers": [...] }`, saved whole through `localEnvironment().files` and the shared atomic writer (no new `node:fs` importer). A server is `{ id, name, host, port, user, auth, hostKey }`:
    - `id` a lowercase UUID; `name` 1 to 80 characters; `host` a hostname, IPv4 or IPv6 literal (fixed pattern, no spaces, no leading `-`); `port` 1 to 65535, default 22; `user` a POSIX user name pattern.
    - `auth` is `{ method: 'key', keyPath, hasPassphrase }`, `{ method: 'agent' }` or `{ method: 'password' }`. The key path is a local absolute path; the key file is read only at connect time, in memory.
    - `hostKey` is the pinned SHA-256 fingerprint, or `null` until trusted.
    - Secrets: the password or the key passphrase is saved in the secret store under `ssh-<serverId>-password` or `ssh-<serverId>-passphrase`, read only at connect time. They never reach `ssh-servers.json`, a log line, a reason text, an argument array or an environment variable.
    - `add`, `list`, `get`, `update`, `trustHostKey(id, fingerprint)` and `remove` return `{ ok, ... }` or a fixed reason that never echoes input. `remove` deletes the server's secrets, and is refused while a stored project uses the server. A corrupt file is set aside like `projects.json` (D40).
  - **Host keys:** pinned per server and confirmed. A connect to a server with no pinned key fails with a result that carries the offered fingerprint (`host-key-unknown`); main pins it only through `trustHostKey`, which the add wizard (`p4-add-project-wizard`) will call after the user confirms. A changed key always refuses (`host-key-changed`) and is never auto-replaced.
  - **The SSH transport** (`src/main/env/ssh-transport.ts`, the only importer of `ssh2`): one connection per server, shared by every project on it, with an SFTP session and exec channels. Credentials come in at connect time from the server store and the secret store; agent auth uses `SSH_AUTH_SOCK`, or the Windows OpenSSH agent pipe on Windows. A keepalive notices a dead link. A dropped connection moves the transport to `unreachable`; it never reconnects by itself. The transport is injectable, so unit tests use a fake one (`tests/support/fake-ssh-transport.ts`) over a temp folder.
  - **The SSH backend** (`src/main/env/ssh.ts`), made by `createSshEnvironment({ server, transport })`:
    - `path` is `path.posix`, with `sep` `/`.
    - `files` runs over SFTP, mapping SFTP status codes to the Node codes of the contract (`NO_SUCH_FILE` to `ENOENT`, `PERMISSION_DENIED` to `EACCES`, and a generic `FAILURE` resolved by an `lstat` to `EEXIST`, `ENOTDIR`, `EISDIR` or `ENOTEMPTY` where the operation allows, else `EIO`). `readFile` with a cap stats the open handle and refuses a larger file with `EFBIG`, and never reads past the cap. `symlink`, `chmod` and `rm` (recursive) use SFTP calls, or a fixed command where SFTP has none. A lost connection gives `ENOTCONN` for every call.
    - `process.platform` is read once per connection from `uname -s` (`linux` or `darwin`); any other system is refused at connect as unsupported.
    - `spawn` runs on an exec channel as one command string: `cd -- <cwd> && exec env -- <NAME=value…> sh -c <the WSL launcher constant> sh <file> <args…>`, where every element is single-quoted by one fixed quoter (SSH exec takes a single string, so this quoter is the only place a command line is built, and it is tested against hostile strings). The launcher is shared with the WSL backend (moved to a common module, unchanged), so the marker line, `setsid` and the group id work the same. On timeout or abort, a second exec channel runs `kill -KILL -- -<pgid>`, then the channel is closed, then the result resolves. `{ started: false }` when the connection is down.
    - Variables: only the variables the caller set or changed relative to the app's own environment cross, through the `env` prefix; `PATH` never crosses. No credential is ever among them.
    - `network: 'none'` probes `unshare --user --map-root-user --net true` once per connection on Linux: `os` with the Linux unshare wrapper, else `proxy-only`. macOS servers are `proxy-only`. `networkLevel()` agrees.
    - `watch.watchDir` polls one folder about every second, with the same rules as WSL. The WSL polling code moves to a shared module (`src/main/env/poll-watch.ts`) used by both, with its behaviour and the WSL tests unchanged.
    - `git` is `createGit(sshLauncher)` from `src/main/git/git.ts`, with the same argument lists, environment, timeouts, parsing and codes. The SSH launcher runs git through the group launcher, so a timeout kills the remote git process too. Exit 127 with git's "not found" text maps to `git-missing`.
  - **Connection state** (an addition to `Environment`, not to `ToolEnvironment`): a `connection` part with `state()` (`connected` or `unreachable`), `onChange(listener)` returning an unsubscribe, and `reconnect()` resolving `{ ok: true }` or `{ ok: false, reason }`.
    - Local: always `connected`; `reconnect` is a no-op.
    - WSL: `unreachable` when the share root cannot be found or a transport run cannot start (a stopped or missing distribution). `reconnect` runs `wsl.exe -d <distro> --exec true` (which starts a stopped distribution), then finds the share root again. Normal calls never start a distribution on purpose (D42 unchanged).
    - SSH: follows the transport. `reconnect` opens a new connection with the same server details, and checks the pinned host key.
  - **`environmentFor`** builds the SSH backend for `{ kind: 'ssh', server }` when the server id is known, and refuses with a fixed reason otherwise. Making the backend does not connect; the registry asks it to.
  - **Store and registry:**
    - `ProjectEnvironment` gains `{ kind: 'ssh'; server: string }`. An SSH root is an absolute, normalized POSIX path, checked as an existing folder through the environment at add time. Duplicates compare kind, server and root exactly. Loading does not touch the network.
    - The registry keeps a state per project: `connected` or `unreachable`. At start, each project's environment is made and connected; one that cannot be made or reached is kept as `unreachable` instead of being dropped, so it stays listed and removable (this settles the p4-env-wsl registry follow-up).
    - Read-only: an unreachable project has no running watcher, `handlerFor` refuses its human-only actions with a fixed reason ("this project's environment is unreachable; reconnect to continue"), and `buildOptionsFor` and `environmentOf` give `null`, so nothing runs against it. It never falls back to local.
    - `stateOf(id)`, `onStateChange(listener)` and `reconnect(id)`. `reconnect` calls the environment's `reconnect`, and on success starts the watcher, rebuilds the handlers and refreshes once. A connection that drops later moves the project to `unreachable` and closes its watcher.
  - **Tests:**
    - unit tests on every OS with the fake transport: server store (validation, secrets never in the file, trust, changed key, remove refusals, corrupt file), path, every files method and its codes, the cap, the quoter and the exec command string, the variables, the group kill on timeout and abort, the network level, the shared polling watch, git argument lists and codes, the lost connection on every part, `environmentFor`, store and registry SSH cases, and the connection state for local, WSL and SSH, including Reconnect;
    - a credential scan: with a known password and passphrase, no exec string, argument array, environment, log line, saved file or reason text holds them;
    - the recording backend over the SSH backend: a tool, `run_command`, the lock and `approveResult` reach their results through the interface;
    - the boundary scans still pass, with a new check that only `src/main/env/ssh-transport.ts` imports `ssh2`;
    - an opt-in live test (`tests/live/ssh-walk.live.test.ts`, in `pnpm test:live`) that runs the headless walk on a temp repo on a server named by `HARNESS_SSH_HOST`, `HARNESS_SSH_PORT`, `HARNESS_SSH_USER`, `HARNESS_SSH_KEY` (a key path, key auth only) and `HARNESS_SSH_ROOT` (the parent folder for the temp repo), with the host key pinned from `HARNESS_SSH_FINGERPRINT` or trusted in the test. It is skipped when the variables are unset and never runs in CI. It is run here against sshd in WSL Ubuntu on localhost.
  - **Docs:** D43 in `docs/decisions.md` (notes under D41 and D42), an SSH section, the connection part and the unreachable state, and the checklist status in `docs/environments.md`, the network limit over SSH in `docs/agent-commands.md`, the `CHANGELOG.md` Unreleased entry, `CLAUDE.md` (the read list names D43; `test:live` names the SSH walk and its variables), `README.md` and `docs/PRD.md` (F3 progress), `docs/workflow-engine.md` (the registry's states), `docs/phases/phase-04-projects.md`, and row 4 and the follow-ups in `docs/phases/phase-04-progress.md`.
- **Out:**
  - Dev containers (`p4-env-container`).
  - The projects screen, the Reconnect button and how a read-only session looks (`p4-projects-screen`).
  - The add wizard UI, including showing the host key fingerprint and calling `trustHostKey` and `detectWsl` (`p4-add-project-wizard`).
  - IPC for servers, projects or Reconnect.
  - Automatic reconnect, jump hosts, `~/.ssh/config` and the user's `known_hosts`, port forwarding, Windows SSH servers.
  - A change to the local backend's behaviour, or to the WSL backend's beyond the shared launcher, the shared polling watch and its connection part.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| SSH library (D43) | `ssh2` npm package: SFTP and exec channels in main, secrets in memory only | System OpenSSH `ssh`/`sftp` binaries (askpass for passwords, file calls as commands, weak ControlMaster on Windows) |
| Auth methods | Key file (optional passphrase), ssh-agent, password | Key file and agent only; key file only |
| Host key checking | Pinned SHA-256 fingerprint per server, confirmed through `trustHostKey`; a changed key always refuses | Automatic trust on first use; the user's `~/.ssh/known_hosts` |
| Where servers live | `ssh-servers.json` in app data, saved through `localEnvironment().files`; projects name a server by id | Host details inside each project in `projects.json` |
| Unreachable state and Reconnect | A `connection` part on `Environment`; the registry keeps unreachable projects listed and read-only; manual `reconnect(id)` only | The same with automatic retry and backoff; a registry-only health check |
| SSH spawn and tree kill | The WSL `setsid` launcher on an exec channel, every element single-quoted by one fixed quoter; `kill -KILL -- -<pgid>` on a second channel | Signalling the exec channel only |
| Live walk server | Environment variables with key auth; run here against sshd in WSL Ubuntu on localhost | Variables with any auth read from the secret store |
| WSL Reconnect | Reconnect starts a stopped distribution (`wsl.exe -d <distro> --exec true`); normal calls never do | Report only; the user starts it |
| Defaults stated, not asked | Remote platform from `uname -s` (Linux, macOS; others refused); macOS servers are `proxy-only`; one connection per server shared by its projects; SSH git goes through the group launcher; the polling watch is shared with WSL | — |

## Approach

1. Add `ssh2` (and `@types/ssh2`) with pnpm, and check that electron-vite keeps it external in the main build and that `pnpm package` includes it. `cpu-features` is optional and is not built.
2. Move the launcher constant and the polling watch out of `src/main/env/wsl.ts` into shared modules (`src/main/env/launcher.ts`, `src/main/env/poll-watch.ts`), with the WSL tests unchanged.
3. Add the `connection` part to `Environment` in `src/main/env/types.ts`, with the local and WSL implementations and their tests.
4. Add the server store (`src/main/projects/servers.ts`) over `localEnvironment().files` and the secret store (`src/main/secrets/store.ts`, unchanged API).
5. Add `ssh-transport.ts` (the real transport over `ssh2`) and the fake transport, then `ssh.ts`: the quoter, path, files, process, network, watch, git and connection, with the unit tests.
6. `environmentFor` for the SSH kind (`src/main/env/index.ts`), with the server store injected.
7. Store and registry (`src/main/projects/store.ts`, `registry.ts`): the SSH descriptor, the per-project state, read-only refusals, `stateOf`, `onStateChange` and `reconnect`. Wire the server store and the state into `src/main/index.ts` (no IPC).
8. The recording backend over SSH, the boundary scan for `ssh2`, the credential scan.
9. The live SSH walk through `tests/support/headless-walk.ts`, run against sshd in WSL.
10. Docs (D43 and the rest), then the full checks.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The environment interface has five parts and a narrower tool view | `docs/environments.md` "The interface"; `src/main/env/types.ts` |
| The WSL launcher is a constant that can be shared | `src/main/env/wsl.ts:42` (`WSL_LAUNCHER`) |
| git takes an injected launcher | `createGit` in `src/main/git/git.ts` (D42) |
| The secret store has a name pattern that fits `ssh-<uuid>-passphrase` (51 characters) | `src/main/secrets/store.ts:48` (`^[a-z0-9][a-z0-9-]{0,63}$`) |
| The secret store registers values it reads with the redactor | `src/main/secrets/store.ts:39` |
| The store's descriptor union is extended per backend | `src/main/projects/store.ts:32` |
| The registry drops a project whose environment cannot be made | `src/main/projects/registry.ts` `start()` returns null; follow-up in `docs/phases/phase-04-progress.md:49` |
| Only two app-data stores may import `node:fs`; the boundary test lists them | `tests/unit/env-boundary.test.ts:46-64` |
| `environmentFor` takes injected dependencies for tests | `src/main/env/index.ts:33` (`EnvironmentDeps`) |
| `ssh2` 1.17.0 exists, with `asn1` and `bcrypt-pbkdf` as dependencies and `cpu-features` and `nan` optional | `pnpm view ssh2` |
| An OpenSSH client exists on this machine (for the live setup) | `ssh -V`: OpenSSH_9.0p1 |
| The unreachable state is a phase 4 requirement | `docs/PRD.md:115`, `docs/design-notes.md:264`, `docs/phases/phase-04-projects.md:29` |

## Risks

- **Packaging `ssh2`:** electron-vite may bundle it instead of keeping it external, or the package build may miss it. Checked in step 1 with `pnpm build` and the e2e package step.
- **SFTP codes:** a generic `FAILURE` hides the real cause. The `lstat` follow-up covers the codes the modules rely on; others become `EIO`, recorded as a deviation.
- **The quoter is the one command-line builder.** A mistake would let an argument reach the remote shell. Mitigation: one function, tests with quotes, `$`, backticks, newlines and NUL (refused), and the reviewer's focus.
- **The variables appear in the remote process list** through the `env` prefix (not credentials, which never cross). Recorded in D43 as a limit; `ssh2`'s `env` requests are refused by most servers (`AcceptEnv`).
- **The live walk needs sshd in WSL.** If it is not installed or not running, the live run is reported as not run, and the unit walk still covers the backend.
- **The `connection` part touches every backend and the registry.** The local behaviour must stay the same; the existing registry and lock tests must hold unchanged.

## Open questions

None.
