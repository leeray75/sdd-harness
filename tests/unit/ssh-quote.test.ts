import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LAUNCHER } from '../../src/main/env/launcher';
import {
  crossingVariables,
  gitLine,
  killLine,
  shellQuote,
  spawnLine,
  UNAME_LINE,
} from '../../src/main/env/ssh-command';
import { splitWords } from '../support/posix-words';

// The quoter of the SSH backend (D43, p4-env-ssh, AC3, and the exec strings of AC5 and AC7). Each argument
// must come back as one word. The fake's own parser checks this everywhere; a real POSIX shell checks it
// where one exists (Git Bash on this machine, or a Linux CI runner), with the script on stdin so no
// argument passes through the Windows command line.

/** The arguments the quoting must hold as single words: spaces, quotes, expansions, separators, globs, lines. */
const HARD_ARGS = [
  'plain',
  'with space',
  "it's",
  "'quoted'",
  '$HOME',
  '${HOME}',
  '`id`',
  'a;b',
  'a&b',
  'a&&b',
  'a|b',
  '*',
  '?[x]',
  'line one\nline two',
  '-rf',
  '--',
  '',
  'back\\slash',
  '"double"',
  '~tilde',
  '#hash',
];

/** Whether a POSIX sh is on this machine (Git Bash on Windows, or any Linux or macOS shell). */
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

/** The words a real POSIX shell gives for a line of quoted words, read back as NUL-separated text. */
function shellWords(quoted: readonly string[]): string[] | null {
  const script = `printf '%s\\0' ${quoted.join(' ')}\n`;
  const run = spawnSync('sh', [], { input: script });
  if (run.status !== 0 || run.stdout === undefined) return null;
  const text = run.stdout.toString('utf8');
  // Each word is followed by a NUL, so the last piece is the empty text after the final one.
  return text.split('\0').slice(0, -1);
}

describe('shellQuote: each argument is one word (AC3)', () => {
  it('round-trips every hard argument through the fake parser', () => {
    for (const arg of HARD_ARGS) {
      const quoted = shellQuote(arg);
      expect(quoted, arg).not.toBeNull();
      expect(splitWords(quoted ?? ''), arg).toEqual([arg]);
    }
  });

  it('round-trips the same arguments through a real POSIX shell where one exists', () => {
    if (!hasSh) return;
    const quoted = HARD_ARGS.map((arg) => shellQuote(arg) ?? '');
    expect(shellWords(quoted)).toEqual(HARD_ARGS);
  });

  it('refuses a NUL byte, which no shell word can hold', () => {
    expect(shellQuote('a\0b')).toBeNull();
    expect(spawnLine('/home/u', [], 'node', ['a\0b'])).toBeNull();
    expect(gitLine('/home/u', ['A=b\0c'], ['status'])).toBeNull();
  });
});

describe('the exec strings are built from quoted words only (AC5, AC7)', () => {
  it('a spawn line has the form cd -- <cwd> && exec env -- <NAME=value…> sh -c <LAUNCHER> sh <file> <args…>', () => {
    const line = spawnLine('/home/u/p', ['MODE=x y'], 'node', ['-v', 'a b']);
    expect(line).toBe(
      `cd -- '/home/u/p' && exec env -- 'MODE=x y' sh -c ${shellQuote(LAUNCHER)} sh 'node' '-v' 'a b'`,
    );
    expect(splitWords(line ?? '')).toEqual([
      'cd',
      '--',
      '/home/u/p',
      '&&',
      'exec',
      'env',
      '--',
      'MODE=x y',
      'sh',
      '-c',
      LAUNCHER,
      'sh',
      'node',
      '-v',
      'a b',
    ]);
  });

  it('a spawn line with no variables has no empty word', () => {
    expect(splitWords(spawnLine('/x', [], 'true', []) ?? '')).toEqual([
      'cd',
      '--',
      '/x',
      '&&',
      'exec',
      'env',
      '--',
      'sh',
      '-c',
      LAUNCHER,
      'sh',
      'true',
    ]);
  });

  it('a git line runs git through the same launcher, with the same folder and variables', () => {
    expect(
      splitWords(gitLine('/r', ['GIT_TERMINAL_PROMPT=0'], ['status', '--porcelain=v1']) ?? ''),
    ).toEqual([
      'cd',
      '--',
      '/r',
      '&&',
      'exec',
      'env',
      '--',
      'GIT_TERMINAL_PROMPT=0',
      'sh',
      '-c',
      LAUNCHER,
      'sh',
      'git',
      'status',
      '--porcelain=v1',
    ]);
  });

  it('the kill line names the group with one quoted word, and uname is fixed', () => {
    expect(splitWords(killLine(4242))).toEqual(['kill', '-KILL', '--', '-4242']);
    expect(UNAME_LINE).toBe('uname -s');
  });
});

describe('crossingVariables: only changed variables, never PATH or a bad name (AC5)', () => {
  it('sends the variables the caller set or changed, and nothing else', () => {
    const app = { HOME: '/home/app', SAME: 'same' };
    const pairs = crossingVariables(
      {
        HOME: '/home/other',
        SAME: 'same',
        NEW_ONE: 'v',
        PATH: '/bin',
        'BAD-NAME': 'x',
        GONE: undefined,
      },
      app,
    );
    expect(pairs.sort()).toEqual(['HOME=/home/other', 'NEW_ONE=v']);
  });

  it('never sends PATH, in any case', () => {
    expect(crossingVariables({ PATH: '/p', path: '/q', Path: '/r' }, {})).toEqual([]);
  });
});
