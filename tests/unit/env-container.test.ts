import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as localGit from '../../src/main/git/git';
import { environmentFor, UNSUPPORTED_ENVIRONMENT, WSL_UNAVAILABLE } from '../../src/main/env';
import { WSL_EXE } from '../../src/main/env/wsl';
import {
  createdMs,
  dockerInvocation,
  execArgv,
  findContainer,
  isContainerFolder,
  parseDockerHost,
  userOfMetadata,
  DOCKER_PROGRAM,
  type ContainerTransport,
} from '../../src/main/env/container-transport';
import {
  CONNECT_SCRIPT,
  CONTAINER_RECONNECT_REASONS,
  createContainerEnvironment,
  FILES_SCRIPTS,
  KILL_SCRIPT,
} from '../../src/main/env/container';
import { LAUNCHER } from '../../src/main/env/launcher';
import type { Environment } from '../../src/main/env/types';
import {
  fakeDocker,
  type FakeContainer,
  type FakeDocker,
} from '../support/fake-container-transport';

// The dev container backend (D44, p4-env-container). The lookup and the docker command are checked on the fake
// docker transport (tests/support/fake-container-transport.ts), so no docker program starts in `pnpm test`.
// AC2 is the lookup and the user; AC3 is the docker command and the variables. Later tasks add the path, files,
// process, watch, git, connection and environmentFor cases to this file.

const FOLDER = '/home/dev/project';
const OTHER = '/home/dev/other';

let base: string;
let docker: FakeDocker;
let containers: FakeContainer[];

/** A labelled container for the lookup tests. Its mount is a folder under the test's temp base. */
function container(
  id: string,
  options: Partial<Omit<FakeContainer, 'id' | 'mount'>> = {},
): FakeContainer {
  const mount = join(base, id);
  mkdirSync(mount, { recursive: true });
  return {
    id,
    folder: options.folder ?? FOLDER,
    metadata: options.metadata ?? null,
    running: options.running ?? true,
    created: options.created ?? '2026-11-20 10:00:00 +0000 UTC',
    mount,
  };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'env-container-'));
  containers = [];
  docker = fakeDocker(containers);
});

afterEach(async () => {
  await docker.killAll();
  rmSync(base, { recursive: true, force: true });
});

describe('the lookup by label and the user (AC2)', () => {
  it('chooses a running container over a stopped one, and the newest among equals', async () => {
    containers.push(
      container('stopped-new', { running: false, created: '2026-11-26 09:00:00 +0000 UTC' }),
      container('running-old', { created: '2026-11-01 09:00:00 +0000 UTC' }),
      container('running-new', { created: '2026-11-25 09:00:00 +0000 UTC' }),
      container('other-folder', { folder: OTHER, created: '2026-11-26 12:00:00 +0000 UTC' }),
    );
    expect(await findContainer(docker, FOLDER)).toEqual({
      ok: true,
      id: 'running-new',
      running: true,
      user: null,
    });
  });

  it('chooses the newest stopped container when none runs, and reports it stopped', async () => {
    containers.push(
      container('stopped-old', { running: false, created: '2026-11-01 09:00:00 +0000 UTC' }),
      container('stopped-new', { running: false, created: '2026-11-25 09:00:00 +0000 UTC' }),
    );
    expect(await findContainer(docker, FOLDER)).toEqual({
      ok: true,
      id: 'stopped-new',
      running: false,
      user: null,
    });
  });

  it('reads the creation time of docker text, with its offset', () => {
    expect(createdMs('2026-11-26 10:00:00 +0200 CEST')).toBe(
      Date.parse('2026-11-26T10:00:00+02:00'),
    );
    expect(createdMs('not a time')).toBe(0);
  });

  it('takes remoteUser over containerUser, and the last entry of each', () => {
    const metadata = JSON.stringify([
      { remoteUser: 'first' },
      { containerUser: 'container-one' },
      { remoteUser: 'second', containerUser: 'container-two' },
      { containerUser: 'container-three' },
    ]);
    expect(userOfMetadata(metadata)).toBe('second');
    expect(userOfMetadata(JSON.stringify([{ containerUser: 'a' }, { containerUser: 'b' }]))).toBe(
      'b',
    );
    expect(userOfMetadata(JSON.stringify([{ containerUser: 'a' }, { remoteUser: 'dev' }]))).toBe(
      'dev',
    );
  });

  it('gives no user for a missing, empty or unreadable metadata label', () => {
    expect(userOfMetadata(null)).toBeNull();
    expect(userOfMetadata('not json')).toBeNull();
    expect(userOfMetadata(JSON.stringify({ remoteUser: 'dev' }))).toBeNull();
    expect(userOfMetadata(JSON.stringify([]))).toBeNull();
  });

  it('ignores a user that fails the POSIX user-name pattern, so no -u is given', async () => {
    for (const bad of ['Root', '1000', 'a b', 'x'.repeat(33), '-dash', 'dev$', '']) {
      expect(userOfMetadata(JSON.stringify([{ remoteUser: bad }]))).toBeNull();
    }
    containers.push(
      container('bad-user', {
        metadata: JSON.stringify([{ remoteUser: 'Bad User' }]),
      }),
    );
    expect(await findContainer(docker, FOLDER)).toEqual({
      ok: true,
      id: 'bad-user',
      running: true,
      user: null,
    });
    const exec = execArgv({
      id: 'bad-user',
      user: null,
      cwd: '/work',
      names: [],
      command: ['true'],
    });
    expect(exec).not.toContain('-u');
  });

  it('reads the user from the container metadata label on the lookup', async () => {
    containers.push(
      container('dev', {
        metadata: JSON.stringify([{ containerUser: 'root' }, { remoteUser: 'vscode' }]),
      }),
    );
    expect(await findContainer(docker, FOLDER)).toEqual({
      ok: true,
      id: 'dev',
      running: true,
      user: 'vscode',
    });
  });

  it('gives the cause when the engine is down, docker is missing, or no container has the label', async () => {
    containers.push(container('one'));
    docker = fakeDocker(containers, { engineDown: true });
    expect(await findContainer(docker, FOLDER)).toEqual({ ok: false, cause: 'engine-down' });

    docker = fakeDocker(containers, { dockerMissing: true });
    expect(await findContainer(docker, FOLDER)).toEqual({ ok: false, cause: 'docker-missing' });

    docker = fakeDocker(containers);
    expect(await findContainer(docker, '/home/dev/nothing')).toEqual({
      ok: false,
      cause: 'not-found',
    });
  });

  it('names the label and the folder in the listing, and never a shell', async () => {
    containers.push(container('one'));
    await findContainer(docker, FOLDER);
    expect(docker.calls[0]?.argv).toEqual([
      'ps',
      '-a',
      '--no-trunc',
      '--filter',
      `label=devcontainer.local_folder=${FOLDER}`,
      '--format',
      '{{json .}}',
    ]);
  });
});

