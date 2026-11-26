# Projects on SSH servers, and the unreachable, read-only project state

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-env-ssh/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-env-ssh

## Context

Every module that works in a project goes through an `Environment` (D41), with local and WSL backends (D42). There is no SSH backend, no place for a server's details or secrets, and no idea of an unreachable environment: the registry drops a project whose environment cannot be made, so a project on a stopped WSL distribution disappears from the list and cannot be removed.

This work adds saved SSH servers (secrets in `safeStorage`, host keys pinned and confirmed) and an SSH backend for the whole interface over `ssh2`: SFTP for files, exec channels with the shared `setsid` launcher for programs and git, and a polled watch (D43). It adds a connection part to the interface, so the registry keeps an unreachable project listed, removable and read-only until Reconnect, for WSL and SSH alike. The phase 3 headless walk runs on an SSH project.

## Required work

- T1 Dependency (`ssh2`).
- T2 Shared launcher and polling watch.
- T3 Connection part (local and WSL).
- T4 Saved servers.
- T5 Quoter.
- T6 Transport interface and fake.
- T7 Path and files.
- T8 Process part.
- T9 Watch, git, connection and failures.
- T10 App transport.
- T11 environmentFor.
- T12 Store and registry.
- T13 Recording backend, boundary and credential scan.
- T14 Live SSH walk.
- T15 Docs.
- T16 Full checks.

## Acceptance criteria

- AC1 saved servers: validation, trust, remove rules, the corrupt file, and no secret in the saved file.
- AC2 host keys: unpinned gives `host-key-unknown` with the fingerprint, a changed key gives `host-key-changed` and keeps the pin, the pinned key connects.
- AC3 quoter: hostile arguments stay single arguments; NUL is refused.
- AC4 path and files: `path.posix`, every method with the contract's Node codes, the capped read, rename over an existing file.
- AC5 process: the exact exec string, changed variables only and never `PATH`, the hidden marker, the group kill, `{ started: false }`, the platform from `uname -s`, the network level and `networkLevel()`.
- AC6 watch: the shared polling watcher, with the WSL tests unchanged.
- AC7 git: the same argument lists, values and codes; exit 127 is `git-missing`; a timeout kills the remote group.
- AC8 lost connection: a result for every call, no throw, no local path.
- AC9 connection part: local always connected; WSL unreachable when stopped or missing, and Reconnect starts it; SSH follows its transport.
- AC10 environmentFor: SSH for a known server without connecting; fixed refusal otherwise.
- AC11 store and registry: SSH add and refusals; unreachable projects listed, removable and read-only; a drop closes the watcher; Reconnect restores it.
- AC12 no credentials in any exec string, argument, variable, log line, file, reason or state payload.
- AC13 recording backend over SSH.
- AC14 boundary: only `ssh-transport.ts` imports `ssh2`; no new `node:fs` importer.
- AC15 the live SSH walk passes against sshd in WSL on this machine, is skipped without its variables, and never runs in CI.
- AC16 packaging: `ssh2` stays external and is packaged.
- AC17 docs: the CHANGELOG, D43, environments, agent commands, workflow engine, CLAUDE.md, README, PRD, the phase doc and the progress file.
- AC18 checks: typecheck, lint, format:check, test and e2e pass; no existing assertion changed.

## Out of scope

- Dev containers.
- The projects screen, the Reconnect button and the read-only session UI.
- The add wizard, including fingerprint confirmation and WSL detection.
- IPC for servers, projects, state or Reconnect.
- Automatic reconnect, jump hosts, `~/.ssh/config`, the user's `known_hosts`, port forwarding and Windows SSH servers.
- A change to the local backend's behaviour.

## Links

- Plan: docs/specs/p4-env-ssh/PLAN.md
- Spec and tasks: docs/specs/p4-env-ssh/SPECS.md, docs/specs/p4-env-ssh/tasks.md
