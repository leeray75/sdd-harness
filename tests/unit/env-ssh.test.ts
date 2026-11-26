import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as localGit from '../../src/main/git/git';
import type { SshServer } from '../../src/main/projects/servers';
import { environmentFor, UNSUPPORTED_ENVIRONMENT } from '../../src/main/env';
import { createSshEnvironment, SSH_RECONNECT_REASONS } from '../../src/main/env/ssh';
import { secretName, spawnLine, UNSHARE_PROBE_LINE } from '../../src/main/env/ssh-command';
import { checkHostKey, fingerprintOf, signInFor } from '../../src/main/env/ssh-transport';
import { createServerStore } from '../../src/main/projects/servers';
import type { SecretStore } from '../../src/main/secrets/store';
import type { Environment } from '../../src/main/env/types';
import { fakeSshTransport, type FakeSsh } from '../support/fake-ssh-transport';
import { splitWords } from '../support/posix-words';

// The SSH backend (D43, p4-env-ssh). Every check runs on the fake transport over a temp folder that stands
// for the remote `/`, so no connection is made. AC4 covers the path part and the files part; the process,
// watch, git, connection and lost-connection cases are added with their parts.

const SERVER: SshServer = {
  id: '6f1c2b8e-1d2a-4c3b-9a8f-0123456789ab',
  name: 'Test server',
  host: 'server.example',
  port: 22,
  user: 'deploy',
  auth: { method: 'agent' },
  hostKey: null,
};

/** A program that exists on this machine, run as the program of a launched request. */
const NODE = process.execPath;

let base: string;
let remote: string;
let transport: FakeSsh;
let env: Environment;

beforeEach(async () => {
  base = mkdtempSync(join(realpathSync(tmpdir()), 'env-ssh-'));
  remote = join(base, 'remote');
  mkdirSync(remote, { recursive: true });
  transport = fakeSshTransport(remote);
  await transport.connect();
  env = createSshEnvironment({ server: SERVER, transport });
});

afterEach(async () => {
  await transport.killAll();
  rmSync(base, { recursive: true, force: true });
});

/** The local path of a remote path, for a test's own setup and checks (not the backend's mapping). */
function local(remotePath: string): string {
  return join(remote, ...remotePath.split('/').filter((segment) => segment !== ''));
}

/** The Node code of a rejected call, or undefined when it resolved. */
async function codeOf(work: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await work();
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

describe('the path part is path.posix (AC4)', () => {
  it('uses path.posix with the / separator', () => {
    expect(env.path).toBe(posix);
    expect(env.path.sep).toBe('/');
    expect(env.path.join('/srv', 'app')).toBe('/srv/app');
    expect(env.path.isAbsolute('C:\\x')).toBe(false);
  });

  it('refuses every files method for a relative path with ENOENT', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => env.files.stat('relative'),
      () => env.files.lstat('relative'),
      () => env.files.realpath('relative'),
      () => env.files.access('relative', 'exists'),
      () => env.files.readFile('relative'),
      () => env.files.open('relative', 'r'),
      () => env.files.writeFile('relative', 'x'),
      () => env.files.mkdir('relative'),
      () => env.files.readdir('relative'),
      () => env.files.rm('relative', { force: true }),
      () => env.files.rmdir('relative'),
      () => env.files.rename('relative', '/x'),
      () => env.files.chmod('relative', 0o644),
      () => env.files.readlink('relative'),
      () => env.files.symlink('/x', 'relative'),
    ];
    for (const call of calls) {
      expect(await codeOf(call)).toBe('ENOENT');
    }
  });
});

