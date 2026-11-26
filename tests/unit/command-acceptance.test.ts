import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAgentMessage, type RouterDeps, type ToolRunner } from '../../src/main/agent/router';
import { commandPolicyFor, makeToolRunner } from '../../src/main/agent/host';
import { checkToolCall } from '../../src/main/policy/gate';
import { DEFAULT_POLICY_CONTEXT } from '../../src/main/policy/context';
import { chooseNetwork, DEAD_PROXY } from '../../src/main/commands/network';
import { probeNetwork } from '../../src/main/env/probes';
import { localEnvironment, toolEnvironment } from '../../src/main/env';
import { runCommandInRoot, type CommandContext } from '../../src/main/tools/run-command';
import type { RuleEvent } from '../../src/main/policy/rule-event';
import type { JobId } from '../../src/shared/agent-protocol';

// host.ts imports Electron for the fork and the quit hook. The runner does not use it.
vi.mock('electron', () => ({
  app: { once: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

const ALLOW = () => ({ allow: true as const });
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

let base: string;
let counter = 0;
let scripts: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'command-acceptance-'));
  scripts = join(base, 'scripts');
  mkdirSync(scripts);
  const files: Record<string, string> = {
    // AC5: checks the lock, then edits, creates and deletes under docs/specs.
    'specs-stub.cjs': `
      const fs = require('node:fs'); const path = require('node:path');
      const dir = path.join(process.cwd(), 'docs', 'specs');
      const spec = path.join(dir, 'feature', 'SPECS.md');
      try { fs.writeFileSync(spec, 'lock check'); console.log('lock: writable'); }
      catch (error) { console.log('lock: ' + error.code); }
      fs.chmodSync(dir, 0o777); fs.chmodSync(path.join(dir, 'feature'), 0o777);
      fs.chmodSync(spec, 0o666); fs.chmodSync(path.join(dir, 'feature', 'tasks.md'), 0o666);
      fs.writeFileSync(spec, 'tampered');
      fs.writeFileSync(path.join(dir, 'feature', 'new.md'), 'created');
      fs.unlinkSync(path.join(dir, 'feature', 'tasks.md'));
      fs.mkdirSync(path.join(dir, 'extra'));
      fs.writeFileSync(path.join(dir, 'extra', 'x.md'), 'in a new folder');
      console.log('edited');
    `,
    // AC6: changes .git/HEAD, a ref and a hook, adds a hook, and changes .git/index.
    'git-stub.cjs': `
      const fs = require('node:fs'); const path = require('node:path');
      const git = path.join(process.cwd(), '.git');
      fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/evil\\n');
      fs.writeFileSync(path.join(git, 'refs', 'heads', 'main'), 'sha-evil');
      fs.writeFileSync(path.join(git, 'hooks', 'pre-commit'), 'evil hook');
      fs.writeFileSync(path.join(git, 'hooks', 'post-commit'), 'added hook');
      fs.writeFileSync(path.join(git, 'index'), 'index changed');
      console.log('git edited');
    `,
    // AC7: edits a source file, creates one, deletes one, and writes ignored and node_modules paths.
    'project-stub.cjs': `
      const fs = require('node:fs'); const path = require('node:path');
      fs.writeFileSync('src/app.ts', 'edited by the command');
      fs.writeFileSync('src/new.ts', 'new file');
      fs.unlinkSync('src/gone.ts');
      fs.writeFileSync('out.log', 'ignored log');
      fs.mkdirSync('node_modules/pkg', { recursive: true });
      fs.writeFileSync(path.join('node_modules', 'pkg', 'index.js'), 'changed module');
      console.log('project edited');
    `,
    // AC8: unlocks and tampers, then sleeps until the timeout kills it.
    'sleep-stub.cjs': `
      const fs = require('node:fs'); const path = require('node:path');
      const dir = path.join(process.cwd(), 'docs', 'specs');
      fs.chmodSync(dir, 0o777); fs.chmodSync(path.join(dir, 'feature'), 0o777);
      fs.chmodSync(path.join(dir, 'feature', 'SPECS.md'), 0o666);
      fs.writeFileSync(path.join(dir, 'feature', 'SPECS.md'), 'tampered before timeout');
      setTimeout(() => {}, 60000);
    `,
    // AC9: reports the proxy variable the command sees.
    'env-stub.cjs': `
      console.log('proxy=' + (process.env.HTTP_PROXY ?? 'none') + ' goproxy=' + (process.env.GOPROXY ?? 'none'));
    `,
  };
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(scripts, name), source);
  }
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function fresh(): string {
  counter += 1;
  const root = join(base, `root-${counter}`);
  mkdirSync(root);
  return root;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** The docs/specs tree or the .git tree: every entry with its kind, mode and bytes. */
function treeOf(dir: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = `${prefix}${name}`;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out[rel] = `dir:${(stat.mode & 0o777).toString(8)}`;
      Object.assign(out, treeOf(path, `${rel}/`));
    } else {
      out[rel] = `file:${(stat.mode & 0o777).toString(8)}:${readFileSync(path).toString('base64')}`;
    }
  }
  return out;
}

