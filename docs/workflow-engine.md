# Workflow engine

The sdd workflow's states, events and transitions are one typed table in `src/shared/workflow.ts`. This page is the reference for that table: the nodes, the events, the transitions, the six stages a user sees, the event kinds and the map from the human-only events to the D33 actions. The decision and its reasons are in [`decisions.md`](decisions.md#d34--workflow-table-hand-written-stage-mapping-data-agent-overlay-event-kinds-and-human-map) (D34). The table is ported from the sdd plugin's `hooks/machine.ts` at v0.18.0, and a test holds a literal copy of that config to keep the two equal.

The table is plain data with pure functions. It imports nothing outside `src/shared/`, and it uses no Node, Electron or DOM API, so main and the renderer can both read it. The document layer (D35), which reads a feature's sdd documents and detects its node, is described in the last two sections.

## Nodes

There are twelve nodes (`NODE_IDS`). Eleven are the steps of one feature's path (`PATH_IDS`). The twelfth, `data-agent`, is an overlay: the read-only data agent runs beside planning and implementing and never moves the path.

| Node            | Path | Stage         | Meaning                                                 |
| --------------- | ---- | ------------- | ------------------------------------------------------- |
| `idle`          | yes  | Start         | No work yet. The initial node (`INITIAL_NODE`).         |
| `planning`      | yes  | Plan          | The plan is being written with the user.                |
| `plan-approved` | yes  | Plan          | The user approved the plan. The spec is next.           |
| `spec-drafted`  | yes  | Spec          | The spec is drafted and waiting for approval.           |
| `spec-approved` | yes  | Build         | The spec is approved and locked. The build can start.   |
| `spec-changed`  | yes  | Spec          | The approved spec was edited, and needs approval again. |
| `implementing`  | yes  | Build         | The writer is changing the code.                        |
| `reviewing`     | yes  | Build         | The reviewer is checking the code.                      |
| `paused`        | yes  | Build, paused | The build stopped for a spec problem. The user decides. |
| `build-done`    | yes  | Review        | The build and review are done. The user decides.        |
| `closed`        | yes  | Done          | The feature is closed.                                  |
| `data-agent`    | no   | none          | The read-only data agent is running (overlay).          |

## Events

There are eighteen events (`EVENT_IDS`), in the plugin's order.

| Event             | Kind       | Meaning                                             |
| ----------------- | ---------- | --------------------------------------------------- |
| `START`           | user       | Start planning, or import.                          |
| `APPROVE_PLAN`    | user       | Approve the plan.                                   |
| `DRAFT_SPEC`      | app        | Draft the spec.                                     |
| `APPROVE_SPEC`    | human-only | Approve the spec and lock it.                       |
| `EDIT_SPEC`       | app        | An approved spec was edited.                        |
| `START_BUILD`     | user       | Start the build.                                    |
| `IMPLEMENTED`     | app        | The writer finishes a pass.                         |
| `REVIEW_ISSUES`   | app        | The review finds issues, and the code goes back.    |
| `REVIEW_PASSED`   | app        | The review passes, or the round limit ends.         |
| `SPEC_PROBLEM`    | app        | A spec problem pauses the build.                    |
| `REVISE`          | user       | Revise the paused spec.                             |
| `REAPPROVE`       | human-only | Approve the revised or changed spec again.          |
| `REQUEST_CHANGES` | user       | Ask for changes after the build.                    |
| `CLOSE`           | human-only | Close the feature.                                  |
| `START_NEXT`      | user       | Start the next piece of work.                       |
| `DATA_START`      | app        | A data agent starts, from planning or implementing. |
| `DATA_STOP`       | app        | The data agent stops, back to planning.             |
| `DATA_STOP_BUILD` | app        | The data agent stops, back to implementing.         |

## Transitions

There are 21 legal transitions. Any other (node, event) pair is illegal. The table holds them as `TRANSITIONS`: for each node, the events it accepts and the node each one leads to.

