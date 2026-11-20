import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { TOOL_NAMES, type ToolName } from '../../src/shared/tools';
import { handleAgentMessage, type RouterDeps, type ToolRunner } from '../../src/main/agent/router';
import { makeToolRunner } from '../../src/main/agent/host';
import { checkToolCall } from '../../src/main/policy/gate';

// host.ts imports Electron for the fork and the quit hook. The runner does not use it.
vi.mock('electron', () => ({
  app: { once: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

/** A valid argument object for each new tool. Running any of them would leave a visible trace. */
const NEW_TOOL_CALLS: Array<{ tool: ToolName; args: Record<string, unknown> }> = [
  { tool: 'list_files', args: {} },
  { tool: 'search_text', args: { pattern: 'alpha' } },
  { tool: 'write_file', args: { path: 'reach-write.txt', content: 'written' } },
  { tool: 'edit_file', args: { path: 'a.txt', old_text: 'alpha', new_text: 'omega' } },
  {
    tool: 'run_command',
    args: {
      program: process.execPath,
      args: ['-e', "require('node:fs').writeFileSync('reach-run.txt', 'ran')"],
    },
  },
  { tool: 'read_ticket', args: { id: 'T-1' } },
];

let base: string;
let root: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'tool-reachability-'));
  root = join(base, 'root');
  mkdirSync(root);
  writeFileSync(join(root, 'a.txt'), 'alpha beta');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function makeDeps(runner: ToolRunner) {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const runTool = vi.fn<ToolRunner>(runner);
  const deps: RouterDeps = { checkToolCall, runTool, logger: { info, error } };
  return { deps, runTool };
}

function request(job: JobId, tool: string, args: Record<string, unknown>, id = 'req-1') {
  return { type: 'tool-call-request', id, job, tool, args };
}

describe('reachability: the gate still denies every new tool for every job', () => {
  it.each(
    JOB_IDS.flatMap((job) => NEW_TOOL_CALLS.map((call) => [job, call.tool, call.args] as const)),
  )('denies %s calling %s, and the runner is never called', async (job, tool, args) => {
    const { deps, runTool } = makeDeps(makeToolRunner(root));
    const outcome = await handleAgentMessage(request(job, tool, args), deps);
    expect(outcome.reply).toMatchObject({
      type: 'tool-call-result',
      ok: false,
      error: { code: 'denied' },
    });
    expect(runTool).not.toHaveBeenCalled();
  });

  it('leaves no trace on disk from the denied write and command', async () => {
    const { deps } = makeDeps(makeToolRunner(root));
    for (const job of JOB_IDS) {
      for (const call of NEW_TOOL_CALLS) {
        await handleAgentMessage(request(job, call.tool, call.args), deps);
      }
    }
    expect(existsSync(join(root, 'reach-write.txt'))).toBe(false);
    expect(existsSync(join(root, 'reach-run.txt'))).toBe(false);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('alpha beta');
  });

  it('denies read_file for every job except reader', async () => {
    for (const job of JOB_IDS.filter((name) => name !== 'reader')) {
      const { deps, runTool } = makeDeps(makeToolRunner(root));
      const outcome = await handleAgentMessage(request(job, 'read_file', { path: 'a.txt' }), deps);
      expect(outcome.reply).toMatchObject({ ok: false, error: { code: 'denied' } });
      expect(runTool).not.toHaveBeenCalled();
    }
  });

  it('denies the reader calling read_file with extra arguments', async () => {
    const { deps, runTool } = makeDeps(makeToolRunner(root));
    const outcome = await handleAgentMessage(
      request('reader', 'read_file', { path: 'a.txt', pattern: '*' }),
      deps,
    );
    expect(outcome.reply).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(runTool).not.toHaveBeenCalled();
  });

  it('denies a tool name that only looks like a registry name', async () => {
    const { deps, runTool } = makeDeps(makeToolRunner(root));
    const outcome = await handleAgentMessage(
      request('reader', 'read_file ', { path: 'a.txt' }),
      deps,
    );
    expect(outcome.reply).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(runTool).not.toHaveBeenCalled();
  });
});

describe('reachability: reader + read_file still runs', () => {
  it('runs the call through the runner and returns the file text', async () => {
    const { deps, runTool } = makeDeps(makeToolRunner(root));
    const outcome = await handleAgentMessage(
      request('reader', 'read_file', { path: 'a.txt' }),
      deps,
    );
    expect(outcome.reply).toEqual({
      type: 'tool-call-result',
      id: 'req-1',
      ok: true,
      output: 'alpha beta',
    });
    expect(runTool).toHaveBeenCalledTimes(1);
  });
});

describe('makeToolRunner: dispatch after the registry guard', () => {
  it('refuses a name that is not in the registry, without running anything', async () => {
    const runner = makeToolRunner(root);
    expect(await runner({ tool: 'delete_file', args: { path: 'a.txt' } })).toEqual({
      ok: false,
      reason: 'no such tool',
    });
    expect(await runner({ tool: 'toString', args: {} })).toEqual({
      ok: false,
      reason: 'no such tool',
    });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('alpha beta');
  });

  it('refuses bad arguments with the guard reason, and does not run the tool', async () => {
    const runner = makeToolRunner(root);
    const result = await runner({ tool: 'write_file', args: { path: 'bad.txt' } });
    expect(result).toEqual({ ok: false, reason: "missing required argument 'content'" });
    expect(existsSync(join(root, 'bad.txt'))).toBe(false);
  });

  it('refuses unknown argument keys for a registry tool', async () => {
    const result = await makeToolRunner(root)({ tool: 'read_file', args: { path: 'a.txt', x: 1 } });
    expect(result.ok).toBe(false);
  });

  it('dispatches each registry tool to its runner', async () => {
    const runner = makeToolRunner(root);
    expect(await runner({ tool: 'read_file', args: { path: 'a.txt' } })).toEqual({
      ok: true,
      output: 'alpha beta',
    });
    expect(await runner({ tool: 'list_files', args: { pattern: '*.txt' } })).toEqual({
      ok: true,
      output: 'a.txt',
    });
    expect(await runner({ tool: 'search_text', args: { pattern: 'beta' } })).toEqual({
      ok: true,
      output: 'a.txt:1: alpha beta',
    });
    expect(
      await runner({
        tool: 'edit_file',
        args: { path: 'a.txt', old_text: 'beta', new_text: 'gamma' },
      }),
    ).toEqual({ ok: true, output: 'replaced 1 occurrence in a.txt' });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('alpha gamma');
    expect(await runner({ tool: 'write_file', args: { path: 'w.txt', content: 'hi' } })).toEqual({
      ok: true,
      output: 'wrote 2 bytes to w.txt',
    });
    expect(readFileSync(join(root, 'w.txt'), 'utf8')).toBe('hi');
    expect(await runner({ tool: 'read_ticket', args: { id: 'T-1' } })).toEqual({
      ok: false,
      reason: 'no tracker is configured',
    });
  });

  it('dispatches run_command, and refuses git through it', async () => {
    const runner = makeToolRunner(root);
    const ran = await runner({
      tool: 'run_command',
      args: { program: process.execPath, args: ['-e', "process.stdout.write('hello')"] },
    });
    expect(ran.ok).toBe(true);
    if (ran.ok) expect(ran.output).toContain('hello');
    expect(
      await runner({ tool: 'run_command', args: { program: 'git', args: ['status'] } }),
    ).toMatchObject({ ok: false });
  });

  it('uses the timeout main gives run_command', async () => {
    const quick = await makeToolRunner(root, { commandTimeoutMs: 300 })({
      tool: 'run_command',
      args: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] },
    });
    expect(quick.ok).toBe(true);
    if (quick.ok) expect(quick.output).toMatch(/^timed out after 300 ms/);
  });

  it('has no root for read_file when none is configured', async () => {
    expect(await makeToolRunner(undefined)({ tool: 'read_file', args: { path: 'a.txt' } })).toEqual(
      {
        ok: false,
        reason: 'no root is configured',
      },
    );
  });

  it('reads tickets from the source main gives it', async () => {
    const runner = makeToolRunner(root, {
      ticketSource: {
        read: async (id) => ({ ok: true, title: `ticket ${id}`, body: 'approve the spec' }),
      },
    });
    const result = await runner({ tool: 'read_ticket', args: { id: 'T-7' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain('Title: ticket T-7');
  });
});

// Every registry tool except read_file must be among the denied calls above. A tool added to
// the registry later makes this fail until its denial is covered too.
describe('reachability: coverage', () => {
  it('covers every registry tool other than read_file among the denied calls', () => {
    const covered = new Set(NEW_TOOL_CALLS.map((call) => call.tool));
    const expected = new Set<ToolName>(TOOL_NAMES.filter((name) => name !== 'read_file'));
    expect(covered).toEqual(expected);
  });
});
