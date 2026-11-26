# Dev container backend (docker exec, found by the devcontainer label)

**Parent:** none: no tracker configured
**Spec:** docs/specs/p4-env-container/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p4-env-container

## Context

Projects can live on this computer, in WSL and on SSH servers (D41–D43), but not in a dev container. This adds the fourth environment backend and records how dev containers are attached as D44: the docker CLI, with each call a `docker exec` through the shared setsid launcher. The container is found by its `devcontainer.local_folder` label, so a rebuilt container keeps the project. Programs run as the dev container's `remoteUser`, and Docker is reached on the host PATH or through a WSL distribution.

## Required work

- T1 Transport interface and docker command.
- T2 Lookup, user and exec form.
- T3 Path and files (fixed scripts by exec).
- T4 Process part.
- T5 Watch, git and connection.
- T6 Detection (`detectDocker`, not wired).
- T7 environmentFor, store and registry.
- T8 Walk, recording backend and boundary.
- T9 Live container walk.
- T10 Docs.
- T11 Full checks.

## Acceptance criteria

- AC1–AC3: the descriptor, the lookup and user rule, and the docker command for both hosts, with no variable value in an argument.
- AC4–AC6: files with the contract's codes and the byte cap; spawn with the group kill and the network level; the watch and git.
- AC7: the connection part. `reconnect()` starts a stopped container. A gone container makes the backend unreachable, and every call is a result.
- AC8–AC10: environmentFor, the registry's unreachable and Reconnect behaviour for container projects, and detection.
- AC11–AC13: the headless walk on the fake transport, the recording backend, the boundary scan, and the live walk in a real container.
- AC14–AC15: docs (D44 and the rest), and every check green with no assertion changed.

## Out of scope

- Building containers from devcontainer.json, the devcontainer CLI, compose, plain unlabelled containers, Windows containers.
- Any UI, IPC or automatic reconnect.

## Links

- Plan: docs/specs/p4-env-container/PLAN.md
- Spec and tasks: docs/specs/p4-env-container/SPECS.md, docs/specs/p4-env-container/tasks.md
