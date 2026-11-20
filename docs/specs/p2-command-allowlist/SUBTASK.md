# Command allowlist, file protection and network limits (p2-command-allowlist)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/p2-command-allowlist/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/p2-command-allowlist`

## Context

`run_command` reaches a command check that denies everything (D30), and on Windows the runner refuses `.cmd` shims such as `pnpm` (D29), so no job can run tests or builds. This work adds what D6 asks for:

- a per-project allowlist of detected test and build commands for Node, Python, Go and Rust: the writer may run tests and the build, the reviewer tests only, in exact forms from the root;
- Windows shims run through `cmd.exe`, built only from allowlisted, safe tokens;
- `docs/specs/` is read-only while a command runs, and is restored from a snapshot afterwards, along with the `.git` key files. The reviewer's changes to files that aren't git-ignored are reverted too;
- no network for the writer: a network namespace on Linux, `sandbox-exec` on macOS, and dead proxy and offline variables everywhere. The level reached is reported;
- Rule events for every revert and for the network level.

## Required work

- T1 Detection
- T2 Command check
- T3 Program lookup and the Windows rule
- T4 Snapshot, lock and restore
- T5 Network wrapper
- T6 Rule events
- T7 Runner, router and host
- T8 Decision D31
- T9 Changelog and project docs
- T10 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1 (detection): the test and build forms for each type and package manager. Missing or invalid markers give no forms.
- AC2 (check): the writer gets tests and the build, the reviewer tests only, in exact forms from the root. Everything else is denied with fixed reasons.
- AC3 (gate and host): allow and deny Rule events through the gate; the host uses the detected check.
- AC4 (lookup and Windows): PATH and PATHEXT lookup; the `cmd.exe` line only from safe tokens; a `.cmd` stub runs on Windows.
- AC5 (spec lock and restore): `docs/specs/` is read-only during a command and byte- and mode-identical after it.
- AC6 (`.git` key files): HEAD, refs and hooks are restored; the index is untouched.
- AC7 (reviewer revert): non-ignored changes are reverted, while ignored files and `node_modules` are kept. The writer's source changes are kept. The snapshot cap refuses a command before it starts.
- AC8 (restore always): the restore also runs after a timeout or a start failure.
- AC9 (network): the wrapper choice per OS; the writer-only variables; a real block where the OS supports it; one network event per writer command.
- AC10 (router): the job is passed to the runner.
- AC11 (docs): D31, with D29's open question settled.
- AC12 (changelog and project docs): CHANGELOG entries, a new `docs/agent-commands.md` reference, and stale docs updated in the same change.
- AC13 (checks): typecheck, lint, format check and unit tests pass.

## Out of scope

- Job prompts (`p2-jobs-and-prompts`).
- The human-only channel (`p2-human-only-channel`).
- Real workflow states (Phase 3).
- A project settings file and user-edited allowlists (Phase 4).
- Makefiles, extra command arguments, containers.
- Any UI.

## Links

- Plan: docs/specs/p2-command-allowlist/PLAN.md
- Spec and tasks: docs/specs/p2-command-allowlist/SPECS.md, docs/specs/p2-command-allowlist/tasks.md