describe('the docker command (AC3)', () => {
  it('the host form starts docker with the docker arguments and no shell', () => {
    const argv = ['exec', '-w', '/work', 'abc', 'true'];
    const invocation = dockerInvocation({ kind: 'host' }, argv, { SDD_X: 'value' });
    expect(invocation.file).toBe(DOCKER_PROGRAM);
    expect(invocation.args).toEqual(argv);
    expect(invocation.env['SDD_X']).toBe('value');
    expect(invocation.env['WSLENV']).toBeUndefined();
  });

  it('the WSL form starts wsl.exe with the same arguments, and names the crossing variables in WSLENV', () => {
    const argv = ['exec', '-e', 'SDD_X', 'abc', 'true'];
    const invocation = dockerInvocation({ kind: 'wsl', distribution: 'Ubuntu' }, argv, {
      SDD_X: 'value',
      SDD_Y: 'other',
    });
    expect(invocation.file).toBe(WSL_EXE);
    expect(invocation.args).toEqual(['-d', 'Ubuntu', '--exec', DOCKER_PROGRAM, ...argv]);
    expect(invocation.env['WSLENV']).toBe('SDD_X:SDD_Y');
    expect(invocation.args.join(' ')).not.toContain('value');
  });

  it('builds the exec form: flags, the user, the folder, the crossing names and the command', () => {
    expect(
      execArgv({
        id: 'abc',
        user: 'dev',
        cwd: '/work',
        names: ['SDD_X', 'GIT_TERMINAL_PROMPT'],
        stdin: true,
        command: ['sh', '-c', 'script', 'sh', '/work/file'],
      }),
    ).toEqual([
      'exec',
      '-i',
      '-u',
      'dev',
      '-w',
      '/work',
      '-e',
      'SDD_X',
      '-e',
      'GIT_TERMINAL_PROMPT',
      'abc',
      'sh',
      '-c',
      'script',
      'sh',
      '/work/file',
    ]);
  });

  it('accepts only the folder and host shapes the store and the factory accept', () => {
    expect(isContainerFolder('/home/dev/project')).toBe(true);
    expect(isContainerFolder('')).toBe(false);
    expect(isContainerFolder('-x')).toBe(false);
    expect(isContainerFolder('/a"b')).toBe(false);
    expect(isContainerFolder("/a'b")).toBe(false);
    expect(isContainerFolder('/a\nb')).toBe(false);
    expect(isContainerFolder('/a\u007fb')).toBe(false);
    expect(isContainerFolder('x'.repeat(1025))).toBe(false);
    expect(isContainerFolder('x'.repeat(1024))).toBe(true);
    expect(parseDockerHost({ kind: 'host' })).toEqual({ kind: 'host' });
    expect(parseDockerHost({ kind: 'host', distribution: 'Ubuntu' })).toBeNull();
    expect(parseDockerHost({ kind: 'wsl', distribution: 'Ubuntu' })).toEqual({
      kind: 'wsl',
      distribution: 'Ubuntu',
    });
    expect(parseDockerHost({ kind: 'wsl', distribution: '-bad' })).toBeNull();
    expect(parseDockerHost({ kind: 'podman' })).toBeNull();
  });
});

