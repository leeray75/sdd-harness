import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { environmentFor } from '../../src/main/env';
import { appSshTransport } from '../../src/main/env/ssh-transport';
import { createServerStore, SERVERS_FILE_NAME } from '../../src/main/projects/servers';
import type { SecretStore } from '../../src/main/secrets/store';
import {
  closeWalk,
  runHeadlessWalk,
  startWalk,
  WALK_TIMEOUT_MS,
  type GitReader,
} from '../support/headless-walk';
import { remoteGit, remoteRun, remoteWalkFiles, type SshTarget } from '../support/ssh-remote';

// The headless walk on an SSH project (p4-env-ssh, G5, AC15). The live suite (D24): it runs only with
// `pnpm test:live`, never in CI. It needs a server it can sign in to with a key that has no passphrase:
// HARNESS_SSH_HOST, HARNESS_SSH_USER, HARNESS_SSH_KEY (a key file path) and HARNESS_SSH_ROOT (a folder on the server
// the walk may create its temp folders in). HARNESS_SSH_PORT (default 22) and HARNESS_SSH_FINGERPRINT (the server's
// pinned host key, SHA256:<base64>) are optional; without the fingerprint the walk trusts the key the first connect
// shows. The walk's temp folders are removed afterwards over SFTP.

/** The variables the suite needs, and why it skips when one is missing. */
function probe(): string | null {
  const missing = [
    'HARNESS_SSH_HOST',
    'HARNESS_SSH_USER',
    'HARNESS_SSH_KEY',
    'HARNESS_SSH_ROOT',
  ].filter((name) => (process.env[name] ?? '') === '');
  if (missing.length > 0) return `${missing.join(', ')} must be set`;
  try {
    execFileSync('ssh', ['-V'], { stdio: 'ignore', windowsHide: true });
  } catch {
    return 'the ssh client is not installed';
  }
  return null;
}

const reason = probe();
if (reason !== null) {
  console.info(`ssh walk: skipped, ${reason}`);
}

/** An in-memory secret store: the walk signs in with a key that has no passphrase, so nothing is stored. */
function noSecrets(): SecretStore {
  return {
    save: () => undefined,
    read: () => null,
    delete: () => false,
    listNames: () => [],
  };
}

