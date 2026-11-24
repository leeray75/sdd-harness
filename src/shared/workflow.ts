// The sdd workflow table (D34): the twelve nodes, the twenty-one events and the transitions between
// them, ported by hand from the sdd plugin's hooks/machine.ts (v0.18.0). The last three events,
// CONTINUE, STOP_BUILD and END_BUILD, are the app's additions for the build loop (D37). Shared code, so it
// imports only from src/shared/ and no Node, Electron or DOM API. It holds plain data and pure
// functions; it has no state-machine dependency and changes nothing at run time.
//
// Eleven nodes are the steps of one feature's path. `data-agent` is an overlay: the read-only data
// agent runs beside planning and implementing and never moves the path, so it has no stage.
// docs/workflow-engine.md is the reference for this table.

import type { HumanActionId } from './human-actions';

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

/** The twelve node ids, in the plugin's order. */
export const NODE_IDS = [
  'idle',
  'planning',
  'plan-approved',
  'spec-drafted',
  'spec-approved',
  'spec-changed',
  'implementing',
  'reviewing',
  'paused',
  'build-done',
  'closed',
  'data-agent',
] as const;

export type NodeId = (typeof NODE_IDS)[number];

/** The path nodes: every node except the `data-agent` overlay. */
export type PathId = Exclude<NodeId, 'data-agent'>;

export const PATH_IDS: readonly PathId[] = NODE_IDS.filter(
  (id): id is PathId => id !== 'data-agent',
);

/**
 * The twenty-one event ids: the plugin's eighteen in the plugin's order (the documented flow's
 * order), then CONTINUE, STOP_BUILD and END_BUILD (D37).
 */
export const EVENT_IDS = [
  'START',
  'APPROVE_PLAN',
  'DRAFT_SPEC',
  'APPROVE_SPEC',
  'EDIT_SPEC',
  'START_BUILD',
  'IMPLEMENTED',
  'REVIEW_ISSUES',
  'REVIEW_PASSED',
  'SPEC_PROBLEM',
  'REVISE',
  'REAPPROVE',
  'REQUEST_CHANGES',
  'CLOSE',
  'START_NEXT',
  'DATA_START',
  'DATA_STOP',
  'DATA_STOP_BUILD',
  'CONTINUE',
  'STOP_BUILD',
  'END_BUILD',
] as const;

export type EventId = (typeof EVENT_IDS)[number];

/** True when `value` is one of the twelve node ids. */
export function isNodeId(value: unknown): value is NodeId {
  return typeof value === 'string' && (NODE_IDS as readonly string[]).includes(value);
}

