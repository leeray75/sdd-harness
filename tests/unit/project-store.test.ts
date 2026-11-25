import { createHash, randomUUID } from 'node:crypto';
import {
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
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectStore,
  STORE_REASONS,
  type ProjectStore,
} from '../../src/main/projects/store';
import type { Logger } from '../../src/main/log';
import { DEFAULT_RULES, RULE_REASONS } from '../../src/shared/project-rules';

// The store on temp folders. Each test gets its own folder with a project store file and a few
// project folders inside it. The clock is fixed, so a set-aside file has a known name.

const NOW = new Date('2026-11-25T00:00:00.000Z');
const STAMP = '2026-11-25T00-00-00-000Z';
const LOCAL = { kind: 'local' as const };

let base: string;
let filePath: string;
let logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sdd-store-'));
  filePath = join(base, 'data', 'projects.json');
  logger = { info: vi.fn(), error: vi.fn() };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function makeFolder(name: string): string {
  const folder = join(base, name);
  mkdirSync(folder, { recursive: true });
  return folder;
}

function makeStore(platform: NodeJS.Platform = 'linux'): ProjectStore {
  return createProjectStore({
    filePath,
    newId: () => randomUUID(),
    now: () => NOW,
    platform,
    logger: logger as Logger,
  });
}

