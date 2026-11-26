import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolEnvironment } from '../../src/main/env';
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
