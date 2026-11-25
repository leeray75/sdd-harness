import { describe, expect, it } from 'vitest';
import {
  checkRoundLimit,
  DEFAULT_RULES,
  formatCommitMessage,
  MAX_COMMIT_FORMAT_LENGTH,
  parseRules,
  RULE_REASONS,
} from '../../src/shared/project-rules';
import { roundLimit } from '../../src/main/workflow/build-loop';

function refusedReason(value: unknown): string {
  const result = parseRules(value);
  if (result.ok) throw new Error('expected the rules to be refused');
  return result.reason;
}

describe('defaults (G2)', () => {
  it('is round limit 3, the defaults model policy and the ticket-colon format', () => {
    expect(DEFAULT_RULES).toEqual({
      roundLimit: 3,
      modelPolicy: 'defaults',
      commitFormat: '{ticket}: {summary}',
    });
  });

  it('fills every missing field with its default', () => {
    expect(parseRules({})).toEqual({ ok: true, rules: DEFAULT_RULES });
    expect(parseRules({ roundLimit: 1 })).toEqual({
      ok: true,
      rules: { ...DEFAULT_RULES, roundLimit: 1 },
    });
    expect(parseRules({ commitFormat: '[{ticket}] {summary}' })).toEqual({
      ok: true,
      rules: { ...DEFAULT_RULES, commitFormat: '[{ticket}] {summary}' },
    });
  });

  it('treats an undefined field as missing', () => {
    expect(parseRules({ roundLimit: undefined })).toEqual({ ok: true, rules: DEFAULT_RULES });
  });
});

describe('parseRules: accepted values (AC3)', () => {
  it('accepts each round limit', () => {
    for (const roundLimit of [1, 2, 3]) {
      expect(parseRules({ roundLimit })).toEqual({
        ok: true,
        rules: { ...DEFAULT_RULES, roundLimit },
      });
    }
  });

  it('accepts each model policy', () => {
    for (const modelPolicy of ['defaults', 'self-hosted-only', 'custom']) {
      expect(parseRules({ modelPolicy })).toEqual({
        ok: true,
        rules: { ...DEFAULT_RULES, modelPolicy },
      });
    }
  });

  it('accepts a commit format of 1 and of 120 characters', () => {
    expect(parseRules({ commitFormat: '{summary}' }).ok).toBe(true);
    const longest = `${'x'.repeat(MAX_COMMIT_FORMAT_LENGTH - '{summary}'.length)}{summary}`;
    expect(longest.length).toBe(MAX_COMMIT_FORMAT_LENGTH);
    expect(parseRules({ commitFormat: longest }).ok).toBe(true);
  });

  it('accepts a format with the ticket once and the summary once in either order', () => {
    expect(parseRules({ commitFormat: '[{ticket}] {summary}' }).ok).toBe(true);
    expect(parseRules({ commitFormat: '{summary} ({ticket})' }).ok).toBe(true);
  });
});