| From            | Event             | To              |
| --------------- | ----------------- | --------------- |
| `idle`          | `START`           | `planning`      |
| `planning`      | `APPROVE_PLAN`    | `plan-approved` |
| `planning`      | `DATA_START`      | `data-agent`    |
| `plan-approved` | `DRAFT_SPEC`      | `spec-drafted`  |
| `spec-drafted`  | `APPROVE_SPEC`    | `spec-approved` |
| `spec-approved` | `EDIT_SPEC`       | `spec-changed`  |
| `spec-approved` | `START_BUILD`     | `implementing`  |
| `spec-changed`  | `REAPPROVE`       | `implementing`  |
| `implementing`  | `IMPLEMENTED`     | `reviewing`     |
| `implementing`  | `SPEC_PROBLEM`    | `paused`        |
| `implementing`  | `DATA_START`      | `data-agent`    |
| `reviewing`     | `REVIEW_ISSUES`   | `implementing`  |
| `reviewing`     | `REVIEW_PASSED`   | `build-done`    |
| `reviewing`     | `SPEC_PROBLEM`    | `paused`        |
| `paused`        | `REVISE`          | `spec-changed`  |
| `paused`        | `REAPPROVE`       | `implementing`  |
| `build-done`    | `CLOSE`           | `closed`        |
| `build-done`    | `REQUEST_CHANGES` | `implementing`  |
| `closed`        | `START_NEXT`      | `planning`      |
| `data-agent`    | `DATA_STOP`       | `planning`      |
| `data-agent`    | `DATA_STOP_BUILD` | `implementing`  |

The functions are:

- `legalEvents(node)`: the legal events from a node, in `EVENT_IDS` order.
- `nextNode(node, event)`: the target node, or the same node when the event is illegal.
- `transition(node, event)`: `{ ok: true, node }` for a legal event, or `{ ok: false, node, reason }` for an illegal one. The node is unchanged, and the reason is fixed text that names only the two ids, for example `CLOSE is not a legal event from planning`.
- `isNodeId` and `isEventId`: guards that reject anything that is not an id.

No app event leaves `build-done`. From `build-done` only `CLOSE` (human-only) and `REQUEST_CHANGES` (user) are legal, so the build waits for the user.

## Stages and labels

The six stages a user sees are `STAGE_IDS`, in order: `start`, `plan`, `spec`, `build`, `review`, `done`. Their labels (`STAGE_LABELS`) are Start, Plan, Spec, Build, Review and Done. The paused variant of Build has the label `PAUSED_LABEL`, "Build, paused".

`stageOf(node)` gives the stage view `{ stage, paused }` of a path node. `stageLabel(view)` gives the label of that view.

| Node            | Stage  | `paused` | Label         |
| --------------- | ------ | -------- | ------------- |
| `idle`          | start  | false    | Start         |
| `planning`      | plan   | false    | Plan          |
| `plan-approved` | plan   | false    | Plan          |
| `spec-drafted`  | spec   | false    | Spec          |
| `spec-changed`  | spec   | false    | Spec          |
| `spec-approved` | build  | false    | Build         |
| `implementing`  | build  | false    | Build         |
| `reviewing`     | build  | false    | Build         |
| `paused`        | build  | true     | Build, paused |
| `build-done`    | review | false    | Review        |
| `closed`        | done   | false    | Done          |

`isOverlay(node)` is true only for `data-agent`, which has no stage. A caller that shows `data-agent` shows the stage of the path node it left.

The six stage labels never equal or contain an internal node or event id, and a test checks this case-sensitively. The paused label is exempt from that check, and a test checks its exact value, "Build, paused", because the word "paused" there is plain English, as in `docs/workflow.md`.

## Event kinds

Every event has one kind (`EVENT_KINDS`):

- **human-only:** only a person may trigger it, through a D33 human action in the app's window: `APPROVE_SPEC`, `REAPPROVE`, `CLOSE`.
- **user:** a person's choice in the UI: `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`.
- **app:** the app's own work or an agent's report: the other nine events.