/**
 * The project fixture: a spec folder, the .git key files and a source file. With `realGit`, git
 * init makes a real repository first, and the fake HEAD, config and index are not written (a
 * fake index would make git's query fail).
 */
function specFixture(root: string, realGit = false): void {
  if (realGit) {
    execFileSync('git', ['init', '-q'], { cwd: root });
  }
  write(root, 'docs/specs/feature/SPECS.md', 'spec v1');
  write(root, 'docs/specs/feature/tasks.md', 'tasks v1');
  if (!realGit) {
    write(root, '.git/HEAD', 'ref: refs/heads/main\n');
    write(root, '.git/config', '[core]\n');
    write(root, '.git/index', 'index v1');
  }
  write(root, '.git/hooks/pre-commit', 'hook v1');
  write(root, '.git/refs/heads/main', 'sha-v1');
  write(root, 'src/app.ts', 'export const a = 1;');
}

function script(name: string): string {
  return join(scripts, name);
}

interface Harvest {
  events: RuleEvent[];
  context: CommandContext;
}

function harvest(job: JobId): Harvest {
  const events: RuleEvent[] = [];
  return {
    events,
    context: { job, check: ALLOW, onRuleEvent: (event) => events.push(event) },
  };
}

function revertsOf(events: RuleEvent[]): string[] {
  return events
    .flatMap((event) => (event.kind === 'revert' ? [`${event.target}=${event.action}`] : []))
    .sort();
}

function networkOf(events: RuleEvent[]): RuleEvent[] {
  return events.filter((event) => event.kind === 'network');
}

describe('AC5: spec folder lock and restore, through the runner', () => {
  it.skipIf(IS_ROOT)(
    'the spec files are read-only during the run, and the folder is restored byte for byte and mode for mode',
    async () => {
      const root = fresh();
      specFixture(root);
      const before = treeOf(join(root, 'docs/specs'), 'docs/specs/');
      const { events, context } = harvest('writer');
      const result = await runCommandInRoot(
        toolEnvironment(localEnvironment()),
        root,
        { program: process.execPath, args: [script('specs-stub.cjs')] },
        context,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.output).toMatch(/lock: (EACCES|EPERM)/);
      expect(result.output).toContain('reverted changes in docs/specs');
      expect(treeOf(join(root, 'docs/specs'), 'docs/specs/')).toEqual(before);
      expect(revertsOf(events)).toEqual([
        'docs/specs/extra/x.md=deleted',
        'docs/specs/extra=deleted',
        'docs/specs/feature/SPECS.md=restored',
        'docs/specs/feature/new.md=deleted',
        'docs/specs/feature/tasks.md=re-created',
      ]);
    },
  );
});

