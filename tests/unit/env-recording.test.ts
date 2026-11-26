import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolEnvironment } from '../../src/main/env';
import { createWslEnvironment } from '../../src/main/env/wsl';
import { createSshEnvironment } from '../../src/main/env/ssh';
import { fakeSshTransport, type FakeSsh } from '../support/fake-ssh-transport';
import { approveResult, SHIP_REASONS } from '../../src/main/workflow/ship';
import { fakeWslTransport, type FakeTransport } from '../support/fake-wsl-transport';
import { readFileInRoot } from '../../src/main/tools/read-file';
import { writeFileInRoot } from '../../src/main/tools/write-file';
import { listFilesInRoot } from '../../src/main/tools/list-files';
import { searchTextInRoot } from '../../src/main/tools/search-text';
import { runCommandInRoot } from '../../src/main/tools/run-command';
import { hashSpec, readSpecState, writeSpecState } from '../../src/main/workflow/spec-lock';
import { createSpecLockWatcher } from '../../src/main/workflow/spec-watch';
import { SPEC_STATE_VERSION } from '../../src/shared/spec-state';
import { recordingEnvironment, type RecordingEnv } from '../support/recording-env';

// The recording backend (AC6, D41): each step below reaches its result only through the environment,
// which records every call by part and method. The calls run on the local backend, on a temp folder.

const FEATURE = 'p3-x';
let base: string;
let root: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'env-recording-'));
  root = join(base, 'root');
  mkdirSync(join(root, 'docs', 'specs', FEATURE), { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'needle in a file');
  writeFileSync(join(root, 'docs', 'specs', FEATURE, 'SPECS.md'), '# Spec\n\nGoals\n');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A fresh recording environment, with its own call list. */
function recorder(): RecordingEnv {
  return recordingEnvironment();
}

describe('the file tools go through files (AC6)', () => {
  it('read_file reads through files', async () => {
    const rec = recorder();
    const result = await readFileInRoot(toolEnvironment(rec.env), root, 'a.txt');
    expect(result).toEqual({ ok: true, output: 'needle in a file' });
    expect(rec.methodsOf('files')).toEqual(
      expect.arrayContaining(['realpath', 'stat', 'readFile']),
    );
  });

  it('write_file writes through files, atomically', async () => {
    const rec = recorder();
    const result = await writeFileInRoot(toolEnvironment(rec.env), root, {
      path: 'new.txt',
      content: 'hello',
    });
    expect(result.ok).toBe(true);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['writeFile', 'rename']));
  });

  it('list_files lists through files, and search_text reads through files', async () => {
    const rec = recorder();
    const listed = await listFilesInRoot(toolEnvironment(rec.env), root, { pattern: '*.txt' });
    expect(listed.ok && listed.output).toContain('a.txt');
    expect(rec.methodsOf('files')).toContain('readdir');

    const search = recorder();
    const found = await searchTextInRoot(toolEnvironment(search.env), root, {
      pattern: 'needle',
      glob: 'a.txt',
    });
    expect(found.ok && found.output).toContain('a.txt:1:');
    expect(search.methodsOf('files')).toEqual(
      expect.arrayContaining(['readdir', 'stat', 'readFile']),
    );
  });
});

describe('run_command spawns through process (AC6)', () => {
  it('starts the program through process.spawn', async () => {
    const rec = recorder();
    const result = await runCommandInRoot(
      toolEnvironment(rec.env),
      root,
      { program: process.execPath, args: ['-e', "process.stdout.write('ran')"] },
      { job: 'reviewer', check: () => ({ allow: true }) },
      { parentEnv: { ...process.env } },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toContain('ran');
    expect(rec.methodsOf('process')).toEqual(['spawn']);
  }, 60_000);
});

describe('the spec lock reads, hashes and writes through files, and watches through watch (AC6)', () => {
  it('hashes the spec and writes the state through files', async () => {
    const rec = recorder();
    const hash = await hashSpec(rec.env, root, FEATURE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['lstat', 'open']));

    const write = recorder();
    const saved = await writeSpecState(write.env, root, {
      version: SPEC_STATE_VERSION,
      feature: FEATURE,
      sha256: hash ?? '',
      approvedAt: '2026-11-25T10:00:00.000Z',
      editing: false,
    });
    expect(saved).toEqual({ ok: true });
    expect(write.methodsOf('files')).toEqual(expect.arrayContaining(['writeFile', 'rename']));

    const read = recorder();
    expect((await readSpecState(read.env, root)).kind).toBe('ok');
    expect(read.methodsOf('files')).toEqual(expect.arrayContaining(['lstat', 'open']));
  });

  it('watches the spec folders through watch', async () => {
    const rec = recorder();
    const watcher = createSpecLockWatcher({ env: rec.env, root, onChange: () => undefined });
    try {
      await watcher.refresh();
      expect(rec.methodsOf('watch')).toContain('watchDir');
    } finally {
      watcher.close();
    }
  });
});

