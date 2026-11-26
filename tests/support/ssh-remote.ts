import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { shellQuote } from '../../src/main/env/ssh-command';
import type { WalkFiles } from './headless-walk';

// Test-only helpers for the live SSH walk (AC15). The walk is synchronous, so these run one command on the server
// through the system ssh client, with no shell on this side: every word the remote shell reads is quoted by
// shellQuote. They are never used by the app (only the environment's SSH backend reaches a server there), and
// they never see a password: the walk's key is read by the ssh client from its file.

/** The server a live test reaches: its address, user and key file. */
export interface SshTarget {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  /** A scratch folder of the test, for the client's own known-hosts file. */
  scratch: string;
}

/** The ssh client's options: the key only, no prompt, and host keys checked by the app, not here. */
function sshOptions(target: SshTarget): string[] {
  return [
    '-i',
    target.keyPath,
    '-p',
    String(target.port),
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    `UserKnownHostsFile=${posix.join(target.scratch.replace(/\\/g, '/'), 'known_hosts')}`,
  ];
}

/** Runs one command on the server and returns its stdout. Throws when the command fails. */
export function remoteRun(target: SshTarget, command: string, input?: string): string {
  return execFileSync('ssh', [...sshOptions(target), `${target.user}@${target.host}`, command], {
    encoding: 'utf8',
    windowsHide: true,
    input: input ?? '',
    timeout: 120_000,
  });
}

/** Runs git on the server, from a remote folder, with a fixed argument list (every word quoted). */
export function remoteGit(target: SshTarget, cwd: string, args: string[]): string {
  const words = ['git', ...args].map((word) => shellQuote(word) ?? "''");
  return remoteRun(target, `cd -- ${shellQuote(cwd) ?? "''"} && ${words.join(' ')}`);
}

/** The walk's files on the server, by path relative to a remote folder. */
export function remoteWalkFiles(target: SshTarget, root: string): WalkFiles {
  const at = (relative: string): string => posix.join(root, relative);
  return {
    write: (relative, text) => {
      const path = at(relative);
      remoteRun(
        target,
        `mkdir -p -- ${shellQuote(posix.dirname(path)) ?? "''"} && cat > ${shellQuote(path) ?? "''"}`,
        text,
      );
    },
    read: (relative) => remoteRun(target, `cat -- ${shellQuote(at(relative)) ?? "''"}`),
    exists: (relative) => {
      try {
        remoteRun(target, `test -e ${shellQuote(at(relative)) ?? "''"}`);
        return true;
      } catch {
        return false;
      }
    },
    append: (relative, text) => {
      remoteRun(target, `cat >> ${shellQuote(at(relative)) ?? "''"}`, text);
    },
  };
}
