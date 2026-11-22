import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type DetectInput, detectFolder } from '../../src/shared/spec-detect';
import { stageOf } from '../../src/shared/workflow';

// A folder with PLAN.md, SPECS.md and no summary, no ledger, and no build: the base fixture each
// case changes.
const BASE: DetectInput = {
  approval: 'approved',
  files: { plan: true, specs: true, summary: false },
  planStatus: 'approved',
  ledgerState: '',
  currentRound: null,
  phase: '',
};

function detect(changes: Partial<DetectInput>) {
  return detectFolder({ ...BASE, ...changes });
}

describe('detectFolder precedence (AC4)', () => {
  describe('approval changed', () => {
    it('is spec-changed, whatever the ledger says (stage Spec)', () => {
      const got = detect({ approval: 'changed', ledgerState: 'running', phase: 'reviewing' });
      expect(got).toEqual({
        node: 'spec-changed',
        stage: stageOf('spec-changed'),
        round: null,
        source: null,
      });
      expect(got.stage).toEqual({ stage: 'spec', paused: false });
    });
  });

  describe('approval none', () => {
    it('is closed when SUMMARY.md exists (stage Done)', () => {
      const got = detect({ approval: 'none', files: { plan: true, specs: true, summary: true } });
      expect(got.node).toBe('closed');
      expect(got.stage).toEqual({ stage: 'done', paused: false });
    });

    it('is spec-drafted when SPECS.md exists and there is no summary', () => {
      const got = detect({ approval: 'none', files: { plan: true, specs: true, summary: false } });
      expect(got.node).toBe('spec-drafted');
      expect(got.stage).toEqual({ stage: 'spec', paused: false });
    });

    it('is plan-approved when PLAN.md has Status approved and there is no SPECS.md', () => {
      const got = detect({
        approval: 'none',
        files: { plan: true, specs: false, summary: false },
        planStatus: 'approved',
      });
      expect(got.node).toBe('plan-approved');
      expect(got.stage).toEqual({ stage: 'plan', paused: false });
    });

    it('is planning when PLAN.md is not approved', () => {
      const got = detect({
        approval: 'none',
        files: { plan: true, specs: false, summary: false },
        planStatus: 'draft',
      });
      expect(got.node).toBe('planning');
      expect(got.stage).toEqual({ stage: 'plan', paused: false });
    });

    it('is idle when no file is present (stage Start)', () => {
      const got = detect({
        approval: 'none',
        files: { plan: false, specs: false, summary: false },
        planStatus: '',
      });
      expect(got).toEqual({ node: 'idle', stage: stageOf('idle'), round: null, source: null });
      expect(got.stage).toEqual({ stage: 'start', paused: false });
    });

    it('ignores the ledger: a paused or running ledger does not move the node', () => {
      const got = detect({
        approval: 'none',
        files: { plan: true, specs: true, summary: false },
        ledgerState: 'paused-for-revision',
      });
      expect(got.node).toBe('spec-drafted');
      expect(got.round).toBeNull();
      expect(got.source).toBeNull();
    });
  });

  describe('approval approved', () => {
    it('is paused when the ledger is paused-for-revision (stage Build, paused)', () => {
      const got = detect({ ledgerState: 'paused-for-revision', currentRound: 2 });
      expect(got.node).toBe('paused');
      expect(got.stage).toEqual({ stage: 'build', paused: true });
      expect(got.round).toBeNull();
      expect(got.source).toBeNull();
    });

    it('is build-done when the ledger is done (stage Review)', () => {
      const got = detect({ ledgerState: 'done', phase: 'reviewing', currentRound: 1 });
      expect(got.node).toBe('build-done');
      expect(got.stage).toEqual({ stage: 'review', paused: false });
      expect(got.round).toBeNull();
    });

    it('is build-done when SUMMARY.md exists and the ledger is not running', () => {
      const got = detect({
        files: { plan: true, specs: true, summary: true },
        ledgerState: 'done',
      });
      expect(got.node).toBe('build-done');
    });

    it('is build-done when SUMMARY.md exists and there is no ledger', () => {
      const got = detect({ files: { plan: true, specs: true, summary: true }, ledgerState: '' });
      expect(got.node).toBe('build-done');
    });

    it('is not build-done when SUMMARY.md exists but the ledger is running', () => {
      const got = detect({
        files: { plan: true, specs: true, summary: true },
        ledgerState: 'running',
        phase: '',
        currentRound: 1,
      });
      expect(got.node).toBe('implementing');
      expect(got.source).toBe('ledger');
    });

    it('is implementing from the phase line when the ledger is running (source phase)', () => {
      const got = detect({ ledgerState: 'running', phase: 'implementing', currentRound: 2 });
      expect(got).toEqual({
        node: 'implementing',
        stage: stageOf('implementing'),
        round: 2,
        source: 'phase',
      });
    });

    it('is reviewing from the phase line when the ledger is running (source phase)', () => {
      const got = detect({ ledgerState: 'running', phase: 'reviewing', currentRound: 3 });
      expect(got).toEqual({
        node: 'reviewing',
        stage: stageOf('reviewing'),
        round: 3,
        source: 'phase',
      });
    });

    it('is implementing from the ledger when the running ledger has no phase (source ledger)', () => {
      const got = detect({ ledgerState: 'running', phase: '', currentRound: 1 });
      expect(got).toEqual({
        node: 'implementing',
        stage: stageOf('implementing'),
        round: 1,
        source: 'ledger',
      });
    });

    it('has a null round for a running build when the ledger has no current round', () => {
      const got = detect({ ledgerState: 'running', phase: '', currentRound: null });
      expect(got.node).toBe('implementing');
      expect(got.round).toBeNull();
    });

    it('is spec-approved when there is no ledger and no summary (stage Build)', () => {
      const got = detect({ ledgerState: '', currentRound: 4 });
      expect(got).toEqual({
        node: 'spec-approved',
        stage: stageOf('spec-approved'),
        round: null,
        source: null,
      });
      expect(got.stage).toEqual({ stage: 'build', paused: false });
    });
  });

  describe('approval unchecked', () => {
    it('is detected the same way as approved: paused', () => {
      const got = detect({ approval: 'unchecked', ledgerState: 'paused-for-revision' });
      expect(got.node).toBe('paused');
    });

    it('is detected the same way as approved: build-done', () => {
      const got = detect({ approval: 'unchecked', ledgerState: 'done' });
      expect(got.node).toBe('build-done');
    });

    it('is detected the same way as approved: reviewing from the phase line', () => {
      const got = detect({
        approval: 'unchecked',
        ledgerState: 'running',
        phase: 'reviewing',
        currentRound: 1,
      });
      expect(got).toEqual({
        node: 'reviewing',
        stage: stageOf('reviewing'),
        round: 1,
        source: 'phase',
      });
    });

    it('is detected the same way as approved: spec-approved with no ledger', () => {
      const got = detect({ approval: 'unchecked', ledgerState: '' });
      expect(got.node).toBe('spec-approved');
      expect(got.source).toBeNull();
    });
  });
});

describe('the shared modules are pure (AC6)', () => {
  const modules = ['spec-docs.ts', 'spec-detect.ts'].map((name) =>
    readFileSync(fileURLToPath(new URL(`../../src/shared/${name}`, import.meta.url)), 'utf8'),
  );

  it('import only from the same folder, and use no Node, Electron or DOM API', () => {
    for (const source of modules) {
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(specifier?.startsWith('./'), `import ${specifier}`).toBe(true);
      }
      expect(source).not.toMatch(/\brequire\s*\(/);
      expect(source).not.toMatch(/\bprocess\.|\bwindow\.|\bdocument\.|\belectron\b/);
    }
  });
});
