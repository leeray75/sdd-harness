---
status: done
ticket:
---

# p4-env-ssh

## Problem

F3 needs projects on SSH servers, and it needs a project whose environment cannot be reached to stay visible, read-only and recoverable. Since `p4-env-wsl`, the environment interface (D41) has a local and a WSL backend, but `environmentFor` refuses any other kind, and there is nowhere to keep a server's details or its secrets. The registry also drops a project whose environment cannot be made, so a project on a stopped WSL distribution (or a server that is down) disappears from the list and cannot even be removed. Nothing in main knows that an environment is unreachable or how to bring it back.

## Goals

- **G1:** An SSH backend implements the whole `Environment` interface for one saved server and a remote POSIX root, with the same contract as the local and WSL backends (`docs/environments.md`).
- **G2:** Saved servers live in app data with no secret in them. Passwords and key passphrases live in the secret store (`safeStorage`) and never reach a file, argument, environment variable, reason text or log line. Host keys are pinned per server and confirmed, and a changed key always refuses.
- **G3:** An environment reports whether it is reachable, and can reconnect. The registry keeps an unreachable project listed, removable and read-only, and Reconnect restores it. This covers local (always reachable), WSL (a stopped or missing distribution is unreachable) and SSH. Nothing falls back to local.
- **G4:** The project store and the registry accept `{ kind: 'ssh', server }` projects, with the root checked through the environment.
- **G5:** The phase 3 headless walk runs on an SSH project in an opt-in live test.
- **G6:** The SSH library, credential handling and host key policy are recorded as D43, and the docs are current.

## Non-goals

- Dev containers (`p4-env-container`).
- The projects screen, the Reconnect button and the look of a read-only session (`p4-projects-screen`).
- The add wizard, including showing a fingerprint, calling `trustHostKey` and calling `detectWsl` (`p4-add-project-wizard`).
- IPC for servers, projects, the connection state or Reconnect.
- Automatic reconnect, jump hosts, `~/.ssh/config`, the user's `known_hosts`, port forwarding, and Windows SSH servers.
- Any change to the local backend's behaviour. The WSL backend changes only by the shared launcher module, the shared polling watch and its `connection` part.

## Design

### D43: the SSH library, credentials and host keys

- **Library:** `ssh2` (1.17.x) is a runtime dependency of main. Only `src/main/env/ssh-transport.ts` imports it. `@types/ssh2` is a dev dependency. The optional `cpu-features` is not built, and `ssh2` works without it.
- **Credentials:** read at connect time only. A password comes from the secret store entry `ssh-<serverId>-password`; a key passphrase from `ssh-<serverId>-passphrase`; a private key from its file, read in memory through `localEnvironment().files`. They are passed to `ssh2` in memory and never stored elsewhere. Agent auth uses `SSH_AUTH_SOCK`, or `\\.\pipe\openssh-ssh-agent` on Windows when that variable is unset.
- **Host keys:** each server has `hostKey`, a pinned `SHA256:<base64>` fingerprint, or `null`. The transport's host key check compares the offered key's fingerprint with the pinned one. With no pinned key, the connect fails with `host-key-unknown` and the offered fingerprint (a public value). With a different key, the connect fails with `host-key-changed`, and the pin is never replaced automatically. Only `trustHostKey(id, fingerprint)` pins a key.

### Saved servers (`src/main/projects/servers.ts`)

- `createServerStore({ filePath, secrets, logger })` keeps `ssh-servers.json` as `{ "version": 1, "servers": [...] }` in app data, saved whole after each write through `writeFileAtomic(localEnvironment().files, …)`. It does not import `node:fs`.
- A server is `{ id, name, host, port, user, auth, hostKey }`:
  - `id`: a lowercase UUID, made by the store.
  - `name`: 1 to 80 characters after trimming, no line break.
  - `host`: a DNS name (`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`), an IPv4 literal, or an IPv6 literal in brackets or bare. No space, no leading `-`, no `@`.
  - `port`: an integer 1 to 65535, default 22.
  - `user`: `^[a-z_][a-z0-9_.-]{0,31}$`.
  - `auth`: `{ method: 'key', keyPath: <local absolute path>, hasPassphrase: boolean }`, `{ method: 'agent' }` or `{ method: 'password' }`.
  - `hostKey`: `null` or a fingerprint matching `^SHA256:[A-Za-z0-9+/]{43}$`.