/** The Node code of a rejected call, or undefined when it resolved. */
async function codeOf(work: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await work();
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

/** A connected backend for the container with the given folder, on the given transport. */
async function connectedEnv(transport: ContainerTransport): Promise<Environment> {
  const env = createContainerEnvironment({
    descriptor: { folder: FOLDER, docker: { kind: 'host' } },
    transport,
  });
  expect(await env.connection.reconnect()).toEqual({ ok: true });
  return env;
}

/** The container's local folder (its `/`), for a test's own setup and checks. */
function rootOf(item: FakeContainer): string {
  return item.mount;
}

describe('the path part and the files part (AC4)', () => {
  it('uses path.posix with the / separator', () => {
    const env = createContainerEnvironment({
      descriptor: { folder: FOLDER, docker: { kind: 'host' } },
      transport: fakeDocker([]),
    });
    expect(env.path).toBe(posix);
    expect(env.path.sep).toBe('/');
  });

  it('refuses a relative or non-normalized path with ENOENT, and starts no process', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const before = docker.calls.length;
    const calls: Array<() => Promise<unknown>> = [
      () => env.files.stat('relative'),
      () => env.files.lstat('/a/../b'),
      () => env.files.realpath('relative'),
      () => env.files.access('relative', 'exists'),
      () => env.files.readFile('relative'),
      () => env.files.open('relative', 'r'),
      () => env.files.writeFile('relative', 'x'),
      () => env.files.mkdir('relative'),
      () => env.files.readdir('/a//b'),
      () => env.files.rm('relative', { force: true }),
      () => env.files.rmdir('relative'),
      () => env.files.rename('relative', '/x'),
      () => env.files.chmod('relative', 0o644),
      () => env.files.readlink('relative'),
      () => env.files.symlink('/x', 'relative'),
    ];
    for (const call of calls) expect(await codeOf(call)).toBe('ENOENT');
    expect(docker.calls.length).toBe(before);
  });

  it('gives the Node codes of the contract for each failure the scripts test', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    writeFileSync(join(root, 'file.txt'), 'hello');
    mkdirSync(join(root, 'dir'));
    writeFileSync(join(root, 'dir', 'child.txt'), 'x');
    expect(await codeOf(() => env.files.stat('/missing'))).toBe('ENOENT');
    expect(await codeOf(() => env.files.stat('/file.txt/x'))).toBe('ENOTDIR');
    expect(await codeOf(() => env.files.readFile('/dir'))).toBe('EISDIR');
    expect(await codeOf(() => env.files.mkdir('/dir'))).toBe('EEXIST');
    expect(await codeOf(() => env.files.rmdir('/dir'))).toBe('ENOTEMPTY');
    expect(await codeOf(() => env.files.access('/file.txt', 'execute'))).toBe('EACCES');
    expect(await codeOf(() => env.files.writeFile('/file.txt', 'x', { flag: 'wx' }))).toBe(
      'EEXIST',
    );
  });

  it('gives EIO for a failure the scripts do not name', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const broken: ContainerTransport = {
      run: async (argv, options) => {
        if (argv.includes(FILES_SCRIPTS.realpath)) {
          return {
            started: true,
            code: 2,
            signal: null,
            timedOut: false,
            aborted: false,
            stderr: Buffer.from('something odd\n'),
          };
        }
        return docker.run(argv, options);
      },
    };
    const env = await connectedEnv(broken);
    expect(await codeOf(() => env.files.realpath('/file.txt'))).toBe('EIO');
  });

  it('reads a file with a cap: a larger file is EFBIG, and head reads no further than the cap plus one', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    writeFileSync(join(root, 'big.txt'), '0123456789');
    writeFileSync(join(root, 'small.txt'), '0123');
    expect(await codeOf(() => env.files.readFile('/big.txt', { maxBytes: 4 }))).toBe('EFBIG');
    expect((await env.files.readFile('/small.txt', { maxBytes: 4 })).toString()).toBe('0123');
    const readArgs = docker.calls
      .filter((call) => call.argv.includes(FILES_SCRIPTS.readCapped))
      .map((call) => call.argv[call.argv.length - 1]);
    // The cap is 4, so head is asked for 5 bytes: one more than the cap, never more.
    expect(readArgs).toContain('5');
    expect(readArgs.every((value) => value === '5')).toBe(true);
  });

  it('reads a file without a cap, and reads byte ranges through a handle', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    writeFileSync(join(root, 'text.txt'), 'hello world');
    expect((await env.files.readFile('/text.txt')).toString()).toBe('hello world');
    const handle = await env.files.open('/text.txt', 'r');
    const buffer = Buffer.alloc(5);
    const read = await handle.read(buffer, 0, 5, 6);
    expect(read.bytesRead).toBe(5);
    expect(buffer.toString()).toBe('world');
    await handle.close();
  });

  it('writes the bytes on stdin, with no value in an argument array', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    await env.files.writeFile('/out.txt', 'line one\nline two');
    await env.files.writeFile('/bytes.bin', Buffer.from([0, 1, 2, 255]));
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('line one\nline two');
    expect([...readFileSync(join(root, 'bytes.bin'))]).toEqual([0, 1, 2, 255]);
    const write = docker.calls.find((call) => call.argv.includes(FILES_SCRIPTS.write));
    expect(write?.argv).toContain('-i');
    expect(write?.argv.join(' ')).not.toContain('line one');
    await expect(env.files.writeFile('/exists.txt', 'x', { flag: 'wx' })).resolves.toBeUndefined();
    expect(await codeOf(() => env.files.writeFile('/exists.txt', 'y', { flag: 'wx' }))).toBe(
      'EEXIST',
    );
    expect(existsSync(join(root, 'exists.txt'))).toBe(true);
  });

  it('lists folders with the type of each entry, and makes, moves, removes and chmods paths', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    mkdirSync(join(root, 'folder'));
    writeFileSync(join(root, 'plain.txt'), 'x');
    const entries = await env.files.readdir('/');
    const types = Object.fromEntries(
      entries.map((entry) => [
        entry.name,
        entry.isDirectory()
          ? 'dir'
          : entry.isFile()
            ? 'file'
            : entry.isSymbolicLink()
              ? 'link'
              : 'other',
      ]),
    );
    expect(types).toEqual({ folder: 'dir', 'plain.txt': 'file' });
    await env.files.mkdir('/deep/er/still', { recursive: true });
    expect(existsSync(join(root, 'deep', 'er', 'still'))).toBe(true);
    await env.files.rename('/plain.txt', '/moved.txt');
    expect(existsSync(join(root, 'moved.txt'))).toBe(true);
    await env.files.chmod('/moved.txt', 0o600);
    await env.files.rm('/deep', { recursive: true });
    expect(existsSync(join(root, 'deep'))).toBe(false);
    await env.files.rm('/never', { force: true });
    expect(await codeOf(() => env.files.rm('/never'))).toBe('ENOENT');
  });

  it.skipIf(process.platform === 'win32')(
    'makes a link and reads it back as the container path',
    async () => {
      containers.push(container('c1'));
      docker = fakeDocker(containers);
      const env = await connectedEnv(docker);
      const root = rootOf(containers[0] as FakeContainer);
      writeFileSync(join(root, 'target.txt'), 'x');
      await env.files.symlink('/target.txt', '/link.txt');
      expect(await env.files.readlink('/link.txt')).toBe('/target.txt');
      expect(await env.files.realpath('/link.txt')).toBe('/target.txt');
      expect(existsSync(join(root, 'link.txt'))).toBe(true);
      expect(existsSync(root)).toBe(true);
    },
  );
});

