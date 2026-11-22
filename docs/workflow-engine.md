# Workflow engine

The sdd workflow's states, events and transitions are one typed table in `src/shared/workflow.ts`. This page is the reference for that table: the nodes, the events, the transitions, the six stages a user sees, the event kinds and the map from the human-only events to the D33 actions. The decision and its reasons are in [`decisions.md`](decisions.md#d34--workflow-table-hand-written-stage-mapping-data-agent-overlay-event-kinds-and-human-map) (D34). The table is ported from the sdd plugin's `hooks/machine.ts` at v0.18.0, and a test holds a literal copy of that config to keep the two equal.

The table is plain data with pure functions. It imports nothing outside `src/shared/`, and it uses no Node, Electron or DOM API, so main and the renderer can both read it.

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

## Where the code is

- `src/shared/workflow.ts`: the ids, the table, the functions, the stages, the event kinds and the human map.
- `tests/unit/workflow-machine.test.ts`: the parity with the plugin's config, and the legal events and transitions.
- `tests/unit/workflow-stages.test.ts`: the stage mapping, the labels and the `build-done` gate.
- `tests/unit/workflow-events.test.ts`: the event kinds, the human map and the module's imports.

## Extending this page

Later Phase 3 subtasks add their part here: the spec lock (`p3-spec-lock`), the build loop (`p3-build-loop`) and shipping (`p3-ship`). Each one adds its handlers and any new state or event to this page and to the table, with a decision in `decisions.md` when the table changes.
