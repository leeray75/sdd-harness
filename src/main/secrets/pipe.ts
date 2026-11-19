// Client side of the dev secrets handoff (AC12, revision 1). The dev script starts a one-shot
// local server at an address it chooses and passes the address to main with
// `--harness-secret-pipe=<address>`. Main connects once, reads until the server closes the
// connection, and returns the text. Nothing read here is ever logged, and the reasons for a
// failure never echo what was read.

import { createConnection } from 'node:net';
import { MAX_SECRET_VALUE_LENGTH } from './store';

/** How long main waits for the whole value before it gives up. */
export const PIPE_TIMEOUT_MS = 10_000;

/** A UTF-8 character is at most four bytes, so this bounds the bytes read before decoding. */
const MAX_PIPE_BYTES = MAX_SECRET_VALUE_LENGTH * 4;

const WINDOWS_ADDRESS = /^\\\\\.\\pipe\\sdd-harness-secret-[0-9a-f]{32}$/;
const POSIX_SOCKET_NAME = 's.sock';

/**
 * True when the address has the shape the dev script makes: a random named pipe on Windows,
 * or an absolute path to `s.sock` elsewhere. Anything else is refused before a connection.
 */
export function checkPipeAddress(address: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') {
    return WINDOWS_ADDRESS.test(address);
  }
  return address.startsWith('/') && address.endsWith(`/${POSIX_SOCKET_NAME}`);
}

export interface ReadPipeOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

/**
 * Connects once to the address, reads until the server ends the connection, and returns the
 * text. Rejects on a bad address, a connection error, a timeout, or a value longer than
 * MAX_SECRET_VALUE_LENGTH characters.
 */
export function readSecretFromPipe(
  address: string,
  options: ReadPipeOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? PIPE_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    if (!checkPipeAddress(address, platform)) {
      reject(new Error('the secret pipe address is not valid'));
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const socket = createConnection(address);

    const settle = (error: Error | null, text?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(text ?? '');
      }
    };

    // Declared after `settle`: settle only runs from socket or timer events, which come later.
    const timer = setTimeout(() => {
      settle(new Error(`the secret was not received within ${timeoutMs} ms`));
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_PIPE_BYTES) {
        settle(new Error(`the secret is longer than ${MAX_SECRET_VALUE_LENGTH} characters`));
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length > MAX_SECRET_VALUE_LENGTH) {
        settle(new Error(`the secret is longer than ${MAX_SECRET_VALUE_LENGTH} characters`));
        return;
      }
      settle(null, text);
    });
    socket.on('error', () => {
      settle(new Error('the secret pipe could not be read'));
    });
    socket.on('close', () => {
      settle(new Error('the secret pipe closed before the secret was received'));
    });
  });
}
