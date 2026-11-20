// Writes a whole file by writing a temporary file in the same folder and renaming it into
// place. On Windows a rename can fail while another program has the target open, so a failed
// rename is retried briefly. If every attempt fails, the temporary file is removed and the
// result is a fixed failure. Runs only in main.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

async function removeQuietly(path: string): Promise<void> {
  try {
    await fs.rm(path, { force: true });
  } catch {
    // Nothing more can be done; the name is random, so it cannot clash with a later write.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes `data` to `target` through a temporary file in the same folder. `target` must be a
 * path whose folder exists. Never leaves the temporary file behind.
 */
export async function writeFileAtomic(
  target: string,
  data: Buffer,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const rename = options.rename ?? ((from: string, to: string) => fs.rename(from, to));
  const attempts = options.attempts ?? RENAME_ATTEMPTS;
  const retryMs = options.retryMs ?? RENAME_RETRY_MS;
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);

  try {
    await fs.writeFile(temp, data, { flag: 'wx' });
  } catch {
    await removeQuietly(temp);
    return { ok: false, reason: WRITE_FAILED };
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, target);
      return { ok: true };
    } catch {
      if (attempt >= attempts) {
        await removeQuietly(temp);
        return { ok: false, reason: RENAME_FAILED };
      }
      await delay(retryMs * attempt);
    }
  }
}
