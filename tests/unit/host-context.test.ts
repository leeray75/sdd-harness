import { describe, expect, it } from 'vitest';
import { commandPolicyFor, contextFor, type LiveSupplier } from '../../src/main/agent/host';
import { checkToolCall } from '../../src/main/policy/gate';
import {
  DEFAULT_POLICY_CONTEXT,
  type LiveSpec,
  type PolicyContext,
} from '../../src/main/policy/context';

// AC6 (p3-spec-lock, D36): each tool call's context is the base context with the live supplier's
// current feature and spec state. Without a supplier the default is used, as before.

const BASE: PolicyContext = { ...DEFAULT_POLICY_CONTEXT, feature: 'base', spec: 'none' };

/** A supplier whose answer the test changes between calls. */
function movingSupplier(first: LiveSpec) {
  let current = first;
  const supplier: LiveSupplier = () => current;
  return {
    supplier,
    set(next: LiveSpec) {
      current = next;
    },
  };
}

describe('contextFor', () => {
  it('returns the base context unchanged with no supplier', () => {
    expect(contextFor(BASE)).toBe(BASE);
  });

  it('takes the feature and spec from the supplier, and keeps the rest of the base', () => {
    const got = contextFor(BASE, () => ({ feature: 'live', spec: 'approved' }));
    expect(got.feature).toBe('live');
    expect(got.spec).toBe('approved');
    expect(got.tightening).toBe(BASE.tightening);
    expect(got.commandCheck).toBe(BASE.commandCheck);
  });
});

describe('the host context follows the supplier (AC6)', () => {
  it('uses the supplier values at each call, not the values at start', () => {
    const live = movingSupplier({ feature: 'f', spec: 'draft' });
    const { contextNow } = commandPolicyFor(undefined, live.supplier);
    const writeSource = {
      job: 'writer' as const,
      tool: 'write_file',
      args: { path: 'src/a.ts', content: 'x' },
    };

    expect(checkToolCall(writeSource, contextNow()).allow).toBe(false);

    live.set({ feature: 'f', spec: 'approved' });
    expect(checkToolCall(writeSource, contextNow()).allow).toBe(true);

    live.set({ feature: 'f', spec: 'locked' });
    expect(checkToolCall(writeSource, contextNow()).allow).toBe(false);
  });

  it('gives the default context, with no feature and no spec, when no supplier is given', () => {
    const { contextNow } = commandPolicyFor(undefined);
    expect(contextNow()).toEqual(DEFAULT_POLICY_CONTEXT);
  });

  it('keeps the command check deny-all with no root, whatever the supplier says', () => {
    const { contextNow, commandCheck } = commandPolicyFor(undefined, () => ({
      feature: 'f',
      spec: 'approved',
    }));
    expect(commandCheck({ job: 'writer', program: 'node', args: ['-v'] }).allow).toBe(false);
    expect(contextNow().commandCheck).toBe(commandCheck);
  });
});