- `add(input, secret?)`, `list()`, `get(id)`, `update(id, changes, secret?)`, `trustHostKey(id, fingerprint)` and `remove(id, inUse)` return `{ ok: true, server }` or `{ ok: false, reason }` with fixed reasons that never echo input. `add` and `update` take the password or passphrase as a separate argument and save it to the secret store; a save that fails leaves both unchanged. Changing `host` or `port` clears `hostKey`. `remove` is refused while `inUse(id)` is true (a stored project uses the server) and deletes the server's secrets.
- A file that cannot be read, is not JSON, has another `version` or holds an invalid server is set aside as `ssh-servers.json.corrupt-<timestamp>`, with one log line giving only a reason code, as the project store does (D40).

### The SSH transport (`src/main/env/ssh-transport.ts`)

- `SshTransport` is the interface the backend uses, so the tests can use a fake:
  - `state()` (`connected` or `unreachable`), `onChange(listener)`, `connect()` resolving `{ ok: true }` or `{ ok: false, code, fingerprint? }` with `code` one of `host-key-unknown`, `host-key-changed`, `auth-failed`, `unreachable`, `unsupported-system`;
  - `sftp`: the SFTP calls the files part needs, each resolving a value or an error with an SFTP status code or `ENOTCONN`;
  - `exec(command, options)`: runs one command string on a new channel, streams stdout and stderr, can be closed, and resolves the exit code, the signal, `timedOut`, `aborted` and, when asked, captured output; `{ started: false }` when not connected. It never rejects.
- `appSshTransport(server, deps)` is the app's transport over `ssh2`: one `Client` per server id, shared by every project on that server, with `keepaliveInterval` 15 s and `keepaliveCountMax` 3, and a ready timeout of 20 s. Its host key check is the pinned-fingerprint rule above. A `close`, `end` or `error` event moves it to `unreachable` and notifies listeners once. It never reconnects by itself.
- On connect it runs `uname -s` once: `Linux` gives platform `linux`, `Darwin` gives `darwin`, and anything else ends the connection with `unsupported-system`.

### The SSH backend (`src/main/env/ssh.ts`)

`createSshEnvironment({ server, transport })` returns an `Environment`:

