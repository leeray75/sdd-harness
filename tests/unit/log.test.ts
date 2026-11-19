import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../src/main/log';
import { redactor, REDACTED } from '../../src/main/secrets/redact';

const SENTINEL = 'SENTINEL-LOG-KEY-6613';
const BEARER_LINE = `Bearer ${SENTINEL}`;

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  // Capture what main writes, without printing to the test output.
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
  redactor.register(SENTINEL);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log: every line passes through the redactor (AC6)', () => {
  it('redacts a registered value in an info line', () => {
    log.info(`loaded key ${SENTINEL} for the job`);
    expect(stdout).toBe(`[harness] loaded key ${REDACTED} for the job\n`);
    expect(stdout).not.toContain(SENTINEL);
  });

  it('redacts a Bearer token in an info line', () => {
    log.info(`request used ${BEARER_LINE}`);
    expect(stdout).not.toContain(SENTINEL);
    expect(stdout).toContain(`Bearer ${REDACTED}`);
  });

  it('redacts a registered value in an error line, written to stderr only', () => {
    log.error(`failed with ${SENTINEL}`);
    expect(stderr).toBe(`[harness] failed with ${REDACTED}\n`);
    expect(stdout).toBe('');
  });

  it('redacts a Bearer token in an error line', () => {
    log.error(`request failed: ${BEARER_LINE}`);
    expect(stderr).not.toContain(SENTINEL);
  });

  it('redacts a forwarded agent line to stdout, unchanged otherwise', () => {
    log.forward(`agent says ${SENTINEL} and more`, false);
    expect(stdout).toBe(`agent says ${REDACTED} and more\n`);
    expect(stderr).toBe('');
  });

  it('redacts a forwarded agent line to stderr, including a Bearer token', () => {
    log.forward(`stderr text ${BEARER_LINE}`, true);
    expect(stderr).not.toContain(SENTINEL);
    expect(stdout).toBe('');
  });

  it('keeps lines without secrets exactly as they were', () => {
    log.info('agent ready pid=42');
    log.forward('[agent] spike finished stopped=answered turns=2', false);
    expect(stdout).toBe(
      '[harness] agent ready pid=42\n[agent] spike finished stopped=answered turns=2\n',
    );
  });

  it('never writes the sentinel to either stream across all three methods', () => {
    log.info(SENTINEL);
    log.error(BEARER_LINE);
    log.forward(SENTINEL, false);
    log.forward(BEARER_LINE, true);
    expect(stdout).not.toContain(SENTINEL);
    expect(stderr).not.toContain(SENTINEL);
  });
});
