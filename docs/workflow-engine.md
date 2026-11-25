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

There are twenty-one events (`EVENT_IDS`): the plugin's eighteen, in the plugin's order, then `CONTINUE`, `STOP_BUILD` and `END_BUILD`, which the build loop adds (D37).

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
| `CONTINUE`        | user       | Continue the paused build from its step (D37).      |
| `STOP_BUILD`      | user       | Stop the paused build; the build ends (D37).        |
| `END_BUILD`       | app        | The build ends without a verdict (D37).             |

## Transitions

There are 26 legal transitions. Five of them were added by D37: `CONTINUE`, `STOP_BUILD` and `END_BUILD` from `paused`, and `END_BUILD` from `implementing` and `reviewing`. Any other (node, event) pair is illegal. The table holds them as `TRANSITIONS`: for each node, the events it accepts and the node each one leads to.

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
- **user:** a person's choice in the UI: `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`, `CONTINUE`, `STOP_BUILD`.
- **app:** the app's own work or an agent's report: the other ten events.

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

**The current feature.** The state file's feature while the file is valid. Otherwise the folder with the newest modification time, and a tie goes to the smaller slug. An approved feature stays current until it is closed. `mark-done` removes the file when it names the feature (D38).

**Watching.** `createSpecLockWatcher` watches `docs/specs/` (for the state file) and the current feature's folder (for its `SPECS.md`), with non-recursive `fs.watch`. An event starts a refresh after 150 ms. A refresh re-reads the state and re-hashes the spec, and `onChange` runs only when the value changes. `current()` gives the last value, which is `unchecked` until the first refresh. A watcher that errors is dropped, and the next refresh arms it again. Nothing is called after `close()`.

**Handlers.** `approve-spec` and `edit-approved-spec` are registered on the human-only channel (D33) when a project root exists, which is `HARNESS_SPIKE_ROOT` for now. Both are reached only through the channel's checks. A refusal is `{ ok: false, code: 'refused', reason }` with a fixed reason, changes no file, and never throws.

- `approve-spec` refuses when SPECS.md is missing, unreadable or too large, when it lacks a Goals or an Acceptance criteria heading, or when it is already approved with the same hash. Otherwise it sets `status: approved` in SPECS.md, writes the state file with `editing: false` and the current time, and refreshes the watcher. If the state write fails, it puts SPECS.md back as it was.
- `edit-approved-spec` refuses unless the state file is readable, names this feature, and the approval is `approved`. Otherwise it sets `editing: true` and keeps the hash. The spec then reads as `changed`.

**Agent context.** `startAgentHost` takes an optional supplier of the open feature and its spec state. Each tool call's context is the base context with the supplier's current values (D30). Without a supplier, the default context is used: no feature, spec state `none`.

**Limits.**

- The gate reads the watcher's last value. A missed event leaves it stale until the next event or refresh.
- The watcher arms the folders that exist at each refresh. If `docs/specs/` is created later, the next refresh arms it.
- The file symlink tests are skipped where Windows refuses file symlinks.

## Build loop

The build loop runs one feature's build in the main process (D37). Its controller is `src/main/workflow/build-loop.ts`, and the jobs run through an injected runner in `src/main/workflow/job-runner.ts`. The reports are parsed by `src/shared/build-reports.ts`, and the two documents are rendered by `src/shared/build-docs.ts`.

**The round.** The writer runs Mode 1 (`WRITER_TASKS.implement`). Then review round n runs, and the decision follows:

- **PASS:** REVIEW_PASSED, outcome Clean.
- **ISSUES at the limit:** REVIEW_PASSED, outcome Open issues remain. The findings are listed under Open issues, and there is no fourth review.
- **ISSUES below the limit:** REVIEW_ISSUES, then the writer in Mode 2 (`WRITER_TASKS.fixFindings`) with every finding unedited, then IMPLEMENTED and review round n+1.

The limit is 3 by default. A build option may set 1, 2 or 3 and no other value (`roundLimit`). The round counter counts the reviews of the current revision.

**Pauses.** A `NEEDS-SPEC-CHANGE` in the writer's report or analysis, or a `spec-change` finding in a review, pauses the build after the step that found it. The step's other findings are carried. The ledger gets `state: paused-for-revision`, `resume on approve: no`, and a Spec problems entry that names the step.

