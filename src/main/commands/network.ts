// The network limit for the code writer's commands (D31). On Linux a command runs in its own
// network namespace (unshare), and on macOS under sandbox-exec with outbound network to
// non-loopback addresses denied. Elsewhere, and when the OS method is missing, the command only
// gets dead proxy variables and offline flags, which is best effort. Runs only in main.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export type NetworkLevel = 'os' | 'proxy-only';

export interface NetworkChoice {
  level: NetworkLevel;
  /** The wrapper that gives the level, or null for proxy-only. */
  wrapper: 'unshare' | 'sandbox-exec' | null;
}

/** The results of the one-time probes, passed in so the choice is a pure function. */
export interface NetworkProbes {
  /** `unshare --user --map-root-user --net true` exits 0. */
  unshareWorks: boolean;
  /** /usr/bin/sandbox-exec exists. */
  sandboxExecExists: boolean;
}

export const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

/** The shell step that brings loopback up in the new namespace, then runs the program. */
export const LOOPBACK_THEN_EXEC = 'ip link set lo up 2>/dev/null; exec "$0" "$@"';

/** The sandbox profile: everything is allowed except outbound network to non-loopback addresses. */
export const MACOS_SANDBOX_PROFILE = [
  '(version 1)',
  '(allow default)',
  '(deny network-outbound (require-not (remote ip "localhost:*")))',
].join('\n');

/** The dead proxy every writer command gets. Nothing listens on port 9 of the loopback. */
export const DEAD_PROXY = 'http://127.0.0.1:9';

/**
 * The wrapper choice from the platform and the probe results: Linux with a working unshare gives
 * the OS level; macOS with sandbox-exec gives the OS level; anything else is proxy-only.
 */
export function chooseNetwork(platform: NodeJS.Platform, probes: NetworkProbes): NetworkChoice {
  if (platform === 'linux' && probes.unshareWorks) {
    return { level: 'os', wrapper: 'unshare' };
  }
  if (platform === 'darwin' && probes.sandboxExecExists) {
    return { level: 'os', wrapper: 'sandbox-exec' };
  }
  return { level: 'proxy-only', wrapper: null };
}

/** The program and arguments to start, with the wrapper around the resolved file. */
export function wrapCommand(
  choice: NetworkChoice,
  file: string,
  args: readonly string[],
): { command: string; args: string[] } {
  switch (choice.wrapper) {
    case 'unshare':
      return {
        command: 'unshare',
        args: ['--user', '--map-root-user', '--net', 'sh', '-c', LOOPBACK_THEN_EXEC, file, ...args],
      };
    case 'sandbox-exec':
      return {
        command: SANDBOX_EXEC_PATH,
        args: ['-p', MACOS_SANDBOX_PROFILE, file, ...args],
      };
    default:
      return { command: file, args: [...args] };
  }
}

/**
 * The environment added for the code writer's commands: dead proxies (with NO_PROXY empty) and
 * offline flags for the common package managers. Only the writer's commands get it.
 */
export function writerNetworkEnv(): NodeJS.ProcessEnv {
  return {
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    all_proxy: DEAD_PROXY,
    NO_PROXY: '',
    no_proxy: '',
    npm_config_offline: 'true',
    YARN_ENABLE_OFFLINE_MODE: '1',
    CARGO_NET_OFFLINE: 'true',
    GOPROXY: 'off',
    PIP_NO_INDEX: '1',
  };
}

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
