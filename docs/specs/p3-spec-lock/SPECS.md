---
status: done
ticket:
---

# p3-spec-lock

## Problem

The harness can tell which node a `docs/specs/<feature>/` folder is at (D35), but its approval input is always `none`, so an approved spec never reads as approved. Nothing records an approval in the repo (D7). Nothing notices when an approved SPECS.md is edited. The `approve-spec` and `edit-approved-spec` human actions have no handlers (D33). The agent policy gate gets a placeholder spec state, so it cannot keep agents out of an approved spec (F1, D4).

## Goals

- **G1:** A versioned state file, `docs/specs/.sdd-state.json`, holds the active feature, the SHA-256 of its SPECS.md, the approval time and an `editing` flag. It is read with a size cap and written atomically, and a missing, malformed, oversized or wrong-version file is reported, never thrown.
- **G2:** The approval value (`none`, `approved`, `changed`, `unchecked`) is computed from the state file and a hash of SPECS.md. The hash is taken after dropping a leading BOM and turning CRLF into LF.
- **G3:** A main-side watcher notices an edit to the active SPECS.md, or to the state file, and reports the new approval. Every read re-hashes, so a missed event cannot leave a stale value.
- **G4:** The `approve-spec` and `edit-approved-spec` handlers are registered on the D33 channel. They are reached only through its checks, refuse with a reason, and never throw.
- **G5:** The folder scan gets the real approval and picks the current feature. A throwing approval callback cannot reject a scan.
- **G6:** The policy gate's spec state comes from the live approval, so no agent can write an approved spec, and an unchecked state fails closed.
- **G7:** The docs are updated in the same change.

## Non-goals

- The build loop, the ledger writes, the round limits and the planner's revise path (`p3-build-loop`).
- `approve-result`, commit, push and `mark-done`, including clearing the state file on close (`p3-ship`).
- The headless end-to-end test (`p3-headless-e2e`).
- Any UI or IPC beyond registering the handlers, and tracker writes (D8).
- Changing the sdd plugin's own files, or migrating its `.claude/sdd/` lock files.

## Design

### The state file (`src/shared/spec-state.ts`, pure)

- `SPEC_STATE_FILE = '.sdd-state.json'`, kept under `SPECS_DIR`. `SPEC_STATE_VERSION = 1`. `MAX_SPEC_STATE_BYTES = 4096`.
- The JSON has exactly these keys:
  - `version`: 1;
  - `feature`: a shared feature slug;
  - `sha256`: 64 lowercase hex characters;
  - `approvedAt`: an ISO 8601 UTC time;
  - `editing`: a boolean.
- `parseSpecState(text)` returns `{ ok: true, state }` or `{ ok: false, problem }`, where `problem` is one of `malformed`, `wrong-version` or `invalid` with a fixed reason. It never throws, and it never echoes a value in its reason.
- `serializeSpecState(state)` writes 2-space JSON with a trailing newline.
- `normalizeSpecText(text)` drops one leading U+FEFF and replaces every CRLF with LF.
- `approvalFor(lock, feature, currentHash)`:
  - `lock` is the parsed state, `null` when there is no file, or `'unreadable'`;
  - `currentHash` is the hash, or `null` when SPECS.md can't be read or is missing.

  It returns:
  - `none` when there is no file, or the file names another feature;
  - `unchecked` when the file is unreadable or invalid, or the hash is null for the locked feature;
  - `changed` when `editing` is true or the hash differs;
  - `approved` otherwise.
- `setFrontmatterStatus(text, value)` ports the plugin's `set_status`:
  - it replaces the `status:` line inside a leading `---` block, or adds one before the closing `---`;
  - with no frontmatter, it prepends `---\nstatus: <value>\n---\n`;
  - it keeps the file's line endings.
- `hasRequiredHeadings(text)` is true when the text has both `## Goals` and `## Acceptance criteria` lines.
- The module imports nothing from Node, Electron or the DOM, and may import `./human-actions` and `./spec-docs`.

