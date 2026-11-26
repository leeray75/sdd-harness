import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { localEnvironment } from '../../src/main/env';
import type { Environment } from '../../src/main/env/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENAME_ATTEMPTS } from '../../src/main/tools/atomic-write';
import {
  approvalOf,
  currentFeature,
  hashSpec,
  readSpecState,
  scanSpecFoldersWithLock,
  writeAtomic,
  writeSpecState,
  type SpecStateRead,
} from '../../src/main/workflow/spec-lock';
import { MAX_SPEC_FILE_BYTES, scanSpecFolders } from '../../src/main/workflow/spec-folders';
import {
  MAX_SPEC_STATE_BYTES,
  serializeSpecState,
  type SpecStateFile,
} from '../../src/shared/spec-state';

// Whether this machine lets the process create a file symlink (Windows needs developer mode).
function canSymlinkFiles(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'sdd-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FILE_SYMLINKS = canSymlinkFiles();
const SPEC =
  '---\nstatus: draft\nticket:\n---\n\n# Spec\n\n## Goals\n\n- **G1:** x\n\n## Acceptance criteria\n\n- **AC1:** y\n';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-spec-lock-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(relative: string, text: string | Buffer): Promise<void> {
  const path = join(root, 'docs', 'specs', relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function specsDir(): string {
  return join(root, 'docs', 'specs');
}

function state(feature: string, sha256: string, editing = false): SpecStateFile {
  return {
    version: 1,
    feature,
    sha256,
    approvedAt: '2026-11-22T10:00:00.000Z',
    editing,
  };
}

/** Writes a SPECS.md for `feature` and a state that locks it to the file's current hash. */
async function lockFeature(feature: string, text = SPEC, editing = false): Promise<void> {
  await put(`${feature}/SPECS.md`, text);
  const hash = await hashSpec(localEnvironment(), root, feature);
  if (hash === null) throw new Error('the test spec could not be hashed');
  const written = await writeSpecState(localEnvironment(), root, state(feature, hash, editing));
  expect(written.ok).toBe(true);
}

describe('approval round trip at the lock level (AC1)', () => {
  it('is approved right after the lock is written, and changed after an edit', async () => {
    await lockFeature('p3-x');
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('approved');
    await put('p3-x/SPECS.md', `${SPEC}\nmore\n`);
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('changed');
  });

  it('stays approved after a CRLF-only re-save, and after a BOM is added', async () => {
    await lockFeature('p3-x');
    await put('p3-x/SPECS.md', SPEC.replace(/\n/g, '\r\n'));
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('approved');
    await put('p3-x/SPECS.md', '﻿' + SPEC);
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('approved');
  });

  it('is none with no state file, and none when another feature is locked', async () => {
    await put('p3-x/SPECS.md', SPEC);
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('none');
    await lockFeature('p3-other');
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('none');
  });

  it('is unchecked when SPECS.md is missing, and when the state file is malformed', async () => {
    await lockFeature('p3-x');
    await rm(join(specsDir(), 'p3-x', 'SPECS.md'));
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('unchecked');
    await put('p3-x/SPECS.md', SPEC);
    await writeFile(join(specsDir(), '.sdd-state.json'), '{broken');
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('unchecked');
  });

  it('is changed with editing true, even when the hash still matches', async () => {
    await lockFeature('p3-x', SPEC, true);
    expect(await approvalOf(localEnvironment(), root, 'p3-x')).toBe('changed');
  });

  it('is none for a null feature with no lock, and unchecked for a null feature with a bad lock', async () => {
    expect(await approvalOf(localEnvironment(), root, null)).toBe('none');
    await put('p3-x/SPECS.md', SPEC);
    await writeFile(join(specsDir(), '.sdd-state.json'), 'nope');
    expect(await approvalOf(localEnvironment(), root, null)).toBe('unchecked');
  });
});

describe('readSpecState (AC2)', () => {
  it('reports absent when docs/specs or the state file is missing', async () => {
    expect(await readSpecState(localEnvironment(), root)).toEqual({ kind: 'absent' });
    await put('p3-x/SPECS.md', SPEC);
    expect(await readSpecState(localEnvironment(), root)).toEqual({ kind: 'absent' });
  });

  it('reads a valid state file', async () => {
    await lockFeature('p3-x');
    const read = await readSpecState(localEnvironment(), root);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.state.feature).toBe('p3-x');
  });

  it('reports an oversized state file as unreadable, without reading it whole', async () => {
    await put('.sdd-state.json', 'x'.repeat(MAX_SPEC_STATE_BYTES + 1));
    expect(await readSpecState(localEnvironment(), root)).toEqual({
      kind: 'unreadable',
      reason: 'the file is over the size cap',
    });
  });

  it('reports a state file that is a directory as unreadable', async () => {
    mkdirSync(join(specsDir(), '.sdd-state.json'), { recursive: true });
    expect(await readSpecState(localEnvironment(), root)).toEqual({
      kind: 'unreadable',
      reason: 'not a regular file',
    });
  });

  it('reports a malformed or wrong-version file as unreadable with the parser reason', async () => {
    await put('.sdd-state.json', 'not json');
    expect(await readSpecState(localEnvironment(), root)).toEqual({
      kind: 'unreadable',
      reason: 'the state file is not valid JSON',
    });
    await put('.sdd-state.json', JSON.stringify({ ...state('p3-x', 'a'.repeat(64)), version: 9 }));
    expect(await readSpecState(localEnvironment(), root)).toEqual({
      kind: 'unreadable',
      reason: 'the state file version is not supported',
    });
  });

  it.skipIf(!FILE_SYMLINKS)(
    'reports a symbolic link as unreadable, and does not follow it',
    async () => {
      await put('target.json', serializeSpecState(state('p3-x', 'a'.repeat(64))));
      await symlink(join(specsDir(), 'target.json'), join(specsDir(), '.sdd-state.json'));
      expect(await readSpecState(localEnvironment(), root)).toEqual({
        kind: 'unreadable',
        reason: 'a symbolic link is not followed',
      });
    },
  );
});

describe('writeSpecState (AC2)', () => {
  it('writes the file and leaves no temp file behind', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const result = await writeSpecState(localEnvironment(), root, state('p3-x', 'a'.repeat(64)));
    expect(result).toEqual({ ok: true });
    expect(readdirSync(specsDir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const read = await readSpecState(localEnvironment(), root);
    expect(read.kind).toBe('ok');
  });

  it('leaves no temp file behind when the rename fails, and reports the failure', async () => {
    // A folder where the state file should be: renaming a file onto it fails on every OS.
    mkdirSync(join(specsDir(), '.sdd-state.json'), { recursive: true });
    const result = await writeSpecState(localEnvironment(), root, state('p3-x', 'a'.repeat(64)));
    expect(result.ok).toBe(false);
    expect(readdirSync(specsDir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports a missing docs/specs without throwing', async () => {
    const result = await writeSpecState(localEnvironment(), root, state('p3-x', 'a'.repeat(64)));
    expect(result).toEqual({ ok: false, reason: 'docs/specs is not a folder' });
  });
});

describe('hashSpec', () => {
  it('hashes the normalized text, so a BOM and CRLF do not change it', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const plain = await hashSpec(localEnvironment(), root, 'p3-x');
    await put('p3-x/SPECS.md', '﻿' + SPEC.replace(/\n/g, '\r\n'));
    expect(await hashSpec(localEnvironment(), root, 'p3-x')).toBe(plain);
    expect(plain).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is null for a missing file, an invalid feature, and a file over the cap', async () => {
    expect(await hashSpec(localEnvironment(), root, 'p3-x')).toBeNull();
    expect(await hashSpec(localEnvironment(), root, 'a--b')).toBeNull();
    await put('p3-x/SPECS.md', 'x'.repeat(MAX_SPEC_FILE_BYTES + 1));
    expect(await hashSpec(localEnvironment(), root, 'p3-x')).toBeNull();
  });

  it.skipIf(!FILE_SYMLINKS)('is null for a symbolic link to a spec', async () => {
    await put('target/SPECS.md', SPEC);
    await mkdir(join(specsDir(), 'p3-x'), { recursive: true });
    await symlink(join(specsDir(), 'target', 'SPECS.md'), join(specsDir(), 'p3-x', 'SPECS.md'));
    expect(await hashSpec(localEnvironment(), root, 'p3-x')).toBeNull();
  });
});

describe('currentFeature', () => {
  const folder = (feature: string, newestMtime: number) =>
    ({ feature, newestMtime }) as Parameters<typeof currentFeature>[1][number];
  const absent: SpecStateRead = { kind: 'absent' };
  const unreadable: SpecStateRead = { kind: 'unreadable', reason: 'x' };

  it('follows the state file when it is valid, even over a newer folder', () => {
    const lock: SpecStateRead = { kind: 'ok', state: state('p3-x', 'a'.repeat(64)) };
    expect(currentFeature(lock, [folder('p3-new', 99)])).toBe('p3-x');
  });

  it('falls back to the folder with the greatest newest mtime when there is no valid state', () => {
    const folders = [folder('alpha', 1), folder('beta', 5)];
    expect(currentFeature(absent, folders)).toBe('beta');
    expect(currentFeature(unreadable, folders)).toBe('beta');
  });

  it('breaks a tie by slug, and is null with no folders and no state', () => {
    expect(currentFeature(absent, [folder('zeta', 3), folder('alpha', 3)])).toBe('alpha');
    expect(currentFeature(absent, [])).toBeNull();
  });
});

describe('scanSpecFoldersWithLock (AC5)', () => {
  it('detects a locked folder with no ledger as spec-approved, and an edited one as spec-changed', async () => {
    await put('p3-x/PLAN.md', 'Status: approved\n');
    await lockFeature('p3-x');
    const approved = await scanSpecFoldersWithLock(localEnvironment(), root);
    expect(approved.folders[0]?.detection.node).toBe('spec-approved');
    expect(approved.current).toBe('p3-x');

    await put('p3-x/SPECS.md', `${SPEC}\nedited\n`);
    const changed = await scanSpecFoldersWithLock(localEnvironment(), root);
    expect(changed.folders[0]?.detection.node).toBe('spec-changed');
  });

  it('gives the other folders none, and picks the newest folder when there is no lock', async () => {
    await put('alpha/PLAN.md', 'Status: draft\n');
    await lockFeature('p3-x');
    const locked = await scanSpecFoldersWithLock(localEnvironment(), root);
    const alpha = locked.folders.find((folder) => folder.feature === 'alpha');
    expect(alpha?.detection.node).toBe('planning');
    expect(locked.current).toBe('p3-x');

    await rm(join(specsDir(), '.sdd-state.json'));
    const unlocked = await scanSpecFoldersWithLock(localEnvironment(), root);
    expect(unlocked.current).not.toBeNull();
    expect(unlocked.folders.every((folder) => folder.detection.node !== 'spec-approved')).toBe(
      true,
    );
  });
});

describe('scanSpecFolders with a throwing approvalOf (AC5)', () => {
  it('returns every folder, and reads the throwing one as unchecked', async () => {
    await put('alpha/PLAN.md', 'Status: draft\n');
    await put('alpha/SPECS.md', '---\nstatus: draft\nticket:\n---\n');
    await put('beta/PLAN.md', 'Status: draft\n');
    await put('beta/SPECS.md', '---\nstatus: draft\nticket:\n---\n');
    const folders = await scanSpecFolders(localEnvironment(), root, (feature) => {
      if (feature === 'alpha') throw new Error('boom');
      return 'none';
    });
    expect(folders.map((folder) => folder.feature)).toEqual(['alpha', 'beta']);
    // With no SPECS.md lock, `none` gives spec-drafted; the throw gives unchecked, which reads as
    // approved with no ledger.
    expect(folders[0]?.detection.node).toBe('spec-approved');
    expect(folders[1]?.detection.node).toBe('spec-drafted');
  });
});

// The spec lock's atomic write goes through the shared writer and its rename retry (revision 1, AC14).
// The files part is the local one, except that its rename fails with EPERM a set number of times, or its
// first write fails with a code.
describe('the spec lock atomic write retries a rename and reports the last code (AC14)', () => {
  /** A local environment whose rename fails `failures` times (EPERM) and whose writeFile may fail with a code. */
  function flakyEnv(options: { renameFailures: number; writeCode?: string }): {
    env: Environment;
    renames: () => number;
  } {
    const local = localEnvironment();
    let renames = 0;
    const files = {
      ...local.files,
      writeFile: async (path: string, data: Buffer | string, opts?: { flag?: 'w' | 'wx' }) => {
        if (options.writeCode !== undefined) {
          throw Object.assign(new Error('write failed'), { code: options.writeCode });
        }
        return local.files.writeFile(path, data, opts);
      },
      rename: async (from: string, to: string) => {
        renames += 1;
        if (renames <= options.renameFailures) {
          throw Object.assign(new Error('rename failed'), { code: 'EPERM' });
        }
        return local.files.rename(from, to);
      },
    };
    return { env: { ...local, files }, renames: () => renames };
  }

  let folder: string;
  let target: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'sdd-atomic-'));
    target = join(folder, 'SPECS.md');
    writeFileSync(target, 'before\n');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('succeeds when the rename fails fewer times than RENAME_ATTEMPTS', async () => {
    const flaky = flakyEnv({ renameFailures: RENAME_ATTEMPTS - 1 });
    expect(await writeAtomic(flaky.env, target, 'after\n')).toEqual({ ok: true });
    expect(readFileSync(target, 'utf8')).toBe('after\n');
    expect(flaky.renames()).toBe(RENAME_ATTEMPTS);
  });

  it('returns the rename code when every attempt fails, and leaves no temporary file', async () => {
    const flaky = flakyEnv({ renameFailures: RENAME_ATTEMPTS + 10 });
    expect(await writeAtomic(flaky.env, target, 'after\n')).toEqual({
      ok: false,
      reason: 'EPERM',
    });
    expect(flaky.renames()).toBe(RENAME_ATTEMPTS);
    expect(readFileSync(target, 'utf8')).toBe('before\n');
    expect(readdirSync(folder).sort()).toEqual(['SPECS.md']);
  });

  it('returns its own code when the first write fails', async () => {
    const flaky = flakyEnv({ renameFailures: 0, writeCode: 'EACCES' });
    expect(await writeAtomic(flaky.env, target, 'after\n')).toEqual({
      ok: false,
      reason: 'EACCES',
    });
    expect(readdirSync(folder).sort()).toEqual(['SPECS.md']);
  });
});
