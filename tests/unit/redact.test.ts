import { describe, expect, it } from 'vitest';
import { createRedactor, redactor, REDACTED } from '../../src/main/secrets/redact';

const SENTINEL = 'SENTINEL-REDACT-5531';
const KEY_SHAPE = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRST';

describe('redact: registered values', () => {
  it('replaces a registered value wherever it appears, several times', () => {
    const r = createRedactor();
    r.register(SENTINEL);
    expect(r.redact(`a ${SENTINEL} b ${SENTINEL} c`)).toBe(`a ${REDACTED} b ${REDACTED} c`);
  });

  it('replaces a registered value inside JSON text', () => {
    const r = createRedactor();
    r.register(SENTINEL);
    const json = JSON.stringify({ note: `value is ${SENTINEL}`, other: 1 });
    expect(r.redact(json)).not.toContain(SENTINEL);
    expect(JSON.parse(r.redact(json))).toEqual({ note: `value is ${REDACTED}`, other: 1 });
  });

  it('treats the registered value literally, not as a pattern', () => {
    const r = createRedactor();
    r.register('a.b*c(d)');
    expect(r.redact('x a.b*c(d) y axbbc')).toBe(`x ${REDACTED} y axbbc`);
  });

  it('removes a longer value whole when a shorter registered value is inside it', () => {
    const r = createRedactor();
    r.register('abcd');
    r.register('abcdefgh');
    expect(r.redact('abcdefgh')).toBe(REDACTED);
  });

  it('ignores an empty or whitespace-only value', () => {
    const r = createRedactor();
    r.register('');
    r.register('   \t ');
    expect(r.redact('plain text   ')).toBe('plain text   ');
  });

  it('keeps a registered value redacted across later calls on the same redactor', () => {
    const r = createRedactor();
    r.register(SENTINEL);
    expect(r.redact(SENTINEL)).toBe(REDACTED);
    expect(r.redact(`again ${SENTINEL}`)).toBe(`again ${REDACTED}`);
  });
});

describe('redact: Bearer tokens', () => {
  it('replaces the token after Bearer and keeps the word', () => {
    const r = createRedactor();
    expect(r.redact('Bearer abc.DEF-123_x~y+z/==')).toBe(`Bearer ${REDACTED}`);
  });

  it('matches the word case-insensitively', () => {
    const r = createRedactor();
    // The header rule then also covers the rest of the line, so only the name is left.
    expect(r.redact('authorization: bearer TOKEN-VALUE-1')).toBe(`authorization: ${REDACTED}`);
    expect(r.redact('BEARER TOKEN-VALUE-2')).toBe(`BEARER ${REDACTED}`);
  });

  it('does not treat a line break after the word as a separator, so a bare Bearer is unchanged', () => {
    const r = createRedactor();
    expect(r.redact('Bearer\nnext line')).toBe('Bearer\nnext line');
    expect(r.redact('Bearer\r\nnext line')).toBe('Bearer\r\nnext line');
    expect(r.redact('Bearer\t\tTOKEN-VALUE-4')).toBe(`Bearer\t\t${REDACTED}`);
  });

  it('stops the token at a JSON quote', () => {
    const r = createRedactor();
    expect(r.redact('{"t":"Bearer TOKEN-VALUE-3","n":1}')).toBe(`{"t":"Bearer ${REDACTED}","n":1}`);
  });
});

describe('redact: Authorization and x-api-key headers', () => {
  it('replaces the value of an Authorization header written as name: value', () => {
    const r = createRedactor();
    expect(r.redact('Authorization: Basic dXNlcjpwYXNz')).toBe(`Authorization: ${REDACTED}`);
  });

  it('replaces the value of an x-api-key header, in any case', () => {
    const r = createRedactor();
    expect(r.redact('X-API-Key: some-value-here')).toBe(`X-API-Key: ${REDACTED}`);
    expect(r.redact('x-api-key:other')).toBe(`x-api-key:${REDACTED}`);
  });

  it('replaces the value of a header written as JSON', () => {
    const r = createRedactor();
    expect(r.redact('{"Authorization":"Basic abc"}')).toBe(`{"Authorization":"${REDACTED}"}`);
    expect(r.redact('{"x-api-key": "k-1"}')).toBe(`{"x-api-key": "${REDACTED}"}`);
  });
});

describe('redact: key-shaped strings', () => {
  it('replaces sk- and sk-ant- strings with at least 20 key characters', () => {
    const r = createRedactor();
    expect(r.redact(`key ${KEY_SHAPE} end`)).toBe(`key ${REDACTED} end`);
    expect(r.redact('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(REDACTED);
  });

  it('leaves near-misses unchanged', () => {
    const r = createRedactor();
    expect(r.redact('sk-short')).toBe('sk-short');
    expect(r.redact('the word Bearer')).toBe('the word Bearer');
    expect(r.redact('Bearer')).toBe('Bearer');
    expect(r.redact('Bearer   ')).toBe('Bearer   ');
    expect(r.redact('risk-management-is-a-long-phrase')).toBe('risk-management-is-a-long-phrase');
  });
});

describe('redact: the process-wide instance', () => {
  it('is a redactor whose registered value is removed', () => {
    const value = 'SENTINEL-PROCESS-WIDE-0042';
    redactor.register(value);
    expect(redactor.redact(`line ${value}`)).toBe(`line ${REDACTED}`);
  });
});
