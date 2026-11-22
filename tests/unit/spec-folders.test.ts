import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SPEC_FILE_BYTES,
  readSpecFolder,
  readSpecFolderAt,
  scanSpecFolders,
} from '../../src/main/workflow/spec-folders';
import { stageOf } from '../../src/shared/workflow';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VENDORED_FOLDER = fileURLToPath(
  new URL('../fixtures/sdd-plugin/specs/p3-state-machine', import.meta.url),
);

// Whether this machine lets the process create a file symlink. Windows refuses it without the
// symlink privilege (developer mode), so that one test is skipped there; directory junctions need
// no privilege and are always tested.
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

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-spec-folders-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(relative: string, text: string): Promise<void> {
  const path = join(root, 'docs', 'specs', relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

describe('a plugin-written folder opens as history (AC5)', () => {
  it('reads the vendored p3-state-machine folder as closed, stage Done, with approval none', async () => {
    const folder = await readSpecFolderAt(VENDORED_FOLDER, 'p3-state-machine', 'none');
    expect(folder).not.toBeNull();
    expect(folder?.detection.node).toBe('closed');
    expect(folder?.detection.stage).toEqual(stageOf('closed'));
    expect(folder?.detection.stage).toEqual({ stage: 'done', paused: false });
    expect(folder?.detection.round).toBeNull();
    expect(folder?.detection.source).toBeNull();
  });

  it('parses the vendored folder: approved plan, done spec, all tasks ticked, done ledger', async () => {
    const folder = await readSpecFolderAt(VENDORED_FOLDER, 'p3-state-machine', 'none');
    expect(folder?.parsed.plan.status).toBe('approved');
    expect(folder?.parsed.specs.status).toBe('done');
    expect(folder?.parsed.tasks.open).toBe(0);
    expect(folder?.parsed.tasks.checked).toBeGreaterThan(0);
    expect(folder?.parsed.ledger.state).toBe('done');
    expect(folder?.parsed.ledger.problems).toEqual([]);
    expect(Object.values(folder?.files ?? {}).every((file) => file.state === 'present')).toBe(true);
  });
});

describe('the finished folders of this repo (AC5)', () => {
  it('every folder with SUMMARY.md and a done ledger is closed, and there are at least 20', async () => {
    const folders = await scanSpecFolders(REPO_ROOT);
    const finished = folders.filter(
      (folder) =>
        folder.files['SUMMARY.md'].state === 'present' && folder.parsed.ledger.state === 'done',
    );
    expect(finished.length).toBeGreaterThanOrEqual(20);
    for (const folder of finished) {
      expect(folder.detection.node, folder.feature).toBe('closed');
      expect(folder.detection.stage, folder.feature).toEqual({ stage: 'done', paused: false });
    }
  });
});

describe('scanSpecFolders on temp folders (AC6)', () => {
  it('returns an empty list when docs/specs is missing', async () => {
    expect(await scanSpecFolders(root)).toEqual([]);
  });

  it('returns the valid folders sorted by slug, each with files, detection and newest mtime', async () => {
    await put('beta/PLAN.md', 'Status: approved\n');
    await put('beta/SPECS.md', '---\nstatus: draft\nticket:\n---\n');
    await put('alpha/PLAN.md', 'Status: draft\n');
    const folders = await scanSpecFolders(root);
    expect(folders.map((folder) => folder.feature)).toEqual(['alpha', 'beta']);
    expect(folders[0]?.detection.node).toBe('planning');
    expect(folders[1]?.detection.node).toBe('spec-drafted');
    expect(folders[1]?.parsed.specs.status).toBe('draft');
    expect(folders[0]?.newestMtime).toBeGreaterThan(0);
    expect(folders[0]?.files['SPECS.md'].state).toBe('absent');
  });

  it('skips invalid slugs, files at the folder level, symbolic links and folders with no known file', async () => {
    await put('alpha/PLAN.md', 'Status: draft\n');
    await put('Bad_Name/PLAN.md', 'Status: draft\n');
    await put('loose.md', 'Status: draft\n');
    await put('notes-only/notes.txt', 'nothing known here\n');
    await mkdir(join(root, 'docs', 'specs', 'real-target'), { recursive: true });
    await put('real-target/PLAN.md', 'Status: approved\n');
    // A directory link: a junction on Windows, which needs no special privilege.
    await symlink(
      join(root, 'docs', 'specs', 'real-target'),
      join(root, 'docs', 'specs', 'linked'),
      'junction',
    );
    const folders = await scanSpecFolders(root);
    expect(folders.map((folder) => folder.feature)).toEqual(['alpha', 'real-target']);
  });

  it('gives each folder the approval from approvalOf, and none by default', async () => {
    await put('alpha/PLAN.md', 'Status: approved\n');
    await put('alpha/tasks.md', '- [ ] one\n');
    const approved = await scanSpecFolders(root, (feature) =>
      feature === 'alpha' ? 'approved' : 'none',
    );
    expect(approved[0]?.detection.node).toBe('spec-approved');
    expect(approved[0]?.detection.stage).toEqual({ stage: 'build', paused: false });
    const defaulted = await scanSpecFolders(root);
    expect(defaulted[0]?.detection.node).toBe('plan-approved');
  });

  it('reports a file that cannot be read, without throwing, and keeps the folder', async () => {
    // A directory named PLAN.md is not a regular file, so it cannot be read as a plan.
    await mkdir(join(root, 'docs', 'specs', 'gamma', 'PLAN.md'), { recursive: true });
    await put('gamma/SPECS.md', '---\nstatus: draft\nticket:\n---\n');
    const folders = await scanSpecFolders(root);
    expect(folders.map((folder) => folder.feature)).toEqual(['gamma']);
    const gamma = folders[0];
    expect(gamma?.files['PLAN.md'].state).toBe('unreadable');
    expect(gamma?.files['PLAN.md'].reason).toBe('not a regular file');
    expect(gamma?.parsed.plan.present).toBe(false);
    expect(gamma?.parsed.plan.problems).toContain('PLAN.md could not be read: not a regular file');
    expect(gamma?.detection.node).toBe('spec-drafted');
  });

  it('reads at most MAX_SPEC_FILE_BYTES of a long file and reports the cut', async () => {
    await put('delta/PLAN.md', `Status: approved\n${'x'.repeat(MAX_SPEC_FILE_BYTES + 10)}`);
    const folders = await scanSpecFolders(root);
    const delta = folders[0];
    expect(delta?.files['PLAN.md'].truncated).toBe(true);
    expect(delta?.parsed.plan.status).toBe('approved');
    expect(delta?.parsed.plan.problems.join(' ')).toContain('longer than');
  });

  it.skipIf(!FILE_SYMLINKS)(
    'does not follow a symbolic link to a file, and reports it as unreadable',
    async () => {
      await put('eps/SPECS.md', '---\nstatus: draft\nticket:\n---\n');
      await put('target-only/PLAN.md', 'Status: approved\n');
      await symlink(
        join(root, 'docs', 'specs', 'target-only', 'PLAN.md'),
        join(root, 'docs', 'specs', 'eps', 'PLAN.md'),
      );
      const eps = (await scanSpecFolders(root)).find((folder) => folder.feature === 'eps');
      expect(eps?.files['PLAN.md'].state).toBe('unreadable');
      expect(eps?.files['PLAN.md'].reason).toBe('a symbolic link is not followed');
      expect(eps?.detection.node).toBe('spec-drafted');
    },
  );
});

describe('readSpecFolder (AC6)', () => {
  it('returns null for an invalid slug, a missing folder, or a folder with no known file', async () => {
    await put('alpha/PLAN.md', 'Status: draft\n');
    await put('notes-only/notes.txt', 'x\n');
    expect(await readSpecFolder(root, '../alpha')).toBeNull();
    expect(await readSpecFolder(root, 'missing')).toBeNull();
    expect(await readSpecFolder(root, 'notes-only')).toBeNull();
    expect((await readSpecFolder(root, 'alpha'))?.detection.node).toBe('planning');
  });

  it('returns null when the project has no docs/specs at all', async () => {
    expect(await readSpecFolder(root, 'alpha')).toBeNull();
  });
});