describe('the process part (AC5)', () => {
  const NODE = process.execPath;
  const LAUNCH_CWD = '/work';
  const KILL = KILL_SCRIPT;

  beforeEach(() => {
    containers.length = 0;
  });

  it('starts the program with the exec form and the user from the lookup, and no shell', async () => {
    containers.push(container('c1', { metadata: JSON.stringify([{ remoteUser: 'dev' }]) }));
    docker = fakeDocker(containers, {
      program: () => ({ chunks: ['ok'] }),
    });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    const outcome = await env.process.spawn(NODE, ['-e', 'process.exit(0)'], {
      cwd: LAUNCH_CWD,
      env: {},
      timeoutMs: 10_000,
      network: 'normal',
    });
    expect(outcome).toEqual({
      started: true,
      code: 0,
      signal: null,
      timedOut: false,
      aborted: false,
    });
    const exec = docker.calls.find(
      (call) => call.argv[0] === 'exec' && call.argv.includes(LAUNCHER),
    );
    expect(exec?.argv).toEqual([
      'exec',
      '-u',
      'dev',
      '-w',
      LAUNCH_CWD,
      'c1',
      'sh',
      '-c',
      LAUNCHER,
      'sh',
      NODE,
      '-e',
      'process.exit(0)',
    ]);
  });

  it('passes only the changed variables, never PATH, and the marker line is hidden', async () => {
    containers.push(container('c1', { metadata: JSON.stringify([{ remoteUser: 'dev' }]) }));
    docker = fakeDocker(containers, {
      program: () => ({ chunks: ['answer'] }),
    });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    const seen: string[] = [];
    const outcome = await env.process.spawn(NODE, ['-e', 'x'], {
      cwd: LAUNCH_CWD,
      env: { PATH: '/bin', SDD_X: 'value' },
      timeoutMs: 10_000,
      network: 'normal',
      onOutput: (chunk) => seen.push(chunk.toString('utf8')),
    });
    expect(outcome.started).toBe(true);
    const exec = docker.calls.find((call) => call.argv.includes(LAUNCHER));
    expect(exec?.argv).toContain('SDD_X');
    expect(exec?.argv).not.toContain('PATH');
    expect(exec?.argv.join(' ')).not.toContain('value');
    expect(exec?.env).toEqual({ SDD_X: 'value' });
    expect(seen.join('')).toBe('answer');
    expect(seen.join('')).not.toContain('SDD-GROUP-');
  });

  it('runs the group kill before the result resolves, on a timeout and on an abort', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers, { stall: true });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    const timedOut = await env.process.spawn(NODE, ['-e', 'x'], {
      cwd: LAUNCH_CWD,
      env: {},
      timeoutMs: 150,
      network: 'normal',
    });
    expect(timedOut).toMatchObject({ started: true, timedOut: true, aborted: false });
    const killAfterTimeout = docker.calls.filter((call) => call.argv.includes(KILL));
    expect(killAfterTimeout.length).toBe(1);
    expect(killAfterTimeout[0]?.argv.join(' ')).toContain('-91000');

    const controller = new AbortController();
    const aborting = env.process.spawn(NODE, ['-e', 'x'], {
      cwd: LAUNCH_CWD,
      env: {},
      timeoutMs: 10_000,
      network: 'normal',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const aborted = await aborting;
    expect(aborted).toMatchObject({ started: true, aborted: true, timedOut: false });
    expect(docker.calls.filter((call) => call.argv.includes(KILL)).length).toBe(2);
  });

  it('gives { started: false } while unreachable, with no process and no call', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = createContainerEnvironment({
      descriptor: { folder: FOLDER, docker: { kind: 'host' } },
      transport: docker,
    });
    const before = docker.calls.length;
    expect(env.connection.state()).toBe('unreachable');
    expect(
      await env.process.spawn(NODE, ['-e', 'x'], {
        cwd: LAUNCH_CWD,
        env: {},
        timeoutMs: 1_000,
        network: 'normal',
      }),
    ).toEqual({ started: false });
    expect(docker.calls.length).toBe(before);
  });

  it('gives the platform read at connect, and a network level that agrees with the spawn', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers, {
      probe: false,
      program: () => ({ chunks: [] }),
    });
    const env = await connectedEnv(docker);
    expect(env.process.platform).toBe('linux');
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    expect(await env.process.networkLevel()).toBe('proxy-only');
    const writer = await env.process.spawn(NODE, ['-e', 'x'], {
      cwd: LAUNCH_CWD,
      env: {},
      timeoutMs: 10_000,
      network: 'none',
    });
    expect(writer).toMatchObject({ started: true, network: 'proxy-only' });
    expect(docker.calls.filter((call) => call.argv.includes('unshare')).length).toBe(1);
  });

  it('gives the os level when the probe works, and wraps the writer command with unshare', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers, {
      probe: true,
      program: () => ({ chunks: [] }),
    });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    expect(await env.process.networkLevel()).toBe('os');
    const writer = await env.process.spawn(NODE, ['-e', 'x'], {
      cwd: LAUNCH_CWD,
      env: {},
      timeoutMs: 10_000,
      network: 'none',
    });
    expect(writer).toMatchObject({ started: true, network: 'os' });
    const exec = docker.calls.find((call) => call.argv.includes(LAUNCHER));
    expect(exec?.argv.join(' ')).toContain('unshare');
  });
});

