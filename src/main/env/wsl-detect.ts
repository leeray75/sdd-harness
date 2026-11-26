// WSL detection (D42, p4-env-wsl). `detectWsl` reports whether WSL is installed here, the distributions
// with their WSL version, and the default one. The add wizard (p4-add-project-wizard) calls it when a
// user asks; nothing calls it at import time or at app start. It runs `wsl.exe --list --verbose` with
// an argument array, no shell and a timeout, and never throws. Main only.
//
// `wsl.exe` writes its list as UTF-16LE. The `*` marks the default distribution. A distribution whose
// name fails `isDistributionName` is left out: the same check the project store and the environment
// factory use for a stored name (D42). The program run is injected, so the tests never start wsl.exe.

import { execFile } from 'node:child_process';

/** How long the list may take, in milliseconds. */
export const WSL_LIST_TIMEOUT_MS = 10_000;
/** The most output bytes the list may return. */
const WSL_LIST_MAX_BYTES = 1024 * 1024;
/** A distribution name: letters, digits, `.`, `_` and `-`, starting with a letter or digit, up to 64 characters. */
const DISTRIBUTION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The UTF-16 code unit of the byte order mark, which wsl.exe may write first. */
const BYTE_ORDER_MARK_UNIT = 0xfeff;

/** True for a distribution name the app accepts. Shared with the store and environmentFor (D42). */
export function isDistributionName(name: unknown): name is string {
  return typeof name === 'string' && DISTRIBUTION_NAME.test(name);
}

/** One installed distribution: its name, its WSL version and whether it is the default. */
export interface WslDistribution {
  readonly name: string;
  readonly version: 1 | 2;
  readonly isDefault: boolean;
}

/** WSL is either not installed here, or installed with its distributions (possibly none). */
export type WslInfo = { installed: false } | { installed: true; distributions: WslDistribution[] };

/** The outcome of one program run: its stdout, or a failure (missing program, exit code, timeout). */
export type ProgramRunResult = { ok: true; stdout: Buffer } | { ok: false };

/** Runs a program with an argument array and no shell. Never rejects. */
export type ProgramRun = (
  file: string,
  argv: readonly string[],
  options: { timeoutMs: number; maxBytes: number },
) => Promise<ProgramRunResult>;

export interface DetectOptions {
  /** The platform; defaults to the app's own. Off Windows nothing runs. */
  platform?: NodeJS.Platform;
  /** The program run; defaults to execFile with no shell. Tests inject their own. */
  run?: ProgramRun;
}

/** The default program run: execFile with an argument array, no shell, a timeout and an output cap. */
const execProgram: ProgramRun = (file, argv, options) =>
  new Promise((resolve) => {
    try {
      execFile(
        file,
        [...argv],
        {
          shell: false,
          windowsHide: true,
          timeout: options.timeoutMs,
          maxBuffer: options.maxBytes,
          encoding: 'buffer',
        },
        (error, stdout) => {
          if (error) resolve({ ok: false });
          else resolve({ ok: true, stdout: Buffer.from(stdout) });
        },
      );
    } catch {
      resolve({ ok: false });
    }
  });

/**
 * The distributions in the output of `wsl.exe --list --verbose`: UTF-16LE text, one line per
 * distribution as `[*] <name> <state> <version>`. The header line and any other line are skipped, and
 * a name that fails isDistributionName is left out.
 */
export function parseWslList(stdout: Buffer): WslDistribution[] {
  const decoded = stdout.toString('utf16le');
  const text = decoded.charCodeAt(0) === BYTE_ORDER_MARK_UNIT ? decoded.slice(1) : decoded;
  const found: WslDistribution[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^(\*\s+)?(\S+)\s+(\S+)\s+([12])$/.exec(raw.trim());
    if (match === null) continue;
    const name = match[2] ?? '';
    if (!isDistributionName(name)) continue;
    found.push({
      name,
      version: match[4] === '2' ? 2 : 1,
      isDefault: match[1] !== undefined,
    });
  }
  return found;
}

/**
 * What WSL has here. Off Windows, or when wsl.exe is missing, fails or times out, the answer is
 * `{ installed: false }`. It never throws.
 */
export async function detectWsl(options: DetectOptions = {}): Promise<WslInfo> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { installed: false };
  const run = options.run ?? execProgram;
  try {
    const result = await run('wsl.exe', ['--list', '--verbose'], {
      timeoutMs: WSL_LIST_TIMEOUT_MS,
      maxBytes: WSL_LIST_MAX_BYTES,
    });
    if (!result.ok) return { installed: false };
    return { installed: true, distributions: parseWslList(result.stdout) };
  } catch {
    return { installed: false };
  }
}