No human-only event is classified as app.

## The human-action map

`HUMAN_EVENT_ACTIONS` maps each human-only event to the D33 action that carries it out. Its keys are exactly the human-only events, and every value is in `HUMAN_ACTION_IDS` (see [`human-actions.md`](human-actions.md)).

| Event          | Action         |
| -------------- | -------------- |
| `APPROVE_SPEC` | `approve-spec` |
| `REAPPROVE`    | `approve-spec` |
| `CLOSE`        | `mark-done`    |

Two D33 actions have no event here. `approve-result` does not change the table: the feature stays in `build-done`, and the shipping subtask (`p3-ship`) handles it. `edit-approved-spec` and `change-rules` raise no event themselves: a saved spec change is seen as `EDIT_SPEC`.

## Document layer

The document layer reads and writes the sdd documents of one feature folder, `docs/specs/<feature>/` (D35). Its pure part is in `src/shared/spec-docs.ts`, and it imports nothing outside `src/shared/`. The scanner that reads a project's folders is in `src/main/workflow/spec-folders.ts`.

**Templates.** `TEMPLATES` holds the plugin's four v0.18.0 templates (`plan`, `specs`, `tasks` and `subtask`), verbatim. `fillTemplate(kind, fields)` fills the five placeholders below and leaves every other `<...>` guidance text as it is. A field that is left out, or is an empty string, leaves its placeholder in place. A feature slug that fails validation gives `{ ok: false, reason }`; nothing is thrown.

| Placeholder      | Filled from                        | When the field is left out |
| ---------------- | ---------------------------------- | -------------------------- |
| `<feature>`      | `feature` (required, a valid slug) | not applicable             |
| `<Feature name>` | `title`                            | the feature slug           |
| `<STORY-ID>`     | `ticket`                           | stays                      |
| `<story title>`  | `storyTitle`                       | stays                      |
| `<YYYY-MM-DD>`   | `date`                             | stays                      |

**Layout.** `SPECS_DIR` is `docs/specs`. `SPEC_FILES` lists the seven names a feature folder can hold: `PLAN.md`, `SPECS.md`, `tasks.md`, `SUBTASK.md`, `build-ledger.md`, `changes.md` and `SUMMARY.md`. `isFeatureSlug` checks a slug against `FEATURE_SLUG_PATTERN` and `MAX_FEATURE_LENGTH` (`src/shared/human-actions.ts`). `specFilePath(feature, file)` gives `docs/specs/<feature>/<file>`, and null for a bad slug, a name not in the list, a separator, a traversal, an absolute path or a value that is not a string.

**Parsers.** Each takes the file's text, or `null` when the file is absent, and returns `present` with the fields it reads and a `problems` list. None throws. CRLF text and a byte order mark are read the same way.

- `parsePlan`: the first `Status:` value of PLAN.md.
- `parseSpecs`: the `status` and `ticket` of the frontmatter in SPECS.md. The status is reported; it does not decide the node.
- `parseTasks`: the checked and open checkboxes, counted as the plugin counts them.
- `parseLedger`: `state`, `revision`, `resumeOnApprove` (`resume on approve: yes`), `currentRound` (`current round:`) and `phase` (`implementing`, `reviewing` or empty). A malformed value is reported and read as absent.

**Scanner.** `readSpecFolder(projectRoot, feature, approval)` reads one folder, and `scanSpecFolders(projectRoot, approvalOf)` returns every valid folder sorted by slug, each with its files, parsed files, detection and newest known-file mtime. The scanner uses `lstat`, so symbolic links and junctions are skipped, and it reads at most 256 KiB of each file. A folder with no known file is skipped. An unreadable file is reported in its state and its problems, and nothing is thrown. `docs/specs` missing gives an empty list.

## Detecting a folder's node