// The same steps over the WSL backend (D42, p4-env-wsl, AC9). The Linux project lives on a fake share, a
// temp folder, and the fake transport answers the program and git. Every result comes through the
// interface, and the recording wrapper shows which parts each step used.
const WSL_ROOT = '/home/u/project';
let share: string;
let transport: FakeTransport;

beforeAll(() => {
  share = join(base, 'wsl-share');
  const onShare = join(share, 'home', 'u', 'project');
  mkdirSync(join(onShare, 'docs', 'specs', FEATURE), { recursive: true });
  writeFileSync(join(onShare, 'a.txt'), 'needle in a file');
  writeFileSync(join(onShare, 'docs', 'specs', FEATURE, 'SPECS.md'), '# Spec\n\nGoals\n');
  mkdirSync(join(share, 'usr', 'bin'), { recursive: true });
  writeFileSync(join(share, 'usr', 'bin', 'tool'), '#!/bin/sh\n', { mode: 0o755 });
});

/** A recording WSL environment: a fresh fake transport, and a call list of its own. */
function wslRecorder(): RecordingEnv {
  transport = fakeWslTransport(share, {
    program: () => ({ code: 0, chunks: ['ran'] }),
    git: () => ({ code: 128, stderr: 'fatal: not a git repository\n' }),
  });
  return recordingEnvironment(createWslEnvironment({ distribution: 'Ubuntu', transport }));
}

describe('over the WSL backend, each step reaches its result through the interface (AC9)', () => {
  it('a file tool reads through files on the share', async () => {
    const rec = wslRecorder();
    const result = await readFileInRoot(toolEnvironment(rec.env), WSL_ROOT, 'a.txt');
    expect(result).toEqual({ ok: true, output: 'needle in a file' });
    expect(rec.methodsOf('files')).toEqual(
      expect.arrayContaining(['realpath', 'stat', 'readFile']),
    );
  });

  it('a write tool writes through files, atomically, on the share', async () => {
    const rec = wslRecorder();
    const result = await writeFileInRoot(toolEnvironment(rec.env), WSL_ROOT, {
      path: 'new.txt',
      content: 'from wsl',
    });
    expect(result.ok).toBe(true);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['writeFile', 'rename']));
    expect(readFileSync(join(share, 'home', 'u', 'project', 'new.txt'), 'utf8')).toBe('from wsl');
  });

  it('run_command starts the program through process.spawn, through wsl.exe', async () => {
    const rec = wslRecorder();
    const result = await runCommandInRoot(
      toolEnvironment(rec.env),
      WSL_ROOT,
      { program: '/usr/bin/tool', args: ['x'] },
      { job: 'reviewer', check: () => ({ allow: true }) },
      { parentEnv: { PATH: '/usr/bin' }, platform: 'linux' },
    );
    expect(result.ok && result.output).toContain('ran');
    expect(rec.methodsOf('process')).toEqual(['spawn']);
    expect(transport.calls.some((call) => call.argv.includes('sh'))).toBe(true);
  });

  it('the spec lock hashes, writes, reads and watches on the share', async () => {
    const rec = wslRecorder();
    const hash = await hashSpec(rec.env, WSL_ROOT, FEATURE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['lstat', 'open']));

    const saved = await writeSpecState(rec.env, WSL_ROOT, {
      version: SPEC_STATE_VERSION,
      feature: FEATURE,
      sha256: hash ?? '',
      approvedAt: '2026-11-25T10:00:00.000Z',
      editing: false,
    });
    expect(saved).toEqual({ ok: true });
    expect((await readSpecState(rec.env, WSL_ROOT)).kind).toBe('ok');

    const watcher = createSpecLockWatcher({
      env: rec.env,
      root: WSL_ROOT,
      onChange: () => undefined,
    });
    try {
      await watcher.refresh();
      expect(rec.methodsOf('watch')).toContain('watchDir');
    } finally {
      watcher.close();
    }
  });

  it('approve-result reaches its refusal through the gate, with the lock and spec read on the share', async () => {
    const rec = wslRecorder();
    const result = await approveResult(rec.env, WSL_ROOT, FEATURE, {});
    expect(result).toEqual({ ok: false, reason: SHIP_REASONS.notBuildDone });
    expect(rec.methodsOf('files').length).toBeGreaterThan(0);
  });
});

