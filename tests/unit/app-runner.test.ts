// The app runner factory (p3-headless-e2e, D39, AC5). Every gate decision of a runner built by
// createAppJobRunner reaches the logger as its formatRuleEvent line, and each call reads the live
// supplier again, so a change of the live feature or spec state is seen by the next call.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localEnvironment } from '../../src/main/env';
import { createAppJobRunner } from '../../src/main/workflow/app-runner';
import type { LiveSpec } from '../../src/main/policy/context';
import { formatRuleEvent, makeRuleEvent, type RuleLogger } from '../../src/main/policy/rule-event';
import { createScriptedProvider, type ScriptedTurn } from '../support/scripted-provider';

const FEATURE = 'p9-demo';
const SECRET_CONTENT = 'SECRET-CONTENT-123';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sdd-app-runner-'));
  mkdirSync(join(root, 'src'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function recordingLogger() {
  const info = vi.fn<(message: string) => void>();
  const warn = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const logger: RuleLogger = { info, warn, error };
  return { logger, info, warn, error };
}

function writeCall(path: string): ScriptedTurn {
  return { toolCalls: [{ name: 'write_file', args: { path, content: SECRET_CONTENT } }] };
}

describe('createAppJobRunner (AC5)', () => {
  it('logs every decision as its formatRuleEvent line, and reads the live spec state per call', async () => {
    const script = {
      writer: [
        // Request 1: no feature open, so the source write is blocked.
        writeCall('src/a.ts'),
        { text: 'first done' },
        // Request 2: the spec is approved. The source write is allowed and the SPECS.md write blocked.
        writeCall('src/b.ts'),
        writeCall(`docs/specs/${FEATURE}/SPECS.md`),
        { text: 'second done' },
      ],
      reviewer: [],
    };
    const provider = createScriptedProvider(script);
    const { logger, info, error } = recordingLogger();
    let live: LiveSpec = { feature: null, spec: 'none' };
    const runner = await createAppJobRunner({
      env: localEnvironment(),
      root,
      provider,
      model: 'test-model',
      live: () => live,
      log: logger,
    });

    const first = await runner({ job: 'writer', task: 'first', history: [] });
    expect(first.ok).toBe(true);
    expect(existsSync(join(root, 'src', 'a.ts'))).toBe(false);

    live = { feature: FEATURE, spec: 'approved' };
    const second = await runner({ job: 'writer', task: 'second', history: [] });
    expect(second.ok).toBe(true);
    expect(readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe(SECRET_CONTENT);
    expect(existsSync(join(root, 'docs', 'specs', FEATURE, 'SPECS.md'))).toBe(false);

    const blockedSource = makeRuleEvent(
      { job: 'writer', tool: 'write_file', args: { path: 'src/a.ts', content: 'x' } },
      false,
      'not allowed: source files can be edited only after the spec is approved',
    );
    const allowedSource = makeRuleEvent(
      { job: 'writer', tool: 'write_file', args: { path: 'src/b.ts', content: 'x' } },
      true,
      'allowed',
    );
    const blockedSpec = makeRuleEvent(
      {
        job: 'writer',
        tool: 'write_file',
        args: { path: `docs/specs/${FEATURE}/SPECS.md`, content: 'x' },
      },
      false,
      'not allowed: the spec is approved; spec files are read-only',
    );

    expect(error.mock.calls.map((call) => call[0])).toEqual([
      formatRuleEvent(blockedSource),
      formatRuleEvent(blockedSpec),
    ]);
    expect(info.mock.calls.map((call) => call[0])).toEqual([formatRuleEvent(allowedSource)]);
    expect(formatRuleEvent(blockedSource)).toBe(
      'rule blocked: job=writer tool=write_file target=src/a.ts reason=not allowed: source files can be edited only after the spec is approved',
    );

    // No line holds file content.
    const everyLine = [...info.mock.calls, ...error.mock.calls].map((call) => call[0]);
    expect(everyLine.some((line) => line.includes(SECRET_CONTENT))).toBe(false);
  });
});