`detectFolder(input)` in `src/shared/spec-detect.ts` gives a folder's `{ node, stage, round, source }` from its approval and its files. The approval is an input: `none` (no lock), `approved`, `changed` or `unchecked`. The Spec lock section below says how each value is read. The precedence follows the plugin's `hooks/detect.ts` (v0.18.0); the first rule that matches wins:

1. Approval `changed` gives `spec-changed`, whatever the ledger says.
2. Approval `none` gives:
   - `closed` when SUMMARY.md exists;
   - else `spec-drafted` when SPECS.md exists;
   - else `plan-approved` when PLAN.md has Status `approved`;
   - else `planning` when PLAN.md exists;
   - else `idle`.

   The ledger is ignored: a build needs an approved spec.

3. Approval `approved` or `unchecked` (read as approved) gives:
   - `paused` when the ledger's state is `paused-for-revision`;
   - else `build-done` when the ledger's state is `done`, or SUMMARY.md exists and the ledger is not `running`;
   - else, when the ledger's state is `running`, the `phase:` value (source `phase`), or `implementing` when the phase is empty (source `ledger`);
   - else `spec-approved`.

`round` is the ledger's current round while the node is `implementing` or `reviewing`, and null otherwise. `source` is null unless the build is running.

The plugin's session marker and its seen-subagent inputs are not ported, so a folder is read from its files and the approval alone. D35 records why. A plugin-written folder that has finished, with SUMMARY.md and a `done` ledger, detects as `closed` (stage Done) with approval `none`. This holds for the 20 finished folders of this repo and the vendored `p3-state-machine` folder.

## Spec lock

The approval lock says whether a feature's spec is approved (D36). Its pure part is `src/shared/spec-state.ts`. The file reads, writes, hashing and the scan are in `src/main/workflow/spec-lock.ts`, the watcher is in `src/main/workflow/spec-watch.ts`, and the two handlers are in `src/main/human/spec-handlers.ts`.

**The state file.** `docs/specs/.sdd-state.json` has exactly five keys: `version` (1), `feature` (a slug), `sha256` (64 lowercase hex characters), `approvedAt` (ISO 8601 in UTC) and `editing` (a boolean). It is read with a 4 KiB cap. A file that is a symbolic link, not a file, too large, not JSON, the wrong version or otherwise invalid is `unreadable`, with a fixed reason, and nothing is thrown. It is written to `<file>.<random>.tmp` and renamed over the old file, and a failed write removes its temp file.

**The hash.** `sha256` is the SHA-256 of the feature's `SPECS.md` after one leading byte order mark is dropped and every CRLF becomes LF. The frontmatter is part of the text, so approval writes `status: approved` before it hashes the file. A re-save with CRLF or a byte order mark does not change the hash.

**The approval.** `approvalFor(lock, feature, hash)` gives one value per feature:

| Value       | When                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| `none`      | No state file, or the file names another feature.                                     |
| `unchecked` | The state file is unreadable, or the locked spec is missing, unreadable or too large. |
| `changed`   | `editing` is true, or the hash differs.                                               |
| `approved`  | The hash matches and `editing` is false.                                              |