describe('stat, listing and links (AC4)', () => {
  it('stat and lstat give the type, and readdir gives each entry its type', async () => {
    mkdirSync(local('/app/src'), { recursive: true });
    writeFileSync(local('/app/readme.md'), 'hello');
    const file = await env.files.stat('/app/readme.md');
    expect(file.isFile()).toBe(true);
    expect(file.size).toBe(5);
    expect((await env.files.stat('/app/src')).isDirectory()).toBe(true);
    const entries = await env.files.readdir('/app');
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(byName['readme.md']?.isFile()).toBe(true);
    expect(byName['src']?.isDirectory()).toBe(true);
  });

  it('a missing path is ENOENT for stat, lstat, realpath, readdir and readlink', async () => {
    expect(await codeOf(() => env.files.stat('/missing'))).toBe('ENOENT');
    expect(await codeOf(() => env.files.lstat('/missing'))).toBe('ENOENT');
    expect(await codeOf(() => env.files.realpath('/missing'))).toBe('ENOENT');
    expect(await codeOf(() => env.files.readdir('/missing'))).toBe('ENOENT');
    expect(await codeOf(() => env.files.readlink('/missing'))).toBe('ENOENT');
  });

  it('readdir of a file is ENOTDIR', async () => {
    writeFileSync(local('/plain.txt'), 'x');
    expect(await codeOf(() => env.files.readdir('/plain.txt'))).toBe('ENOTDIR');
  });

  it('realpath gives the remote path, not the local one', async () => {
    mkdirSync(local('/app/real'), { recursive: true });
    expect(await env.files.realpath('/app/real')).toBe('/app/real');
  });

  it('access: exists is ENOENT for a missing path, and execute uses the mode bits for this user', async () => {
    writeFileSync(local('/bin.sh'), '#!/bin/sh\n');
    await expect(env.files.access('/bin.sh', 'exists')).resolves.toBeUndefined();
    expect(await codeOf(() => env.files.access('/none', 'exists'))).toBe('ENOENT');

    // The fake's own modes are the platform's, so the test sets the attributes the server would send.
    const realStat = transport.sftp.stat.bind(transport.sftp);
    let mode = 0o100640;
    transport.sftp.stat = async (path) => ({
      ...(await realStat(path)),
      mode,
      uid: 1000,
      gid: 1000,
    });
    expect(await codeOf(() => env.files.access('/bin.sh', 'execute'))).toBe('EACCES');
    mode = 0o100750;
    await expect(env.files.access('/bin.sh', 'execute')).resolves.toBeUndefined();
    mode = 0o100604;
    expect(await codeOf(() => env.files.access('/bin.sh', 'execute'))).toBe('EACCES');
  });
});

describe('reads and writes (AC4)', () => {
  it('writes and reads back a file, and refuses wx over an existing file with EEXIST', async () => {
    await env.files.writeFile('/notes.txt', 'first');
    expect(readFileSync(local('/notes.txt'), 'utf8')).toBe('first');
    expect((await env.files.readFile('/notes.txt')).toString('utf8')).toBe('first');
    expect(await codeOf(() => env.files.writeFile('/notes.txt', 'second', { flag: 'wx' }))).toBe(
      'EEXIST',
    );
  });

  it('writing into a folder is EISDIR, and reading a folder is EISDIR', async () => {
    mkdirSync(local('/folder'));
    expect(await codeOf(() => env.files.writeFile('/folder', 'x'))).toBe('EISDIR');
    expect(await codeOf(() => env.files.readFile('/folder'))).toBe('EISDIR');
  });

  it('writing under a file is ENOTDIR, and a missing folder is ENOENT', async () => {
    writeFileSync(local('/plain.txt'), 'x');
    expect(await codeOf(() => env.files.writeFile('/plain.txt/inner', 'x'))).toBe('ENOTDIR');
    expect(await codeOf(() => env.files.writeFile('/no-folder/inner', 'x'))).toBe('ENOENT');
  });

  it('a read with a cap gives EFBIG for a larger file, and keeps a file at the cap', async () => {
    writeFileSync(local('/big.bin'), Buffer.alloc(100, 1));
    writeFileSync(local('/edge.bin'), Buffer.alloc(10, 2));
    const before = transport.bytesServed;
    expect(await codeOf(() => env.files.readFile('/big.bin', { maxBytes: 10 }))).toBe('EFBIG');
    // The size is read from the handle first, so a larger file is refused before its bytes are read.
    expect(transport.bytesServed - before).toBeLessThanOrEqual(11);
    expect((await env.files.readFile('/edge.bin', { maxBytes: 10 })).length).toBe(10);
  });

  it('a read with a cap reads at most maxBytes + 1 bytes when the size lies', async () => {
    writeFileSync(local('/grows.bin'), Buffer.alloc(50, 3));
    const realOpen = transport.sftp.open.bind(transport.sftp);
    transport.sftp.open = async (path, flags) => {
      const file = await realOpen(path, flags);
      // A file whose size reads as 0 while it holds 50 bytes: the read itself must refuse.
      return { ...file, stat: async () => ({ ...(await file.stat()), size: 0 }) };
    };
    const before = transport.bytesServed;
    expect(await codeOf(() => env.files.readFile('/grows.bin', { maxBytes: 10 }))).toBe('EFBIG');
    expect(transport.bytesServed - before).toBeLessThanOrEqual(11);
  });

  it('open reads a byte range through a handle', async () => {
    writeFileSync(local('/range.txt'), 'abcdefgh');
    const handle = await env.files.open('/range.txt', 'r');
    const buffer = Buffer.alloc(3);
    const result = await handle.read(buffer, 0, 3, 2);
    await handle.close();
    expect(result.bytesRead).toBe(3);
    expect(buffer.toString('utf8')).toBe('cde');
  });
});

