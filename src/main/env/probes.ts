// The network probes of the local backend (D31, p4-env-local): whether unshare can make a user and
// network namespace here, and whether /usr/bin/sandbox-exec exists. They are the only part of the
// network limit that touches the system, so they live under src/main/env with the other system calls.
// The choice and the wrappers that use them are pure, in src/main/commands/network.ts. Runs only in main.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type NetworkProbes, SANDBOX_EXEC_PATH } from '../commands/network';

let unshareProbe: Promise<boolean> | undefined;

/**
 * Whether unshare can make a user and network namespace here. Run once and remembered; a
 * failed or missing unshare is false.
 */
export function probeUnshare(): Promise<boolean> {
  unshareProbe ??= new Promise((resolve) => {
    execFile(
      'unshare',
      ['--user', '--map-root-user', '--net', 'true'],
      { shell: false, windowsHide: true, timeout: 10_000 },
      (error) => resolve(error === null),
    );
  });
  return unshareProbe;
}

/** The probes for a platform. Only Linux runs unshare and only macOS checks sandbox-exec. */
export async function probeNetwork(platform: NodeJS.Platform): Promise<NetworkProbes> {
  return {
    unshareWorks: platform === 'linux' ? await probeUnshare() : false,
    sandboxExecExists: platform === 'darwin' && existsSync(SANDBOX_EXEC_PATH),
  };
}
