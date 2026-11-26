import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { environmentFor, localEnvironment, UNSUPPORTED_ENVIRONMENT } from '../../src/main/env';
import type { Environment, SpawnOutcome } from '../../src/main/env/types';
import { writeFileAtomic } from '../../src/main/tools/atomic-write';

// The local backend behind the environment interface (D41, AC5). Every check runs on a temp folder.

let base: string;
let env: Environment;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'env-local-'));
  env = localEnvironment();
  writeFileSync(join(base, 'file.txt'), 'hello');
  mkdirSync(join(base, 'folder'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** The parent environment a spawn gets in these tests: the app's own, which is safe for node. */
function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

describe('the local files part passes Node errors through', () => {
  it('reports ENOENT for a missing path', async () => {
    await expect(env.files.stat(join(base, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports ENOTDIR when a file is listed as a folder', async () => {
    await expect(env.files.readdir(join(base, 'file.txt'))).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('reports EISDIR when a folder is read as a file', async () => {
    await expect(env.files.readFile(join(base, 'folder'))).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  it('reads a file, and refuses one over the byte cap', async () => {
    expect((await env.files.readFile(join(base, 'file.txt'))).toString('utf8')).toBe('hello');
    await expect(env.files.readFile(join(base, 'file.txt'), { maxBytes: 2 })).rejects.toMatchObject(
      { code: 'EFBIG' },
    );
  });
});

describe('the local process part', () => {
  it('runs a program with an argument array and no shell, and returns its exit code', async () => {
    const chunks: Buffer[] = [];
    const outcome = await env.process.spawn(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1]); process.exit(3)', '$HOME & calc'],
      {
        cwd: base,
        env: childEnv(),
        timeoutMs: 20_000,
        network: 'normal',
        onOutput: (chunk) => chunks.push(chunk),
      },
    );
    expect(outcome).toMatchObject({ started: true, code: 3, timedOut: false, aborted: false });
    // No shell: the argument reaches the program as written, with its characters unexpanded.
    expect(Buffer.concat(chunks).toString('utf8')).toBe('$HOME & calc');
  });

  it('reports a program that cannot start', async () => {
    const outcome = await env.process.spawn(join(base, 'no-such-program-42'), [], {
      cwd: base,
      env: childEnv(),
      timeoutMs: 20_000,
      network: 'normal',
    });
    expect(outcome).toEqual({ started: false });
  });

  it('kills the whole child tree on timeout and says so', async () => {
    // The parent starts a grandchild that sleeps; a timeout must end both.
    const script = [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      'setTimeout(() => {}, 60000);',
    ].join('\n');
    const started = Date.now();
    const outcome: SpawnOutcome = await env.process.spawn(process.execPath, ['-e', script], {
      cwd: base,
      env: childEnv(),
      timeoutMs: 1_000,
      network: 'normal',
    });
    expect(outcome).toMatchObject({ started: true, code: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it('reports the network level only for the writer limit', async () => {
    const level = await env.process.networkLevel();
    expect(['os', 'proxy-only']).toContain(level);
    const outcome = await env.process.spawn(process.execPath, ['-e', ''], {
      cwd: base,
      env: childEnv(),
      timeoutMs: 20_000,
      network: 'none',
    });
    expect(outcome).toMatchObject({ started: true, network: level });
  }, 60_000);
});

describe('the local watch part', () => {
  it('reports a change in the folder and stops after close()', async () => {
    const watched = join(base, 'watched');
    mkdirSync(watched);
    const events: string[] = [];
    const handle = env.watch.watchDir(
      watched,
      (_type, name) => events.push(name ?? ''),
      () => undefined,
    );
    writeFileSync(join(watched, 'new.txt'), 'x');
    for (let waited = 0; events.length === 0 && waited < 10_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(events.length).toBeGreaterThan(0);
    handle.close();
    const before = events.length;
    writeFileSync(join(watched, 'after.txt'), 'y');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events.length).toBe(before);
  }, 20_000);
});

describe('writeFileAtomic over the local files part (AC5)', () => {
  it('writes the whole file and leaves no temporary file behind', async () => {
    const target = join(base, 'atomic.txt');
    expect(await writeFileAtomic(env.files, target, Buffer.from('whole'))).toEqual({ ok: true });
    expect(readFileSync(target, 'utf8')).toBe('whole');
    expect(readdirSync(base).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('retries a busy rename, then writes the file', async () => {
    const target = join(base, 'busy.txt');
    let renames = 0;
    const result = await writeFileAtomic(env.files, target, Buffer.from('later'), {
      retryMs: 1,
      rename: async (from, to) => {
        renames += 1;
        if (renames < 3) {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        }
        await env.files.rename(from, to);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(renames).toBe(3);
    expect(readFileSync(target, 'utf8')).toBe('later');
  });
});

describe('environmentFor', () => {
  it('returns the local backend for the local kind, the same object as localEnvironment()', () => {
    const chosen = environmentFor({ kind: 'local' });
    expect(chosen).toEqual({ ok: true, env: localEnvironment() });
    if (chosen.ok) expect(chosen.env).toBe(localEnvironment());
  });

  it('refuses any other kind with the fixed reason', () => {
    expect(environmentFor({ kind: 'wsl' })).toEqual({ ok: false, reason: UNSUPPORTED_ENVIRONMENT });
    expect(environmentFor({ kind: 'ssh' })).toEqual({ ok: false, reason: UNSUPPORTED_ENVIRONMENT });
  });
});