describe('folders (AC4)', () => {
  it('mkdir: an existing folder is EEXIST, a file in the way is ENOTDIR, recursive makes the chain', async () => {
    await env.files.mkdir('/a/b/c', { recursive: true });
    expect((await env.files.stat('/a/b/c')).isDirectory()).toBe(true);
    expect(await codeOf(() => env.files.mkdir('/a/b'))).toBe('EEXIST');
    writeFileSync(local('/a/file'), 'x');
    expect(await codeOf(() => env.files.mkdir('/a/file/inner'))).toBe('ENOTDIR');
    expect(await codeOf(() => env.files.mkdir('/a/file', { recursive: true }))).toBe('EEXIST');
    await env.files.mkdir('/a/b', { recursive: true });
  });

  it('rmdir: a non-empty folder is ENOTEMPTY, a file is ENOTDIR, a missing path is ENOENT', async () => {
    mkdirSync(local('/full'));
    writeFileSync(local('/full/x'), 'x');
    writeFileSync(local('/plain'), 'x');
    expect(await codeOf(() => env.files.rmdir('/full'))).toBe('ENOTEMPTY');
    expect(await codeOf(() => env.files.rmdir('/plain'))).toBe('ENOTDIR');
    expect(await codeOf(() => env.files.rmdir('/nothing'))).toBe('ENOENT');
    mkdirSync(local('/empty'));
    await env.files.rmdir('/empty');
    expect(await codeOf(() => env.files.stat('/empty'))).toBe('ENOENT');
  });

  it('rm: recursive removes a tree, force is quiet for a missing path, a folder needs recursive', async () => {
    mkdirSync(local('/tree/inner'), { recursive: true });
    writeFileSync(local('/tree/inner/leaf'), 'x');
    expect(await codeOf(() => env.files.rm('/tree', {}))).toBe('EISDIR');
    await env.files.rm('/tree', { recursive: true });
    expect(await codeOf(() => env.files.stat('/tree'))).toBe('ENOENT');
    await expect(env.files.rm('/tree', { force: true })).resolves.toBeUndefined();
    expect(await codeOf(() => env.files.rm('/tree', {}))).toBe('ENOENT');
  });
});

describe('rename, chmod and links (AC4)', () => {
  it('rename over an existing file works with the posix-rename extension', async () => {
    writeFileSync(local('/from.txt'), 'new');
    writeFileSync(local('/to.txt'), 'old');
    await env.files.rename('/from.txt', '/to.txt');
    expect(readFileSync(local('/to.txt'), 'utf8')).toBe('new');
  });

  it('rename over an existing file works without the extension, by removing the target first', async () => {
    transport.script.posixRename = false;
    writeFileSync(local('/from.txt'), 'new');
    writeFileSync(local('/to.txt'), 'old');
    await env.files.rename('/from.txt', '/to.txt');
    expect(readFileSync(local('/to.txt'), 'utf8')).toBe('new');
  });

  it('rename onto a folder is EEXIST, and a missing source is ENOENT', async () => {
    writeFileSync(local('/source.txt'), 'x');
    mkdirSync(local('/target-folder'));
    expect(await codeOf(() => env.files.rename('/source.txt', '/target-folder'))).toBe('EEXIST');
    expect(await codeOf(() => env.files.rename('/nothing', '/other'))).toBe('ENOENT');
  });

  it('chmod of a missing path is ENOENT, and a generic failure is EIO', async () => {
    expect(await codeOf(() => env.files.chmod('/nothing', 0o644))).toBe('ENOENT');
    writeFileSync(local('/here.txt'), 'x');
    transport.sftp.chmod = async () => {
      throw Object.assign(new Error('FAILURE'), { code: 'FAILURE' });
    };
    expect(await codeOf(() => env.files.chmod('/here.txt', 0o644))).toBe('EIO');
  });

  it('a generic failure of a file call is EIO when the path does not explain it', async () => {
    writeFileSync(local('/here.txt'), 'x');
    transport.sftp.unlink = async () => {
      throw Object.assign(new Error('FAILURE'), { code: 'FAILURE' });
    };
    expect(await codeOf(() => env.files.rm('/here.txt', {}))).toBe('EIO');
  });

  it('readlink of a regular file is EINVAL, and symlink to an existing path is EEXIST', async () => {
    writeFileSync(local('/plain.txt'), 'x');
    expect(await codeOf(() => env.files.readlink('/plain.txt'))).toBe('EINVAL');
    expect(await codeOf(() => env.files.symlink('/elsewhere', '/plain.txt'))).toBe('EEXIST');
  });

  it.skipIf(process.platform === 'win32')(
    'symlink makes a link that readlink and lstat report',
    async () => {
      writeFileSync(local('/real.txt'), 'x');
      await env.files.symlink('/real.txt', '/link.txt');
      expect(await env.files.readlink('/link.txt')).toBe('/real.txt');
      expect((await env.files.lstat('/link.txt')).isSymbolicLink()).toBe(true);
    },
  );
});

