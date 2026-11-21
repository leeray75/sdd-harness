import { describe, expect, it } from 'vitest';
import {
  HUMAN_ACTION_IDS,
  isHumanActionId,
  parseHumanActionRequest,
} from '../../src/shared/human-actions';

describe('HUMAN_ACTION_IDS', () => {
  it('lists the five human-only actions', () => {
    expect([...HUMAN_ACTION_IDS]).toEqual([
      'approve-spec',
      'approve-result',
      'mark-done',
      'change-rules',
      'edit-approved-spec',
    ]);
  });
});

describe('parseHumanActionRequest: accepted requests', () => {
  it.each(HUMAN_ACTION_IDS)('accepts the action %s with a slug feature', (action) => {
    expect(parseHumanActionRequest({ action, feature: 'demo' })).toEqual({
      ok: true,
      request: { action, feature: 'demo' },
    });
  });

  it('accepts digits and single dashes inside a slug', () => {
    expect(
      parseHumanActionRequest({ action: 'mark-done', feature: 'p2-human-only-channel' }).ok,
    ).toBe(true);
    expect(parseHumanActionRequest({ action: 'mark-done', feature: 'a1' }).ok).toBe(true);
  });

  it('accepts a 64-character slug', () => {
    const feature = 'a'.repeat(64);
    expect(parseHumanActionRequest({ action: 'approve-spec', feature }).ok).toBe(true);
  });

  it('returns only the two fields, copied from a plain object', () => {
    const result = parseHumanActionRequest({ action: 'approve-spec', feature: 'demo' });
    expect(result).toEqual({ ok: true, request: { action: 'approve-spec', feature: 'demo' } });
  });
});

describe('parseHumanActionRequest: shape', () => {
  it('refuses a missing key', () => {
    expect(parseHumanActionRequest({ action: 'approve-spec' }).ok).toBe(false);
    expect(parseHumanActionRequest({ feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({}).ok).toBe(false);
  });

  it('refuses an extra key', () => {
    expect(parseHumanActionRequest({ action: 'approve-spec', feature: 'demo', extra: 1 }).ok).toBe(
      false,
    );
  });

  it('refuses an unknown action id', () => {
    expect(parseHumanActionRequest({ action: 'git-push', feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'Approve-Spec', feature: 'demo' }).ok).toBe(false);
  });

  it('refuses wrong types, arrays and null', () => {
    expect(parseHumanActionRequest(null).ok).toBe(false);
    expect(parseHumanActionRequest(undefined).ok).toBe(false);
    expect(parseHumanActionRequest('approve-spec').ok).toBe(false);
    expect(parseHumanActionRequest(42).ok).toBe(false);
    expect(parseHumanActionRequest(true).ok).toBe(false);
    expect(parseHumanActionRequest(['approve-spec', 'demo']).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 1, feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'approve-spec', feature: 1 }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: null, feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'approve-spec', feature: ['demo'] }).ok).toBe(false);
  });

  it('refuses an object from another prototype', () => {
    class Request {
      action = 'approve-spec';
      feature = 'demo';
    }
    expect(parseHumanActionRequest(new Request()).ok).toBe(false);
  });
});

describe('parseHumanActionRequest: feature slugs', () => {
  it.each([
    ['an empty slug', ''],
    ['uppercase', 'Demo'],
    ['a leading dash', '-demo'],
    ['a trailing dash', 'demo-'],
    ['a double dash', 'de--mo'],
    ['a 65-character slug', 'a'.repeat(65)],
    ['a path', '../x'],
    ['a path with a slash', 'a/b'],
    ['a space', 'de mo'],
    ['an underscore', 'de_mo'],
  ])('refuses %s', (_name, feature) => {
    expect(parseHumanActionRequest({ action: 'approve-spec', feature }).ok).toBe(false);
  });
});

describe('parseHumanActionRequest: reasons', () => {
  it('never echo a value from the request', () => {
    const secret = 'SECRET-VALUE-123';
    const bad = [
      { action: secret, feature: 'demo' },
      { action: 'approve-spec', feature: `${secret}/../x` },
      { action: 'approve-spec', feature: 'Upper' + secret },
      { action: 'approve-spec', feature: 'demo', [secret]: 1 },
      { [secret]: 'approve-spec', feature: 'demo' },
      { action: 'approve-spec' },
    ];
    for (const value of bad) {
      const result = parseHumanActionRequest(value);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).not.toContain(secret);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('never echo a long feature', () => {
    const long = 'x'.repeat(200);
    const result = parseHumanActionRequest({ action: 'approve-spec', feature: long });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).not.toContain(long);
  });
});

describe('isHumanActionId', () => {
  it('is true only for the five ids', () => {
    for (const id of HUMAN_ACTION_IDS) {
      expect(isHumanActionId(id)).toBe(true);
    }
    expect(isHumanActionId('human-action')).toBe(false);
    expect(isHumanActionId('approve_spec')).toBe(false);
    expect(isHumanActionId(undefined)).toBe(false);
  });
});