describe('environmentFor for a dev container (AC8, D44)', () => {
  it('builds the backend for a valid descriptor, and starts no process', () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const made = environmentFor(
      { kind: 'container', folder: FOLDER, docker: { kind: 'host' } },
      { containerTransportFor: () => docker },
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.env.connection.state()).toBe('unreachable');
    expect(docker.calls).toEqual([]);
  });

  it('refuses a malformed descriptor with UNSUPPORTED_ENVIRONMENT, on any platform', () => {
    const bad = [
      { kind: 'container', folder: '-x', docker: { kind: 'host' } },
      { kind: 'container', folder: '', docker: { kind: 'host' } },
      { kind: 'container', folder: FOLDER },
      { kind: 'container', folder: FOLDER, docker: { kind: 'host', distribution: 'Ubuntu' } },
      { kind: 'container', folder: FOLDER, docker: { kind: 'wsl', distribution: '-bad' } },
    ];
    for (const descriptor of bad) {
      expect(environmentFor(descriptor, { platform: 'win32' })).toEqual({
        ok: false,
        reason: UNSUPPORTED_ENVIRONMENT,
      });
    }
  });

  it('refuses the WSL Docker host off Windows with WSL_UNAVAILABLE, and builds it on Windows', () => {
    const descriptor = {
      kind: 'container',
      folder: FOLDER,
      docker: { kind: 'wsl', distribution: 'Ubuntu' },
    };
    expect(environmentFor(descriptor, { platform: 'linux' })).toEqual({
      ok: false,
      reason: WSL_UNAVAILABLE,
    });
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const onWindows = environmentFor(descriptor, {
      platform: 'win32',
      containerTransportFor: () => docker,
    });
    expect(onWindows.ok).toBe(true);
    expect(docker.calls).toEqual([]);
  });
});