describe('programs: the exec string, variables, marker, group kill, platform and network (AC5)', () => {
  /** The exec strings the transport was sent that start a program (they begin with `cd --`). */
  const launches = (): string[] =>
    transport.calls.map((call) => call.command).filter((c) => c.startsWith('cd -- '));

  it('a spawn sends exactly the quoted form, and returns the exit code', async () => {
    mkdirSync(local('/home/u'), { recursive: true });
    const chunks: string[] = [];
    const outcome = await env.process.spawn(NODE, ['-e', 'process.stdout.write("ok")'], {
      cwd: '/home/u',
      env: {},
      timeoutMs: 30_000,
      network: 'normal',
      onOutput: (chunk) => chunks.push(chunk.toString('utf8')),
    });
    expect(outcome).toMatchObject({ started: true, code: 0, timedOut: false, aborted: false });
    expect(launches()).toEqual([
      spawnLine('/home/u', [], NODE, ['-e', 'process.stdout.write("ok")']),
    ]);
    // The marker line is never passed on: only the program's own output arrives.
    expect(chunks.join('')).toBe('ok');
  });

  it('only changed variables cross, in their own words, and PATH never does', async () => {
    mkdirSync(local('/work'), { recursive: true });
    const env_ = { ...process.env, SDD_TEST_VAR: 'hello', PATH: '/not/sent' };
    const chunks: string[] = [];
    await env.process.spawn(NODE, ['-e', 'process.stdout.write(process.env.SDD_TEST_VAR)'], {
      cwd: '/work',
      env: env_,
      timeoutMs: 30_000,
      network: 'normal',
      onOutput: (chunk) => chunks.push(chunk.toString('utf8')),
    });
    const [line] = launches();
    const words = splitWords(line ?? '');
    const sent = words.slice(words.indexOf('env') + 2, words.indexOf('sh'));
    expect(sent).toEqual(['SDD_TEST_VAR=hello']);
    expect(chunks.join('')).toBe('hello');
  });

  it('a timeout stops the group before the channel resolves', async () => {
    mkdirSync(local('/loop'), { recursive: true });
    const order: string[] = [];
    const realExec = transport.exec;
    transport.exec = (command, options) => {
      const id = command.startsWith('kill') ? 'kill' : 'exec';
      order.push(`start ${id}`);
      return realExec(command, options).then((result) => {
        order.push(`end ${id}`);
        return result;
      });
    };
    const outcome = await env.process.spawn(NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: '/loop',
      env: {},
      timeoutMs: 400,
      network: 'normal',
    });
    expect(outcome).toMatchObject({ started: true, timedOut: true, aborted: false });
    expect(order.indexOf('end kill')).toBeGreaterThan(-1);
    expect(order.indexOf('end kill')).toBeLessThan(order.indexOf('end exec'));
  });

  it('an abort stops the group and reports aborted', async () => {
    mkdirSync(local('/loop'), { recursive: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const outcome = await env.process.spawn(NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: '/loop',
      env: {},
      timeoutMs: 30_000,
      network: 'normal',
      signal: controller.signal,
    });
    expect(outcome).toMatchObject({ started: true, aborted: true, timedOut: false });
    expect(transport.calls.some((call) => call.command.startsWith('kill -KILL'))).toBe(true);
  });

  it('a program that cannot be found is reported with code 127', async () => {
    mkdirSync(local('/work'), { recursive: true });
    const outcome = await env.process.spawn(join(base, 'no-such-program'), [], {
      cwd: '/work',
      env: {},
      timeoutMs: 30_000,
      network: 'normal',
    });
    expect(outcome).toMatchObject({ started: true, code: 127 });
  });

  it('is started false when unreachable, and for a relative folder', async () => {
    mkdirSync(local('/work'), { recursive: true });
    const relative = await env.process.spawn(NODE, [], {
      cwd: 'work',
      env: {},
      timeoutMs: 1000,
      network: 'normal',
    });
    expect(relative).toEqual({ started: false });
    transport.drop();
    const down = await env.process.spawn(NODE, [], {
      cwd: '/work',
      env: {},
      timeoutMs: 1000,
      network: 'normal',
    });
    expect(down).toEqual({ started: false });
  });

  it('the platform is the one read at connect', async () => {
    expect(env.process.platform).toBe('linux');
    const darwin = fakeSshTransport(join(base, 'darwin-root'), { uname: 'Darwin' });
    mkdirSync(join(base, 'darwin-root'), { recursive: true });
    await darwin.connect();
    expect(createSshEnvironment({ server: SERVER, transport: darwin }).process.platform).toBe(
      'darwin',
    );
  });

  it('on Linux the network level comes from one probe per connection, and networkLevel agrees with a spawn', async () => {
    mkdirSync(local('/work'), { recursive: true });
    transport.script.probe = true;
    expect(await env.process.networkLevel()).toBe('os');
    expect(await env.process.networkLevel()).toBe('os');
    const probes = () =>
      transport.calls.filter((call) => call.command === UNSHARE_PROBE_LINE).length;
    expect(probes()).toBe(1);

    // A new connection is a new probe; the same connection keeps its answer.
    transport.drop();
    await transport.connect();
    expect(await env.process.networkLevel()).toBe('os');
    expect(probes()).toBe(2);
  });

  it('a failed probe is proxy-only, and a writer command gets the dead proxies through the variables', async () => {
    mkdirSync(local('/work'), { recursive: true });
    transport.script.probe = false;
    expect(await env.process.networkLevel()).toBe('proxy-only');
    const outcome = await env.process.spawn(NODE, ['-e', ''], {
      cwd: '/work',
      env: {},
      timeoutMs: 30_000,
      network: 'none',
    });
    expect(outcome).toMatchObject({ started: true, network: 'proxy-only' });
    const [line] = launches();
    expect(splitWords(line ?? '')).toContain('HTTP_PROXY=http://127.0.0.1:9');
    expect(splitWords(line ?? '')).not.toContain('unshare');
  });

  it('on macOS the level is proxy-only and no probe is run', async () => {
    const mac = fakeSshTransport(join(base, 'mac-root'), { uname: 'Darwin', probe: true });
    mkdirSync(join(base, 'mac-root'), { recursive: true });
    await mac.connect();
    const macEnv = createSshEnvironment({ server: SERVER, transport: mac });
    expect(await macEnv.process.networkLevel()).toBe('proxy-only');
    expect(mac.calls.filter((call) => call.command === UNSHARE_PROBE_LINE)).toEqual([]);
  });
});