describe('AC6: the .git key files', () => {
  it('restores HEAD, a ref and a hook, removes an added hook, and does not touch .git/index', async () => {
    const root = fresh();
    specFixture(root);
    const { events, context } = harvest('writer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('git-stub.cjs')] },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('reverted changes in .git');
    expect(readFileSync(join(root, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect(readFileSync(join(root, '.git/refs/heads/main'), 'utf8')).toBe('sha-v1');
    expect(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8')).toBe('hook v1');
    expect(existsSync(join(root, '.git/hooks/post-commit'))).toBe(false);
    expect(readFileSync(join(root, '.git/index'), 'utf8')).toBe('index changed');
    expect(revertsOf(events)).toEqual([
      '.git/HEAD=restored',
      '.git/hooks/post-commit=deleted',
      '.git/hooks/pre-commit=restored',
      '.git/refs/heads/main=restored',
    ]);
  });
});

describe('AC7: the reviewer reverts project files, the writer keeps them', () => {
  it('reverts a source edit, a new file and a deletion for the reviewer, and keeps ignored and node_modules writes', async () => {
    const root = fresh();
    specFixture(root, true);
    write(root, 'src/gone.ts', 'to be deleted');
    write(root, '.gitignore', 'out.log\n');
    const { events, context } = harvest('reviewer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('project-stub.cjs')] },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('reverted changes to project files');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('export const a = 1;');
    expect(existsSync(join(root, 'src/new.ts'))).toBe(false);
    expect(readFileSync(join(root, 'src/gone.ts'), 'utf8')).toBe('to be deleted');
    expect(readFileSync(join(root, 'node_modules/pkg/index.js'), 'utf8')).toBe('changed module');
    expect(revertsOf(events)).toEqual([
      'src/app.ts=restored',
      'src/gone.ts=re-created',
      'src/new.ts=deleted',
    ]);
  });

  it('keeps the same source edits for the writer', async () => {
    const root = fresh();
    specFixture(root);
    write(root, 'src/gone.ts', 'to be deleted');
    const { context } = harvest('writer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('project-stub.cjs')] },
      context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).not.toContain('project files');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('edited by the command');
    expect(existsSync(join(root, 'src/new.ts'))).toBe(true);
    expect(existsSync(join(root, 'src/gone.ts'))).toBe(false);
  });

  it('refuses the reviewer before the command starts when the protected files are over the cap', async () => {
    const root = fresh();
    specFixture(root);
    const marker = join(root, 'ran.txt');
    const { context } = harvest('reviewer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('project-stub.cjs')] },
      context,
      { protectMaxBytes: 4 },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'the project is too large to protect while this command runs',
    });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('export const a = 1;');
  });

  it('without git, the reviewer skips only node_modules, so an ignored-looking log is reverted', async () => {
    // No .git at all: the root is not a repository, so git's query fails and nothing is ignored.
    const root = fresh();
    write(root, 'src/app.ts', 'export const a = 1;');
    write(root, 'src/gone.ts', 'to be deleted');
    write(root, '.gitignore', 'out.log\n');
    const { events, context } = harvest('reviewer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('project-stub.cjs')] },
      context,
    );
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, 'out.log'))).toBe(false);
    expect(readFileSync(join(root, 'node_modules/pkg/index.js'), 'utf8')).toBe('changed module');
    expect(revertsOf(events)).toContain('out.log=deleted');
  });
});

describe('AC8: the restore runs after a timeout and after a start failure', () => {
  it.skipIf(IS_ROOT)(
    'a timed-out command is killed, and the spec folder is restored with its modes',
    async () => {
      const root = fresh();
      specFixture(root);
      const before = treeOf(join(root, 'docs/specs'), 'docs/specs/');
      const { events, context } = harvest('writer');
      const result = await runCommandInRoot(
        toolEnvironment(localEnvironment()),
        root,
        { program: process.execPath, args: [script('sleep-stub.cjs')] },
        context,
        { timeoutMs: 1500 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.output).toMatch(/^timed out after 1500 ms/);
      expect(result.output).toContain('reverted changes in docs/specs');
      expect(treeOf(join(root, 'docs/specs'), 'docs/specs/')).toEqual(before);
      expect(revertsOf(events)).toContain('docs/specs/feature/SPECS.md=restored');
    },
  );

  it('a program that cannot start is reported as failed, and the spec folder modes come back', async () => {
    const root = fresh();
    specFixture(root);
    const broken = join(
      base,
      `broken-${counter}`,
      process.platform === 'win32' ? 'broken.exe' : 'broken',
    );
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(
      broken,
      process.platform === 'win32' ? 'not a program' : '#!/nonexistent/interpreter\n',
    );
    chmodSync(broken, 0o755);
    const before = treeOf(join(root, 'docs/specs'), 'docs/specs/');
    const { context } = harvest('writer');
    const result = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: broken, args: [] },
      context,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('the program could not be started');
    expect(treeOf(join(root, 'docs/specs'), 'docs/specs/')).toEqual(before);
    const modes = readdirSync(join(root, 'docs/specs/feature')).map(
      (name) => statSync(join(root, 'docs/specs/feature', name)).mode & 0o777,
    );
    expect(modes.every((mode) => mode !== 0o555 && mode !== 0o444)).toBe(true);
  });
});

describe('AC9: the writer gets the network limit and the dead proxy; the reviewer does not', () => {
  it('gives the writer the proxy variables and one network event, and the reviewer neither', async () => {
    const root = fresh();
    specFixture(root);
    const writer = harvest('writer');
    const writerRun = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('env-stub.cjs')] },
      writer.context,
    );
    expect(writerRun.ok && writerRun.output).toContain(`proxy=${DEAD_PROXY} goproxy=off`);
    const networkEvents = networkOf(writer.events);
    expect(networkEvents).toHaveLength(1);
    expect(networkEvents[0]).toMatchObject({
      kind: 'network',
      job: 'writer',
      level: expect.any(String),
    });

    const reviewer = harvest('reviewer');
    const reviewerRun = await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('env-stub.cjs')] },
      reviewer.context,
    );
    expect(reviewerRun.ok && reviewerRun.output).toContain('proxy=none goproxy=none');
    expect(networkOf(reviewer.events)).toHaveLength(0);
  });

  it('reports the level the platform choice gives, which is proxy-only on Windows', async () => {
    const root = fresh();
    specFixture(root);
    const writer = harvest('writer');
    await runCommandInRoot(
      toolEnvironment(localEnvironment()),
      root,
      { program: process.execPath, args: [script('env-stub.cjs')] },
      writer.context,
    );
    const expected = chooseNetwork(process.platform, await probeNetwork(process.platform)).level;
    expect(networkOf(writer.events)[0]).toMatchObject({ level: expected });
    if (process.platform === 'win32') {
      expect(expected).toBe('proxy-only');
    }
  });
});

