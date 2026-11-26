import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localEnvironment } from '../../src/main/env';
import { createWslEnvironment, WSL_RECONNECT_REASONS } from '../../src/main/env/wsl';
import type { ConnectionState, Environment } from '../../src/main/env/types';
import { fakeWslTransport, type FakeTransport } from '../support/fake-wsl-transport';

// The connection part (D43, p4-env-ssh, AC9). The local backend is always connected. A WSL backend is
// unreachable while its share root is missing or while a run cannot start, and its reconnect runs
// `wsl.exe -d <distro> --exec true` (which starts a stopped distribution) and finds the share again.
// Every check runs on the fake WSL transport over a temp folder, so no wsl.exe starts.

const DISTRO = 'Ubuntu';

let base: string;
let share: string;
let transport: FakeTransport;
let env: Environment;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'env-connection-'));
  share = join(base, 'share');
  mkdirSync(share, { recursive: true });
  transport = fakeWslTransport(share);
  env = createWslEnvironment({ distribution: DISTRO, transport });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** The argument arrays the transport was given that ran the reconnect command. */
function reconnectCalls(): string[][] {
  return transport.calls
    .map((call) => [...call.argv])
    .filter((argv) => argv.join(' ') === `-d ${DISTRO} --exec true`);
}

describe('local: always connected (AC9)', () => {
  it('is connected, its listener never fires, and reconnect resolves ok', async () => {
    const local = localEnvironment();
    expect(local.connection.state()).toBe('connected');
    const seen: ConnectionState[] = [];
    const stop = local.connection.onChange((state) => seen.push(state));
    expect(typeof stop).toBe('function');
    stop();
    expect(seen).toEqual([]);
    expect(await local.connection.reconnect()).toEqual({ ok: true });
    expect(local.connection.state()).toBe('connected');
  });
});

describe('WSL: unreachable while the share or the runs fail, and reconnect restores it (AC9)', () => {
  it('is connected while the share exists and a run starts', async () => {
    expect(env.connection.state()).toBe('connected');
    await env.files.stat('/');
    expect(env.connection.state()).toBe('connected');
  });

  it('is unreachable when the share root is missing, and a reconnect finds it again', async () => {
    transport.script.share = join(base, 'no-such-share');
    expect(env.connection.state()).toBe('unreachable');

    // The share is still missing after the distribution starts: the reconnect says so.
    expect(await env.connection.reconnect()).toEqual({
      ok: false,
      reason: WSL_RECONNECT_REASONS.noShare,
    });
    expect(env.connection.state()).toBe('unreachable');

    // The share comes back: the reconnect runs the fixed command and finds the share again.
    transport.script.share = undefined;
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    expect(env.connection.state()).toBe('connected');
    expect(reconnectCalls().length).toBe(2);
    expect(transport.calls.find((call) => call.argv.includes('true'))?.argv).toEqual([
      '-d',
      DISTRO,
      '--exec',
      'true',
    ]);
  });

  it('is unreachable when a run cannot start, and reconnect fails with a fixed reason', async () => {
    transport.script.cannotStart = true;
    // A run that cannot start is what makes the state unreachable (files calls do not run wsl.exe).
    expect((await env.git.currentBranch(share)).ok).toBe(false);
    expect(env.connection.state()).toBe('unreachable');
    const result = await env.connection.reconnect();
    expect(result).toEqual({ ok: false, reason: WSL_RECONNECT_REASONS.notStarted });
    expect(JSON.stringify(result)).not.toContain(DISTRO);
    transport.script.cannotStart = false;
    expect(await env.connection.reconnect()).toEqual({ ok: true });
    expect(env.connection.state()).toBe('connected');
  });

  it('gives the not-found reason when wsl.exe does not have the distribution (exit 127, UTF-16 text)', async () => {
    transport.script.distroMissing = true;
    expect(await env.connection.reconnect()).toEqual({
      ok: false,
      reason: WSL_RECONNECT_REASONS.notFound,
    });
    expect(env.connection.state()).toBe('unreachable');
    expect(reconnectCalls().length).toBe(1);
  });

  it('notifies a listener on each change, and stops after its unsubscribe', async () => {
    const seen: ConnectionState[] = [];
    const stop = env.connection.onChange((state) => seen.push(state));

    transport.script.cannotStart = true;
    await env.git.currentBranch(share);
    transport.script.cannotStart = false;
    await env.git.currentBranch(share);
    expect(seen).toEqual(['unreachable', 'connected']);

    stop();
    transport.script.cannotStart = true;
    await env.git.currentBranch(share);
    expect(seen).toEqual(['unreachable', 'connected']);
  });

  it('runs the reconnect command only when asked: normal calls never run it', async () => {
    await env.files.stat('/');
    await env.process.networkLevel();
    await env.git.currentBranch(share);
    expect(reconnectCalls()).toEqual([]);
  });
});