/** True when `value` is one of the twenty-one event ids. */
export function isEventId(value: unknown): value is EventId {
  return typeof value === 'string' && (EVENT_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** Where a feature starts: no work yet. */
export const INITIAL_NODE: NodeId = 'idle';

/**
 * The plugin's MACHINE_CONFIG.states as plain data: for each node, the events it accepts and the
 * node each one leads to. An event missing from a node's map is illegal there.
 */
export const TRANSITIONS: Readonly<Record<NodeId, Readonly<Partial<Record<EventId, NodeId>>>>> = {
  idle: { START: 'planning' },
  planning: { APPROVE_PLAN: 'plan-approved', DATA_START: 'data-agent' },
  'plan-approved': { DRAFT_SPEC: 'spec-drafted' },
  'spec-drafted': { APPROVE_SPEC: 'spec-approved' },
  'spec-approved': { EDIT_SPEC: 'spec-changed', START_BUILD: 'implementing' },
  'spec-changed': { REAPPROVE: 'implementing' },
  implementing: {
    IMPLEMENTED: 'reviewing',
    SPEC_PROBLEM: 'paused',
    DATA_START: 'data-agent',
    END_BUILD: 'build-done',
  },
  reviewing: {
    REVIEW_ISSUES: 'implementing',
    REVIEW_PASSED: 'build-done',
    SPEC_PROBLEM: 'paused',
    END_BUILD: 'build-done',
  },
  paused: {
    REVISE: 'spec-changed',
    REAPPROVE: 'implementing',
    CONTINUE: 'implementing',
    STOP_BUILD: 'build-done',
    END_BUILD: 'build-done',
  },
  'build-done': { CLOSE: 'closed', REQUEST_CHANGES: 'implementing' },
  closed: { START_NEXT: 'planning' },
  'data-agent': { DATA_STOP: 'planning', DATA_STOP_BUILD: 'implementing' },
};

/** The events legal from `node`, in EVENT_IDS order. */
export function legalEvents(node: NodeId): EventId[] {
  const targets = TRANSITIONS[node];
  return EVENT_IDS.filter((event) => targets[event] !== undefined);
}

/** The node `event` leads to from `node`, or `node` itself when the event is illegal there. */
export function nextNode(node: NodeId, event: EventId): NodeId {
  return TRANSITIONS[node][event] ?? node;
}

/** The outcome of a transition: the node after it, or the unchanged node and the fixed reason. */
export type TransitionResult =
  { ok: true; node: NodeId } | { ok: false; node: NodeId; reason: string };

/**
 * Applies `event` to `node`. A legal event gives `{ ok: true, node }` with the target. An illegal
 * one gives `{ ok: false, node, reason }`, where `node` is unchanged and `reason` names only the
 * two ids. A value that is not an id gets a fixed reason with no echo of the value.
 */
export function transition(node: NodeId, event: EventId): TransitionResult {
  if (!isNodeId(node) || !isEventId(event)) {
    return { ok: false, node, reason: 'unknown node or event' };
  }
  const target = TRANSITIONS[node][event];
  if (target === undefined) {
    return { ok: false, node, reason: `${event} is not a legal event from ${node}` };
  }
  return { ok: true, node: target };
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------

/** The six stages a user sees, in order. */
export const STAGE_IDS = ['start', 'plan', 'spec', 'build', 'review', 'done'] as const;

export type StageId = (typeof STAGE_IDS)[number];

/** The plain-language label of each stage (docs/workflow.md). */
export const STAGE_LABELS: Readonly<Record<StageId, string>> = {
  start: 'Start',
  plan: 'Plan',
  spec: 'Spec',
  build: 'Build',
  review: 'Review',
  done: 'Done',
};

/** The label of the paused variant of the Build stage. */
export const PAUSED_LABEL = 'Build, paused';

/** The stage a path node shows. `paused` is true only for the paused node. */
export interface StageView {
  readonly stage: StageId;
  readonly paused: boolean;
}

const PATH_STAGES: Readonly<Record<PathId, StageView>> = {
  idle: { stage: 'start', paused: false },
  planning: { stage: 'plan', paused: false },
  'plan-approved': { stage: 'plan', paused: false },
  'spec-drafted': { stage: 'spec', paused: false },
  'spec-changed': { stage: 'spec', paused: false },
  'spec-approved': { stage: 'build', paused: false },
  implementing: { stage: 'build', paused: false },
  reviewing: { stage: 'build', paused: false },
  paused: { stage: 'build', paused: true },
  'build-done': { stage: 'review', paused: false },
  closed: { stage: 'done', paused: false },
};

/** The stage a path node shows, per docs/workflow.md. */
export function stageOf(node: PathId): StageView {
  return PATH_STAGES[node];
}

/** The label a stage view shows: "Build, paused" for the paused node, else the stage label. */
export function stageLabel(view: StageView): string {
  return view.paused ? PAUSED_LABEL : STAGE_LABELS[view.stage];
}

/** True only for `data-agent`, which runs beside the path and has no stage of its own. */
export function isOverlay(node: NodeId): node is 'data-agent' {
  return node === 'data-agent';
}

// ---------------------------------------------------------------------------------------------
// Event kinds and the human-action map
// ---------------------------------------------------------------------------------------------

/**
 * Who may trigger an event: `human-only` only from a D33 human action, `user` from a person's
 * choice in the UI, and `app` from the app's own work (D34).
 */
export type EventKind = 'human-only' | 'user' | 'app';

export const EVENT_KINDS: Readonly<Record<EventId, EventKind>> = {
  APPROVE_SPEC: 'human-only',
  REAPPROVE: 'human-only',
  CLOSE: 'human-only',
  START: 'user',
  APPROVE_PLAN: 'user',
  START_BUILD: 'user',
  REVISE: 'user',
  REQUEST_CHANGES: 'user',
  START_NEXT: 'user',
  DRAFT_SPEC: 'app',
  EDIT_SPEC: 'app',
  IMPLEMENTED: 'app',
  REVIEW_ISSUES: 'app',
  REVIEW_PASSED: 'app',
  SPEC_PROBLEM: 'app',
  DATA_START: 'app',
  DATA_STOP: 'app',
  DATA_STOP_BUILD: 'app',
  CONTINUE: 'user',
  STOP_BUILD: 'user',
  END_BUILD: 'app',
};

/** The human-only events, which are the keys of HUMAN_EVENT_ACTIONS. */
export type HumanOnlyEventId = 'APPROVE_SPEC' | 'REAPPROVE' | 'CLOSE';

/**
 * The D33 action that each human-only event is carried out by. `approve-result` and the two
 * other human actions have no event here (D34).
 */
export const HUMAN_EVENT_ACTIONS: Readonly<Record<HumanOnlyEventId, HumanActionId>> = {
  APPROVE_SPEC: 'approve-spec',
  REAPPROVE: 'approve-spec',
  CLOSE: 'mark-done',
};
