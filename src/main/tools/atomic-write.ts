// Writes a whole file by writing a temporary file in the same folder and renaming it into
// place. On Windows a rename can fail while another program has the target open, so a failed
// rename is retried briefly. If every attempt fails, the temporary file is removed and the
// result is a fixed failure. The writes go through the environment's files part (D41), so the
// same steps hold for any backend. Runs only in main.

import { randomBytes } from 'node:crypto';
import type { FilesPart } from '../env/types';

/** Rename attempts before the write is given up. */
export const RENAME_ATTEMPTS = 5;

/** Base wait between rename attempts, in milliseconds; each retry waits longer. */
export const RENAME_RETRY_MS = 25;

const WRITE_FAILED = 'the file could not be written; nothing was changed';
const RENAME_FAILED = 'the file could not be replaced; nothing was changed';

export type AtomicWriteResult = { ok: true } | { ok: false; reason: string };

export interface AtomicWriteOptions {
  /** Replaces the rename, for tests. */
  rename?: (from: string, to: string) => Promise<void>;
  attempts?: number;
  retryMs?: number;
}

async function removeQuietly(files: FilesPart, path: string): Promise<void> {
  try {
    await files.rm(path, { force: true });
  } catch {
    // Nothing more can be done; the name is random, so it cannot clash with a later write.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The temporary name beside `target`: the same folder, a dot, the target's name, a random part
 * and `.tmp`. The folder is everything up to the last separator, so both `/` and `\` work.
 */
function tempNameFor(target: string): string {
  const cut = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  const folder = target.slice(0, cut + 1);
  const name = target.slice(cut + 1);
  return `${folder}.${name}.${randomBytes(6).toString('hex')}.tmp`;
}

/**
 * Writes `data` to `target` through a temporary file in the same folder, over `files`. `target`
 * must be a path whose folder exists. Never leaves the temporary file behind.
 */
export async function writeFileAtomic(
  files: FilesPart,
  target: string,
  data: Buffer,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const rename = options.rename ?? ((from: string, to: string) => files.rename(from, to));
  const attempts = options.attempts ?? RENAME_ATTEMPTS;
  const retryMs = options.retryMs ?? RENAME_RETRY_MS;
  const temp = tempNameFor(target);

  try {
    await files.writeFile(temp, data, { flag: 'wx' });
  } catch {
    await removeQuietly(files, temp);
    return { ok: false, reason: WRITE_FAILED };
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, target);
      return { ok: true };
    } catch {
      if (attempt >= attempts) {
        await removeQuietly(files, temp);
        return { ok: false, reason: RENAME_FAILED };
      }
      await delay(retryMs * attempt);
    }
  }
}
