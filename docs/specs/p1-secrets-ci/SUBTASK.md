# Fix the spike e2e on Linux and macOS after p1-secrets

**Parent:** none: no parent chosen (Phase 1, fix for subtask 2)
**Spec:** docs/specs/p1-secrets-ci/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p1-secrets-ci

## Context

PR #8 was merged before CI finished, and `main` is red: the spike e2e test fails on Linux (the seed run exits 1) and on macOS (the requests don't carry the stored key). This subtask makes the test explain its failures without printing the key, makes the test-only weak-backend override work on Linux through Electron's plain-text switch, pauses for a CI run to diagnose macOS, fixes it in a spec revision, and merges only on green CI on all three OSes.

## Required work

- T1 Test diagnostics.
- T2 Linux plain-text switch.
- T3 Docs for the Linux fix.
- T4 CI checkpoint (build pauses; branch pushed, draft PR opened).
- T5 macOS fix (settled in revision 1).
- T6 Remaining docs.
- T7 Full check.

## Acceptance criteria

See AC1–AC7 in docs/specs/p1-secrets-ci/SPECS.md:

- **AC1:** run output in every failure message, checked for the sentinel first.
- **AC2:** headers reported as `missing`, `placeholder`, `sentinel` or `other`, never as values.
- **AC3:** plain-text encryption only on Linux with the override, once, before the store's first use; unit tested.
- **AC4:** the build pauses for a CI run on a draft PR.
- **AC5:** the macOS fix, settled in revision 1.
- **AC6:** CHANGELOG, D25, README, CLAUDE.md and the progress file updated.
- **AC7:** local checks pass; CI green on all three OSes before merge.

## Out of scope

- Async `safeStorage` calls; a real keyring in CI; changes for real users; the other `p1-secrets` notes.

## Links

- Plan: docs/specs/p1-secrets-ci/PLAN.md
- Spec and tasks: docs/specs/p1-secrets-ci/SPECS.md, docs/specs/p1-secrets-ci/tasks.md
