import { describe, expect, it, vi } from 'vitest';
import { parseSecretsArgs, runSecretsCommand } from '../../src/main/secrets/dev-mode';
import type { SecretStore } from '../../src/main/secrets/store';

const SENTINEL = 'SENTINEL-DEVMODE-VALUE-7782';
const WIN_PIPE = `\\\\.\\pipe\\sdd-harness-secret-${'b'.repeat(32)}`;
const POSIX_PIPE = '/tmp/sdd-harness-secret-abc/s.sock';

describe('parseSecretsArgs', () => {
  it('returns null when the secrets mode is not requested', () => {
    expect(parseSecretsArgs(['/app', '--user-data-dir=/x'], 'linux')).toBeNull();
  });

  it('parses set with a name and a pipe address', () => {
    expect(
      parseSecretsArgs(
        [
          '/app',
          '--harness-secrets=set',
          '--harness-secret-name=spike',
          `--harness-secret-pipe=${POSIX_PIPE}`,
        ],
        'linux',
      ),
    ).toEqual({ op: 'set', name: 'spike', address: POSIX_PIPE });
  });

  it('parses delete and list', () => {
    expect(
      parseSecretsArgs(['--harness-secrets=delete', '--harness-secret-name=spike'], 'linux'),
    ).toEqual({ op: 'delete', name: 'spike' });
    expect(parseSecretsArgs(['--harness-secrets=list'], 'linux')).toEqual({ op: 'list' });
  });

  it('refuses an unknown mode', () => {
    const command = parseSecretsArgs(['--harness-secrets=update'], 'linux');
    expect(command).toEqual({ op: 'invalid', reason: 'secrets mode must be set, delete or list' });
  });

  it('refuses set and delete without a name', () => {
    expect(parseSecretsArgs(['--harness-secrets=delete'], 'linux')).toMatchObject({
      op: 'invalid',
    });
    expect(
      parseSecretsArgs(['--harness-secrets=set', `--harness-secret-pipe=${POSIX_PIPE}`], 'linux'),
    ).toMatchObject({ op: 'invalid' });
  });

  it('refuses set without a pipe address, or with one of the wrong shape for the platform', () => {
    expect(
      parseSecretsArgs(['--harness-secrets=set', '--harness-secret-name=spike'], 'linux'),
    ).toMatchObject({ op: 'invalid' });
    expect(
      parseSecretsArgs(
        [
          '--harness-secrets=set',
          '--harness-secret-name=spike',
          `--harness-secret-pipe=${WIN_PIPE}`,
        ],
        'linux',
      ),
    ).toMatchObject({ op: 'invalid' });
    expect(
      parseSecretsArgs(
        [
          '--harness-secrets=set',
          '--harness-secret-name=spike',
          `--harness-secret-pipe=${POSIX_PIPE}`,
        ],
        'win32',
      ),
    ).toMatchObject({ op: 'invalid' });
  });

  it('accepts a Windows named pipe on win32', () => {
    expect(
      parseSecretsArgs(
        [
          '--harness-secrets=set',
          '--harness-secret-name=spike',
          `--harness-secret-pipe=${WIN_PIPE}`,
        ],
        'win32',
      ),
    ).toEqual({ op: 'set', name: 'spike', address: WIN_PIPE });
  });

  it('ignores the pipe switch for list and delete, and uses the last switch of each kind', () => {
    expect(
      parseSecretsArgs(['--harness-secrets=list', '--harness-secret-name=x'], 'linux'),
    ).toEqual({
      op: 'list',
    });
    expect(
      parseSecretsArgs(
        ['--harness-secrets=delete', '--harness-secret-name=first', '--harness-secret-name=second'],
        'linux',
      ),
    ).toEqual({ op: 'delete', name: 'second' });
  });

  it('never echoes a value in an invalid reason', () => {
    const command = parseSecretsArgs(
      ['--harness-secrets=set', `--harness-secret-name=${SENTINEL}`, '--harness-secret-pipe=bad'],
      'linux',
    );
    expect(command).toMatchObject({ op: 'invalid' });
    if (command?.op === 'invalid') {
      expect(command.reason).not.toContain(SENTINEL);
    }
  });
});

function fakeStore(overrides: Partial<SecretStore> = {}): SecretStore & {
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn(),
    read: vi.fn(() => null),
    delete: vi.fn(() => true),
    listNames: vi.fn(() => ['beta', 'alpha']),
    ...overrides,
  } as SecretStore & { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
}

describe('runSecretsCommand', () => {
  it('saves the received value and prints the operation, the name and ok', () => {
    const store = fakeStore();
    const outcome = runSecretsCommand(
      store,
      { op: 'set', name: 'spike', address: POSIX_PIPE },
      SENTINEL,
    );
    expect(store.save).toHaveBeenCalledWith('spike', SENTINEL);
    expect(outcome).toEqual({ ok: true, lines: ['secrets set spike ok'] });
    expect(outcome.lines.join('\n')).not.toContain(SENTINEL);
  });

  it('fails without writing when no value was received', () => {
    const store = fakeStore();
    const outcome = runSecretsCommand(
      store,
      { op: 'set', name: 'spike', address: POSIX_PIPE },
      null,
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      lines: ['secrets set spike failed: no value received'],
    });
  });

  it('reports a store error as a failure with its message, and prints no value', () => {
    const store = fakeStore({
      save: vi.fn(() => {
        throw new Error('secure storage is unavailable, so the secret was not saved');
      }),
    });
    const outcome = runSecretsCommand(
      store,
      { op: 'set', name: 'spike', address: POSIX_PIPE },
      SENTINEL,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toMatch(/^secrets set spike failed: secure storage is unavailable/);
    expect(outcome.lines.join('\n')).not.toContain(SENTINEL);
  });

  it('deletes an entry, and reports a missing one as a failure', () => {
    expect(runSecretsCommand(fakeStore(), { op: 'delete', name: 'spike' }, null)).toEqual({
      ok: true,
      lines: ['secrets delete spike ok'],
    });
    const missing = fakeStore({ delete: vi.fn(() => false) });
    expect(runSecretsCommand(missing, { op: 'delete', name: 'spike' }, null)).toEqual({
      ok: false,
      lines: ['secrets delete spike failed: no secret with that name'],
    });
  });

  it('lists names as lines and ends with ok, without reading any value', () => {
    const store = fakeStore();
    const outcome = runSecretsCommand(store, { op: 'list' }, null);
    expect(outcome).toEqual({
      ok: true,
      lines: ['secret beta', 'secret alpha', 'secrets list ok'],
    });
    expect(store.read).not.toHaveBeenCalled();
  });

  it('reports a store that throws on list as a failure', () => {
    const store = fakeStore({
      listNames: vi.fn(() => {
        throw new Error('the secrets file could not be read; it is not valid JSON');
      }),
    });
    const outcome = runSecretsCommand(store, { op: 'list' }, null);
    expect(outcome.ok).toBe(false);
    expect(outcome.lines).toEqual([
      'secrets list failed: the secrets file could not be read; it is not valid JSON',
    ]);
  });

  it('fails for an invalid command and does not touch the store', () => {
    const store = fakeStore();
    const outcome = runSecretsCommand(store, { op: 'invalid', reason: 'bad' }, null);
    expect(outcome).toEqual({ ok: false, lines: ['secrets failed: bad'] });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });
});