### The lock on disk (`src/main/workflow/spec-lock.ts`)

- `readSpecState(root)` returns one of:
  - `{ kind: 'absent' }`;
  - `{ kind: 'ok', state }`;
  - `{ kind: 'unreadable', reason }`, for a symlink, a non-file, a file over the cap, an I/O error, or a parse problem.

  It uses lstat and never throws.
- `writeSpecState(root, state)` writes `<file>.<random>.tmp` in `docs/specs/` and renames it over the file. It returns `{ ok }` or `{ ok: false, reason }` and removes the temp file on failure. It never throws.
- `hashSpec(root, feature)` returns the SHA-256 hex of the normalized SPECS.md text (`node:crypto`), or null when the file is missing, unreadable, a symlink or over `MAX_SPEC_FILE_BYTES`.
- `approvalOf(root, feature)` is async and returns an `Approval`.
- `currentFeature(lock, folders)` returns the state file's feature when it is valid, else the folder with the greatest `newestMtime`, with ties broken by slug, else null.
- `scanSpecFoldersWithLock(root)` returns `{ folders, current }`. It reads the state once, hashes only the locked feature's spec, and passes a synchronous callback to `scanSpecFolders`.
- `scanSpecFolders` wraps its `approvalOf` call in try/catch, so a throw gives `unchecked`. Its signature is unchanged.

### The watcher (`src/main/workflow/spec-watch.ts`)

- `createSpecLockWatcher({ root, debounceMs = 150, onChange })` returns:
  - `current()`: synchronous, the last `{ feature, approval }`. It starts as `{ feature: null, approval: 'unchecked' }` until the first refresh finishes;
  - `refresh()`: re-reads and re-hashes, and returns the new value;
  - `close()`.
- It watches `docs/specs/` (for the state file) and the current feature's folder with non-recursive `fs.watch`. Events are debounced, then a refresh runs. `onChange` is called only when the value differs from the last one. A watcher error closes that watcher, and the next refresh re-arms it. After `close()`, no callback fires.

### The handlers (`src/main/human/spec-handlers.ts`)

- `createSpecHandlers({ root, now, onLockChanged })` returns `{ 'approve-spec': handler, 'edit-approved-spec': handler }`. Each handler takes the channel's checked request.
- A refusal returns `{ ok: false, code: 'refused', reason }`, with a fixed reason. `refused` is added to `HumanActionRefusal` in `src/shared/human-actions.ts`.
- **`approve-spec`:**
  - It refuses when SPECS.md is missing, unreadable or over the cap, or lacks the Goals or Acceptance criteria heading.
  - It refuses when the feature is already approved with the same hash and not editing.
  - Otherwise it writes `status: approved` into SPECS.md atomically, hashes the result, and writes the state file with `{ version: 1, feature, sha256, approvedAt: now(), editing: false }`. That replaces any other active feature.
  - When the state write fails, it restores SPECS.md's previous text and refuses.
  - It calls `onLockChanged()` after success.
- **`edit-approved-spec`:**
  - It refuses when the state file is absent, unreadable or names another feature, or when the approval is not `approved`.
  - Otherwise it rewrites the state file with `editing: true` and the same hash, and calls `onLockChanged()`.
- Neither handler throws: unexpected errors become a `refused` result with a fixed reason. Neither runs a command or git.
- `src/main/index.ts` registers both handlers only when the app has a project root, which is the spike root today. It also starts the watcher, and gives `onLockChanged` the watcher's `refresh`.

### Policy (`src/main/policy/context.ts`, `gate.ts`, `src/main/agent/host.ts`)

- `SpecState = 'none' | 'draft' | 'approved' | 'locked'`.
- `specStateOf(approval)` maps:
  - `approved`→`approved`;
  - `changed`→`draft`;
  - `unchecked`→`locked`;
  - `none`→`none`.
