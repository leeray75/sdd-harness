# Plan: p3-spec-lock

Ticket: none (vibe planning, Phase 3 subtask 3)
Status: approved
Date: 2026-11-22

## Objective

Make the approved spec's hash the source of truth (D4, D7). Approving a spec in the app writes a small state file in the repo, holding the active feature and the SHA-256 of its SPECS.md. Any later edit to that SPECS.md is detected, both by watching the folder and on every read, and the folder then reads as spec-changed ("approve again").

This work also does three more things:

- it gives the `approve-spec` and `edit-approved-spec` human actions (D33) their handlers;
- it gives the folder detector (D35) its real approval input, and picks the current feature;
- it feeds the agent policy gate the real spec state, so no agent can write an approved spec (F1, D4).

## Scope

- **In:**
  - **The state file** `docs/specs/.sdd-state.json`. It holds:
    - a format version;
    - the active feature;
    - the SHA-256 of the active feature's SPECS.md;
    - the approval time;
    - an `editing` flag.

    A pure shared module parses and serializes it, and never throws. Main reads it with a size cap and writes it atomically (a temp file, then a rename). A missing, malformed, oversized or wrong-version file is reported, not thrown.
  - **The hash:** SHA-256 of SPECS.md after dropping a leading BOM and turning CRLF into LF. tasks.md is not hashed.
  - **The approval value** that `detectFolder` takes, for any feature:
    - `none`: no lock on that feature;
    - `approved`: the hash matches and `editing` is false;
    - `changed`: the hash differs, or `editing` is true;
    - `unchecked`: the state file is unreadable, malformed, oversized or the wrong version, or SPECS.md can't be read or is missing.
  - **The current-feature choice:** the state file's active feature, else the plugin's rule, the folder with the newest modification time. An async form of `scanSpecFolders` reads the state once per scan, and guards the approval callback so one that throws gives `unchecked` and the scan carries on.
  - **The watcher:** `fs.watch` on the active feature's folder and on `docs/specs/` (for the state file), with a debounce. On change it re-reads and re-hashes, and reports a new approval to subscribers when the value differs. Reads never rely on the watcher alone: each read re-hashes, which covers missed events.
  - **The handlers**, registered on the D33 channel in `src/main/index.ts` through a small factory, so they can be tested without Electron:
    - **`approve-spec`:**
      - It checks that SPECS.md exists and is readable, and has the `## Goals` and `## Acceptance criteria` headings (as the plugin's approve script does).
      - It sets `status: approved` in the frontmatter, adding a frontmatter block if there is none.
      - It hashes the file and writes the state file. That clears `editing` and makes this the active feature, replacing any other.
      - It refuses with a reason, and changes nothing, when the spec is already approved with the same hash and not editing.
    - **`edit-approved-spec`:**
      - It sets `editing: true` and keeps the stored hash, so the folder reads as spec-changed at once (EDIT_SPEC).
      - It refuses when the feature is not the active one or isn't approved.

    Both handlers act only through the channel's sender, guard and gesture checks, return a reason when they refuse, and never throw.
  - **The policy context:**
    - `SpecState` becomes `none | draft | approved | locked`, derived from the active feature's approval: approved→`approved`, changed→`draft`, unchecked→`locked`, none→`none`.
    - A new gate rule makes `locked` deny every spec-doc, spec-other and source write for every job.
    - The host builds each tool call's context from the live lock state. The lock state starts as `locked` until the first read finishes (fail closed).
    - The policy slug pattern is unified with the shared `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH`.
  - **Docs**, done in the build on the feature branch:
    - the CHANGELOG entry;
    - D36, which also amends D34 so that EDIT_SPEC can come from the user's action (`edit-approved-spec`) as well as from the app (the watcher);
    - `docs/workflow-engine.md`, extended with the state file, hash, approval, watcher and current feature;
    - `docs/human-actions.md`, with the two handlers and the status line updated;
    - stale docs checked and updated: `CLAUDE.md` (D1–D36, the engine line), `README.md`, `docs/PRD.md` (F2: "Spec lock by hash", and tick "Existing folders open with the right stage"), `docs/workflow.md`, `docs/agent-tools.md` or the policy doc if it names `SpecState`, the phase-03 doc, and the progress file's follow-ups.
- **Out:**
  - The build loop, the ledger writes, the round limits, and the planner's revise path (`p3-build-loop`).
  - `approve-result`, commit, push and `mark-done`, including clearing the state file on close (`p3-ship`).
  - The headless end-to-end test (`p3-headless-e2e`).
  - Any UI or IPC beyond registering the handlers, and tracker writes (D8).
  - Changing the plugin's own files, and migrating the plugin's `.claude/sdd/` lock files.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| State file location and name | `docs/specs/.sdd-state.json`, one per repo, in JSON. The gate already treats it as `spec-other`, which is read-only to every agent, and the scanner skips it because it is not a folder. | One file per feature, `docs/specs/<feature>/approval.json` (needs a scan, and a closed feature must clear it); a repo-root `.sdd/state.json` (falls in the gate's `source` area, so the writer could edit it after approval) |
| What the hash covers | SPECS.md only, after dropping a leading BOM and turning CRLF into LF, so a line-ending difference between checkouts is not a change | Raw bytes, like the plugin (a CRLF checkout reads as changed) |
| What `edit-approved-spec` does | Sets `editing: true` and keeps the old hash, so the folder reads spec-changed (EDIT_SPEC). `approve-spec` clears it on re-approval. | Drop the approval, going back to `none` and spec-drafted (loses the "approve again" state the PRD names) |
| The gate's view of changed and unchecked | changed→`draft`: source is locked, and the planner may revise the spec docs, as the plugin does. unchecked→a new `locked` state, which fails closed with no spec or source writes. | Both stay `approved` (the writer could edit source against a spec that no longer matches); both `locked` (blocks the planner's revise path in `p3-build-loop`) |
| Watcher (default, stated) | Node's `fs.watch`, non-recursive, on the feature folder and `docs/specs/`, with a 150 ms debounce. Errors close the watcher, which re-arms on the next read. No new dependency. | chokidar (an extra dependency, and the read check covers missed events anyway) |
| approve-spec checks (default, stated) | Port the plugin's check for the `## Goals` and `## Acceptance criteria` headings, and set `status: approved` before hashing | Hash the file as it is, with no frontmatter write |
| Slug pattern (default, stated) | `effectiveFeature` uses the shared `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH` (the p3-spec-docs follow-up) | Leave the looser policy pattern |

## Approach

1. **Shared, pure: `src/shared/spec-state.ts`.**
   - `SPEC_STATE_FILE` (`.sdd-state.json`), `SPEC_STATE_VERSION` (1) and `MAX_SPEC_STATE_BYTES` (4 KiB).
   - `parseSpecState(text)`, which returns `{ ok, state } | { ok: false, problem }`. It checks the exact keys, the version, the feature slug, a 64-hex hash, an ISO time and the boolean flag.
   - `serializeSpecState`.
   - `normalizeSpecText`, which drops the BOM and turns CRLF into LF.
   - `approvalFor(state, feature, currentHash | null)`.
   - `setFrontmatterStatus(text, value)`, ported from the plugin's `set_status`.
   - `hasRequiredHeadings(text)`.

   No Node import: hashing is in main.
2. **Main: `src/main/workflow/spec-lock.ts`.**
   - `readSpecState(root)`: lstat, no symlinks, the cap, never throws.
   - `writeSpecState(root, state)`: a temp file in the same folder, then a rename.
   - `hashSpec(root, feature)`: `node:crypto` SHA-256 of the normalized text, or null when unreadable.
   - `approvalOf(root, feature)` (async).
   - `currentFeature(root, folders)`.
   - `scanSpecFoldersWithLock(root)` reads the state once, hashes the active feature's spec, and passes a guarded callback to `scanSpecFolders`.
   - `scanSpecFolders` itself gets a try/catch around `approvalOf`, giving `unchecked`. It stays synchronous and keeps its signature.
3. **Main: `src/main/workflow/spec-watch.ts`.**
   - `createSpecLockWatcher({ root, debounceMs, onChange })` holds the live `{ feature, approval }`. It refreshes on start, on debounced `fs.watch` events and on every `refresh()`, and exposes `current()` synchronously for the gate. `close()` releases the watchers.
   - Temp-dir tests use real `fs.watch` with a bounded wait.
4. **Main: `src/main/human/spec-handlers.ts`.**
   - `createSpecHandlers({ root, now, onLockChanged })` returns the `approve-spec` and `edit-approved-spec` handlers. A refusal uses a new refusal code, `refused`, with a fixed reason; this extends `HumanActionRefusal` in `src/shared/human-actions.ts`.
   - Registered in `src/main/index.ts` for the project root the app has (the spike root, or none, until projects arrive in Phase 4). With no root, nothing is registered, and requests stay `not-available`.
5. **Policy.**
   - `src/main/policy/context.ts`: the `locked` state, `specStateOf(approval)`, and the unified slug.
   - `src/main/policy/gate.ts`: the `locked` rule.
   - `src/main/agent/host.ts`: merges the watcher's live spec state into each call's context.
6. **Docs**, as listed under Scope.
7. **Tests:** unit tests for each module. The AC tests cover:
   - the approval round trip;
   - malformed, missing and wrong-version state;
   - the watcher's change and the read fallback;
   - the handlers' refusals, and that they are reached only through `channel.handle`;
   - a gate denial for an agent write to an approved SPECS.md;
   - a throwing callback;
   - the import scan of the shared module.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| A file under `docs/specs/` that is not one of the four planning names is `spec-other`, which every agent's write rule denies | `src/main/policy/path-areas.ts` (`classifyPath`, the `segments.length === 4` branch); `src/main/policy/gate.ts` (`writeReason`: the planner gets `PLANNER_SCOPE`, the writer gets `WRITER_SPEC` or `SPEC_APPROVED`) |
| The gate already blocks spec-doc writes when `context.spec === 'approved'` | `src/main/policy/gate.ts` `writeReason` (the `SPEC_APPROVED` branches) |
| The policy context is built once per host today | `src/main/agent/host.ts:86-94` and `:233-236` |
| The scanner skips plain files in `docs/specs/`, so the state file is not a feature | `src/main/workflow/spec-folders.ts` `scanSpecFolders` (`entry.isDirectory()`) |
| The scanner's callback is synchronous and unguarded | `src/main/workflow/spec-folders.ts` (`ApprovalOf`, `approvalOf(name)`) |
| The channel's handler takes `{ action, feature }` and may be async; a throw becomes `not-available` | `src/main/human/channel.ts` (`HumanActionHandler`, step 5) |
| The channel is created in `src/main/index.ts` with no handlers | `src/main/index.ts:38-50` |
| The plugin sets `status: approved` and then hashes SPECS.md's raw bytes; it checks the Goals and AC headings | plugin `scripts/approve.sh:16-31, 43-55`; `scripts/lib.sh:272-280` |
| EDIT_SPEC goes from spec-approved to spec-changed, its kind is `app`, and REAPPROVE goes to implementing | `src/shared/workflow.ts:91-92, 214, 205` |
| This repo checks text out as LF, but other repos may not | `.gitattributes` (`* text=auto eol=lf`); `core.autocrlf=true` here |

## Risks

- **`fs.watch` differs by OS.** Events are duplicated or come as renames on Windows, and an editor's save-by-rename can drop the watch. The debounce, re-arming the watch on the next refresh, and the re-hash on every read cover this. The watcher test is on the Linux `check` job and on Windows locally; a flaky result there would show the problem.
- **The host's context becomes live.** A slow first read could deny calls that would be allowed. The `locked` default is the intended fail-closed behaviour, and is documented.
- **The new refusal code `refused`** widens a shared union that the renderer's bridge types use. Typecheck shows every place that needs it.
- **No project root yet.** The handlers are registered only when the app has a root, so in normal runs they stay unreachable until Phase 4. Their tests drive them through `channel.handle` with fakes.

## Open questions

none
