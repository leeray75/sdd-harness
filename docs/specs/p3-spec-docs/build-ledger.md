# Build ledger: p3-spec-docs

state: done
revision: 0
resume on approve: no
current round: 1 of 3, in revision 0
phase: reviewing
Implementor: a825fefcdea517602, haiku    Reviewer: acec51fb1d0ac51e6, sonnet
Data agent: none (not used)
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation, revision 0 (Mode 1)

- Done: T1–T7 (all ticked). typecheck, lint, format:check pass; pnpm test 62 files, 1294 passed, 13 skipped. 20 finished docs/specs folders detected as closed.
- Concerns reported:
  - The file-symlink test is skipped on this Windows account (EPERM). It runs on Linux CI. The directory-junction case always runs.
  - SUBTASK has four `<feature>` placeholders, not the three PLAN.md lists; the test asserts four.
  - Extra exports: an optional third `approval` argument on `readSpecFolder`, and `readSpecFolderAt` for the vendored folder.
  - The `Phase` union is declared in both shared modules, so `spec-detect.ts` imports only `./workflow`.

## Revision 0, round 1 (PASS)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| ------- | -------- | -------- | -------------------- | --------- | ------ |
| (none)  |          |          |                      |           |        |

Needs a runtime check (reviewer): the file-symlink test, skipped on this Windows account, should pass on the Linux CI `check` job. Also noted, not raised as a defect: `scanSpecFolders` calls the caller's `approvalOf` without a try/catch, so a callback that throws would reject the scan (the spec doesn't require a guard). The orchestrator re-ran the check job locally: typecheck, lint and format:check pass; `pnpm test` gives 62 files, 1294 passed, 13 skipped.

## Spec problems

none

## Carried findings

none
