# Tasks: p2-command-allowlist

Work in order. After each task, run its check, then tick the box.

- [x] **T1 — Detection.**
  - Write `src/main/commands/detect.ts` (`CommandForm`, `DetectedCommands`, `detectCommands(files)`, and a small root-backed reader with a size cap).
  - Add `tests/unit/command-detect.test.ts` (AC1): every type, every package-manager source, missing and invalid markers, a mixed repo.

  **Check:** `pnpm typecheck` and `pnpm test` pass.
- [x] **T2 — Command check.**
  - Write `src/main/policy/command-allowlist.ts` (`makeCommandCheck`) with the six ordered steps and fixed reasons.
  - Add `tests/unit/command-allowlist.test.ts` (AC2), plus gate-level cases in `tests/unit/policy-gate.test.ts` (AC3, the gate part).

  **Check:** `pnpm test`.
- [x] **T3 — Program lookup and the Windows rule.**
  - Add `resolveProgram` (PATH, PATHEXT, platform as a parameter) and the pure `cmd.exe` line builder with the token and path rules, under `src/main/commands/`.
  - In `run-command.ts`, spawn the resolved file. Use `cmd.exe /d /s /c` with `windowsVerbatimArguments` only for an allowlisted `.cmd`/`.bat`; keep refusing every other `.cmd`/`.bat` and git.
  - Add `tests/unit/command-lookup.test.ts` (AC4), with the Windows stub run skipped elsewhere.

  **Check:** `pnpm test`.
- [x] **T4 — Snapshot, lock and restore.**
  - Write `src/main/commands/protect.ts`:
    - collect the protected set per job (`docs/specs/`, the `.git` key files, and for the reviewer the non-ignored files through the read-only git query, with the no-git fallback);
    - the 256 MiB cap (a parameter for tests);
    - read-only bits for `docs/specs/`;
    - restore of modes and contents, returning the restored, re-created and deleted paths.
  - Add `tests/unit/command-protect.test.ts` for the collection, the cap, the ignored set with and without git, and the restore (AC5–AC7 at module level).

  **Check:** `pnpm test`.
- [x] **T5 — Network wrapper.**
  - Write `src/main/commands/network.ts`:
    - the pure wrapper choice from the platform and probe results;
    - the one-time probes (`unshare`, `sandbox-exec`);
    - the macOS profile;
    - the Linux loopback step;
    - the writer's proxy and offline variables.
  - Add `tests/unit/command-network.test.ts` (AC9), with the real-OS cases skipped where the method is unavailable.

  **Check:** `pnpm test`.
- [x] **T6 — Rule events.**
  - Extend `src/main/policy/rule-event.ts` with the revert and network kinds, their formatting, sanitizing and log levels.
  - Extend `tests/unit/policy-rule-events.test.ts`.

  **Check:** `pnpm test`.
- [x] **T7 — Runner, router and host.**
  - The router passes `job` to the runner (`ToolRunner` gains `job`).
  - `runCommandInRoot` composes: allowlist re-check, lookup, snapshot and lock, network wrapper (writer), run, restore (always), and the result lines and Rule events through an injected sink.
  - `startAgentHost` detects commands from the root and passes `makeCommandCheck(detected)` in the context and to the runner; with no root it keeps `DEFAULT_POLICY_CONTEXT`.
  - Update `tests/unit/agent-router.test.ts`, `tests/unit/tool-reachability.test.ts` and `tests/unit/tool-command.test.ts` (or the existing run-command test file).
  - Add `tests/unit/command-acceptance.test.ts`: stub-command runs on a temp root for AC5–AC8 end to end, and AC10.

  **Check:** `pnpm test`.
- [x] **T8 — Decision D31.**
  - Add D31 to `docs/decisions.md` (AC11).
  - Mark D29's open question as settled by D31.

  **Check:** `pnpm format:check`.
- [x] **T9 — Changelog and project docs.**
  - Add this subtask's entries to `CHANGELOG.md` under `## [Unreleased]`, and update its Known issues (AC12).
  - Create `docs/agent-commands.md` as AC12 describes.
  - Check `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, `docs/phases/phase-02-tool-policy.md` and the follow-ups in `docs/phases/phase-02-progress.md` for anything this work makes stale, and update them. Note each doc checked, and whether it changed, in `changes.md`.
  - Run `pnpm exec prettier --write` on every changed doc.

  **Check:** `pnpm format:check` passes, and `git diff --stat` shows `CHANGELOG.md` and `docs/agent-commands.md`.
- [x] **T10 — Full checks.** Run typecheck, lint, format check and the unit tests (AC13). **Check:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` all pass.
