import { describe, expect, it } from 'vitest';
import {
  EVENT_IDS,
  INITIAL_NODE,
  isEventId,
  isNodeId,
  legalEvents,
  NODE_IDS,
  nextNode,
  PATH_IDS,
  transition,
  TRANSITIONS,
} from '../../src/shared/workflow';

// A literal copy of the sdd plugin's hooks/machine.ts at v0.18.0 (AC1, AC2). The test does not read
// the plugin at run time, because CI does not have it. Any change to the port is deliberate, and
// it must change this copy too.
const PLUGIN_NODE_IDS = [
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
];

const PLUGIN_PATH_IDS = PLUGIN_NODE_IDS.filter((id) => id !== 'data-agent');

const PLUGIN_EVENT_IDS = [
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
];

// The app's two additions for the build loop (D37, amends D34). They come after the plugin's list.
const HARNESS_EVENT_IDS = ['CONTINUE', 'STOP_BUILD', 'END_BUILD'];

const HARNESS_STATES: Record<string, Record<string, string>> = {
  implementing: { END_BUILD: 'build-done' },
  reviewing: { END_BUILD: 'build-done' },
  paused: { CONTINUE: 'implementing', STOP_BUILD: 'build-done', END_BUILD: 'build-done' },
};

const PLUGIN_STATES: Record<string, { on: Record<string, string> }> = {
  // Plugin states; the build-loop events are in HARNESS_STATES above.
  idle: { on: { START: 'planning' } },
  planning: { on: { APPROVE_PLAN: 'plan-approved', DATA_START: 'data-agent' } },
  'plan-approved': { on: { DRAFT_SPEC: 'spec-drafted' } },
  'spec-drafted': { on: { APPROVE_SPEC: 'spec-approved' } },
  'spec-approved': { on: { EDIT_SPEC: 'spec-changed', START_BUILD: 'implementing' } },
  'spec-changed': { on: { REAPPROVE: 'implementing' } },
  implementing: {
    on: { IMPLEMENTED: 'reviewing', SPEC_PROBLEM: 'paused', DATA_START: 'data-agent' },
  },
  reviewing: {
    on: { REVIEW_ISSUES: 'implementing', REVIEW_PASSED: 'build-done', SPEC_PROBLEM: 'paused' },
  },
  paused: { on: { REVISE: 'spec-changed', REAPPROVE: 'implementing' } },
  'build-done': { on: { CLOSE: 'closed', REQUEST_CHANGES: 'implementing' } },
  closed: { on: { START_NEXT: 'planning' } },
  'data-agent': { on: { DATA_STOP: 'planning', DATA_STOP_BUILD: 'implementing' } },
};

/** The target the plugin copy or the build-loop additions give for a pair, or undefined. */
function expectedTarget(node: string, event: string): string | undefined {
  return PLUGIN_STATES[node]?.on[event] ?? HARNESS_STATES[node]?.[event];
}

describe('workflow ids match the plugin v0.18.0 (AC1)', () => {
  it('NODE_IDS equals the plugin list, order included', () => {
    expect([...NODE_IDS]).toEqual(PLUGIN_NODE_IDS);
    expect(NODE_IDS).toHaveLength(12);
  });

  it('PATH_IDS is the eleven nodes other than data-agent, in order', () => {
    expect([...PATH_IDS]).toEqual(PLUGIN_PATH_IDS);
    expect(PATH_IDS).toHaveLength(11);
  });

  it('EVENT_IDS equals the plugin list, then the two build-loop events, order included', () => {
    expect([...EVENT_IDS]).toEqual([...PLUGIN_EVENT_IDS, ...HARNESS_EVENT_IDS]);
    expect(EVENT_IDS).toHaveLength(21);
  });

  it('INITIAL_NODE is idle', () => {
    expect(INITIAL_NODE).toBe('idle');
  });

  it('isNodeId and isEventId accept every id and reject anything else (AC3)', () => {
    for (const id of PLUGIN_NODE_IDS) {
      expect(isNodeId(id)).toBe(true);
    }
    for (const id of PLUGIN_EVENT_IDS) {
      expect(isEventId(id)).toBe(true);
    }
    for (const value of ['', 'Idle', 'toString', '__proto__', 'START ', 'planning-x', 42, null]) {
      expect(isNodeId(value)).toBe(false);
      expect(isEventId(value)).toBe(false);
    }
    // An event name is not a node, and a node name is not an event.
    expect(isNodeId('START')).toBe(false);
    expect(isEventId('idle')).toBe(false);
  });
});

