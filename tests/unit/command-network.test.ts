import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chooseNetwork,
  DEAD_PROXY,
  LOOPBACK_THEN_EXEC,
  MACOS_SANDBOX_PROFILE,
  SANDBOX_EXEC_PATH,
  wrapCommand,
  writerNetworkEnv,
  type NetworkChoice,
  type NetworkProbes,
} from '../../src/main/commands/network';
// The probes moved to the environment with the other system calls (D41); the assertions are unchanged.
import { probeNetwork } from '../../src/main/env/probes';

const PLATFORMS: NodeJS.Platform[] = ['linux', 'darwin', 'win32', 'freebsd'];
const PROBE_SETS: NetworkProbes[] = [
  { unshareWorks: true, sandboxExecExists: true },
  { unshareWorks: true, sandboxExecExists: false },
  { unshareWorks: false, sandboxExecExists: true },
  { unshareWorks: false, sandboxExecExists: false },
];

describe('chooseNetwork: the wrapper is a pure function of the platform and the probes', () => {
  it('gives the OS level with unshare on Linux when the probe works', () => {
    expect(chooseNetwork('linux', { unshareWorks: true, sandboxExecExists: false })).toEqual({
      level: 'os',
      wrapper: 'unshare',
    });
  });

  it('gives the OS level with sandbox-exec on macOS when it exists', () => {
    expect(chooseNetwork('darwin', { unshareWorks: false, sandboxExecExists: true })).toEqual({
      level: 'os',
      wrapper: 'sandbox-exec',
    });
  });

  it('gives proxy-only everywhere else, and when the probe fails', () => {
    for (const platform of PLATFORMS) {
      for (const probes of PROBE_SETS) {
        const expected =
          (platform === 'linux' && probes.unshareWorks) ||
          (platform === 'darwin' && probes.sandboxExecExists);
        const choice = chooseNetwork(platform, probes);
        if (expected) {
          expect(choice.level).toBe('os');
        } else {
          expect(choice).toEqual({ level: 'proxy-only', wrapper: null });
        }
      }
    }
  });

  it('gives proxy-only on Windows even when every probe is true', () => {
    expect(chooseNetwork('win32', { unshareWorks: true, sandboxExecExists: true })).toEqual({
      level: 'proxy-only',
      wrapper: null,
    });
  });
});

describe('wrapCommand', () => {
  it('wraps a Linux command in unshare with a loopback step, and passes the arguments as they are', () => {
    const wrapped = wrapCommand({ level: 'os', wrapper: 'unshare' }, '/usr/bin/node', [
      'a b',
      '$HOME',
    ]);
    expect(wrapped.command).toBe('unshare');
    expect(wrapped.args).toEqual([
      '--user',
      '--map-root-user',
      '--net',
      'sh',
      '-c',
      LOOPBACK_THEN_EXEC,
      '/usr/bin/node',
      'a b',
      '$HOME',
    ]);
    expect(LOOPBACK_THEN_EXEC).toContain('ip link set lo up');
    expect(LOOPBACK_THEN_EXEC).toContain('exec "$0" "$@"');
  });

  it('wraps a macOS command in sandbox-exec with the profile', () => {
    const wrapped = wrapCommand({ level: 'os', wrapper: 'sandbox-exec' }, '/usr/bin/node', ['x']);
    expect(wrapped).toEqual({
      command: SANDBOX_EXEC_PATH,
      args: ['-p', MACOS_SANDBOX_PROFILE, '/usr/bin/node', 'x'],
    });
  });

  it('leaves the command as it is for proxy-only', () => {
    const choice: NetworkChoice = { level: 'proxy-only', wrapper: null };
    expect(wrapCommand(choice, 'C:\\node.exe', ['-v'])).toEqual({
      command: 'C:\\node.exe',
      args: ['-v'],
    });
  });

  it('gives a macOS profile that denies outbound network except to localhost', () => {
    expect(MACOS_SANDBOX_PROFILE).toContain('(allow default)');
    expect(MACOS_SANDBOX_PROFILE).toContain('network-outbound');
    expect(MACOS_SANDBOX_PROFILE).toContain('localhost:*');
  });
});

