import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { createRequire } from 'node:module';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const root = join(__dirname, '..', '..');
const FIXTURES = join(root, 'tests', 'fixtures', 'spike');
const SENTINEL = 'SENTINEL-KEY-SPIKE-E2E-7319';
const NOTE = 'Spike note: the fixture was recorded from the gateway.';
const ELECTRON_BIN: string = createRequire(__filename)('electron');

interface ReplayServer {
  server: HttpServer;
  baseUrl: string;
  /** The Authorization header of each chat request, in order. */
  authorizations: string[];
}

/**
 * A local stand-in for the gateway: the first chat request gets the recorded tool-call
 * stream, the request that carries the tool result gets the recorded final stream.
 */
function startReplayServer(): Promise<ReplayServer> {
  const toolTurn = readFileSync(join(FIXTURES, 'turn1-tool-call.sse'), 'utf8');
  const finalTurn = readFileSync(join(FIXTURES, 'turn2-final.sse'), 'utf8');
  const authorizations: string[] = [];
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        authorizations.push(req.headers.authorization ?? '<none>');
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(body.includes('"role":"tool"') ? finalTurn : toolTurn);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('replay server has no port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1`, authorizations });
    });
  });
}

/** The environment for a run: the parent's, minus the dev-server URL and any spike key variable. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL' && key !== 'HARNESS_SPIKE_API_KEY') {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Seeds the `spike` entry the way `pnpm secrets:set` does (AC12, revision 1): a one-shot server
 * at a fresh address hands the value to the app started in the secrets mode. Only the address
 * is on the command line; the value is sent on the socket and is never in argv or the env.
 */
async function seedSpikeKey(
  userDataDir: string,
  value: string,
  scratch: string,
): Promise<{ code: number | null; output: string }> {
  let address: string;
  let privateDir: string | null = null;
  if (process.platform === 'win32') {
    address = `\\\\.\\pipe\\sdd-harness-secret-${randomBytes(16).toString('hex')}`;
  } else {
    privateDir = mkdtempSync(join(scratch, 'pipe-'));
    chmodSync(privateDir, 0o700);
    address = join(privateDir, 's.sock');
  }

  let served = false;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => resolve());
  });

  const env = baseEnv();
  env['HARNESS_ALLOW_WEAK_SECRETS'] = '1';
  const child = spawn(
    ELECTRON_BIN,
    [
      root,
      '--harness-secrets=set',
      '--harness-secret-name=spike',
      `--harness-secret-pipe=${address}`,
      `--user-data-dir=${userDataDir}`,
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (exitCode) => resolve(exitCode));
  });

  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (privateDir !== null) {
    rmSync(privateDir, { recursive: true, force: true });
  }
  return { code, output };
}

test('the agent gets the spike key from the store, and the key is in no output or file', async () => {
  test.setTimeout(120_000);
  const { server, baseUrl, authorizations } = await startReplayServer();
  const scratch = mkdtempSync(join(tmpdir(), 'spike-e2e-'));
  const spikeRoot = join(scratch, 'root');
  const userDataDir = join(scratch, 'user-data');
  mkdirSync(spikeRoot);
  mkdirSync(userDataDir);
  writeFileSync(join(spikeRoot, 'notes.txt'), `${NOTE}\n`);

  let appOutput = '';
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    // Seed the store through the secrets mode, with the test-only weak-backend override.
    const seed = await seedSpikeKey(userDataDir, SENTINEL, scratch);
    expect(seed.code).toBe(0);
    expect(seed.output).toContain('[harness] secrets set spike ok');

    // Start the app on the temp user-data dir, with the spike and no key variable.
    const env = baseEnv();
    env['HARNESS_AGENT_SPIKE'] = '1';
    env['HARNESS_SPIKE_BASE_URL'] = baseUrl;
    env['HARNESS_SPIKE_MODEL'] = 'qwen3.8-flash-next-nothink';
    env['HARNESS_SPIKE_ROOT'] = spikeRoot;

    app = await electron.launch({
      args: [root, `--user-data-dir=${userDataDir}`],
      cwd: root,
      env,
    });

    // Collect stdout and stderr as they arrive. Playwright cannot read them after exit.
    const proc = app.process();
    proc.stdout?.on('data', (chunk: Buffer) => {
      appOutput += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      appOutput += chunk.toString('utf8');
    });
    await expect.poll(() => appOutput, { timeout: 60_000 }).toMatch(/\[agent\] spike finished/);

    // Main ran the one read_file call the gate allowed, for the reader job.
    expect(appOutput).toMatch(/\[harness\] tool call ran: job=reader tool=read_file outcome=ok/);
    expect(appOutput).toMatch(/\[agent\] spike finished stopped=answered turns=2/);
    // The streamed answer reached the agent's stdout.
    expect(appOutput).toContain('The file says');

    // Every chat request carried the stored key, so it came from the store.
    expect(authorizations.length).toBeGreaterThan(0);
    for (const header of authorizations) {
      expect(header).toBe(`Bearer ${SENTINEL}`);
    }

    // The sentinel is in neither run's output and not in the secrets file.
    expect(appOutput).not.toContain(SENTINEL);
    expect(seed.output).not.toContain(SENTINEL);
    const secretsFile = readFileSync(join(userDataDir, 'secrets.json'), 'utf8');
    expect(secretsFile).not.toContain(SENTINEL);
    expect(JSON.parse(secretsFile)).toMatchObject({
      version: 1,
      entries: { spike: expect.any(String) },
    });
  } finally {
    await app?.close();
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  // The agent is stopped on quit, so no unexpected exit was logged.
  expect(appOutput).not.toMatch(/agent exited unexpectedly/);
});