/** A hash of every path and content under a folder, in a fixed order. */
function hashTree(dir: string): string {
  const hash = createHash('sha256');
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(folder, entry.name);
      hash.update(full.slice(dir.length));
      hash.update('\0');
      if (entry.isDirectory()) {
        walk(full);
      } else {
        hash.update(readFileSync(full));
        hash.update('\0');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** The other case of every letter, so a path that differs only by case. */
function swapCase(text: string): string {
  return text.replace(/[a-z]/gi, (c) =>
    c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
  );
}

describe('add, list, get, rename, setRules and remove (AC1)', () => {
  it('starts empty when the file is missing, and logs no error', async () => {
    const store = makeStore();
    await store.load();
    expect(store.list()).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(existsSync(filePath)).toBe(false);
  });

  it('adds a project with the default rules, and lists and gets it', async () => {
    const folder = makeFolder('alpha');
    const store = makeStore();
    await store.load();
    const added = await store.add({ name: '  Alpha  ', environment: LOCAL, root: folder });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.project).toMatchObject({
      name: 'Alpha',
      environment: { kind: 'local' },
      root: folder,
      rules: DEFAULT_RULES,
    });
    expect(store.list()).toEqual([added.project]);
    expect(store.get(added.project.id)).toEqual(added.project);
    expect(store.get('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('adds a project with given rules, filling the rest with defaults', async () => {
    const folder = makeFolder('rules');
    const store = makeStore();
    await store.load();
    const added = await store.add({
      name: 'Rules',
      environment: LOCAL,
      root: folder,
      rules: { roundLimit: 1 },
    });
    expect(added).toMatchObject({
      ok: true,
      project: { rules: { ...DEFAULT_RULES, roundLimit: 1 } },
    });
  });

  it('renames, sets rules, and reads both back', async () => {
    const folder = makeFolder('edit');
    const store = makeStore();
    await store.load();
    const added = await store.add({ name: 'Old', environment: LOCAL, root: folder });
    if (!added.ok) throw new Error('add failed');
    const id = added.project.id;

    const renamed = await store.rename(id, 'New name');
    expect(renamed).toMatchObject({ ok: true, project: { name: 'New name' } });

    const ruled = await store.setRules(id, { roundLimit: 2, commitFormat: '[{ticket}] {summary}' });
    expect(ruled).toMatchObject({
      ok: true,
      project: {
        rules: { roundLimit: 2, modelPolicy: 'defaults', commitFormat: '[{ticket}] {summary}' },
      },
    });
    expect(store.get(id)).toMatchObject({
      name: 'New name',
      rules: { roundLimit: 2, commitFormat: '[{ticket}] {summary}' },
    });
  });

  it('refuses rename and setRules for an unknown id, with nothing changed', async () => {
    const store = makeStore();
    await store.load();
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await store.rename(id, 'x')).toEqual({ ok: false, reason: STORE_REASONS.noProject });
    expect(await store.setRules(id, {})).toEqual({ ok: false, reason: STORE_REASONS.noProject });
    expect(await store.remove(id)).toEqual({ ok: false, reason: STORE_REASONS.noProject });
  });

  it('refuses bad rules on setRules and keeps the old rules', async () => {
    const folder = makeFolder('keep');
    const store = makeStore();
    await store.load();
    const added = await store.add({ name: 'Keep', environment: LOCAL, root: folder });
    if (!added.ok) throw new Error('add failed');
    const result = await store.setRules(added.project.id, { specApproval: false });
    expect(result).toEqual({ ok: false, reason: RULE_REASONS.unknownKey });
    expect(store.get(added.project.id)?.rules).toEqual(DEFAULT_RULES);
  });

  it('removes a project from the list and the file', async () => {
    const folder = makeFolder('gone');
    const store = makeStore();
    await store.load();
    const added = await store.add({ name: 'Gone', environment: LOCAL, root: folder });
    if (!added.ok) throw new Error('add failed');
    const removed = await store.remove(added.project.id);
    expect(removed).toMatchObject({ ok: true, project: { id: added.project.id } });
    expect(store.list()).toEqual([]);
    const fresh = makeStore();
    await fresh.load();
    expect(fresh.list()).toEqual([]);
  });

  it('reads back the same projects from a second store on the same file (restart)', async () => {
    const a = makeFolder('one');
    const b = makeFolder('two');
    const first = makeStore();
    await first.load();
    await first.add({ name: 'One', environment: LOCAL, root: a });
    const two = await first.add({
      name: 'Two',
      environment: LOCAL,
      root: b,
      rules: { roundLimit: 1 },
    });
    if (!two.ok) throw new Error('add failed');
    await first.rename(two.project.id, 'Second');

    const second = makeStore();
    await second.load();
    expect(second.list()).toEqual(first.list());
    expect(second.list().map((project) => project.name)).toEqual(['One', 'Second']);
    expect(second.get(two.project.id)?.rules.roundLimit).toBe(1);
  });

  it('stores the root after path.resolve', async () => {
    const folder = makeFolder('resolved');
    const store = makeStore();
    await store.load();
    const added = await store.add({
      name: 'Resolved',
      environment: LOCAL,
      root: `${folder}${folder.includes('\\') ? '\\' : '/'}.`,
    });
    expect(added).toMatchObject({ ok: true, project: { root: folder } });
  });
});

describe('add refusals (AC1)', () => {
  it('refuses a relative root', async () => {
    makeFolder('rel');
    const store = makeStore();
    await store.load();
    expect(await store.add({ name: 'Rel', environment: LOCAL, root: 'rel' })).toEqual({
      ok: false,
      reason: STORE_REASONS.root,
    });
    expect(store.list()).toEqual([]);
  });

  it('refuses a missing root', async () => {
    const store = makeStore();
    await store.load();
    expect(
      await store.add({ name: 'Missing', environment: LOCAL, root: join(base, 'nope') }),
    ).toEqual({ ok: false, reason: STORE_REASONS.root });
  });

  it('refuses a root that is a file', async () => {
    const file = join(base, 'a-file.txt');
    writeFileSync(file, 'not a folder');
    const store = makeStore();
    await store.load();
    expect(await store.add({ name: 'File', environment: LOCAL, root: file })).toEqual({
      ok: false,
      reason: STORE_REASONS.root,
    });
  });

  it('refuses a duplicate root with the same spelling', async () => {
    const folder = makeFolder('dup');
    const store = makeStore();
    await store.load();
    await store.add({ name: 'First', environment: LOCAL, root: folder });
    expect(await store.add({ name: 'Second', environment: LOCAL, root: folder })).toEqual({
      ok: false,
      reason: STORE_REASONS.duplicate,
    });
    expect(store.list()).toHaveLength(1);
  });

  it('refuses a case-only variant of the same folder on win32 and darwin, if it exists', async () => {
    const folder = makeFolder('CaseFolder');
    const variant = swapCase(folder);
    // Only a case-insensitive file system resolves the variant; on any other one the test is void.
    if (!existsSync(variant) || !statSync(variant).isDirectory()) return;
    for (const platform of ['win32', 'darwin'] as const) {
      const store = makeStore(platform);
      await store.load();
      await store.add({ name: 'Original', environment: LOCAL, root: folder });
      expect(await store.add({ name: 'Variant', environment: LOCAL, root: variant })).toEqual({
        ok: false,
        reason: STORE_REASONS.duplicate,
      });
    }
  });

  it('refuses a bad name: empty, blank, too long, or with a line break', async () => {
    const folder = makeFolder('names');
    const store = makeStore();
    await store.load();
    // The last entry holds a literal U+2028 line separator, which must be refused too.
    const bad = ['', '   ', 'x'.repeat(81), 'two lines', 'two\nlines', 'two\rlines', 'a b'];
    for (const name of bad) {
      expect(await store.add({ name, environment: LOCAL, root: folder })).toEqual({
        ok: false,
        reason: STORE_REASONS.name,
      });
    }
    expect(store.list()).toEqual([]);
  });

  it('accepts a name of exactly 80 characters', async () => {
    const folder = makeFolder('long-name');
    const store = makeStore();
    await store.load();
    const result = await store.add({ name: 'x'.repeat(80), environment: LOCAL, root: folder });
    expect(result.ok).toBe(true);
  });

  it('refuses rules that the rules model refuses, and saves nothing', async () => {
    const folder = makeFolder('bad-rules');
    const store = makeStore();
    await store.load();
    expect(
      await store.add({ name: 'Bad', environment: LOCAL, root: folder, rules: { roundLimit: 4 } }),
    ).toEqual({ ok: false, reason: RULE_REASONS.roundLimit });
    expect(existsSync(filePath)).toBe(false);
  });

  it('refuses an environment other than local', async () => {
    const folder = makeFolder('env');
    const store = makeStore();
    await store.load();
    const bad = { kind: 'wsl', distro: 'Ubuntu' } as unknown as { kind: 'local' };
    expect(await store.add({ name: 'Env', environment: bad, root: folder })).toEqual({
      ok: false,
      reason: STORE_REASONS.environment,
    });
  });
});

describe('remove leaves the folder alone (AC2)', () => {
  it('hashes every file under the folder before and after remove, and the hashes match', async () => {
    const folder = makeFolder('kept');
    mkdirSync(join(folder, 'docs', 'specs', 'feature'), { recursive: true });
    writeFileSync(join(folder, 'README.md'), '# kept\n');
    writeFileSync(
      join(folder, 'docs', 'specs', 'feature', 'SPECS.md'),
      '---\nstatus: draft\n---\n',
    );
    writeFileSync(join(folder, '.gitignore'), 'node_modules\n');

    const store = makeStore();
    await store.load();
    const added = await store.add({ name: 'Kept', environment: LOCAL, root: folder });
    if (!added.ok) throw new Error('add failed');

    const before = hashTree(folder);
    const removed = await store.remove(added.project.id);
    expect(removed.ok).toBe(true);
    const after = hashTree(folder);
    expect(after).toBe(before);
    expect(existsSync(join(folder, 'README.md'))).toBe(true);
  }, 15000);
});

describe('load: a store file that cannot be used is set aside (AC6)', () => {
  function setAsideName(): string {
    return `${filePath}.corrupt-${STAMP}`;
  }

  async function loadWith(text: string): Promise<ProjectStore> {
    mkdirSync(join(base, 'data'), { recursive: true });
    writeFileSync(filePath, text);
    const store = makeStore();
    await store.load();
    return store;
  }

  it('sets aside a file that is not JSON, logs the reason code only, and starts empty', async () => {
    const secret = 'SECRET-PROJECT-CONTENT';
    const store = await loadWith(`not json ${secret} {`);
    expect(store.list()).toEqual([]);
    expect(existsSync(filePath)).toBe(false);
    expect(readFileSync(setAsideName(), 'utf8')).toContain(secret);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = String(logger.error.mock.calls[0]?.[0]);
    expect(line).toContain('not-json');
    expect(line).not.toContain(secret);
  });

  it('sets aside a file with another version', async () => {
    const store = await loadWith(JSON.stringify({ version: 2, projects: [] }));
    expect(store.list()).toEqual([]);
    expect(existsSync(setAsideName())).toBe(true);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('version');
  });

  it('sets aside a file with an invalid project', async () => {
    const store = await loadWith(JSON.stringify({ version: 1, projects: [{ id: 'not-a-uuid' }] }));
    expect(store.list()).toEqual([]);
    expect(existsSync(setAsideName())).toBe(true);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('invalid-project');
  });

  it('sets aside a file whose two projects share a folder', async () => {
    const folder = makeFolder('shared');
    const project = {
      id: randomUUID(),
      name: 'Shared',
      environment: LOCAL,
      root: folder,
      rules: DEFAULT_RULES,
    };
    const store = await loadWith(
      JSON.stringify({ version: 1, projects: [project, { ...project, id: randomUUID() }] }),
    );
    expect(store.list()).toEqual([]);
    expect(existsSync(setAsideName())).toBe(true);
  });

  it('loads a valid file and keeps its projects', async () => {
    const folder = makeFolder('valid');
    const project = {
      id: randomUUID(),
      name: 'Valid',
      environment: LOCAL,
      root: folder,
      rules: { roundLimit: 2 },
    };
    const store = await loadWith(JSON.stringify({ version: 1, projects: [project] }));
    expect(store.list()).toEqual([{ ...project, rules: { ...DEFAULT_RULES, roundLimit: 2 } }]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('starts empty and logs that the set-aside failed when the rename fails', async () => {
    mkdirSync(join(base, 'data'), { recursive: true });
    writeFileSync(filePath, 'not json');
    // A folder with the set-aside name makes the rename fail on every platform.
    mkdirSync(setAsideName());
    const store = makeStore();
    await store.load();
    expect(store.list()).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('setting it aside failed');

    // The next save replaces the corrupt file.
    const folder = makeFolder('after-failure');
    const added = await store.add({ name: 'After', environment: LOCAL, root: folder });
    expect(added.ok).toBe(true);
    const fresh = makeStore();
    await fresh.load();
    expect(fresh.list()).toHaveLength(1);
  });
});

describe('a failed save leaves the list unchanged (AC1)', () => {
  it('keeps the list as it was when a save fails, for add and remove', async () => {
    const first = makeFolder('kept-first');
    const second = makeFolder('refused-second');
    const store = makeStore();
    await store.load();
    const kept = await store.add({ name: 'First', environment: LOCAL, root: first });
    if (!kept.ok) throw new Error('add failed');
    const before = store.list();

    // A folder where the file should be makes every save fail.
    rmSync(filePath);
    mkdirSync(filePath);

    expect(await store.add({ name: 'Second', environment: LOCAL, root: second })).toEqual({
      ok: false,
      reason: STORE_REASONS.save,
    });
    expect(store.list()).toEqual(before);
    expect(await store.remove(kept.project.id)).toEqual({ ok: false, reason: STORE_REASONS.save });
    expect(store.list()).toEqual(before);
    expect(await store.rename(kept.project.id, 'Other')).toEqual({
      ok: false,
      reason: STORE_REASONS.save,
    });
    expect(store.get(kept.project.id)?.name).toBe('First');
  }, 20000);
});
