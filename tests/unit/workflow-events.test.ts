import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HUMAN_ACTION_IDS } from '../../src/shared/human-actions';
import { EVENT_IDS, EVENT_KINDS, HUMAN_EVENT_ACTIONS } from '../../src/shared/workflow';

describe('event kinds (AC6)', () => {
  it('classifies all twenty-one events, and only those', () => {
    expect(Object.keys(EVENT_KINDS).sort()).toEqual([...EVENT_IDS].sort());
    expect(Object.keys(EVENT_KINDS)).toHaveLength(21);
  });

  it('marks APPROVE_SPEC, REAPPROVE and CLOSE as human-only', () => {
    const humanOnly = EVENT_IDS.filter((event) => EVENT_KINDS[event] === 'human-only');
    expect(humanOnly).toEqual(['APPROVE_SPEC', 'REAPPROVE', 'CLOSE']);
  });

  it('marks the eight user events as user', () => {
    const user = EVENT_IDS.filter((event) => EVENT_KINDS[event] === 'user');
    expect(user).toEqual([
      'START',
      'APPROVE_PLAN',
      'START_BUILD',
      'REVISE',
      'REQUEST_CHANGES',
      'START_NEXT',
      'CONTINUE',
      'STOP_BUILD',
    ]);
  });

  it('marks the ten app events as app', () => {
    const app = EVENT_IDS.filter((event) => EVENT_KINDS[event] === 'app');
    expect(app).toEqual([
      'DRAFT_SPEC',
      'EDIT_SPEC',
      'IMPLEMENTED',
      'REVIEW_ISSUES',
      'REVIEW_PASSED',
      'SPEC_PROBLEM',
      'DATA_START',
      'DATA_STOP',
      'DATA_STOP_BUILD',
      'END_BUILD',
    ]);
  });

  it('no human-only event is classified as app', () => {
    for (const event of EVENT_IDS) {
      if (EVENT_KINDS[event] === 'human-only') {
        expect(EVENT_KINDS[event]).not.toBe('app');
      }
    }
  });
});

describe('the human-action map (AC6)', () => {
  it('maps APPROVE_SPEC and REAPPROVE to approve-spec, and CLOSE to mark-done', () => {
    expect(HUMAN_EVENT_ACTIONS).toEqual({
      APPROVE_SPEC: 'approve-spec',
      REAPPROVE: 'approve-spec',
      CLOSE: 'mark-done',
    });
  });

  it('its keys are exactly the human-only events', () => {
    const humanOnly = EVENT_IDS.filter((event) => EVENT_KINDS[event] === 'human-only');
    expect(Object.keys(HUMAN_EVENT_ACTIONS).sort()).toEqual([...humanOnly].sort());
  });

  it('every value is a D33 human action id', () => {
    for (const action of Object.values(HUMAN_EVENT_ACTIONS)) {
      expect(HUMAN_ACTION_IDS).toContain(action);
    }
  });
});

describe('the shared workflow module is pure (AC7)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/shared/workflow.ts', import.meta.url)),
    'utf8',
  );

  it('imports nothing outside src/shared, and no Node, Electron or DOM API', () => {
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier?.startsWith('./'), `import ${specifier}`).toBe(true);
    }
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bprocess\.|\bwindow\.|\bdocument\.|\belectron\b/);
  });
});
