// The command strings the SSH backend sends over an exec channel (D43, p4-env-ssh). An exec request is one
// string, which the remote login shell reads, so every value that comes from the caller is quoted here,
// as one POSIX single-quoted word, and nothing else is built into a command. The words the backend writes
// itself (cd, exec, env, sh, kill, uname, and the fixed flags) are constants. Pure: no transport, no fs.

import { LAUNCHER } from './launcher';

/** The two kinds of secret a server can hold: a password, or a key passphrase (D43). */
export type SecretKind = 'password' | 'passphrase';

/** The secret store entry name of one server's secret: `ssh-<serverId>-<kind>`. */
export function secretName(serverId: string, kind: SecretKind): string {
  return `ssh-${serverId}-${kind}`;
}

/** A name an environment variable may have to cross (the same rule as WSLENV, D42). */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The variable that never crosses: the remote shell keeps its own PATH. */
const PATH_NAME = 'PATH';

/**
 * One argument as a single POSIX shell word: wrapped in single quotes, with each `'` written as `'\''`.
 * Null for a value holding a NUL byte, which no shell word can hold (the spawn then does not start).
 */
export function shellQuote(arg: string): string | null {
  if (arg.includes('\0')) return null;
  return `'${arg.split("'").join("'\\''")}'`;
}

/** Every value quoted, or null when one of them cannot be quoted. */
function quoteAll(values: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const value of values) {
    const quoted = shellQuote(value);
    if (quoted === null) return null;
    out.push(quoted);
  }
  return out;
}

/**
 * The variables that cross to the server, as `NAME=value` pairs: only the ones the caller set or changed
 * relative to the app's own environment, never PATH, and never a name that is not a plain variable name.
 */
export function crossingVariables(
  env: NodeJS.ProcessEnv,
  appEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !VARIABLE_NAME.test(name)) continue;
    if (name.toUpperCase() === PATH_NAME) continue;
    if (appEnv[name] === value) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs;
}

/**
 * The exec string of one program (AC5): `cd -- <cwd> && exec env -- <NAME=value…> sh -c <LAUNCHER> sh
 * <file> <args…>`. Every value is quoted. Null when a value holds a NUL byte.
 */
export function spawnLine(
  cwd: string,
  pairs: readonly string[],
  file: string,
  args: readonly string[],
): string | null {
  return launchLine(cwd, pairs, [file, ...args]);
}

/** The exec string of one git call through the same launcher and group kill (AC7). */
export function gitLine(
  root: string,
  pairs: readonly string[],
  args: readonly string[],
): string | null {
  return launchLine(root, pairs, ['git', ...args]);
}

/** The launcher line for a folder, the variables and the program words after `sh`. */
function launchLine(
  cwd: string,
  pairs: readonly string[],
  program: readonly string[],
): string | null {
  const cwdWord = shellQuote(cwd);
  const launcher = shellQuote(LAUNCHER);
  const pairWords = quoteAll(pairs);
  const programWords = quoteAll(program);
  if (cwdWord === null || launcher === null || pairWords === null || programWords === null) {
    return null;
  }
  return [
    'cd',
    '--',
    cwdWord,
    '&&',
    'exec',
    'env',
    '--',
    ...pairWords,
    'sh',
    '-c',
    launcher,
    'sh',
    ...programWords,
  ].join(' ');
}

/** The exec string that kills a process group (AC5): `kill -KILL -- '-<pgid>'`, on a second channel. */
export function killLine(group: number): string {
  // A group id is a plain number, so its quoted word can never be null.
  return `kill -KILL -- ${shellQuote(`-${group}`) ?? "''"}`;
}

/** The exec string that reads the server's system name (`uname -s`), once per connection (AC5). */
export const UNAME_LINE = 'uname -s';

/** The exec string of the one-time probe of `unshare --user --map-root-user --net true` (D42, D43). */
export const UNSHARE_PROBE_LINE = 'unshare --user --map-root-user --net true';
