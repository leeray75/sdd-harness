// Dev-only secrets script (D25, AC12). Run as `pnpm secrets:set <name>`, `pnpm secrets:list`
// and `pnpm secrets:delete <name>`. It never runs in CI and it is never part of the app.
//
//   set: reads the value (hidden prompt on a TTY, or its own piped stdin with one trailing
//        newline trimmed), starts a one-shot local server at an address it makes, starts the
//        app in `--harness-secrets=set` mode with that address, sends the value on the first
//        connection and closes. Only the address goes on the command line.
//   list, delete: start the app in the matching mode and wait for it.
//
// The value never goes on the command line, in an environment variable or in a file. The
// address is a random named pipe on Windows, or a socket in a private 0o700 temp dir elsewhere,
// and that dir is removed when the run ends. Build the app first if out/ is missing.
//
//   echo value | pnpm secrets:set spike

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_ENTRY = join(ROOT, 'out', 'main', 'index.js');
const ELECTRON: string = createRequire(import.meta.url)('electron');
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_VALUE_LENGTH = 4096;
const PROMPT = 'Secret value (input is hidden): ';

type Op = 'set' | 'delete' | 'list';

function isOp(value: string | undefined): value is Op {
  return value === 'set' || value === 'delete' || value === 'list';
}

/** Removes one trailing line break (LF or CRLF). */
function trimOneNewline(text: string): string {
  if (text.endsWith('\r\n')) {
    return text.slice(0, -2);
  }
  if (text.endsWith('\n')) {
    return text.slice(0, -1);
  }
  return text;
}

function readAll(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/** Reads a line from the terminal without echo. Backspace edits; Ctrl+C cancels. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish(null);
          return;
        }
        if (ch === '\u0003') {
          finish(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    const finish = (error: Error | null): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    stdin.on('data', onData);
  });
}

/** The value for `set`: hidden prompt on a TTY, otherwise the script's own stdin. */
async function readValue(): Promise<string> {
  if (process.stdin.isTTY) {
    return readHidden(PROMPT);
  }
  return trimOneNewline(await readAll(process.stdin));
}

/** Builds the app when out/ is missing. Returns false when the build fails. */
function ensureBuilt(): boolean {
  if (existsSync(MAIN_ENTRY)) {
    return true;
  }
  process.stderr.write('out/ is missing, so the app is being built first\n');
  const result = spawnSync('pnpm build', { cwd: ROOT, shell: true, stdio: 'inherit' });
  return result.status === 0;
}

/** A one-shot server: the first connection gets the value, later ones are closed. */
interface OneShot {
  server: Server;
  sockets: Set<Socket>;
}

function serveOnce(address: string, value: string): Promise<OneShot> {
  const sockets = new Set<Socket>();
  let served = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    if (served) {
      socket.destroy();
      return;
    }
    served = true;
    socket.end(value);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => resolve({ server, sockets }));
  });
}

function closeOneShot(oneShot: OneShot): Promise<void> {
  for (const socket of oneShot.sockets) {
    socket.destroy();
  }
  return new Promise((resolve) => {
    oneShot.server.close(() => resolve());
  });
}

/** A fresh address for one run. Returns the private dir to remove afterwards, if any. */
function makeAddress(): { address: string; dir: string | null } {
  if (process.platform === 'win32') {
    return {
      address: `\\\\.\\pipe\\sdd-harness-secret-${randomBytes(16).toString('hex')}`,
      dir: null,
    };
  }
  const dir = mkdtempSync(join(tmpdir(), 'sdd-harness-secret-'));
  chmodSync(dir, 0o700);
  return { address: join(dir, 's.sock'), dir };
}

function electronArgs(op: Op, name: string | undefined, address: string | undefined): string[] {
  const args = [ROOT, `--harness-secrets=${op}`];
  if (name !== undefined) {
    args.push(`--harness-secret-name=${name}`);
  }
  if (address !== undefined) {
    args.push(`--harness-secret-pipe=${address}`);
  }
  return args;
}

/** Starts the app in the secrets mode and resolves with its exit code. */
function runElectron(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, args, { stdio: 'inherit', env: process.env });
    child.on('error', () => resolve(1));
    child.on('exit', (code: number | null) => resolve(code ?? 1));
  });
}

async function runSet(name: string): Promise<number> {
  const value = await readValue();
  if (value === '') {
    process.stderr.write('the value is empty, so nothing was sent\n');
    return 1;
  }
  if (value.length > MAX_VALUE_LENGTH) {
    process.stderr.write(
      `the value is longer than ${MAX_VALUE_LENGTH} characters, so nothing was sent\n`,
    );
    return 1;
  }
  const { address, dir } = makeAddress();
  let oneShot: OneShot | null = null;
  try {
    oneShot = await serveOnce(address, value);
    return await runElectron(electronArgs('set', name, address));
  } catch {
    process.stderr.write('the secret handoff could not be started\n');
    return 1;
  } finally {
    if (oneShot) {
      await closeOneShot(oneShot);
    }
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const [op, name] = argv;
  if (!isOp(op) || (op !== 'list' && (name === undefined || !NAME_PATTERN.test(name)))) {
    process.stderr.write(
      'usage: pnpm secrets:set <name> | pnpm secrets:list | pnpm secrets:delete <name>\n' +
        '  a name is 1 to 64 lowercase letters, digits or hyphens, starting with a letter or digit\n',
    );
    return 2;
  }
  if (!ensureBuilt()) {
    process.stderr.write('the app could not be built, so the secrets command did not run\n');
    return 1;
  }
  if (op === 'set' && name !== undefined) {
    return runSet(name);
  }
  if (op === 'delete') {
    return runElectron(electronArgs('delete', name, undefined));
  }
  return runElectron(electronArgs('list', undefined, undefined));
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write('the secrets command failed\n');
    process.exitCode = 1;
  },
);
