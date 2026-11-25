import { describe, expect, it } from 'vitest';
import {
  DEV_PROJECT_ID,
  HUMAN_ACTION_IDS,
  isHumanActionId,
  isProjectId,
  parseHumanActionRequest,
} from '../../src/shared/human-actions';

const PROJECT = '0b6f2c1e-8d4a-4f3b-9c2d-1a2b3c4d5e6f';

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
    expect(parseHumanActionRequest({ action, project: 'dev', feature: 'demo' })).toEqual({
      ok: true,
      request: { action, project: 'dev', feature: 'demo' },
    });
  });

  it('accepts the dev project and a project UUID', () => {
    expect(parseHumanActionRequest({ action: 'mark-done', project: 'dev', feature: 'a1' }).ok).toBe(
      true,
    );
    expect(
      parseHumanActionRequest({ action: 'mark-done', project: PROJECT, feature: 'a1' }).ok,
    ).toBe(true);
  });

  it('accepts digits and single dashes inside a slug', () => {
    expect(
      parseHumanActionRequest({
        action: 'mark-done',
        project: 'dev',
        feature: 'p2-human-only-channel',
      }).ok,
    ).toBe(true);
    expect(parseHumanActionRequest({ action: 'mark-done', project: 'dev', feature: 'a1' }).ok).toBe(
      true,
    );
  });

  it('accepts a 64-character slug', () => {
    const feature = 'a'.repeat(64);
    expect(parseHumanActionRequest({ action: 'approve-spec', project: 'dev', feature }).ok).toBe(
      true,
    );
  });

  it('returns only the three fields, copied from a plain object', () => {
    const result = parseHumanActionRequest({
      action: 'approve-spec',
      project: 'dev',
      feature: 'demo',
    });
    expect(result).toEqual({
      ok: true,
      request: { action: 'approve-spec', project: 'dev', feature: 'demo' },
    });
  });
});

describe('parseHumanActionRequest: shape', () => {
  it('refuses a missing key, the project included', () => {
    expect(parseHumanActionRequest({ action: 'approve-spec', feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'approve-spec', project: 'dev' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'approve-spec' }).ok).toBe(false);
    expect(parseHumanActionRequest({ project: 'dev', feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({}).ok).toBe(false);
  });

  it('refuses an extra key', () => {
    expect(
      parseHumanActionRequest({ action: 'approve-spec', project: 'dev', feature: 'demo', extra: 1 })
        .ok,
    ).toBe(false);
  });

  it('refuses an unknown action id', () => {
    expect(
      parseHumanActionRequest({ action: 'git-push', project: 'dev', feature: 'demo' }).ok,
    ).toBe(false);
    expect(
      parseHumanActionRequest({ action: 'Approve-Spec', project: 'dev', feature: 'demo' }).ok,
    ).toBe(false);
  });

  it('refuses wrong types, arrays and null', () => {
    expect(parseHumanActionRequest(null).ok).toBe(false);
    expect(parseHumanActionRequest(undefined).ok).toBe(false);
    expect(parseHumanActionRequest('approve-spec').ok).toBe(false);
    expect(parseHumanActionRequest(42).ok).toBe(false);
    expect(parseHumanActionRequest(true).ok).toBe(false);
    expect(parseHumanActionRequest(['approve-spec', 'dev', 'demo']).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 1, project: 'dev', feature: 'demo' }).ok).toBe(false);
    expect(parseHumanActionRequest({ action: 'approve-spec', project: 'dev', feature: 1 }).ok).toBe(
      false,
    );
    expect(parseHumanActionRequest({ action: null, project: 'dev', feature: 'demo' }).ok).toBe(
      false,
    );
    expect(
      parseHumanActionRequest({ action: 'approve-spec', project: 'dev', feature: ['demo'] }).ok,
    ).toBe(false);
    expect(
      parseHumanActionRequest({ action: 'approve-spec', project: 1, feature: 'demo' }).ok,
    ).toBe(false);
  });

  it('refuses an object from another prototype', () => {
    class Request {
      action = 'approve-spec';
      project = 'dev';
      feature = 'demo';
    }
    expect(parseHumanActionRequest(new Request()).ok).toBe(false);
  });
});

describe('parseHumanActionRequest: project ids', () => {
  it.each([
    ['upper-case dev', 'DEV'],
    ['another name', 'default'],
    ['dev with a suffix', 'dev2'],
    ['an empty id', ''],
    ['a upper-case UUID', PROJECT.toUpperCase()],
    ['a UUID that is too short', PROJECT.slice(0, -1)],
    ['a UUID with no dashes', PROJECT.replace(/-/g, '')],
    ['a path', '../dev'],
  ])('refuses %s', (_name, project) => {
    const result = parseHumanActionRequest({ action: 'approve-spec', project, feature: 'demo' });
    expect(result.ok).toBe(false);
  });

  it('recognises dev and a lowercase UUID as project ids', () => {
    expect(DEV_PROJECT_ID).toBe('dev');
    expect(isProjectId('dev')).toBe(true);
    expect(isProjectId(PROJECT)).toBe(true);
    expect(isProjectId(1)).toBe(false);
    expect(isProjectId(undefined)).toBe(false);
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
    expect(parseHumanActionRequest({ action: 'approve-spec', project: 'dev', feature }).ok).toBe(
      false,
    );
  });
});

describe('parseHumanActionRequest: reasons', () => {
  it('never echo a value from the request', () => {
    const secret = 'SECRET-VALUE-123';
    const bad = [
      { action: secret, project: 'dev', feature: 'demo' },
      { action: 'approve-spec', project: secret, feature: 'demo' },
      { action: 'approve-spec', project: 'dev', feature: `${secret}/../x` },
      { action: 'approve-spec', project: 'dev', feature: 'Upper' + secret },
      { action: 'approve-spec', project: 'dev', feature: 'demo', [secret]: 1 },
      { [secret]: 'approve-spec', project: 'dev', feature: 'demo' },
      { action: 'approve-spec', feature: 'demo' },
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
    const result = parseHumanActionRequest({
      action: 'approve-spec',
      project: 'dev',
      feature: long,
    });
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