describe('TRANSITIONS match the plugin config for every (node, event) pair (AC2)', () => {
  it('walks all 12 x 21 pairs: each plugin or build-loop transition is present, nothing else is legal', () => {
    let legal = 0;
    const table: Record<string, Record<string, string | undefined>> = TRANSITIONS;
    for (const node of PLUGIN_NODE_IDS) {
      for (const event of EVENT_IDS) {
        const expected = expectedTarget(node, event);
        const actual = table[node]?.[event];
        expect(actual, `${node} + ${event}`).toBe(expected);
        if (expected !== undefined) {
          legal += 1;
        }
      }
    }
    expect(legal).toBe(26);
  });

  it('has the same keys as the plugin states, one entry per node', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.keys(PLUGIN_STATES).sort());
    expect(Object.keys(TRANSITIONS)).toHaveLength(12);
  });
});

describe('legalEvents, nextNode and transition (AC3)', () => {
  it('legalEvents returns the node events in EVENT_IDS order', () => {
    expect(legalEvents('planning')).toEqual(['APPROVE_PLAN', 'DATA_START']);
    expect(legalEvents('spec-approved')).toEqual(['EDIT_SPEC', 'START_BUILD']);
    expect(legalEvents('implementing')).toEqual([
      'IMPLEMENTED',
      'SPEC_PROBLEM',
      'DATA_START',
      'END_BUILD',
    ]);
    expect(legalEvents('reviewing')).toEqual([
      'REVIEW_ISSUES',
      'REVIEW_PASSED',
      'SPEC_PROBLEM',
      'END_BUILD',
    ]);
    expect(legalEvents('paused')).toEqual([
      'REVISE',
      'REAPPROVE',
      'CONTINUE',
      'STOP_BUILD',
      'END_BUILD',
    ]);
    expect(legalEvents('idle')).toEqual(['START']);
  });

  it('legalEvents for every node matches the plugin config, in EVENT_IDS order', () => {
    for (const node of PLUGIN_NODE_IDS) {
      if (!isNodeId(node)) {
        throw new Error(`${node} is not a node id`);
      }
      const expected = EVENT_IDS.filter((event) => expectedTarget(node, event) !== undefined);
      expect(legalEvents(node)).toEqual(expected);
    }
  });

  it('nextNode returns the target for a legal event', () => {
    expect(nextNode('idle', 'START')).toBe('planning');
    expect(nextNode('reviewing', 'REVIEW_PASSED')).toBe('build-done');
    expect(nextNode('paused', 'REAPPROVE')).toBe('implementing');
  });

  it('nextNode returns the same node for an illegal event', () => {
    expect(nextNode('idle', 'CLOSE')).toBe('idle');
    expect(nextNode('closed', 'START_BUILD')).toBe('closed');
  });

  it('transition returns ok with the target for a legal event', () => {
    expect(transition('spec-drafted', 'APPROVE_SPEC')).toEqual({
      ok: true,
      node: 'spec-approved',
    });
  });

  it('transition returns ok false, the unchanged node and a fixed reason for an illegal event', () => {
    const result = transition('build-done', 'START_BUILD');
    expect(result).toEqual({
      ok: false,
      node: 'build-done',
      reason: 'START_BUILD is not a legal event from build-done',
    });
  });

  it('the reason names only the two ids, with no echo of other text', () => {
    const result = transition('idle', 'DATA_START');
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected an illegal transition');
    }
    expect(result.reason).toBe('DATA_START is not a legal event from idle');
  });

  it('transition refuses a value that is not an id, with a fixed reason and no echo', () => {
    const badNode = 'evil<script>' as unknown as Parameters<typeof transition>[0];
    const badEvent = 'DROP TABLE' as unknown as Parameters<typeof transition>[1];
    expect(transition(badNode, 'START')).toEqual({
      ok: false,
      node: badNode,
      reason: 'unknown node or event',
    });
    expect(transition('idle', badEvent)).toEqual({
      ok: false,
      node: 'idle',
      reason: 'unknown node or event',
    });
  });
});
