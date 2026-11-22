import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSpecLockWatcher,
  type SpecLockWatcher,
  type SpecLockValue,
} from '../../src/main/workflow/spec-watch';
import { hashSpec, writeSpecState } from '../../src/main/workflow/spec-lock';
import type { SpecStateFile } from '../../src/shared/spec-state';

// AC3: real fs.watch on a temp dir. Every wait is bounded by WAIT_MS, and every watcher is closed.
const WAIT_MS = 2000;
const SPEC = '---\nstatus: approved\nticket:\n---\n\n## Goals\n\n## Acceptance criteria\n';

let root: string;
const watchers: SpecLockWatcher[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-spec-watch-'));
});

afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close();
  await rm(root, { recursive: true, force: true });
});

async function put(relative: string, text: string): Promise<void> {
  const path = join(root, 'docs', 'specs', relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Locks `feature` to the current hash of its SPECS.md. */
async function lock(feature: string): Promise<void> {
  const sha256 = await hashSpec(root, feature);
  if (sha256 === null) throw new Error('no spec to lock');
  const state: SpecStateFile = {
    version: 1,
    feature,
    sha256,
    approvedAt: '2026-11-22T10:00:00.000Z',
    editing: false,
  };
  expect((await writeSpecState(root, state)).ok).toBe(true);
}

/** Resolves with the first matching value, or rejects after `ms`. */
function nextMatching(
  onChange: { mock: { calls: unknown[][] } },
  match: (value: SpecLockValue) => boolean,
  ms: number,
): Promise<SpecLockValue> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = onChange.mock.calls
        .map((call) => call[0] as SpecLockValue)
        .find((value) => match(value));
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`no matching change within ${ms} ms`));
      }
    }, 25);
  });
}

async function seedApprovedFeature(): Promise<void> {
  await put('p3-x/PLAN.md', 'Status: approved\n');
  await put('p3-x/SPECS.md', SPEC);
  await lock('p3-x');
}

describe('createSpecLockWatcher (AC3)', () => {
  it('reads unchecked before the first refresh finishes', () => {
    const watcher = createSpecLockWatcher({ root, onChange: () => undefined });
    watchers.push(watcher);
    expect(watcher.current()).toEqual({ feature: null, approval: 'unchecked' });
  });

  it('reports changed through onChange within 2 s after an approved SPECS.md is edited', async () => {
    await seedApprovedFeature();
    const onChange = vi.fn<(value: SpecLockValue) => void>();
    const watcher = createSpecLockWatcher({ root, debounceMs: 50, onChange });
    watchers.push(watcher);
    expect(await watcher.refresh()).toEqual({ feature: 'p3-x', approval: 'approved' });
    expect(watcher.current()).toEqual({ feature: 'p3-x', approval: 'approved' });

    await put('p3-x/SPECS.md', `${SPEC}\nan edit\n`);
    const seen = await nextMatching(onChange, (value) => value.approval === 'changed', WAIT_MS);
    expect(seen).toEqual({ feature: 'p3-x', approval: 'changed' });
    expect(watcher.current()).toEqual({ feature: 'p3-x', approval: 'changed' });
  }, 10_000);

  it('reports changed from refresh() when the watcher was closed and no event arrived', async () => {
    await seedApprovedFeature();
    const onChange = vi.fn<(value: SpecLockValue) => void>();
    const watcher = createSpecLockWatcher({ root, debounceMs: 50, onChange });
    watchers.push(watcher);
    expect((await watcher.refresh()).approval).toBe('approved');
    watcher.close();

    await put('p3-x/SPECS.md', `${SPEC}\nedited while closed\n`);
    const callsBefore = onChange.mock.calls.length;
    expect(await watcher.refresh()).toEqual({ feature: 'p3-x', approval: 'changed' });
    expect(watcher.current()).toEqual({ feature: 'p3-x', approval: 'changed' });
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  it('fires no callback after close(), even when the file changes', async () => {
    await seedApprovedFeature();
    const onChange = vi.fn<(value: SpecLockValue) => void>();
    const watcher = createSpecLockWatcher({ root, debounceMs: 50, onChange });
    watchers.push(watcher);
    await watcher.refresh();
    const callsAtClose = onChange.mock.calls.length;
    watcher.close();

    await put('p3-x/SPECS.md', `${SPEC}\nafter close\n`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onChange.mock.calls.length).toBe(callsAtClose);
  });

  it('calls onChange only when the value differs from the last one', async () => {
    await seedApprovedFeature();
    const onChange = vi.fn<(value: SpecLockValue) => void>();
    const watcher = createSpecLockWatcher({ root, debounceMs: 50, onChange });
    watchers.push(watcher);
    await watcher.refresh();
    const calls = onChange.mock.calls.length;
    await watcher.refresh();
    await watcher.refresh();
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('keeps working when docs/specs does not exist yet, and reports none', async () => {
    const onChange = vi.fn<(value: SpecLockValue) => void>();
    const watcher = createSpecLockWatcher({ root, debounceMs: 50, onChange });
    watchers.push(watcher);
    expect(await watcher.refresh()).toEqual({ feature: null, approval: 'none' });
    expect(onChange).toHaveBeenCalledWith({ feature: null, approval: 'none' });
  });

  it('a throwing listener does not stop the watcher from returning values', async () => {
    await seedApprovedFeature();
    const watcher = createSpecLockWatcher({
      root,
      onChange: () => {
        throw new Error('listener failed');
      },
    });
    watchers.push(watcher);
    expect((await watcher.refresh()).approval).toBe('approved');
  });
});
