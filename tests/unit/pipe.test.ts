import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPipeAddress, readSecretFromPipe } from '../../src/main/secrets/pipe';
import { MAX_SECRET_VALUE_LENGTH } from '../../src/main/secrets/store';

const SENTINEL = 'SENTINEL-PIPE-VALUE-5520';

interface Running {
  address: string;
  server: Server;
  sockets: Set<Socket>;
  dir: string | null;
}

const running: Running[] = [];

/** A new address in the form this platform uses, with a server that is not yet listening. */
function newAddress(): { address: string; dir: string | null } {
  if (process.platform === 'win32') {
    return {
      address: `\\\\.\\pipe\\sdd-harness-secret-${randomBytes(16).toString('hex')}`,
      dir: null,
    };
  }
  const dir = mkdtempSync(join(tmpdir(), 'pipe-test-'));
  return { address: join(dir, 's.sock'), dir };
}

/** Listens at a new address. Each accepted connection is handled by `onConnect`. */
function listen(onConnect: (socket: Socket) => void): Promise<Running> {
  const { address, dir } = newAddress();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    onConnect(socket);
  });
  const entry: Running = { address, server, sockets, dir };
  running.push(entry);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => resolve(entry));
  });
}

afterEach(async () => {
  for (const entry of running.splice(0)) {
    for (const socket of entry.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => {
      entry.server.close(() => resolve());
    });
    if (entry.dir !== null) {
      rmSync(entry.dir, { recursive: true, force: true });
    }
  }
});

describe('checkPipeAddress', () => {
  it('accepts a random named pipe on win32 and refuses other shapes there', () => {
    const good = `\\\\.\\pipe\\sdd-harness-secret-${'a'.repeat(32)}`;
    expect(checkPipeAddress(good, 'win32')).toBe(true);
    expect(checkPipeAddress(`\\\\.\\pipe\\sdd-harness-secret-${'a'.repeat(31)}`, 'win32')).toBe(
      false,
    );
    expect(checkPipeAddress('C:\\temp\\s.sock', 'win32')).toBe(false);
    expect(checkPipeAddress('', 'win32')).toBe(false);
  });

  it('accepts an absolute path to s.sock elsewhere and refuses other paths', () => {
    expect(checkPipeAddress('/tmp/sdd-harness-secret-x/s.sock', 'linux')).toBe(true);
    expect(checkPipeAddress('/tmp/x/other.sock', 'darwin')).toBe(false);
    expect(checkPipeAddress('relative/s.sock', 'linux')).toBe(false);
  });
});

describe('readSecretFromPipe', () => {
  it('reads the whole value the server sends, then returns it', async () => {
    const entry = await listen((socket) => {
      socket.end(SENTINEL);
    });
    await expect(readSecretFromPipe(entry.address, { timeoutMs: 5_000 })).resolves.toBe(SENTINEL);
  });

  it('accepts a value at the length limit', async () => {
    const atLimit = 'k'.repeat(MAX_SECRET_VALUE_LENGTH);
    const entry = await listen((socket) => {
      socket.end(atLimit);
    });
    await expect(readSecretFromPipe(entry.address, { timeoutMs: 5_000 })).resolves.toBe(atLimit);
  });

  it('rejects an oversized value, and the reason names no value', async () => {
    const entry = await listen((socket) => {
      socket.end(`${SENTINEL}${'x'.repeat(MAX_SECRET_VALUE_LENGTH)}`);
    });
    const error = await readSecretFromPipe(entry.address, { timeoutMs: 5_000 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/longer than 4096 characters/);
    expect(String(error)).not.toContain(SENTINEL);
  });

  it('rejects when nothing arrives within the timeout', async () => {
    const entry = await listen(() => {
      // Accept and say nothing.
    });
    const error = await readSecretFromPipe(entry.address, { timeoutMs: 200 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(String(error)).toMatch(/not received within 200 ms/);
  });

  it('rejects when nothing is listening at the address', async () => {
    const { address, dir } = newAddress();
    try {
      await expect(readSecretFromPipe(address, { timeoutMs: 5_000 })).rejects.toThrow();
    } finally {
      if (dir !== null) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('rejects an address that is not in the expected form, without connecting', async () => {
    await expect(readSecretFromPipe('not-an-address', { timeoutMs: 5_000 })).rejects.toThrow(
      /not valid/,
    );
  });

  it('reads an empty value as an empty string, which the store then refuses', async () => {
    const entry = await listen((socket) => {
      socket.end();
    });
    await expect(readSecretFromPipe(entry.address, { timeoutMs: 5_000 })).resolves.toBe('');
  });
});