`detectFolder` takes this value (see [Detecting a folder's node](#detecting-a-folders-node)). The agent gate maps it to a spec state, `specStateOf` in `src/main/policy/context.ts`: `approved` gives `approved`, `changed` gives `draft`, `unchecked` gives `locked` and `none` gives `none`. With `locked`, no job may write a spec file or a source file, and the state file is denied to every job.

**The current feature.** The state file's feature while the file is valid. Otherwise the folder with the newest modification time, and a tie goes to the smaller slug. An approved feature stays current until it is closed, and `p3-ship` clears the file then.

**Watching.** `createSpecLockWatcher` watches `docs/specs/` (for the state file) and the current feature's folder (for its `SPECS.md`), with non-recursive `fs.watch`. An event starts a refresh after 150 ms. A refresh re-reads the state and re-hashes the spec, and `onChange` runs only when the value changes. `current()` gives the last value, which is `unchecked` until the first refresh. A watcher that errors is dropped, and the next refresh arms it again. Nothing is called after `close()`.

**Handlers.** `approve-spec` and `edit-approved-spec` are registered on the human-only channel (D33) when a project root exists, which is `HARNESS_SPIKE_ROOT` for now. Both are reached only through the channel's checks. A refusal is `{ ok: false, code: 'refused', reason }` with a fixed reason, changes no file, and never throws.

- `approve-spec` refuses when SPECS.md is missing, unreadable or too large, when it lacks a Goals or an Acceptance criteria heading, or when it is already approved with the same hash. Otherwise it sets `status: approved` in SPECS.md, writes the state file with `editing: false` and the current time, and refreshes the watcher. If the state write fails, it puts SPECS.md back as it was.
- `edit-approved-spec` refuses unless the state file is readable, names this feature, and the approval is `approved`. Otherwise it sets `editing: true` and keeps the hash. The spec then reads as `changed`.

**Agent context.** `startAgentHost` takes an optional supplier of the open feature and its spec state. Each tool call's context is the base context with the supplier's current values (D30). Without a supplier, the default context is used: no feature, spec state `none`.

**Limits.**

- The gate reads the watcher's last value. A missed event leaves it stale until the next event or refresh.
- The watcher arms the folders that exist at each refresh. If `docs/specs/` is created later, the next refresh arms it.
- The file symlink tests are skipped where Windows refuses file symlinks.

## Where the code is

- `src/shared/workflow.ts`: the ids, the table, the functions, the stages, the event kinds and the human map.
- `src/shared/spec-state.ts`: the state file's parser and serializer, the hash input, the approval values, the frontmatter status setter and the headings check.
- `src/main/workflow/spec-lock.ts`: the state file's reads and writes, the SPECS.md hash, `approvalOf`, `currentFeature` and `scanSpecFoldersWithLock`.
- `src/main/workflow/spec-watch.ts`: the lock watcher.
- `src/main/human/spec-handlers.ts`: the `approve-spec` and `edit-approved-spec` handlers.
- `tests/unit/spec-state.test.ts`, `spec-lock.test.ts`, `spec-watch.test.ts`, `spec-handlers.test.ts`, `host-context.test.ts`: the lock, the watcher, the handlers and the host's context.
- `src/shared/spec-docs.ts`: the templates, the fill function, the layout and path helpers, and the four parsers.
- `src/shared/spec-detect.ts`: `detectFolder` and its types.
- `src/main/workflow/spec-folders.ts`: the scanner, `readSpecFolder`, `readSpecFolderAt` and `scanSpecFolders`.
- `tests/unit/workflow-machine.test.ts`: the parity with the plugin's config, and the legal events and transitions.
- `tests/unit/workflow-stages.test.ts`: the stage mapping, the labels and the `build-done` gate.
- `tests/unit/workflow-events.test.ts`: the event kinds, the human map and the module's imports.
- `tests/unit/spec-docs-templates.test.ts`, `spec-docs-paths.test.ts` and `spec-docs-parse.test.ts`: the templates and fill, the layout and paths, and the parsers.
- `tests/unit/spec-detect.test.ts`: a fixture for every branch of the precedence, and the purity scan of both shared document modules.
- `tests/unit/spec-folders.test.ts`: the temp-folder scans, the vendored plugin folder, and this repo's finished folders.
- `tests/fixtures/sdd-plugin/`: the templates and the `p3-state-machine` folder, copied from the plugin (see its README).

## Extending this page

Later Phase 3 subtasks add their part here: the build loop (`p3-build-loop`) and shipping (`p3-ship`, which clears the state file on close). Each one adds its handlers and any new state or event to this page and to the table, with a decision in `decisions.md` when the table changes. The spec lock (D36) supplies the approval that `detectFolder` takes as an input.