// The SSH backend over the fake transport (AC13, D43): the same steps, reaching their results through the interface.
const SSH_ROOT = '/home/u/project';
const SSH_SERVER = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Build server',
  host: 'build.example',
  port: 22,
  user: 'u',
  auth: { method: 'agent' as const },
  hostKey: null,
};
let sshRemote = '';

/** A recording environment over a connected SSH backend whose remote folder holds the project. */
async function sshRecorder(): Promise<{ rec: RecordingEnv; transport: FakeSsh }> {
  const transport = fakeSshTransport(sshRemote, {
    program: () => ({ code: 0, chunks: ['ran'] }),
    executable: true,
  });
  await transport.connect();
  const rec = recordingEnvironment(createSshEnvironment({ server: SSH_SERVER, transport }));
  return { rec, transport };
}

describe('over the SSH backend, each step reaches its result through the interface (AC13)', () => {
  beforeAll(() => {
    sshRemote = join(base, 'ssh-remote');
    mkdirSync(join(sshRemote, 'home', 'u', 'project', 'docs', 'specs', FEATURE), {
      recursive: true,
    });
    mkdirSync(join(sshRemote, 'usr', 'bin'), { recursive: true });
    writeFileSync(join(sshRemote, 'usr', 'bin', 'tool'), '#!/bin/sh\n');
    writeFileSync(join(sshRemote, 'home', 'u', 'project', 'a.txt'), 'needle in a file');
    writeFileSync(
      join(sshRemote, 'home', 'u', 'project', 'docs', 'specs', FEATURE, 'SPECS.md'),
      '# Spec\n\nGoals\n',
    );
  });

  it('a file tool reads through files on the server', async () => {
    const { rec } = await sshRecorder();
    const result = await readFileInRoot(toolEnvironment(rec.env), SSH_ROOT, 'a.txt');
    expect(result).toEqual({ ok: true, output: 'needle in a file' });
    expect(rec.methodsOf('files')).toEqual(
      expect.arrayContaining(['realpath', 'stat', 'readFile']),
    );
  });

  it('a write tool writes through files, atomically, on the server', async () => {
    const { rec } = await sshRecorder();
    const result = await writeFileInRoot(toolEnvironment(rec.env), SSH_ROOT, {
      path: 'new.txt',
      content: 'from ssh',
    });
    expect(result.ok).toBe(true);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['writeFile', 'rename']));
    expect(readFileSync(join(sshRemote, 'home', 'u', 'project', 'new.txt'), 'utf8')).toBe(
      'from ssh',
    );
  });

  it('run_command starts the program through process.spawn, as an exec request', async () => {
    const { rec, transport } = await sshRecorder();
    const result = await runCommandInRoot(
      toolEnvironment(rec.env),
      SSH_ROOT,
      { program: '/usr/bin/tool', args: ['x'] },
      { job: 'reviewer', check: () => ({ allow: true }) },
      { parentEnv: { PATH: '/usr/bin' }, platform: 'linux' },
    );
    expect(result.ok ? 'ok' : result.reason).toBe('ok');
    expect(result.ok && result.output).toContain('ran');
    expect(rec.methodsOf('process')).toEqual(['spawn']);
    expect(transport.calls.some((call) => call.command.startsWith('cd -- '))).toBe(true);
  });

  it('the spec lock hashes, writes, reads and watches on the server', async () => {
    const { rec } = await sshRecorder();
    const hash = await hashSpec(rec.env, SSH_ROOT, FEATURE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.methodsOf('files')).toEqual(expect.arrayContaining(['lstat', 'open']));

    const saved = await writeSpecState(rec.env, SSH_ROOT, {
      version: SPEC_STATE_VERSION,
      feature: FEATURE,
      sha256: hash ?? '',
      approvedAt: '2026-11-25T10:00:00.000Z',
      editing: false,
    });
    expect(saved).toEqual({ ok: true });
    expect((await readSpecState(rec.env, SSH_ROOT)).kind).toBe('ok');

    const watcher = createSpecLockWatcher({
      env: rec.env,
      root: SSH_ROOT,
      onChange: () => undefined,
    });
    try {
      await watcher.refresh();
      expect(rec.methodsOf('watch')).toContain('watchDir');
    } finally {
      watcher.close();
    }
  });

  it('approve-result reaches its refusal through the gate, with the lock and spec read on the server', async () => {
    const { rec } = await sshRecorder();
    const result = await approveResult(rec.env, SSH_ROOT, FEATURE, {});
    expect(result).toEqual({ ok: false, reason: SHIP_REASONS.notBuildDone });
    expect(rec.methodsOf('files').length).toBeGreaterThan(0);
  });
});
