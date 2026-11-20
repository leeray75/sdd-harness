import { describe, expect, it } from 'vitest';
import { parseHeaderLines, validateHeaders } from '../../src/agent/provider/headers';

const SENTINEL = 'SENTINEL-HEADER-VALUE-do-not-leak-6204';

describe('parseHeaderLines (AC2)', () => {
  it('gives no headers for empty text, and ignores blank and whitespace-only lines', () => {
    expect(parseHeaderLines('')).toEqual({ ok: true, headers: {} });
    expect(parseHeaderLines('\n  \n\t\r\n')).toEqual({ ok: true, headers: {} });
  });

  it('splits each line at its first colon and trims the name and the value', () => {
    expect(parseHeaderLines('  X-Team :  platform  \nX-Url: http://a:4100/x')).toEqual({
      ok: true,
      headers: { 'X-Team': 'platform', 'X-Url': 'http://a:4100/x' },
    });
  });

  it('accepts \\n and \\r\\n line endings alike', () => {
    expect(parseHeaderLines('X-A: 1\r\nX-B: 2\nX-C: 3')).toEqual({
      ok: true,
      headers: { 'X-A': '1', 'X-B': '2', 'X-C': '3' },
    });
  });

  it('keeps a value that is empty after trimming as an empty string', () => {
    expect(parseHeaderLines('X-Empty:')).toEqual({ ok: true, headers: { 'X-Empty': '' } });
  });

  it('refuses a line with no colon, naming the line number', () => {
    const result = parseHeaderLines('X-A: 1\nno separator here');
    expect(result).toEqual({
      ok: false,
      reason: 'line 2 has no ":" between the name and the value',
    });
  });

  it('refuses an empty name, naming the line number', () => {
    expect(parseHeaderLines(': value')).toEqual({
      ok: false,
      reason: 'line 1 has an empty header name',
    });
  });

  it('refuses a repeated name, ignoring case', () => {
    const result = parseHeaderLines('X-Team: a\nx-team: b');
    expect(result).toEqual({
      ok: false,
      reason: 'line 2 repeats the header "x-team" (names ignore case)',
    });
  });

  it('refuses a name that is not an HTTP token, without echoing it', () => {
    const result = parseHeaderLines(`X Bad Name: 1`);
    expect(result).toEqual({
      ok: false,
      reason: 'line 1: the header name is not a valid HTTP token',
    });
  });

  it('refuses each reserved name, in any case', () => {
    for (const name of [
      'authorization',
      'X-API-KEY',
      'Anthropic-Version',
      'Content-Type',
      'content-length',
      'HOST',
    ]) {
      const result = parseHeaderLines(`${name}: 1`);
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('line 1');
        expect(result.reason).toContain(`"${name}" is reserved`);
      }
    }
  });

  it('refuses a value with a NUL or a lone CR, naming the header and the rule', () => {
    expect(parseHeaderLines('X-A: one\u0000two')).toEqual({
      ok: false,
      reason: 'line 1: header "X-A": the value contains a CR, LF or NUL character',
    });
    expect(parseHeaderLines('X-A: one\rtwo')).toEqual({
      ok: false,
      reason: 'line 1: header "X-A": the value contains a CR, LF or NUL character',
    });
  });

  it('keeps a name such as __proto__ as an ordinary header', () => {
    const result = parseHeaderLines('__proto__: 1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype);
      expect(Object.keys(result.headers)).toEqual(['__proto__']);
    }
  });

  it('never puts a header value in a refusal reason', () => {
    const texts = [
      `Authorization: Bearer ${SENTINEL}`,
      `X-A: ${SENTINEL}\u0000`,
      `X-A: ${SENTINEL}\nX-A: ${SENTINEL}`,
      `${SENTINEL}`,
      `${SENTINEL} x: 1`,
      `: ${SENTINEL}`,
    ];
    for (const text of texts) {
      const result = parseHeaderLines(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    }
  });
});

describe('validateHeaders (AC2)', () => {
  it('passes a valid record and returns a copy of it', () => {
    const input = { 'X-Team': 'platform' };
    const result = validateHeaders(input);
    expect(result).toEqual({ ok: true, headers: { 'X-Team': 'platform' } });
    expect(result.ok && result.headers).not.toBe(input);
  });

  it('passes an empty record', () => {
    expect(validateHeaders({})).toEqual({ ok: true, headers: {} });
  });

  it('refuses a name that is not an HTTP token, without echoing it', () => {
    expect(validateHeaders({ 'bad name': 'x' })).toEqual({
      ok: false,
      reason: 'the header name is not a valid HTTP token',
    });
    expect(validateHeaders({ '': 'x' })).toEqual({
      ok: false,
      reason: 'the header name is not a valid HTTP token',
    });
  });

  it('refuses reserved names in any case', () => {
    expect(validateHeaders({ 'X-Api-Key': SENTINEL })).toEqual({
      ok: false,
      reason: 'the header "X-Api-Key" is reserved (the adapter sets it or it carries the key)',
    });
  });

  it('refuses two names that differ only in case', () => {
    expect(validateHeaders({ 'X-A': '1', 'x-a': '2' })).toEqual({
      ok: false,
      reason: 'the header "x-a" repeats another name (names ignore case)',
    });
  });

  it('refuses a value with CR, LF or NUL, naming the header', () => {
    expect(validateHeaders({ 'X-A': 'a\nb' })).toEqual({
      ok: false,
      reason: 'header "X-A": the value contains a CR, LF or NUL character',
    });
  });

  it('refuses a non-string value without echoing it', () => {
    const result = validateHeaders({ 'X-A': 42 as unknown as string });
    expect(result).toEqual({ ok: false, reason: 'the value of header "X-A" is not a string' });
  });

  it('never puts a header value in a refusal reason', () => {
    const records: Record<string, string>[] = [
      { Authorization: `Bearer ${SENTINEL}` },
      { 'X-A': `${SENTINEL}\u0000` },
      { 'x-a': SENTINEL, 'X-A': SENTINEL },
      { [`${SENTINEL} name`]: 'v' },
    ];
    for (const record of records) {
      const result = validateHeaders(record);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    }
  });
});
