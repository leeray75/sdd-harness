// The main-side watcher of the approval lock (p3-spec-lock, D36). It watches docs/specs/ (for the
// state file) and the current feature's folder (for its SPECS.md) with non-recursive fs.watch.
// Each event starts a debounced refresh, which re-reads the state and re-hashes the spec, so a
// missed event cannot leave a stale value for long: every refresh starts from disk.
//
// current() is the last value, synchronously. It is `unchecked` until the first refresh finishes.
// onChange fires only when the value differs from the last one, and never after close().

import type { Environment, WatchHandle } from '../env/types';
import { SPECS_DIR } from '../../shared/spec-docs';
import type { Approval } from '../../shared/spec-detect';
import { approvalOf, scanSpecFoldersWithLock } from './spec-lock';

/** The lock's value: the current feature and its approval. */
export interface SpecLockValue {
  feature: string | null;
  approval: Approval;
}

export interface SpecLockWatcherOptions {
  /** The project's environment (D41): its files are read and its folders watched through it. */
  env: Environment;
  /** The project root: docs/specs/ is read under it. */
  root: string;
  /** How long events are collected before a refresh, in milliseconds. Defaults to 150. */
  debounceMs?: number;
  /** Called with the new value when it differs from the last one. */
  onChange: (value: SpecLockValue) => void;
}

export interface SpecLockWatcher {
  /** The last value. Synchronous; `unchecked` until the first refresh finishes. */
  current(): SpecLockValue;
  /** Re-reads and re-hashes, updates the value and the watches, and returns the new value. */
  refresh(): Promise<SpecLockValue>;
  /** Stops the watches and the timer. No callback fires after this. */
  close(): void;
}

async function isRealDir(env: Environment, path: string): Promise<boolean> {
  try {
    const stats = await env.files.lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export function createSpecLockWatcher(options: SpecLockWatcherOptions): SpecLockWatcher {
  const { env, root, onChange } = options;
  const debounceMs = options.debounceMs ?? 150;

  let value: SpecLockValue = { feature: null, approval: 'unchecked' };
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Refreshes run one after another, so an older read can never finish after a newer one.
  let queue: Promise<unknown> = Promise.resolve();
  // The watched folders, by path. A watcher that errors is removed, and the next refresh re-arms it.
  const watchers = new Map<string, WatchHandle>();

  function schedule(): void {
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh().catch(() => undefined);
    }, debounceMs);
  }

  function closeWatcher(dir: string): void {
    const watcher = watchers.get(dir);
    watchers.delete(dir);
    try {
      watcher?.close();
    } catch {
      // Already closed.
    }
  }

  function arm(dirs: readonly string[]): void {
    for (const dir of [...watchers.keys()]) {
      if (!dirs.includes(dir)) closeWatcher(dir);
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        // An error closes the watch, so the next refresh arms it again (D36).
        const handle: WatchHandle = env.watch.watchDir(
          dir,
          () => schedule(),
          () => {
            if (watchers.get(dir) === handle) closeWatcher(dir);
          },
        );
        watchers.set(dir, handle);
      } catch {
        // Not watchable right now (for example docs/specs is missing). The next refresh tries again.
      }
    }
  }

  async function watchedDirs(feature: string | null): Promise<string[]> {
    const dirs: string[] = [];
    const specsDir = env.path.join(root, SPECS_DIR);
    if (await isRealDir(env, specsDir)) dirs.push(specsDir);
    if (feature !== null) {
      const folder = env.path.join(specsDir, feature);
      if (await isRealDir(env, folder)) dirs.push(folder);
    }
    return dirs;
  }

  async function compute(): Promise<SpecLockValue> {
    let next: SpecLockValue;
    try {
      const scan = await scanSpecFoldersWithLock(env, root);
      next = { feature: scan.current, approval: await approvalOf(env, root, scan.current) };
    } catch {
      next = { feature: value.feature, approval: 'unchecked' };
    }
    if (!closed) {
      arm(await watchedDirs(next.feature));
    }
    const differs = next.feature !== value.feature || next.approval !== value.approval;
    value = next;
    if (differs && !closed) {
      try {
        onChange({ ...next });
      } catch {
        // A failing listener must not stop the watcher.
      }
    }
    return { ...next };
  }

  function refresh(): Promise<SpecLockValue> {
    const run = queue.then(compute);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    current: () => ({ ...value }),
    refresh,
    close(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const dir of [...watchers.keys()]) closeWatcher(dir);
    },
  };
}