describe('writerNetworkEnv', () => {
  it('sets the dead proxy variables, both spellings, and empties NO_PROXY', () => {
    const env = writerNetworkEnv();
    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      expect(env[name]).toBe(DEAD_PROXY);
    }
    expect(DEAD_PROXY).toBe('http://127.0.0.1:9');
    expect(env['NO_PROXY']).toBe('');
    expect(env['no_proxy']).toBe('');
  });

  it('sets the offline flags for npm, yarn, cargo, go and pip', () => {
    const env = writerNetworkEnv();
    expect(env).toMatchObject({
      npm_config_offline: 'true',
      YARN_ENABLE_OFFLINE_MODE: '1',
      CARGO_NET_OFFLINE: 'true',
      GOPROXY: 'off',
      PIP_NO_INDEX: '1',
    });
  });
});

describe('probeNetwork', () => {
  it('reports no method on Windows without running any probe', async () => {
    expect(await probeNetwork('win32')).toEqual({ unshareWorks: false, sandboxExecExists: false });
  });

  it('reports sandbox-exec on macOS only when the file exists', async () => {
    const probes = await probeNetwork('darwin');
    expect(probes.sandboxExecExists).toBe(existsSync(SANDBOX_EXEC_PATH));
    expect(probes.unshareWorks).toBe(false);
  });
});

// The real network check. It runs only where the OS method exists on this machine, and skips
// with that reason elsewhere. The stub tries a non-loopback connection and a loopback one.
const UNSHARE_HERE =
  process.platform === 'linux' &&
  spawnSync('unshare', ['--user', '--map-root-user', '--net', 'true']).status === 0;
const SANDBOX_HERE = process.platform === 'darwin' && existsSync(SANDBOX_EXEC_PATH);

describe('the OS network limit, on a real command', () => {
  let base: string;
  let stub: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'command-network-'));
    stub = join(base, 'net-stub.cjs');
    writeFileSync(
      stub,
      [
        "const net = require('node:net');",
        "if (process.argv[2] === 'remote') {",
        "  const socket = net.connect({ host: '93.184.216.34', port: 80, timeout: 3000 });",
        "  socket.on('connect', () => { console.log('remote connected'); process.exit(0); });",
        "  socket.on('error', (error) => { console.log('remote error ' + error.code); process.exit(3); });",
        "  socket.on('timeout', () => { console.log('remote timeout'); process.exit(4); });",
        '} else {',
        '  const server = net.createServer();',
        "  server.listen(0, '127.0.0.1', () => {",
        "    const client = net.connect(server.address().port, '127.0.0.1', () => {",
        "      console.log('loopback ok'); process.exit(0);",
        '    });',
        "    client.on('error', (error) => { console.log('loopback error ' + error.code); process.exit(5); });",
        '  });',
        "  server.on('error', (error) => { console.log('listen error ' + error.code); process.exit(6); });",
        '}',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const choice: NetworkChoice = UNSHARE_HERE
    ? { level: 'os', wrapper: 'unshare' }
    : { level: 'os', wrapper: 'sandbox-exec' };

  it.skipIf(!UNSHARE_HERE && !SANDBOX_HERE)(
    'a writer command cannot reach a non-loopback address, and can use loopback',
    () => {
      const remote = wrapCommand(choice, process.execPath, [stub, 'remote']);
      const remoteRun = spawnSync(remote.command, remote.args, {
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(remoteRun.status).not.toBe(0);
      expect(remoteRun.stdout).not.toContain('remote connected');

      const local = wrapCommand(choice, process.execPath, [stub, 'loopback']);
      const localRun = spawnSync(local.command, local.args, { encoding: 'utf8', timeout: 20_000 });
      expect(localRun.stdout).toContain('loopback ok');
      expect(localRun.status).toBe(0);
    },
  );
});