/** Waits until a condition holds, polling every few milliseconds, or fails after the limit. */
async function waitUntil(condition: () => boolean, limitMs = 3_000): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the condition did not hold in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A backend for a folder with the given container, made and not yet connected. */
function unconnectedEnv(transport: ContainerTransport, folder = FOLDER): Environment {
  return createContainerEnvironment({
    descriptor: { folder, docker: { kind: 'host' } },
    transport,
  });
}

describe('watching, git, connection and lost containers (AC6, AC7)', () => {
  it('reports the changes in one folder through the shared poller, and close stops them', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = createContainerEnvironment({
      descriptor: { folder: FOLDER, docker: { kind: 'host' } },
      transport: docker,
      pollMs: 30,
    });
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    const root = rootOf(containers[0] as FakeContainer);
    const events: Array<[string, string | null]> = [];
    const errors: Error[] = [];
    const handle = env.watch.watchDir(
      '/',
      (type, name) => events.push([type, name]),
      (error) => errors.push(error),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeFileSync(join(root, 'new.txt'), 'x');
    await waitUntil(() => events.some((event) => event[0] === 'rename' && event[1] === 'new.txt'));
    writeFileSync(join(root, 'new.txt'), 'a longer text');
    await waitUntil(() => events.some((event) => event[0] === 'change' && event[1] === 'new.txt'));
    handle.close();
    const seen = events.length;
    writeFileSync(join(root, 'after.txt'), 'y');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.length).toBe(seen);
    expect(errors).toEqual([]);
  });

  it('runs the git part through the same argument lists, and gives the local results', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    const root = rootOf(containers[0] as FakeContainer);
    const work = join(root, 'work');
    mkdirSync(work);
    const git = (args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], {
        cwd: work,
        encoding: 'utf8',
        windowsHide: true,
      });
    git(['init', '-q', '-b', 'main']);
    writeFileSync(join(work, 'README.md'), '# x\n');
    git(['add', '--', 'README.md']);
    git(['commit', '-q', '-m', 'Initial']);
    writeFileSync(join(work, 'new.txt'), 'y');
    expect(await env.git.currentBranch('/work')).toEqual(await localGit.currentBranch(work));
    expect(await env.git.currentBranch('/work')).toEqual({ ok: true, value: { branch: 'main' } });
    expect(await env.git.changedPaths('/work')).toEqual({ ok: true, value: ['new.txt'] });
    expect(await env.git.changedPaths('/work')).toEqual(await localGit.changedPaths(work));
    expect(await env.git.defaultBranch('/work')).toEqual(await localGit.defaultBranch(work));
    expect(docker.calls.some((call) => call.argv.includes(LAUNCHER))).toBe(true);
  });

  it('gives git-missing for exit code 127', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers, { program: () => ({ code: 127 }) });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    expect(await env.git.currentBranch('/work')).toEqual({ ok: false, code: 'git-missing' });
  });

  it('runs the group kill on a git timeout before the result resolves', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers, { stall: true });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    vi.useFakeTimers();
    try {
      const pending = env.git.currentBranch('/work');
      // The stalled program is registered once its exec is made; wait for that before the clock moves.
      for (
        let turn = 0;
        turn < 500 && !docker.calls.some((call) => call.argv.includes(LAUNCHER));
        turn += 1
      ) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await pending).toEqual({ ok: false, code: 'timeout' });
      expect(docker.calls.some((call) => call.argv.includes(KILL_SCRIPT))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new backend is unreachable and starts no process', () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = unconnectedEnv(docker);
    expect(env.connection.state()).toBe('unreachable');
    expect(docker.calls).toEqual([]);
  });

  it('connects a running container, and starts a stopped one with docker start', async () => {
    containers.push(container('c1', { running: false }));
    docker = fakeDocker(containers);
    const env = unconnectedEnv(docker);
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    expect(env.connection.state()).toBe('connected');
    expect(docker.calls.some((call) => call.argv[0] === 'start' && call.argv[1] === 'c1')).toBe(
      true,
    );
    expect(env.process.platform).toBe('linux');
  });

  it('refuses each failed connect with its fixed reason, which names no folder, container or user', async () => {
    const cases: Array<[keyof typeof CONTAINER_RECONNECT_REASONS, () => Promise<unknown>]> = [
      [
        'docker-missing',
        () => {
          containers.push(container('c1'));
          docker = fakeDocker(containers, { dockerMissing: true });
          return unconnectedEnv(docker).connection.reconnect();
        },
      ],
      [
        'engine-down',
        () => {
          containers.push(container('c1'));
          docker = fakeDocker(containers, { engineDown: true });
          return unconnectedEnv(docker).connection.reconnect();
        },
      ],
      [
        'not-found',
        () => {
          containers.push(container('c1'));
          docker = fakeDocker(containers);
          return unconnectedEnv(docker, '/home/dev/none').connection.reconnect();
        },
      ],
      [
        'start-failed',
        () => {
          containers.push(
            container('c1', {
              running: false,
              metadata: JSON.stringify([{ remoteUser: 'devuser' }]),
            }),
          );
          docker = fakeDocker(containers, { startFails: true });
          return unconnectedEnv(docker).connection.reconnect();
        },
      ],
      [
        'not-linux',
        () => {
          containers.push(container('c1'));
          docker = fakeDocker(containers, { uname: 'Darwin' });
          return unconnectedEnv(docker).connection.reconnect();
        },
      ],
      [
        'no-setsid',
        () => {
          containers.push(container('c1'));
          docker = fakeDocker(containers, { setsid: false });
          return unconnectedEnv(docker).connection.reconnect();
        },
      ],
    ];
    for (const [cause, attempt] of cases) {
      containers.length = 0;
      const result = (await attempt()) as { ok: boolean; reason: string };
      expect(result, cause).toEqual({ ok: false, reason: CONTAINER_RECONNECT_REASONS[cause] });
      expect(result.reason).not.toContain(FOLDER);
      expect(result.reason).not.toContain('c1');
      expect(result.reason).not.toContain('devuser');
    }
  });

  it('a container that stops moves the backend to unreachable once, refuses every call, and reconnect brings it back', async () => {
    containers.push(container('c1', { metadata: JSON.stringify([{ remoteUser: 'dev' }]) }));
    docker = fakeDocker(containers, { program: () => ({ chunks: ['ok'] }) });
    const env = await connectedEnv(docker);
    const states: string[] = [];
    const stop = env.connection.onChange((state) => states.push(state));
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    docker.stopContainer('c1');
    expect(await codeOf(() => env.files.stat('/work'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.readFile('/work'))).toBe('ENOTCONN');
    expect(env.connection.state()).toBe('unreachable');
    expect(states).toEqual(['unreachable']);

    const before = docker.calls.length;
    expect(
      await env.process.spawn(process.execPath, ['-e', 'x'], {
        cwd: '/work',
        env: {},
        timeoutMs: 1_000,
        network: 'normal',
      }),
    ).toEqual({ started: false });
    expect(await env.git.currentBranch('/work')).toEqual({ ok: false, code: 'failed' });
    expect(docker.calls.length).toBe(before);
    expect(await codeOf(() => env.files.stat('/work'))).toBe('ENOTCONN');
    expect(states).toEqual(['unreachable']);

    const errors: Error[] = [];
    const handle = env.watch.watchDir(
      '/work',
      () => undefined,
      (error) => errors.push(error),
    );
    await waitUntil(() => errors.length > 0);
    handle.close();
    expect(errors.length).toBe(1);

    docker.runContainer('c1');
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    expect(states).toEqual(['unreachable', 'connected']);
    stop();
  });

  it('an engine that goes down during a call is a lost connection', async () => {
    containers.push(container('c1'));
    docker = fakeDocker(containers);
    const env = await connectedEnv(docker);
    docker.script.engineDown = true;
    expect(await codeOf(() => env.files.stat('/'))).toBe('ENOTCONN');
    expect(env.connection.state()).toBe('unreachable');
  });
});