describe('AC10: the router passes the job to the runner', () => {
  it('calls the runner with the job of the request', async () => {
    const runTool = vi.fn<ToolRunner>(async () => ({ ok: true as const, output: 'ok' }));
    const deps: RouterDeps = {
      checkToolCall: (request) => checkToolCall(request, DEFAULT_POLICY_CONTEXT),
      runTool,
      onRuleEvent: () => undefined,
      logger: { info: () => undefined, error: () => undefined },
    };
    const outcome = await handleAgentMessage(
      {
        type: 'tool-call-request',
        id: 'r1',
        job: 'reader',
        tool: 'read_file',
        args: { path: 'a.txt' },
      },
      deps,
    );
    expect(runTool).toHaveBeenCalledWith({
      job: 'reader',
      tool: 'read_file',
      args: { path: 'a.txt' },
    });
    expect(outcome.reply).toMatchObject({ type: 'tool-call-result', ok: true });
  });
});

describe('AC3 host: the detected check, and deny-all with no root', () => {
  it('denies every command with no root, and allows only the detected forms with a root', async () => {
    const none = await commandPolicyFor(localEnvironment(), undefined);
    expect(none.policyContext).toBe(DEFAULT_POLICY_CONTEXT);
    expect(none.commandCheck({ job: 'writer', program: 'node', args: ['-v'] })).toEqual({
      allow: false,
      reason: 'commands are not allowed yet: no allowlist is configured',
    });

    const root = fresh();
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    const detected = await commandPolicyFor(localEnvironment(), root);
    expect(detected.commandCheck({ job: 'writer', program: 'npm', args: ['test'] })).toEqual({
      allow: true,
    });
    expect(detected.commandCheck({ job: 'writer', program: 'curl', args: ['x'] }).allow).toBe(
      false,
    );
    expect(detected.policyContext.commandCheck).toBe(detected.commandCheck);
  });

  it('gives the runner the same check through makeToolRunner', async () => {
    const root = fresh();
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    const { commandCheck } = await commandPolicyFor(localEnvironment(), root);
    const runner = makeToolRunner(localEnvironment(), root, { commandCheck });
    const denied = await runner({
      job: 'writer',
      tool: 'run_command',
      args: { program: 'curl', args: [] },
    });
    expect(denied).toEqual({ ok: false, reason: "this command is not on the project's allowlist" });
  });
});