describe('parseRules: refused values (AC3)', () => {
  it('refuses round limits 0, 4, "3" and 2.5', () => {
    for (const roundLimit of [0, 4, '3', 2.5]) {
      expect(parseRules({ roundLimit })).toEqual({
        ok: false,
        reason: RULE_REASONS.roundLimit,
      });
    }
  });

  it('refuses an unknown model policy', () => {
    expect(refusedReason({ modelPolicy: 'anything' })).toBe(RULE_REASONS.modelPolicy);
    expect(refusedReason({ modelPolicy: 'Defaults' })).toBe(RULE_REASONS.modelPolicy);
  });

  it('refuses a format without {summary}', () => {
    expect(refusedReason({ commitFormat: '{ticket}' })).toBe(RULE_REASONS.formatNoSummary);
    expect(refusedReason({ commitFormat: 'plain text' })).toBe(RULE_REASONS.formatNoSummary);
  });

  it('refuses {summary} twice', () => {
    expect(refusedReason({ commitFormat: '{summary} {summary}' })).toBe(
      RULE_REASONS.formatSummaryTwice,
    );
  });

  it('refuses {ticket} twice', () => {
    expect(refusedReason({ commitFormat: '{ticket} {ticket} {summary}' })).toBe(
      RULE_REASONS.formatTicketTwice,
    );
  });

  it('refuses another placeholder', () => {
    expect(refusedReason({ commitFormat: '{ticket} {summary} {date}' })).toBe(
      RULE_REASONS.formatOtherBrace,
    );
    expect(refusedReason({ commitFormat: '{summary} }' })).toBe(RULE_REASONS.formatOtherBrace);
  });

  it('refuses a line break', () => {
    expect(refusedReason({ commitFormat: '{summary}\n' })).toBe(RULE_REASONS.formatLineBreak);
    expect(refusedReason({ commitFormat: '{summary}\r' })).toBe(RULE_REASONS.formatLineBreak);
  });

  it('refuses a format of 121 characters and an empty format', () => {
    const tooLong = `${'x'.repeat(MAX_COMMIT_FORMAT_LENGTH - '{summary}'.length + 1)}{summary}`;
    expect(tooLong.length).toBe(MAX_COMMIT_FORMAT_LENGTH + 1);
    expect(refusedReason({ commitFormat: tooLong })).toBe(RULE_REASONS.formatLength);
    expect(refusedReason({ commitFormat: '' })).toBe(RULE_REASONS.formatLength);
  });

  it('refuses specApproval, review and any other unknown key', () => {
    for (const key of ['specApproval', 'review', 'anything']) {
      expect(parseRules({ [key]: true })).toEqual({
        ok: false,
        reason: RULE_REASONS.unknownKey,
      });
    }
  });

  it('refuses a value that is not a plain object', () => {
    expect(refusedReason(null)).toBe(RULE_REASONS.notObject);
    expect(refusedReason('rules')).toBe(RULE_REASONS.notObject);
    expect(refusedReason([])).toBe(RULE_REASONS.notObject);
    expect(refusedReason(Object.create({ roundLimit: 1 }))).toBe(RULE_REASONS.notPlain);
  });

  it('never echoes the input in a reason', () => {
    const secret = 'SECRET-VALUE-123';
    const reasons = [
      parseRules({ roundLimit: secret }),
      parseRules({ modelPolicy: secret }),
      parseRules({ commitFormat: `{summary} ${secret} {x}` }),
      parseRules({ [secret]: 1 }),
    ];
    for (const result of reasons) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toContain(secret);
    }
  });
});

describe('checkRoundLimit and the build loop (AC2, AC3)', () => {
  it('accepts 1, 2 and 3 and refuses the rest with the fixed reason', () => {
    for (const limit of [1, 2, 3]) {
      expect(checkRoundLimit(limit)).toEqual({ ok: true, limit });
    }
    expect(checkRoundLimit(0)).toEqual({ ok: false, reason: RULE_REASONS.roundLimit });
  });

  it('gives the build loop the same results, with undefined meaning 3', () => {
    expect(roundLimit(undefined)).toEqual({ ok: true, limit: 3 });
    expect(roundLimit(2)).toEqual(checkRoundLimit(2));
    expect(roundLimit('3')).toEqual(checkRoundLimit('3'));
  });
});

describe('formatCommitMessage', () => {
  it('fills the default format with a ticket', () => {
    expect(formatCommitMessage(DEFAULT_RULES.commitFormat, 'T-42', 'Add it')).toBe('T-42: Add it');
  });

  it('gives the summary alone with no ticket, whatever the format', () => {
    expect(formatCommitMessage(DEFAULT_RULES.commitFormat, '', 'Add it')).toBe('Add it');
    expect(formatCommitMessage('[{ticket}] {summary}', '', 'Add it')).toBe('Add it');
  });

  it('fills a custom format with a ticket', () => {
    expect(formatCommitMessage('[{ticket}] {summary}', 'T-42', 'Add it')).toBe('[T-42] Add it');
  });

  it('keeps a placeholder or a dollar pattern in the values as text', () => {
    expect(formatCommitMessage('{ticket}: {summary}', 'T-1', '{ticket} $& done')).toBe(
      'T-1: {ticket} $& done',
    );
  });
});
