# Build ledger: p4-env-wsl

state: done
revision: 1
resume on approve: no
current round: 2 of 3, in revision 1
phase: reviewing
Implementor: a6940a0e7fa68c4de, haiku    Reviewer: aed028d9767b8f506, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1 to T9 are done and ticked. T10 is partly done: the walk helper and the local unit walk pass, but the live WSL walk is intermittent, so it is unticked. T11 (docs) has not started, and T12 has not completed.

Checks run:
- typecheck, lint and format:check pass.
- `pnpm test` in parallel fails 4 of 4 runs: the local headless walk hits EPERM on a rename in `spec-lock.ts` `writeAtomic`. The serial run passes: 1771 passed, 17 skipped.
- `pnpm test:live` WSL walk: 2 passes and 4 failures (EPERM, a refused action, and a build step that could not finish).

## Implementation (revision 1, Mode 3)

T9b, T10, T11 and T12 are done, so T1 to T12 are all ticked.
- **T9b:** `writeAtomic` calls `writeFileAtomic(..., { codeReason: true })`. The new option is opt-in; with the default, the result is unchanged.
- **Live WSL walk:** passed 3 runs in a row (15.3 s, 16.1 s and 16.0 s).
- **Checks:** typecheck, lint and format:check pass. `pnpm test` in parallel: 1774 passed, 17 skipped. e2e: 21 passed, 2 skipped (macOS only).
- **AC13:** the only removed `expect` lines are the 63 walk lines, which moved to the helper.

## Revision 1, round 1  (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor (optional) | src/main/workflow/spec-lock.ts:130 | ACCEPT | The `writeSpecState` comment says `<file>.<random>.tmp`; the shared writer names it `.<file>.<random>.tmp` (atomic-write.ts:54-62) | Comment corrected; prettier and eslint pass on the file; the changes.md row is updated |

The reviewer judged every implementor deviation acceptable. Its runtime checks: the group kill of a hung command on real WSL, and a Linux git process outliving a killed wsl.exe.

## Revision 1, round 2  (PASS)

No findings. The reviewer verified that R1-1 is fixed and that nothing else changed since round 1. The two runtime checks from round 1 still stand.

## Spec problems

- Revision 0 pause, from the implementation report.
  - The spec line (D42): "**Files** use `node:fs` on the distribution's share", with `rename` calling `node:fs` on the mapped path, and "The Node codes pass through unchanged".
  - What is wrong: a rename over an existing file on `\\wsl.localhost\Ubuntu` fails with EPERM about 7% of the time (22 of 300 in a probe; local NTFS 0 of 300). `writeAtomic` in `src/main/workflow/spec-lock.ts` renames once with no retry, so the live walk fails. The parallel unit suite also fails locally with the same EPERM in the local walk.
  - Candidates:
    1. a bounded rename retry in the WSL files part only;
    2. a bounded retry in `spec-lock.ts` `writeAtomic` for every backend, with the same budget as `tools/atomic-write.ts` (the implementor recommends this);
    3. WSL `rename` runs `mv -f --` through the transport;
    4. keep the spec and accept a flaky walk.
  - User chose: Revise the spec. Decision: the spec lock's `writeAtomic` uses the shared `writeFileAtomic` and its rename retry, with its result and reasons unchanged.
  - SPECS.md was amended: Non-goals, a new Design section "Spec lock atomic write", AC14, and the decision under Open questions. tasks.md gained T9b, and T10, T11 and T12 were revised.
  - Re-approved; build resumed (Mode 3).

## Carried findings

- none: no review has run yet.
- Implementor deviations to pass to the reviewer:
  - watch compares subfolders by name only;
  - `shareFor` refuses a segment containing `\` or `:`;
  - chmod failure gives ENOENT or EIO;
  - variable names that are not WSLENV-safe are dropped;
  - the WSLENV on wsl.exe holds the crossing names only;
  - an empty detection list gives installed with no distributions;
  - a git timeout kills wsl.exe, but the Linux git process may outlive it;
  - one `sed -i` edit on the fake transport;
  - a stray `bash.exe.stackdump` file.