The person's choice is one of three:

- `continue`: the problem is recorded as a deviation ("user chose: continue"). If there is a writer step to run, CONTINUE follows, and the step runs again with the carried findings (a review pause re-runs its decision, so the writer analyzes the findings in Mode 2). The counter is not reset. If nothing is left to run, the build ends instead: a review pause with no findings to fix, a change round, or a pause at the last allowed round. Then END_BUILD moves paused to build-done, with no IMPLEMENTED, and SUMMARY.md says Open issues remain, with the deviation and any remaining findings listed under it.
- `revise`: REVISE, to spec-changed. The ledger gets `resume on approve: yes` and one more revision. A revision has no cap.
- `stop`: STOP_BUILD, to build-done. The ledger is done and SUMMARY.md gets the outcome Stopped by the user.

When the spec is approved again (`approved()`, called by main after `approve-spec`), REAPPROVE takes the build to implementing, the writer runs Mode 3 with the carried findings, and the reviews restart at round 1.

**Change rounds.** After a build is done, `requestChanges(items)` sends the user's items to the same writer in Mode 2, then the same reviewer reviews once. It is recorded as `User-requested change round U<k>`, and it does not count against the limit. The label `U<k>` is the round in the prompts and in the reviewer's heading (`## Review round U<k>`), and `parseReview` returns it as the string `U<k>`. Issues left at the end of the round are listed under Open issues, and the round does not loop.

**Sessions.** The writer and the reviewer each keep their own history, and each run returns the messages to pass on. A report that fails its parser gets one restatement in the same history. A second failure, or a run that fails (provider error or turn limit), ends the build with END_BUILD from implementing or reviewing: the node is build-done, the ledger is done, and SUMMARY.md says Open issues remain with the reason. No fake IMPLEMENTED or REVIEW_PASSED is raised.

**Turn caps.** A job run's model requests are capped at 40 for the writer and 20 for the reviewer. The agent loop's default (4) is unchanged. A run that stops at its cap fails with "did not finish within its turn limit".

**Gate.** The writer may write its feature's `tasks.md` and `changes.md` once the spec is approved. Every other spec file, the ledger, SUMMARY and the state file stay denied to every job (D30, amended by D37). Each tool call goes through `checkToolCall` before its runner, and a denied call returns the gate's reason to the model as a tool error.

**Documents.** The controller writes only `build-ledger.md` and `SUMMARY.md` in the feature's folder, through a temp file and a rename. The ledger's header is what `parseLedger` and `detectFolder` read: after each writer step or review, the detector gives implementing or reviewing with the current round. A paused ledger gives paused, and a finished one gives build-done. Free text is flattened to one line, so no value can start a label line. SUMMARY.md has the sections of the plugin's summary: What was built, Files changed (copied from `changes.md`), Acceptance criteria, Needs a runtime check, Review ledger, Spec revisions, Rejected findings, Open issues, Git state and Next steps.

