# Projects inside WSL: a WSL backend for the environment interface

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-env-wsl/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-env-wsl

## Context

Every module that works in a project goes through an `Environment` (D41), but the only backend is local. The project store accepts only local projects, so a repository inside a WSL distribution cannot be added or reached.

This work adds a WSL backend for the whole interface: files on the distribution's share, programs and git through `wsl.exe`, and a polled watch (D42). It also adds detection for the wizard, and WSL projects in the store and registry. The phase 3 headless walk runs on a WSL project.

## Required work

- T1 git launcher.
- T2 Detection.
- T3 Fake transport, path and files.
- T4 Process part.
- T5 Watch part.
- T6 Git part, failures and the app transport.
- T7 environmentFor.
- T8 Store and registry.
- T9 Recording backend and boundary.
- T10 Headless walk helper and the live WSL walk.
- T11 Docs.
- T12 Full checks.

## Acceptance criteria

- AC1 detection: UTF-16LE parsing, invalid names dropped, `{ installed: false }` off Windows and on any failure; nothing runs at import.
- AC2 path and files: `path.posix`; every files method on the share with Node codes; the capped read gives `EFBIG`; `realpath` and `readlink` map back to Linux paths; `symlink` and `chmod` run through the transport.
- AC3 process: the launcher argv with every argument as its own element; only changed variables cross through `WSLENV`, never `PATH`; the marker line is hidden; the group kill runs on timeout and abort; `{ started: false }`; platform `linux`; the network level comes from a once-only unshare probe, and `networkLevel()` agrees.
- AC4 watch: polled events for one folder; no baseline events; `onError` once per run of failures; nothing after `close()`.
- AC5 git: the same argument lists as local through `wsl.exe`, the same parsed values and the same codes; the git tests unchanged.
- AC6 no throw, no fallback, with a dead transport.
- AC7 environmentFor: WSL on `win32`, `WSL_UNAVAILABLE` elsewhere, `UNSUPPORTED_ENVIRONMENT` for a bad name; local unchanged.
- AC8 store and registry: WSL add with the root checked through the environment; each refusal; duplicates by kind, distribution and root; load; the registry builds it.
- AC9 recording backend over the WSL backend: a tool, `run_command`, the lock and `approveResult`.
- AC10 boundary: the scans pass, and only the two WSL modules name `wsl.exe`.
- AC11 headless walk: the unit walk goes through the shared helper unchanged; the opt-in live WSL walk passes on this machine and never runs in CI.
- AC12 docs: the CHANGELOG, D42, `docs/environments.md`, `docs/agent-commands.md`, `CLAUDE.md`, README, PRD, the phase doc and the progress file.
- AC13 checks: typecheck, lint, format:check, test and e2e pass; no existing assertion changed.

## Out of scope

- SSH and dev container backends.
- The unreachable and read-only project state, and Reconnect (`p4-env-ssh`).
- The add wizard UI and project UI or IPC.
- Starting a stopped distribution on purpose.
- Changes to the tools, commands, agent host, lock, watcher or ship modules beyond what the store and registry need.
- A change to the local backend's behaviour.

## Links

- Plan: docs/specs/p4-env-wsl/PLAN.md
- Spec and tasks: docs/specs/p4-env-wsl/SPECS.md, docs/specs/p4-env-wsl/tasks.md
