// The polling watch part (D42, moved by p4-env-ssh, D43). It lists one folder about every `pollMs` through
// the files part, reports added and removed names as `rename` and a changed size or mtime as `change`,
// and compares subfolders by name only. It is shared by the WSL and SSH backends, so a remote folder is
// watched the same way on both. Only the files part is used, so nothing here starts a process.

import { posix } from 'node:path';
import type { FilesPart, WatchHandle, WatchPart } from './types';

/** The watch part over a files part: a poll of one folder, about every `pollMs`. */
export function pollWatchPart(files: FilesPart, pollMs: number): WatchPart {
  return {
    watchDir: (path, onEvent, onError): WatchHandle => {
      /** name -> a key: size and mtime for a file, the name alone for a folder. */
      let last: Map<string, string> | null = null;
      let closed = false;
      let failing = false;
      let busy = false;
      let timer: NodeJS.Timeout | undefined;

      const listing = async (): Promise<Map<string, string>> => {
        const found = new Map<string, string>();
        for (const entry of await files.readdir(path)) {
          if (entry.isDirectory()) {
            found.set(entry.name, 'dir');
            continue;
          }
          try {
            const info = await files.stat(posix.join(path, entry.name));
            found.set(entry.name, `${info.size}:${info.mtimeMs}`);
          } catch (error) {
            // Removed between the listing and the stat: it is simply gone.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return found;
      };

      const report = (previous: Map<string, string>, next: Map<string, string>): void => {
        for (const [name, key] of next) {
          const before = previous.get(name);
          if (before === undefined) onEvent('rename', name);
          else if (before !== key) onEvent('change', name);
        }
        for (const name of previous.keys()) {
          if (!next.has(name)) onEvent('rename', name);
        }
      };

      const tick = async (): Promise<void> => {
        if (closed || busy) return;
        busy = true;
        try {
          const next = await listing();
          if (closed) return;
          failing = false;
          if (last !== null) report(last, next);
          last = next;
        } catch (error) {
          if (!closed && !failing) {
            failing = true;
            onError(error instanceof Error ? error : new Error('listing failed'));
          }
        } finally {
          busy = false;
          if (!closed) timer = setTimeout(() => void tick(), pollMs);
        }
      };

      void tick();
      return {
        close: () => {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
        },
      };
    },
  };
}