**No git.** The controller runs no git and makes no commit. Its commands go through the job runner's tool registry, which has no git tool, and `run_command` goes through the D31 allowlist. Commit and push come only from `approve-result`, after the user's approval (D38, see [Ship and close](#ship-and-close)).

**Refusals.** Every call is checked against the node first. An illegal call, or one made while a step runs, is refused with a fixed reason and changes nothing. `requestEdit()` is the EDIT_SPEC hook for `edit-approved-spec` (`src/main/human/spec-handlers.ts`): it moves spec-approved to spec-changed, and it refuses once the build has started.

## Ship and close

The ship step commits the approved work and closes the feature (D38). The git module is `src/main/git/git.ts`, the two steps are `src/main/workflow/ship.ts`, and the two handlers are `src/main/human/ship-handlers.ts`. Nothing outside `src/main/git/` runs git, and no agent has a git tool.

**The git module.** One private runner calls the git CLI through `execFile`, with no shell and from the project root. The environment adds `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so a missing credential fails rather than waits. A local command times out after 30 s and a push after 120 s. A call returns its value, or one of four codes: `git-missing`, `timeout`, `not-a-repo` or `failed`. The functions are `currentBranch`, `defaultBranch` (from `origin/HEAD`), `changedPaths` (porcelain v1, both sides of a rename, deletions included), `stage` (`add --all --`, literal pathspecs), `commit` (never with `--no-verify`), `push` (`--set-upstream origin`), `aheadOfUpstream` (local refs only) and `ignoredEntries` (the D31 read-only query, moved from `protect.ts`).

**The Git state line.** SUMMARY.md's line after `## Git state` says whether the work is approved. `approve-result` replaces it with `Branch <branch>; approved; committed and pushed in the commit that adds this report.` A missing SUMMARY.md, or one with no Git state line, refuses both actions.

**approve-result.** The checks run in order, and the first refusal stops the step:

1. The feature's build controller, when there is one, is at build-done.
2. The folder is at build-done and the lock approves this feature.
3. The branch is not detached, and is not the default branch (`origin/HEAD`, or `main` and `master` when it is unset).
4. SUMMARY.md holds a Git state line.
5. If the line already says approved, this is a retry. With no upstream, or ahead of it, the branch is pushed. Ahead 0 refuses, and so does a tree with changes. Nothing is committed.
6. Every changed path is in the allowed set: the File column of `changes.md`, every path under `docs/specs/<feature>/`, and `docs/specs/.sdd-state.json`. Any other path refuses, and nothing is written.

Then the Git state line is rewritten, the changed paths and SUMMARY are staged, and one commit is made with the message `<ticket>: <summary>` (or `<summary>` without a ticket). The ticket is SPECS.md's `ticket:`. The summary is SUBTASK.md's first `# ` heading, else SPECS.md's, else the slug, flattened to one line and capped at 72 characters. Then the branch is pushed. If the stage or the commit fails, SUMMARY is written back and the same paths are staged again, so the index matches the files. If the push fails, the commit is kept and the step refuses. Approving again only pushes.

**mark-done.** The controller, node and branch checks are the same as above, and then:

1. The Git state line must say approved. Otherwise it refuses: approve the result first.
2. The tree must be clean, and the branch must have an upstream with ahead 0. Otherwise it refuses: push the approved work first.
3. CLOSE goes through `transition('build-done', 'CLOSE')`.

SPECS.md's status becomes `done`, and the state file is removed when it names this feature. Those two paths are staged and committed as `Close <feature> spec`, and the branch is pushed. If the commit fails, both files are written back and staged again. If the push fails, the close commit is kept. A feature that is already closed, with an unpushed close, is retried by pushing alone. A closed feature whose state file names another feature is left alone, and nothing is committed. After a close the folder detects as `closed`.

**Refusals.** Each refusal is a fixed reason. None names a path, a branch, a commit message or git's output. An unexpected error becomes a refusal, and the handler never throws.

**Rule events.** `createInProcessJobRunner` takes an `onRuleEvent` callback (D30). It gets the gate's decision for each tool call, allowed or denied, and the revert and network events of `run_command` (D31). A throwing callback is caught. No job runner is created at startup yet, so `index.ts` does not pass `logRuleEvent(log)`.

**Workflow.** CLOSE is the only event the ship step raises, and only from build-done. `approve-result` raises no event. The table is unchanged (D34).

## Headless run

The headless walk (`p3-headless-e2e`, D39) runs one feature through every part of the engine on a temp git repo with a local bare remote and no network. It is `tests/unit/headless-e2e.test.ts`, and it uses the real pieces:

- the human-only channel (D33), with a test gesture tracker, and the real spec handlers and ship handlers registered on it;
- the build controller (D37), with the app's job runner from `createAppJobRunner` (`src/main/workflow/app-runner.ts`), the scripted provider in `tests/support/scripted-provider.ts`, and the real gate and tools in the temp root;
- the lock, read from the files for each call through the live supplier (D36).

The walk checks the node after each step (`scanSpecFoldersWithLock` for the folder, `controller.node()` while a controller exists). The steps are: the planning files (planning, plan-approved, spec-drafted); approve-spec (spec-approved), and a refused call with no gesture; the build, with a denied write to the approved SPECS.md, an ISSUES round and its fix, and a spec-problem pause (paused); resume with revise, where edit-approved-spec is refused at spec-changed, SPECS.md is edited directly, approve-spec re-approves it and `approved()` resumes in Mode 3 (build-done); one change round (build-done); approve-result (one commit, pushed); and mark-done (the close commit, pushed, closed).

Before approve-result, the git state (HEAD, the commit count and the remote's branch refs) must not change. After approve-result there is one new commit on the remote with the commit-format message and only allowed paths. After mark-done there is one more. The gate's decisions reach the recording logger as `rule allowed` and `rule blocked` lines, and no line holds file content.

**Where the job runner runs (D39).** Build jobs run in the main process, through `createInProcessJobRunner`, for v1. The agent utility process keeps the spike loop. The app builds its runners only through `createAppJobRunner`, so every rule event is logged. No IPC message is added.

**What the walk shows about revisions.** `edit-approved-spec` is accepted only while the spec is approved and no build has started, because `EDIT_SPEC` is legal only from spec-approved (`src/shared/workflow.ts`). After a pause, the walk asserts that the channel refuses the edit at spec-changed. It then edits SPECS.md directly, and the lock reads the file as changed by its hash (D36). `approve-spec` re-approves it, and `approved()` resumes the build in Mode 3. Until that approval, the controller reads `spec-changed` once the revise is chosen, while the folder still reads `paused`, because the ledger keeps its pause until the build resumes.

## Where the code is

- `src/shared/workflow.ts`: the ids, the table, the functions, the stages, the event kinds and the human map.
- `src/shared/spec-state.ts`: the state file's parser and serializer, the hash input, the approval values, the frontmatter status setter and the headings check.
- `src/main/workflow/spec-lock.ts`: the state file's reads and writes, the SPECS.md hash, `approvalOf`, `currentFeature` and `scanSpecFoldersWithLock`.
- `src/main/workflow/spec-watch.ts`: the lock watcher.
- `src/main/human/spec-handlers.ts`: the `approve-spec` and `edit-approved-spec` handlers.
- `tests/unit/spec-state.test.ts`, `spec-lock.test.ts`, `spec-watch.test.ts`, `spec-handlers.test.ts`, `host-context.test.ts`: the lock, the watcher, the handlers and the host's context.
- `src/shared/build-reports.ts`: the three report parsers (`parseImplementationReport`, `parseFindingsAnalysis`, `parseReview`).
- `src/shared/build-docs.ts`: `renderLedger` and `renderSummary`, and the turn caps the ledger states.
- `src/main/workflow/build-loop.ts`: `roundLimit`, `createBuildController` and the controller.
- `src/main/workflow/job-runner.ts`: `createInProcessJobRunner`, the gate check of each tool call and the turn caps.
- `tests/unit/build-reports.test.ts`, `build-docs.test.ts`, `job-runner.test.ts`, `build-loop.test.ts`: the parsers, the documents, the runner and the controller. `tests/support/scripted-provider.ts` replays the jobs' turns.
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
- `src/main/git/git.ts`: the git module, the only code that runs git (`runGit`, the fixed functions and `ignoredEntries`).
- `src/main/workflow/ship.ts`: `approveResult`, `markDone`, the commit message, the Git state line and the allowed set.
- `src/main/human/ship-handlers.ts`: the `approve-result` and `mark-done` handlers.
- `tests/unit/git.test.ts`, `ship.test.ts`, `ship-handlers.test.ts`: the git functions and the ship steps on temp repos with local bare remotes, and the handlers.
- `tests/unit/git-boundary.test.ts`: the scans that keep git out of the agent side, and the no-git-tool check.
- `src/main/workflow/app-runner.ts`: `createAppJobRunner`, the app's runner factory (D39), with the live context and the rule-event log.
- `tests/unit/app-runner.test.ts`: every gate decision reaches the logger as its formatted line, and a change in the live supplier is seen by the next call.
- `tests/unit/headless-e2e.test.ts`: the headless walk, from planning to closed (see Headless run).
- `tests/unit/plugin-folder-states.test.ts`: the `p3-ship` plugin files (checked against recorded SHA-256 values) opened in each state the detector knows.

## Extending this page

The build loop (`p3-build-loop`) and the ship step (`p3-ship`) are described above. The headless end-to-end test (`p3-headless-e2e`) adds tests and a fixture, not states or handlers. Each new state, event or handler goes on this page and into the table, with a decision in `decisions.md` when the table changes. The spec lock (D36) supplies the approval that `detectFolder` takes as an input.