/** A transport that answers the calls `when` picks with the given stderr and code, and passes the rest on. */
function answering(
  base: FakeDocker,
  when: (argv: readonly string[]) => boolean,
  answer: { code: number; stderr: string },
): ContainerTransport {
  return {
    run: async (argv, options) => {
      if (!when(argv)) return base.run(argv, options);
      return {
        started: true,
        code: answer.code,
        signal: null,
        timedOut: false,
        aborted: false,
        stderr: Buffer.from(answer.stderr),
      };
    },
  };
}

describe('the group kill form and the gone-container lines (AC5, AC7, revision 1)', () => {
  it('the kill exec runs kill -s KILL -- -<pgid>, the POSIX form that dash accepts', async () => {
    expect(KILL_SCRIPT).toBe('kill -s KILL -- "$1"');
    containers.push(container('c1'));
    docker = fakeDocker(containers, { stall: true });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    await env.process.spawn(process.execPath, ['-e', 'x'], {
      cwd: '/work',
      env: {},
      timeoutMs: 150,
      network: 'normal',
    });
    const kill = docker.calls.find((call) => call.argv.includes(KILL_SCRIPT));
    expect(kill?.argv.slice(-5)).toEqual(['sh', '-c', KILL_SCRIPT, 'sh', '-91000']);
  });

  it('a program whose own stderr, after the marker, prints a gone phrase leaves the backend connected', async () => {
    containers.push(container('c1'));
    const stderr = [
      'Error response from daemon: Container c1 is not running',
      'Error: No such container: x',
      'Cannot connect to the Docker daemon at unix:///none',
      '',
    ].join('\n');
    docker = fakeDocker(containers, { program: () => ({ code: 1, stderr }) });
    const env = await connectedEnv(docker);
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    const states: string[] = [];
    env.connection.onChange((state) => states.push(state));
    expect(
      await env.process.spawn(process.execPath, ['-e', 'x'], {
        cwd: '/work',
        env: {},
        timeoutMs: 10_000,
        network: 'normal',
      }),
    ).toEqual({ started: true, code: 1, signal: null, timedOut: false, aborted: false });
    expect(await env.git.currentBranch('/work')).toEqual({ ok: false, code: 'failed' });
    expect(env.connection.state()).toBe('connected');
    expect(states).toEqual([]);
  });

  it('a docker gone line before the marker moves a spawn to unreachable, once', async () => {
    containers.push(container('c1'));
    const base = fakeDocker(containers);
    const env = await connectedEnv(
      answering(base, (argv) => argv.includes(LAUNCHER), {
        code: 1,
        stderr: 'Error response from daemon: Container c1 is not running\n',
      }),
    );
    const states: string[] = [];
    env.connection.onChange((state) => states.push(state));
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    expect(
      await env.process.spawn(process.execPath, ['-e', 'x'], {
        cwd: '/work',
        env: {},
        timeoutMs: 10_000,
        network: 'normal',
      }),
    ).toEqual({ started: false });
    expect(env.connection.state()).toBe('unreachable');
    expect(states).toEqual(['unreachable']);
  });

  it('a docker gone line in a git call moves the backend to unreachable', async () => {
    containers.push(container('c1'));
    const base = fakeDocker(containers);
    const env = await connectedEnv(
      answering(base, (argv) => argv.includes(LAUNCHER), {
        code: 1,
        stderr: 'Error: No such container: c1\n',
      }),
    );
    mkdirSync(join(rootOf(containers[0] as FakeContainer), 'work'), { recursive: true });
    expect(await env.git.currentBranch('/work')).toEqual({ ok: false, code: 'failed' });
    expect(env.connection.state()).toBe('unreachable');
  });

  it('a gone line in the stderr of a files call moves the backend to unreachable, and the call is ENOTCONN', async () => {
    containers.push(container('c1'));
    const base = fakeDocker(containers);
    const env = await connectedEnv(
      answering(base, (argv) => argv.includes(FILES_SCRIPTS.statFollow), {
        code: 1,
        stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n',
      }),
    );
    const states: string[] = [];
    env.connection.onChange((state) => states.push(state));
    expect(await codeOf(() => env.files.stat('/'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.stat('/'))).toBe('ENOTCONN');
    expect(states).toEqual(['unreachable']);
  });

  it('a gone line in the connect check leaves the backend unreachable with its fixed reason', async () => {
    containers.push(container('c1'));
    const base = fakeDocker(containers);
    const env = createContainerEnvironment({
      descriptor: { folder: FOLDER, docker: { kind: 'host' } },
      transport: answering(base, (argv) => argv.includes(CONNECT_SCRIPT), {
        code: 1,
        stderr: 'Error response from daemon: Container c1 is not running\n',
      }),
    });
    expect(await env.connection.reconnect()).toEqual({
      ok: false,
      reason: CONTAINER_RECONNECT_REASONS['start-failed'],
    });
    expect(env.connection.state()).toBe('unreachable');
  });

  it('a phrase without the docker prefix in a files stderr is not a gone line: the backend stays connected', async () => {
    containers.push(container('c1'));
    const base = fakeDocker(containers);
    const env = await connectedEnv(
      answering(base, (argv) => argv.includes(FILES_SCRIPTS.statFollow), {
        code: 1,
        stderr: 'the service is not running\nNo such container\n',
      }),
    );
    expect(await codeOf(() => env.files.stat('/'))).toBe('EIO');
    expect(env.connection.state()).toBe('connected');
  });
});
