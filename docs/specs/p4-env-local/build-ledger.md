# Build ledger: p4-env-local

state: done
revision: 1
resume on approve: no
current round: 2 of 3, in revision 1
phase: reviewing
Implementor: a2e5c261dc23daab8, haiku    Reviewer: a2ba0825e35d4d99f, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1, T3–T11 done and ticked. T2 left unticked: the project store's save uses the shared atomic writer, the secret store's save does not (spec problem below). All five checks passed (typecheck, lint, format:check, test 1682 passed / 15 skipped, e2e 21 passed / 2 skipped).

## Revision 1, round 1  (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor (optional) | tests/unit/env-boundary.test.ts:50 | ACCEPT | fs/child_process scan missed unprefixed, side-effect, require() and dynamic import() forms; no current violation | Added `SYSTEM_IMPORT` pattern covering all forms, with or without `node:` |
| R1-2 | minor (optional) | tests/unit/env-boundary.test.ts:65 | ACCEPT | network scan missed `'./network'` inside src/main/commands; no current violation | Added a check that src/main/commands files do not import `./network` |
| note: index.ts hardcodes `{ kind: 'local' }` for the agent host | note | src/main/index.ts | REJECT (no change) | Spec's App section: the dev project is `{ kind: 'local' }`; the host starts without a dev project, so it can't use `environmentOf` | none |
| note: `options.platform` only affects path and shim | note | src/main/tools/run-command.ts | AGREE (no change) | test seam only; production never passes it | none |

## Revision 1, round 2  (PASS)

No findings. R1-1 and R1-2 verified fixed; the new patterns do not match legitimate imports such as `./fs-helpers` or `fs-extra`. The reviewer accepted the decisions on both notes.

## Spec problems

- Revision 0 pause, from the implementation report (T2): the spec says "The two app-data stores call it with `localEnvironment().files`." and "Only their atomic save goes through the shared helper." `src/main/secrets/store.ts` saves synchronously (`writeFileSync`, `renameSync`, `mkdirSync`) with mode `0o600` and its own temp name, and throws on failure. The shared helper is async and has no mode option, so moving the save as written would make the secret store async and drop the `0o600` mode. Left on `node:fs` (AC2 allows the file to import it). Candidates: (1) keep the store's own sync save and amend the spec; (2) add a `mode` option to the async helper and make the secret store's save async; (3) add a synchronous form of the helper with a mode option in the local backend only. User chose: Revise the spec; decision: keep the secret store's own synchronous `0o600` save, unchanged (candidate 1). SPECS.md Non-goals, Design and Open questions amended; T2 revised in revision 1. Awaiting `/sdd:approve p4-env-local`.

## Carried findings

- none. (At the pause, no review had run yet.) Items the implementor flagged for review: interface members beyond the Design's list (`files.readlink`, `files.symlink`, `files.rmdir`, `process.networkLevel()`, `readFile` cap raising `EFBIG`); probes moved to `src/main/env/probes.ts`; three list_files cap tests given a 60 s timeout; one unexplained headless-e2e failure under load; AC8 cases appended with a Bash heredoc.