describe.skipIf(reason !== null)('the headless walk on an SSH project (G5, AC15)', () => {
  let scratch = '';
  let target: SshTarget;
  let serverId = '';
  let remoteBase = '';
  let work = '';
  let remote = '';
  let hooks = '';
  let reader: GitReader = () => '';
  let maker: ReturnType<typeof makeMaker> | null = null;

  /** The environment maker: the app's SSH backend, with the server store and no secrets (the key has no passphrase). */
  function makeMaker(servers: Awaited<ReturnType<typeof createServerStore>>) {
    const secrets = noSecrets();
    const logger = { info: () => undefined, error: (message: string) => console.error(message) };
    return (descriptor: Parameters<typeof environmentFor>[0]) =>
      environmentFor(descriptor, {
        ssh: { servers: { get: (id) => servers.get(id) }, secrets, logger },
      });
  }

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'sdd-ssh-walk-'));
    const keyPath = process.env['HARNESS_SSH_KEY'] ?? '';
    target = {
      host: process.env['HARNESS_SSH_HOST'] ?? '',
      port: Number(process.env['HARNESS_SSH_PORT'] ?? 22),
      user: process.env['HARNESS_SSH_USER'] ?? '',
      keyPath,
      scratch,
    };

    // Save the server with its key, then pin its host key: the given fingerprint, or the one the first connect shows.
    const secrets = noSecrets();
    const logger = { info: () => undefined, error: (message: string) => console.error(message) };
    const servers = createServerStore({
      filePath: join(scratch, SERVERS_FILE_NAME),
      secrets,
      logger,
    });
    await servers.load();
    const added = await servers.add({
      name: 'Walk server',
      host: target.host,
      port: target.port,
      user: target.user,
      auth: { method: 'key', keyPath, hasPassphrase: false },
    });
    if (!added.ok) throw new Error(added.reason);
    serverId = added.server.id;
    const given = process.env['HARNESS_SSH_FINGERPRINT'];
    if (given !== undefined && given !== '') {
      const pinned = await servers.trustHostKey(serverId, given);
      if (!pinned.ok) throw new Error(pinned.reason);
    } else {
      // An unpinned connect is refused with the offered fingerprint; that one is trusted, once, for this test.
      const discovery = appSshTransport(added.server, {
        secrets,
        logger,
        latest: (id) => servers.get(id),
      });
      const first = await discovery.connect();
      if (first.ok || first.code !== 'host-key-unknown' || first.fingerprint === undefined) {
        throw new Error(`the host key could not be read (${first.ok ? 'connected' : first.code})`);
      }
      const pinned = await servers.trustHostKey(serverId, first.fingerprint);
      if (!pinned.ok) throw new Error(pinned.reason);
    }
    maker = makeMaker(servers);

    remoteBase = posix.join(
      process.env['HARNESS_SSH_ROOT'] ?? '',
      `sdd-ssh-walk-${process.pid}-${Date.now()}`,
    );
    work = posix.join(remoteBase, 'work');
    remote = posix.join(remoteBase, 'origin.git');
    hooks = posix.join(remoteBase, 'no-hooks');
    reader = (cwd, args) => remoteGit(target, cwd, [...args]);
    remoteRun(target, `mkdir -p -- '${work}' '${remote}' '${hooks}'`);
    remoteGit(target, remote, ['init', '-q', '--bare', '-b', 'main']);
    remoteGit(target, work, ['init', '-q', '-b', 'main']);
    for (const [key, value] of [
      ['user.name', 'Walk Test'],
      ['user.email', 'walk@example.com'],
      ['init.defaultBranch', 'main'],
      ['core.autocrlf', 'false'],
      ['commit.gpgsign', 'false'],
      ['core.hooksPath', hooks],
    ] as const) {
      remoteGit(target, work, ['config', key, value]);
    }
    const seed = remoteWalkFiles(target, work);
    seed.write('README.md', '# Walk\n');
    remoteGit(target, work, ['add', '--', 'README.md']);
    remoteGit(target, work, ['commit', '-q', '-m', 'Initial commit']);
    remoteGit(target, work, ['remote', 'add', 'origin', remote]);
    remoteGit(target, work, ['push', '-q', '-u', 'origin', 'main']);
    remoteGit(target, work, ['remote', 'set-head', 'origin', 'main']);
    remoteGit(target, work, ['checkout', '-q', '-b', 'feature/p3-walk']);
  }, WALK_TIMEOUT_MS * 3);

  afterAll(async () => {
    closeWalk();
    if (maker !== null && remoteBase !== '') {
      // The temp folders are removed over SFTP, through the environment (AC15).
      const cleanup = maker({ kind: 'ssh', server: serverId });
      if (cleanup.ok) {
        try {
          await cleanup.env.files.rm(remoteBase, { recursive: true, force: true });
        } catch {
          // The folder is left for the next run to find; nothing else to do.
        }
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  it(
    'runs the same walk through the registry on a project on the server',
    async () => {
      const walk = await startWalk({
        root: work,
        remote,
        projectRoot: work,
        git: reader,
        project: { kind: 'added', environment: { kind: 'ssh', server: serverId } },
        storeFile: join(scratch, 'projects.json'),
        files: remoteWalkFiles(target, work),
        environmentFor: (descriptor) => {
          if (maker === null) throw new Error('the environment maker is not set up');
          return maker(descriptor);
        },
      });
      await runHeadlessWalk(walk);
    },
    WALK_TIMEOUT_MS * 3,
  );
});