- `effectiveFeature` uses the shared `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH`, and the local pattern is removed.
- In `writeReason`, before the job rules, when `context.spec === 'locked'` and the area is `spec-doc`, `spec-other` or `source`, the reason is the fixed text `not allowed: the spec's approval can't be checked, so nothing can be written`.
- `commandPolicyFor` and `startAgentHost` take an optional live supplier, `() => { feature, spec }`. Each tool call's context is the base context with the supplier's current values. With no supplier, the behaviour is today's default.

## Acceptance criteria

- **AC1: Approval round trip.** Unit tests cover each of these:
  - after `approve-spec`, `approvalOf` gives `approved`;
  - after an edit to SPECS.md, it gives `changed`;
  - a CRLF-only re-save still gives `approved`;
  - with no state file it gives `none`, and with another feature locked it gives `none`;
  - with SPECS.md missing or unreadable it gives `unchecked`, and with the state file malformed it gives `unchecked`;
  - with `editing: true` it gives `changed`;
  - re-approving gives `approved` again, with `editing` cleared.
- **AC2: The state file is safe.**
  - `parseSpecState` reports `malformed`, `wrong-version` and `invalid` (bad slug, bad hash, bad time, extra or missing key, non-boolean flag) without throwing.
  - `readSpecState` reports absent, oversized, symlinked and unreadable files.
  - `writeSpecState` leaves no temp file after a success or a failure, and is a rename, so a reader never sees a partial file.
  - Each of these has a test.
- **AC3: Watcher.**
  - A temp-dir test edits an approved SPECS.md, and `onChange` reports `changed` within 2 s.
  - Another test shows `refresh()` reports `changed` when no event arrived (the watcher closed, then the file edited).
  - `current()` is `unchecked` before the first refresh, and no callback fires after `close()`.
- **AC4: Handlers.**
  - Both handlers are registered through `channel.register` and are tested through `channel.handle`. A call with an untrusted sender, an invalid request or no gesture never reaches them.
  - Each refusal case in the design returns `refused` with a reason, changes no file, and throws nothing.
  - The success paths write the frontmatter status and the state file as specified.
  - A failed state write restores SPECS.md.
  - The existing agent-route tests still pass, and no tool, job table or agent source names a handler.
- **AC5: Detection and scan.**
  - `scanSpecFoldersWithLock` on a temp repo detects a locked folder with no ledger as `spec-approved`, and an edited one as `spec-changed`.
  - `current` follows the state file, else the newest folder.
  - `scanSpecFolders` with a throwing `approvalOf` returns every folder, the throwing one as `unchecked`.
- **AC6: Policy.**
  - With the live state `approved`, a gate test denies a planner and a writer `write_file` to the active feature's SPECS.md with the approved-spec reason.
  - With `changed` (→ `draft`), the writer is denied source writes.
  - With `locked`, every job is denied spec and source writes.
  - The state file path is denied to every job.
  - `effectiveFeature` refuses `a--b`, a slug that starts or ends with a dash, and one over 64 characters.
  - The host test shows a call's context follows the supplier.
- **AC7: Docs.** In the build on the feature branch:
  - the `CHANGELOG.md` entry under `## [Unreleased]`;
  - D36 in `docs/decisions.md`, recording the state file, the hash input, the approval values, the `editing` flag, the gate mapping with `locked`, the watcher, the current-feature rule and the `refused` code. It amends D34: EDIT_SPEC may also come from `edit-approved-spec`. It also notes that the spec-state line of D30's context is now settled;
  - `docs/workflow-engine.md`, with a "Spec lock" section;
  - `docs/human-actions.md`, with the two handlers, `refused`, and the status line;
  - stale docs checked and updated: `CLAUDE.md` (D1–D36, the engine line), `README.md`, `docs/PRD.md` (F2, ticking "Existing folders open with the right stage"), `docs/workflow.md`, `docs/agent-jobs.md`, the phase-03 doc ("State file name and format" decided), and the progress file's follow-ups.

  The check is recorded in `changes.md`.
- **AC8: Checks.**
  - `src/shared/spec-state.ts` passes the import scan.
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.
  - CI on the pull request is green on every job before the merge.

## Open questions

- none