describe('environmentFor: the SSH kind (AC10)', () => {
  const silent = { info: () => undefined, error: () => undefined };
  const KNOWN = 'aaaaaaaa-0000-4000-8000-000000000001';

  it('builds the SSH backend for a known server id without connecting, and one transport serves every project on it', () => {
    const server = { ...SERVER, id: KNOWN };
    mkdirSync(join(base, 'env-root'), { recursive: true });
    const fake = fakeSshTransport(join(base, 'env-root'));
    let made = 0;
    const ssh = {
      servers: { get: (id: string) => (id === KNOWN ? server : null) },
      secrets: memorySecrets(),
      logger: silent,
      transportFor: () => {
        made += 1;
        return fake;
      },
    };
    const first = environmentFor({ kind: 'ssh', server: KNOWN }, { ssh });
    const second = environmentFor({ kind: 'ssh', server: KNOWN }, { ssh });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(made).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(fake.state()).toBe('unreachable');
  });

  it('refuses an unknown id, a malformed id and a missing server store with UNSUPPORTED_ENVIRONMENT', () => {
    const ssh = {
      servers: { get: () => null },
      secrets: memorySecrets(),
      logger: silent,
    };
    const refused = { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
    expect(
      environmentFor({ kind: 'ssh', server: 'aaaaaaaa-0000-4000-8000-000000000002' }, { ssh }),
    ).toEqual(refused);
    expect(environmentFor({ kind: 'ssh', server: 'not-a-uuid' }, { ssh })).toEqual(refused);
    expect(environmentFor({ kind: 'ssh', server: 7 }, { ssh })).toEqual(refused);
    expect(environmentFor({ kind: 'ssh' }, { ssh })).toEqual(refused);
    expect(environmentFor({ kind: 'ssh', server: KNOWN })).toEqual(refused);
  });
});

describe('no password or passphrase leaves the secret store (AC12, D43)', () => {
  const KNOWN_PASSWORD = 'pw-Scan-Known-5521';
  const KNOWN_PASSPHRASE = 'phrase-Scan-Known-8830';

  it('no saved file, log line, exec request, argument, variable, reason or state payload holds either value', async () => {
    const lines: string[] = [];
    const logger = { info: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const secrets = memorySecrets();
    const scanFile = join(base, 'scan', 'ssh-servers.json');
    const servers = createServerStore({ filePath: scanFile, secrets, logger });
    await servers.load();
    const withPassword = await servers.add(
      { name: 'Pass', host: 'pass.example', user: 'u', auth: { method: 'password' } },
      KNOWN_PASSWORD,
    );
    const keyPath = join(base, 'scan-key');
    writeFileSync(keyPath, 'KEY');
    const withPhrase = await servers.add(
      {
        name: 'Key',
        host: 'key.example',
        user: 'u',
        auth: { method: 'key', keyPath, hasPassphrase: true },
      },
      KNOWN_PASSPHRASE,
    );
    expect(withPassword.ok && withPhrase.ok).toBe(true);
    if (!withPassword.ok || !withPhrase.ok) return;
    // Refusals and changes, each of which must give a reason with no value in it.
    const reasons: string[] = [];
    reasons.push(
      ...[
        await servers.add(
          { name: 'x', host: 'x', user: 'u', auth: { method: 'password' } },
          KNOWN_PASSWORD,
        ),
        await servers.update(withPassword.server.id, { auth: { method: 'agent' } }, KNOWN_PASSWORD),
        await servers.trustHostKey(withPhrase.server.id, KNOWN_PASSWORD),
      ].map((result) => (result.ok ? 'ok' : result.reason)),
    );

    // A backend over a fake server: its exec requests, its variables and its state carry no value.
    const remote = join(base, 'scan-remote');
    mkdirSync(join(remote, 'work'), { recursive: true });
    const transport = fakeSshTransport(remote);
    await transport.connect();
    const env = createSshEnvironment({ server: withPassword.server, transport });
    await env.process.spawn(NODE, ['-e', ''], {
      cwd: '/work',
      env: { ...process.env, SDD_SCAN: 'plain' },
      timeoutMs: 30_000,
      network: 'normal',
    });
    await env.git.currentBranch('/work');
    transport.drop();
    const payloads: unknown[] = [];
    env.connection.onChange((state) => payloads.push(state));
    await transport.connect();

    const everything = [
      readFileSync(scanFile, 'utf8'),
      lines.join('\n'),
      JSON.stringify(transport.calls),
      reasons.join('\n'),
      JSON.stringify(payloads),
      JSON.stringify(servers.list()),
    ].join('\n');
    expect(everything).not.toContain(KNOWN_PASSWORD);
    expect(everything).not.toContain(KNOWN_PASSPHRASE);
    expect(secrets.values.get(secretName(withPassword.server.id, 'password'))).toBe(KNOWN_PASSWORD);
  });
});

describe('host keys and credentials, without a network (AC2)', () => {
  const PINNED = `SHA256:${'P'.repeat(43)}`;
  const OFFERED = `SHA256:${'O'.repeat(43)}`;
  const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

  it('an unpinned server is host-key-unknown, a different key is host-key-changed, and the pinned key is accepted', () => {
    let pin: string | null = null;
    expect(checkHostKey(pin, OFFERED)).toEqual({ ok: false, code: 'host-key-unknown' });
    pin = PINNED;
    expect(checkHostKey(pin, OFFERED)).toEqual({ ok: false, code: 'host-key-changed' });
    // A changed key never replaces the pin.
    expect(pin).toBe(PINNED);
    expect(checkHostKey(pin, PINNED)).toEqual({ ok: true });
  });

  it('a fingerprint is SHA256 and base64 without padding, and is the same for the same key', () => {
    const fingerprint = fingerprintOf(Buffer.from('an example host key blob'));
    expect(fingerprint).toMatch(FINGERPRINT_PATTERN);
    expect(fingerprintOf(Buffer.from('an example host key blob'))).toBe(fingerprint);
  });

  it('a connect that refuses the host key reports the code and the offered fingerprint', async () => {
    const refused = fakeSshTransport(join(base, 'refused-root'), {
      connectFailure: 'host-key-unknown',
      fingerprint: OFFERED,
    });
    mkdirSync(join(base, 'refused-root'), { recursive: true });
    expect(await refused.connect()).toEqual({
      ok: false,
      code: 'host-key-unknown',
      fingerprint: OFFERED,
    });
    expect(refused.state()).toBe('unreachable');
  });

  it('the agent socket comes from SSH_AUTH_SOCK, and the Windows pipe is used when it is unset', async () => {
    const agent = { ...SERVER, auth: { method: 'agent' as const } };
    expect(await signInFor(agent, memorySecrets(), { SSH_AUTH_SOCK: '/tmp/agent.sock' })).toEqual({
      ok: true,
      signIn: { agent: '/tmp/agent.sock' },
    });
    const unset = await signInFor(agent, memorySecrets(), {});
    expect(unset.ok).toBe(true);
    if (unset.ok && process.platform === 'win32') {
      expect(unset.signIn).toEqual({ agent: '\\\\.\\pipe\\openssh-ssh-agent' });
    }
  });

  it('a password comes from its secret entry, and a missing one is refused', async () => {
    const secrets = memorySecrets();
    const pw = { ...SERVER, auth: { method: 'password' as const } };
    expect(await signInFor(pw, secrets)).toEqual({ ok: false });
    secrets.values.set(secretName(SERVER.id, 'password'), 'pw-Example-7731');
    expect(await signInFor(pw, secrets)).toEqual({
      ok: true,
      signIn: { password: 'pw-Example-7731' },
    });
  });

  it('a key comes from its file in memory, and a passphrase from its secret entry', async () => {
    const keyPath = join(base, 'id_test');
    writeFileSync(keyPath, 'KEY-BYTES');
    const keyed = { ...SERVER, auth: { method: 'key' as const, keyPath, hasPassphrase: false } };
    const plain = await signInFor(keyed, memorySecrets());
    expect(plain).toMatchObject({ ok: true });
    if (plain.ok) expect(plain.signIn.privateKey?.toString('utf8')).toBe('KEY-BYTES');

    const withPhrase = { ...keyed, auth: { ...keyed.auth, hasPassphrase: true } };
    expect(await signInFor(withPhrase, memorySecrets())).toEqual({ ok: false });
    const secrets = memorySecrets();
    secrets.values.set(secretName(SERVER.id, 'passphrase'), 'phrase-Example-4419');
    const phrased = await signInFor(withPhrase, secrets);
    expect(phrased.ok && phrased.signIn.passphrase).toBe('phrase-Example-4419');

    const missing = {
      ...SERVER,
      auth: { method: 'key' as const, keyPath: join(base, 'none'), hasPassphrase: false },
    };
    expect(await signInFor(missing, memorySecrets())).toEqual({ ok: false });
  });
});

/** An in-memory secret store for the credential tests. */
function memorySecrets(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    save: (name, value) => {
      values.set(name, value);
    },
    read: (name) => values.get(name) ?? null,
    delete: (name) => values.delete(name),
    listNames: () => [...values.keys()].sort(),
  };
}

/** Waits until the predicate holds, polling briefly; fails the test after three seconds. */
async function waitFor(predicate: () => boolean): Promise<void> {
  const until = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('the condition did not hold in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('watch: the shared polling watcher (AC6)', () => {
  it('reports additions, changes and removals in one folder, and nothing for the baseline or below it', async () => {
    mkdirSync(local('/watched/sub'), { recursive: true });
    writeFileSync(local('/watched/a.txt'), 'a');
    const fast = createSshEnvironment({ server: SERVER, transport, pollMs: 30 });
    const events: Array<[string, string | null]> = [];
    const handle = fast.watch.watchDir(
      '/watched',
      (type, name) => events.push([type, name]),
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events).toEqual([]);

    writeFileSync(local('/watched/b.txt'), 'b');
    await waitFor(() => events.some(([type, name]) => type === 'rename' && name === 'b.txt'));
    writeFileSync(local('/watched/a.txt'), 'changed size');
    await waitFor(() => events.some(([type, name]) => type === 'change' && name === 'a.txt'));
    rmSync(local('/watched/b.txt'));
    await waitFor(
      () => events.filter(([type, name]) => type === 'rename' && name === 'b.txt').length === 2,
    );

    writeFileSync(local('/watched/sub/deep.txt'), 'deep');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.some(([, name]) => name === 'deep.txt')).toBe(false);

    handle.close();
    const count = events.length;
    writeFileSync(local('/watched/c.txt'), 'c');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events.length).toBe(count);
  });
});