- **Quoter.** `shellQuote(arg)` wraps each element in single quotes and writes each `'` as `'\''`. An argument holding a NUL byte is refused (the spawn resolves `{ started: false }`). It is the only place in the backend that builds a command string, and every exec string is built from quoted elements only.
- **path:** `path.posix`, with `sep` `/`. Every path given to `files` must be absolute POSIX; any other path is `ENOENT`.
- **files** over SFTP:
  - `stat`, `lstat`, `realpath`, `readlink`, `readdir` (with file types), `mkdir` (with `recursive`), `rmdir`, `rename`, `chmod`, `symlink`, `writeFile`, `open` (reads by byte range) and `access` (`exists`, and `execute` from the mode bits for the connected user's uid and gids, read once).
  - `rm` with `recursive` walks the tree over SFTP; `rm` of a missing path with `force` succeeds.
  - Codes: SFTP `NO_SUCH_FILE` is `ENOENT`, `PERMISSION_DENIED` is `EACCES`, `NO_CONNECTION` and `CONNECTION_LOST` are `ENOTCONN`. A generic `FAILURE` is resolved by an `lstat` of the path, and of the target for `rename` and `symlink`: an existing target for `mkdir`, `rename` onto a folder, or `symlink` is `EEXIST`; a file where a folder is needed is `ENOTDIR`; a folder where a file is needed is `EISDIR`; `rmdir` of a non-empty folder is `ENOTEMPTY`; otherwise `EIO`.
  - `readFile` with `maxBytes` opens the file, stats the handle, refuses a larger file with `EFBIG`, and reads at most `maxBytes + 1` bytes, refusing with `EFBIG` if more arrive.
  - `rename` over an existing file uses the `posix-rename@openssh.com` extension when the server offers it, else removes the target first and then renames.
- **process:**
  - `platform` is the value read at connect (`linux` or `darwin`).
  - `spawn(file, argv, options)` runs one exec string: `cd -- <cwd> && exec env -- <NAME=value…> sh -c <LAUNCHER> sh <file> <args…>`, every element quoted. `LAUNCHER` is the constant moved from `wsl.ts` to `src/main/env/launcher.ts`, unchanged, with its marker handling. The marker line is never passed to `onOutput`.
  - Variables: only the variables the caller set or changed relative to the app's own environment cross; `PATH` never crosses; a name that is not `^[A-Za-z_][A-Za-z0-9_]*$` is dropped.
  - On timeout or abort, the backend runs `kill -KILL -- -<pgid>` on a second exec channel, then closes the first channel, then resolves. Output after that is not passed on. When the group id never arrived, only the channel is closed.
  - `{ started: false }` when the transport is not connected or the cwd is not absolute POSIX.
  - `network: 'none'`: on Linux, `unshare --user --map-root-user --net true` is probed once per connection; when it works the level is `os` and the program runs inside the Linux unshare wrapper from `src/main/commands/network.ts`; otherwise `proxy-only`. On macOS the level is `proxy-only`. The dead proxy variables and offline flags cross as variables. `networkLevel()` gives the same answer.
- **watch:** `watchDir` uses the polling watcher moved from `wsl.ts` to `src/main/env/poll-watch.ts`, unchanged: about every second, `rename` for added and removed names, `change` for a changed size or mtime, subfolders by name only, no events for the baseline, `onError` once per run of failures, nothing after `close()`.
- **git:** `createGit(sshLauncher)` from `src/main/git/git.ts`. The SSH launcher runs git through the same launcher and group kill as `spawn` (`cd -- <root> && exec env -- … sh -c <LAUNCHER> sh git <args…>`), so a timeout kills the remote git. Exit 127 is `git-missing`. The argument lists, environment, timeouts, parsing and codes are unchanged.
- **connection:** follows the transport; `reconnect()` calls `transport.connect()` and maps its failure code to a fixed reason.
- No method throws out of the backend. Every failure is a result: a Node code, `{ started: false }` or a git code.

### The connection part (`src/main/env/types.ts`)

- `Environment` gains `connection: ConnectionPart` with `state(): 'connected' | 'unreachable'`, `onChange(listener): () => void` and `reconnect(): Promise<{ ok: true } | { ok: false; reason: string }>`. `ToolEnvironment` does not get it.
- **Local:** always `connected`; `onChange` never fires; `reconnect` resolves `{ ok: true }`.
- **WSL:** `unreachable` when the share root was not found, or when a transport run reports `{ started: false }` or `wsl.exe`'s "no distribution" exit; `connected` again after a successful run. `reconnect()` runs `wsl.exe -d <distro> --exec true` through the transport (which starts a stopped distribution) and finds the share root again. Normal calls never run that command.
- **SSH:** the transport's state.

### environmentFor (`src/main/env/index.ts`)

- `{ kind: 'ssh', server }` builds the SSH backend when `server` is a UUID known to the server store, with the app's transport for that server. An unknown or malformed id is refused with `UNSUPPORTED_ENVIRONMENT`. Making the backend does not connect.
- The server store and the transport maker are injected through `EnvironmentDeps` for the tests. The local and WSL kinds are unchanged.

### Store and registry

- **Store** (`src/main/projects/store.ts`): `ProjectEnvironment` gains `{ kind: 'ssh'; server: string }` with a lowercase UUID. An SSH root is a string, absolute POSIX and equal to `posix.resolve` of itself, and must be an existing folder through the environment passed to `store.add`; an SSH add without an environment is refused. Duplicates compare kind, server and root exactly. Loading an SSH entry does not touch the network.
- **Registry** (`src/main/projects/registry.ts`):
  - Each entry has a state, `connected` or `unreachable`. At start, the registry makes each project's environment and, for a non-local environment, calls `connection.reconnect()` once. A project whose environment cannot be made, or whose connect fails, gets an `unreachable` entry with no watcher, instead of no entry.
  - An unreachable project stays in `projects()` and can be removed, and `buildOptionsFor` and `environmentOf` return `null`. How `handlerFor` refuses its actions depends on the cause (revision 1):
    - **Made but unreachable** (the environment was made, but its connect failed or the connection dropped): refused with `PROJECT_UNREACHABLE` ("this project's environment is unreachable; reconnect to continue").
    - **Cannot be made** (an unknown kind, a bad distribution name, an unknown or removed SSH server id): refused with the existing `no project with this id` text, as today, so the existing registry test holds unchanged. `stateOf` still gives `unreachable`, and `reconnect(id)` tries to make the environment again.
  - The registry listens to each environment's `onChange`. A move to `unreachable` closes the project's watcher and notifies `onStateChange` listeners; it does not reconnect.
  - `stateOf(id)` returns the state, or `null` for an unknown project. `onStateChange(listener)` returns an unsubscribe. `reconnect(id)` makes the environment again if it was never made, calls `reconnect()`, and on success starts the watcher, rebuilds the handlers, refreshes once and notifies listeners; it resolves `{ ok: true }` or `{ ok: false, reason }` with a fixed reason.
  - `addProject` for an SSH project connects first (through the environment's `reconnect`) and refuses with its reason if that fails, so nothing is stored for a server that cannot be reached.
- **App wiring** (`src/main/index.ts`): the server store in app data, passed to `environmentFor`. No IPC is added.

### Tests

- `tests/support/fake-ssh-transport.ts`: a fake `SshTransport` over a temp folder that stands in for the remote `/`. Its `exec` interprets only the fixed command shapes the backend builds (by parsing the quoted elements, never by running a shell), runs the program locally where the test needs it, and records every exec string. It can be switched to `unreachable`, and can report each connect failure code.
- Unit tests in `tests/unit/env-ssh.test.ts`, `ssh-servers.test.ts`, `ssh-quote.test.ts`, `env-connection.test.ts`, and appended cases in the store, registry, recording, boundary and WSL tests. No existing assertion changes.
- `tests/live/ssh-walk.live.test.ts`: the headless walk through `tests/support/headless-walk.ts` on a temp repo under `HARNESS_SSH_ROOT` on the server named by `HARNESS_SSH_HOST`, `HARNESS_SSH_PORT` (default 22), `HARNESS_SSH_USER` and `HARNESS_SSH_KEY` (a key file path; key auth with no passphrase), with the host key pinned from `HARNESS_SSH_FINGERPRINT` when set, else trusted from the first connect inside the test. Skipped when any required variable is unset; never in CI. Its temp folders are removed afterwards over SFTP.

## Acceptance criteria

- **AC1 saved servers:** `ssh-servers.test.ts` shows add, list, get, update, trust and remove with each validation refusal; a changed host or port clears the pin; `remove` is refused while in use and deletes the server's secrets; the corrupt file is set aside with a code-only log line; and the saved file never holds the password or passphrase given to `add` or `update`.
- **AC2 host keys:** with the fake transport and the app transport's check function, an unpinned server's connect fails with `host-key-unknown` and the offered fingerprint, a different key fails with `host-key-changed` and leaves the pin unchanged, and the pinned key connects.
- **AC3 quoter:** `shellQuote` round-trips arguments holding spaces, quotes, `$`, backticks, `;`, `&`, `|`, `*`, newlines and a leading `-` as single arguments (checked by parsing with a POSIX shell where one exists, and by the fake's parser everywhere), and a NUL byte is refused.
- **AC4 path and files:** `path.posix`; every files method over the fake SFTP with the Node codes of the contract, including `EEXIST`, `ENOTDIR`, `EISDIR`, `ENOTEMPTY` and `EIO` from a generic failure; `readFile` with a cap gives `EFBIG` without reading past `maxBytes + 1`; `rename` over an existing file works with and without the extension; a relative path is `ENOENT`.
- **AC5 process:** the exec string for a spawn is exactly the quoted form above; only changed variables cross and never `PATH`; the marker line is hidden; timeout and abort run the group kill before resolving; `{ started: false }` when unreachable; the platform comes from `uname -s`; the network level comes from a once-per-connection probe on Linux and is `proxy-only` on macOS, and `networkLevel()` agrees.
- **AC6 watch:** the shared polling watcher gives the same events for SSH as for WSL, and the WSL watch tests pass unchanged.
- **AC7 git:** the SSH git part sends the same argument lists as the local one, through the launcher, and returns the same values and codes; exit 127 is `git-missing`; a timeout runs the group kill; `git.test.ts` and `git-boundary.test.ts` pass unchanged.
- **AC8 lost connection:** with the transport moved to `unreachable`, every files method gives `ENOTCONN`, `spawn` gives `{ started: false }`, git gives `failed`, `watchDir` calls `onError`, nothing throws, and no call reaches a local path.
- **AC9 connection part:** local is always `connected`; a WSL backend whose share root is missing, or whose run cannot start, is `unreachable` and its `reconnect()` runs `wsl.exe -d <distro> --exec true` and finds the share again; an SSH backend follows its transport and `reconnect()` reconnects it.
- **AC10 environmentFor:** builds SSH for a known server id without connecting; refuses an unknown or malformed id with `UNSUPPORTED_ENVIRONMENT`; local and WSL unchanged.
- **AC11 store and registry:** an SSH project is added with its root checked through the environment, and refused for each bad root, an unreachable server and a duplicate; at start, a project whose environment cannot be made or reached is listed as `unreachable` and removable, and is refused for each human-only action, with `PROJECT_UNREACHABLE` when it was made but cannot be reached and with `no project with this id` when it cannot be made (revision 1), with no watcher and `null` from `buildOptionsFor` and `environmentOf`; a dropped connection moves a project to `unreachable` and closes its watcher; `reconnect(id)` restores the watcher and handlers; the existing registry and store tests pass unchanged.
- **AC12 no credentials leak:** with a known password and passphrase, no exec string, argument array, crossing variable, log line, saved file, reason text or `onStateChange` payload holds either value.
- **AC13 recording backend:** over the SSH backend with the fake transport, a tool, `run_command`, the lock and `approveResult` reach their results through the interface.
- **AC14 boundary:** the existing scans pass; only `src/main/env/ssh-transport.ts` imports `ssh2`; no new module under `src/main/` imports `node:fs`, `node:fs/promises` or `node:child_process`.
- **AC15 headless walk:** `tests/live/ssh-walk.live.test.ts` runs the shared walk on an SSH project and passes against sshd in WSL Ubuntu on localhost on this machine (or the summary says it was not run and why); it is skipped without its variables and never runs in CI; the unit walk is unchanged.
- **AC16 packaging:** `pnpm build` keeps `ssh2` external in the main bundle and `pnpm exec electron-builder --dir` includes it.
- **AC17 docs:** `CHANGELOG.md` (Unreleased), D43 with notes under D41 and D42, `docs/environments.md` (the SSH section, the connection part, the unreachable state and the checklist status), `docs/agent-commands.md` (the network limit over SSH), `docs/workflow-engine.md` (the registry's states and Reconnect), `CLAUDE.md` (the read list names D43; `test:live` names the SSH walk and its variables), `README.md`, `docs/PRD.md`, `docs/phases/phase-04-projects.md`, and row 4 and the follow-ups of `docs/phases/phase-04-progress.md`.
- **AC18 checks:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (parallel) and `pnpm e2e` pass, and no existing assertion changes.

## Open questions

- **2026-11-26, revision 1 (decided):**
  - **Problem:** the refusal for a project whose environment cannot be made conflicted with `tests/unit/project-registry.test.ts:469-487`, which asserts `no project with this id`, and with "no existing assertion changes".
  - **Decision (user):** split by cause. A project whose environment cannot be made is listed as `unreachable` and is removable, but its actions keep the `no project with this id` refusal. Only a project whose environment was made but cannot be reached is refused with `PROJECT_UNREACHABLE`.
  - **Not taken:** changing that one assertion to `PROJECT_UNREACHABLE`; giving no entry to a project whose environment cannot be made.
