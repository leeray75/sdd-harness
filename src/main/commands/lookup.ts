// Finds the file a command runs and builds the cmd.exe line for a Windows script shim (D31).
// Pure except for the file checks, which only stat files. Runs only in main. Reasons are fixed
// strings that never echo the program, the arguments or a path.

import { posix, win32 } from 'node:path';
import type { ToolEnvironment } from '../env/types';

export const NOT_ON_PATH = 'the program was not found on PATH';
export const UNSAFE_CMD_LINE = "this command can't run safely through cmd.exe";

/** The extensions tried on Windows when PATHEXT is not set. */
export const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** A token of the cmd.exe line: letters, digits and a few path characters, nothing else. */
const SAFE_TOKEN = /^[A-Za-z0-9:_./-]+$/;
/** Characters that cmd.exe would read in a path, and line breaks. */
const UNSAFE_PATH_CHARS = /["%!^&|<>()\r\n]/;

export type ProgramLookup = { ok: true; file: string } | { ok: false; reason: string };

/** The value of an environment variable, matched case-insensitively on win32. */
function valueOf(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const wanted = platform === 'win32' ? name.toUpperCase() : name;
  for (const key of Object.keys(env)) {
    const same = platform === 'win32' ? key.toUpperCase() === wanted : key === wanted;
    const value = env[key];
    if (same && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function pathsFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/** True for a regular file, and on POSIX an executable one, through the environment's files part. */
async function isRunnable(
  env: ToolEnvironment,
  file: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    if (!(await env.files.stat(file)).isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      await env.files.access(file, 'execute');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The file a bare program name runs. The PATH in `vars` is searched in order; on Windows each
 * PATHEXT extension is tried first, then the name as given, in each folder. A program that already
 * has a separator is checked as a path and not searched for. Returns the first runnable file, or
 * the fixed reason when there is none. Checks go through `env.files` (D41).
 */
export async function resolveProgram(
  env: ToolEnvironment,
  program: string,
  vars: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<ProgramLookup> {
  if (program.length === 0) {
    return { ok: false, reason: NOT_ON_PATH };
  }
  const path = pathsFor(platform);
  if (/[\\/]/.test(program)) {
    return (await isRunnable(env, program, platform))
      ? { ok: true, file: program }
      : { ok: false, reason: NOT_ON_PATH };
  }
  const pathValue = valueOf(vars, 'PATH', platform) ?? '';
  const folders = pathValue.split(platform === 'win32' ? ';' : ':').filter((dir) => dir.length > 0);
  const extensions =
    platform === 'win32'
      ? (valueOf(vars, 'PATHEXT', platform) ?? DEFAULT_PATHEXT)
          .split(';')
          .filter((ext) => ext.length > 0)
      : [];
  for (const folder of folders) {
    const names = [...extensions.map((ext) => program + ext), program];
    for (const name of names) {
      const file = path.join(folder, name);
      if (await isRunnable(env, file, platform)) {
        return { ok: true, file };
      }
    }
  }
  return { ok: false, reason: NOT_ON_PATH };
}

/** True when the file is a Windows script (.cmd or .bat) that cmd.exe must run. */
export function isCommandScript(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

/** The cmd.exe to run a script shim with: %SystemRoot%\System32\cmd.exe. */
export function cmdExeFor(env: NodeJS.ProcessEnv): string {
  const systemRoot = valueOf(env, 'SystemRoot', 'win32') ?? 'C:\\Windows';
  return win32.join(systemRoot, 'System32', 'cmd.exe');
}

/**
 * The cmd.exe command line for a script: the quoted file, then each argument, and the whole
 * line wrapped in one more pair of quotes. With /s, cmd strips only the outer pair, so the
 * file stays quoted even when its path has a space (without the outer pair, cmd strips the
 * file's own quotes and splits the path at the space). Every argument must match SAFE_TOKEN,
 * and the file must hold none of the characters cmd.exe reads. Any other input is refused
 * with a fixed reason, so no agent-chosen text reaches cmd's parser.
 */
export function cmdLineFor(
  file: string,
  args: readonly string[],
): { ok: true; line: string } | { ok: false; reason: string } {
  if (UNSAFE_PATH_CHARS.test(file) || !args.every((arg) => SAFE_TOKEN.test(arg))) {
    return { ok: false, reason: UNSAFE_CMD_LINE };
  }
  return { ok: true, line: `"${[`"${file}"`, ...args].join(' ')}"` };
}
