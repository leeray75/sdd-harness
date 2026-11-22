import { describe, expect, it } from 'vitest';
import {
  EVENT_IDS,
  EVENT_KINDS,
  isOverlay,
  legalEvents,
  NODE_IDS,
  PAUSED_LABEL,
  PATH_IDS,
  stageLabel,
  stageOf,
  STAGE_IDS,
  STAGE_LABELS,
  transition,
} from '../../src/shared/workflow';

describe('stages and labels (AC4)', () => {
  it('STAGE_IDS are the six stages in order', () => {
    expect([...STAGE_IDS]).toEqual(['start', 'plan', 'spec', 'build', 'review', 'done']);
  });

  it('STAGE_LABELS gives the six plain-language labels', () => {
    expect(Object.values(STAGE_LABELS)).toEqual([
      'Start',
      'Plan',
      'Spec',
      'Build',
      'Review',
      'Done',
    ]);
    expect(PAUSED_LABEL).toBe('Build, paused');
  });

  it('maps each of the eleven path nodes per docs/workflow.md', () => {
    expect(PATH_IDS).toHaveLength(11);
    const expected: Record<string, { stage: string; paused: boolean }> = {
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
    for (const node of PATH_IDS) {
      expect(stageOf(node), node).toEqual(expected[node]);
    }
  });

  it('stageLabel gives "Build, paused" for the paused node and the stage label otherwise', () => {
    expect(stageLabel(stageOf('paused'))).toBe('Build, paused');
    expect(stageLabel(stageOf('implementing'))).toBe('Build');
    expect(stageLabel(stageOf('idle'))).toBe('Start');
    expect(stageLabel(stageOf('build-done'))).toBe('Review');
    expect(stageLabel(stageOf('closed'))).toBe('Done');
  });

  it('isOverlay is true only for data-agent', () => {
    for (const node of NODE_IDS) {
      expect(isOverlay(node), node).toBe(node === 'data-agent');
    }
  });

  it('none of the six STAGE_LABELS equals or contains an internal node or event id', () => {
    const labels = Object.values(STAGE_LABELS);
    expect(labels).toHaveLength(6);
    // Matched case-sensitively: the stage "Start" is a label, while START is an event id.
    const ids: string[] = [...NODE_IDS, ...EVENT_IDS];
    for (const label of labels) {
      for (const id of ids) {
        expect(label === id || label.includes(id), `${label} vs ${id}`).toBe(false);
      }
    }
  });

  it('PAUSED_LABEL is exempt from the id check and is checked by its exact value', () => {
    expect(PAUSED_LABEL).toBe('Build, paused');
    expect(stageLabel(stageOf('paused'))).toBe('Build, paused');
  });
});

describe('the build stops and waits at build-done (AC5)', () => {
  it('reviewing reaches build-done with REVIEW_PASSED', () => {
    expect(transition('reviewing', 'REVIEW_PASSED')).toEqual({ ok: true, node: 'build-done' });
  });

  it('build-done accepts only CLOSE and REQUEST_CHANGES', () => {
    expect(legalEvents('build-done')).toEqual(['REQUEST_CHANGES', 'CLOSE']);
  });

  it('both legal events from build-done are human-only or user, never app', () => {
    for (const event of legalEvents('build-done')) {
      expect(['human-only', 'user']).toContain(EVENT_KINDS[event]);
    }
  });

  it('build-done maps to the Review stage', () => {
    expect(stageLabel(stageOf('build-done'))).toBe('Review');
  });
});