describe('git: the same calls and codes as the local module, through the launcher (AC7)', () => {
  /** Runs git in the local folder of a remote path (a test's own setup). */
  function gitIn(remotePath: string, args: string[]): void {
    execFileSync('git', args, { cwd: local(remotePath), stdio: 'ignore' });
  }

  function makeRepo(): void {
    mkdirSync(local('/repo'), { recursive: true });
    gitIn('/repo', ['init', '-q', '-b', 'main']);
    gitIn('/repo', ['config', 'user.name', 'Test']);
    gitIn('/repo', ['config', 'user.email', 'test@example.com']);
    gitIn('/repo', ['config', 'commit.gpgsign', 'false']);
    writeFileSync(local('/repo/a.txt'), 'a');
    gitIn('/repo', ['add', '--', 'a.txt']);
    gitIn('/repo', ['commit', '-q', '-m', 'init']);
  }

  it('gives the same values as the local module on the same folder', async () => {
    makeRepo();
    expect(await env.git.currentBranch('/repo')).toEqual(
      await localGit.currentBranch(local('/repo')),
    );
    expect(await env.git.defaultBranch('/repo')).toEqual(
      await localGit.defaultBranch(local('/repo')),
    );
    writeFileSync(local('/repo/b.txt'), 'b');
    const changed = await env.git.changedPaths('/repo');
    expect(changed).toEqual({ ok: true, value: ['b.txt'] });
    expect(changed).toEqual(await localGit.changedPaths(local('/repo')));
    expect(await env.git.ignoredEntries('/repo')).toEqual(
      await localGit.ignoredEntries(local('/repo')),
    );
    expect(await env.git.aheadOfUpstream('/repo')).toEqual(
      await localGit.aheadOfUpstream(local('/repo')),
    );
  });

  it('sends the same argument lists as the local module', async () => {
    makeRepo();
    await env.git.changedPaths('/repo');
    const programs = transport.calls
      .map((call) => splitWords(call.command))
      .filter((words) => words.includes('git'));
    expect(
      programs.some(
        (words) =>
          words.slice(-5).join(' ') === 'git status --porcelain=v1 -z --untracked-files=all',
      ),
    ).toBe(true);
  });

  it('exit 127 is git-missing', async () => {
    makeRepo();
    transport.script.noGit = true;
    expect(await env.git.currentBranch('/repo')).toEqual({ ok: false, code: 'git-missing' });
  });

  it('a folder that is not a repository is not-a-repo', async () => {
    mkdirSync(local('/plain'), { recursive: true });
    expect(await env.git.currentBranch('/plain')).toEqual({ ok: false, code: 'not-a-repo' });
  });

  it('a git call past its limit is stopped on the server and reports timeout', async () => {
    mkdirSync(local('/repo'), { recursive: true });
    transport.script.stall = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = env.git.currentBranch('/repo');
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await pending).toEqual({ ok: false, code: 'timeout' });
      expect(transport.calls.some((call) => call.command.startsWith('kill -KILL'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a lost connection: each call is a result, nothing throws, nothing runs locally (AC8)', () => {
  it('files give ENOTCONN, spawn and git give their results, and the watcher reports an error', async () => {
    mkdirSync(local('/work'), { recursive: true });
    transport.drop();
    expect(await codeOf(() => env.files.stat('/work'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.readFile('/work/x'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.writeFile('/work/new.txt', 'x'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.mkdir('/work/sub'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.readdir('/work'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.rm('/work', { recursive: true }))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.rename('/work', '/elsewhere'))).toBe('ENOTCONN');
    expect(await codeOf(() => env.files.access('/work', 'exists'))).toBe('ENOTCONN');
    expect(existsSync(local('/work/new.txt'))).toBe(false);
    expect(existsSync(local('/work/sub'))).toBe(false);

    const outcome = await env.process.spawn(NODE, [], {
      cwd: '/work',
      env: {},
      timeoutMs: 1000,
      network: 'normal',
    });
    expect(outcome).toEqual({ started: false });
    expect(await env.git.currentBranch('/work')).toEqual({ ok: false, code: 'failed' });

    const errors: Error[] = [];
    const handle = env.watch.watchDir(
      '/work',
      () => undefined,
      (error) => errors.push(error),
    );
    await waitFor(() => errors.length > 0);
    handle.close();
  });
});

describe('the connection part follows the session, and reconnect is one connect (AC9)', () => {
  it('is connected after connect, unreachable after a drop, and reconnect brings it back', async () => {
    expect(env.connection.state()).toBe('connected');
    const seen: string[] = [];
    const stop = env.connection.onChange((state) => seen.push(state));
    transport.drop();
    expect(env.connection.state()).toBe('unreachable');
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    expect(env.connection.state()).toBe('connected');
    expect(seen).toEqual(['unreachable', 'connected']);
    stop();
  });

  it('a failed reconnect gives the fixed reason for its code, and names no server detail', async () => {
    const codes = [
      'host-key-unknown',
      'host-key-changed',
      'auth-failed',
      'unreachable',
      'unsupported-system',
    ] as const;
    for (const code of codes) {
      transport.drop();
      transport.script.connectFailure = code;
      const result = await env.connection.reconnect();
      expect(result).toEqual({ ok: false, reason: SSH_RECONNECT_REASONS[code] });
      expect(JSON.stringify(result)).not.toContain(SERVER.host);
      expect(env.connection.state()).toBe('unreachable');
    }
    transport.script.connectFailure = undefined;
    expect(await env.connection.reconnect()).toEqual({ ok: true });
  });
});
