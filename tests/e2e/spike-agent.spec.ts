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
/**
 * The Chromium switches that Playwright's Electron loader adds to every app it launches
 * (playwright-core/lib/server/electron/loader.js): a mock keychain and the basic password store.
 * The seed run passes them too. Without them the seed run encrypts with a key the app run cannot
 * read on macOS and Linux (AC5). This makes the e2e use Playwright's mock keychain, not the real
 * macOS keychain; the real keychain is a runtime check, not part of this test.
 */
const PLAYWRIGHT_KEYCHAIN_SWITCHES = ['--use-mock-keychain', '--password-store=basic'];

interface ReplayServer {
  server: HttpServer;
  baseUrl: string;
  /** The Authorization header of each chat request, in order; undefined when there was none. */
  authorizations: (string | undefined)[];
}

/**
 * A local stand-in for the gateway: the first chat request gets the recorded openai tool-call
 * stream, the request that carries the tool result gets the recorded final stream. It serves the
 * openai/ fixtures at /v1/chat/completions (AC11).
 */
function startReplayServer(): Promise<ReplayServer> {
  const toolTurn = readFileSync(join(FIXTURES, 'openai', 'turn1-tool-call.sse'), 'utf8');
  const finalTurn = readFileSync(join(FIXTURES, 'openai', 'turn2-final.sse'), 'utf8');
  const authorizations: (string | undefined)[] = [];
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        authorizations.push(req.headers.authorization);
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
      // The app gets the base URL without /v1; the openai adapter adds it (AC11).
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, authorizations });
    });
  });
}

/** The Authorization value the agent sends when no key is set (src/agent/index.ts). */
const PLACEHOLDER_HEADER = 'Bearer no-key-set';

type HeaderClass = 'missing' | 'placeholder' | 'sentinel' | 'other';

/** Reduces an Authorization header to a class, so no failure message ever prints a header value. */
function classifyAuthorization(header: string | undefined): HeaderClass {
  if (header === undefined) {
    return 'missing';
  }
  if (header === `Bearer ${SENTINEL}`) {
    return 'sentinel';
  }
  if (header === PLACEHOLDER_HEADER) {
    return 'placeholder';
  }
  return 'other';
}

/**
 * What a failure message may say about one run's captured output (AC1): the output itself, or,
 * when the sentinel is in it, only a note that it leaked. The sentinel is never printed.
 */
function outputReport(label: string, output: string): string {
  if (output.includes(SENTINEL)) {
    return `${label} output: the sentinel appeared in it, so the output is withheld`;
  }
  return `${label} output (stdout and stderr):\n${output.length > 0 ? output : '(no output)'}`;
}

/** Polls a condition until it holds or the time runs out. Returns whether it held. */
async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/** Asserts the sentinel is absent from a text. The message names the place, never the value. */
function expectNoSentinel(place: string, text: string): void {
  expect(
    text.includes(SENTINEL),
    `the sentinel appeared in ${place}; it must never be printed or written`,
  ).toBe(false);
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
 * Seeds the `agentgateway` entry the way `pnpm secrets:set` does (AC11, D25): a one-shot server
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
      ...PLAYWRIGHT_KEYCHAIN_SWITCHES,
      '--harness-secrets=set',
      '--harness-secret-name=agentgateway',
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
  let appClosed = false;
  let shutdownOk = false;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    // Seed the store through the secrets mode, with the test-only weak-backend override.
    const seed = await seedSpikeKey(userDataDir, SENTINEL, scratch);
    expect(
      seed.code,
      `the seed run exited with code ${seed.code}; expected 0\n${outputReport('seed run', seed.output)}`,
    ).toBe(0);
    expect(
      seed.output.includes('[harness] secrets set agentgateway ok'),
      `the seed run did not print "[harness] secrets set agentgateway ok"\n${outputReport('seed run', seed.output)}`,
    ).toBe(true);

    // Start the app on the temp user-data dir, with the spike and no key variable.
    const env = baseEnv();
    // Both runs must set up encryption the same way on Linux: the override makes main call
    // setUsePlainTextEncryption(true), and the seed run already sets it (AC5, round 1 finding U1).
    env['HARNESS_ALLOW_WEAK_SECRETS'] = '1';
    env['HARNESS_AGENT_SPIKE'] = '1';
    env['HARNESS_SPIKE_BASE_URL'] = baseUrl;
    env['HARNESS_SPIKE_MODEL'] = 'qwen3.8-flash-next-nothink';
    env['HARNESS_SPIKE_PROVIDER'] = 'openai';
    env['HARNESS_SPIKE_ROOT'] = spikeRoot;

    app = await electron.launch({
      args: [root, `--user-data-dir=${userDataDir}`],
      cwd: root,
      env,
    });
    // Playwright's ElectronApplication emits 'close' when the app has closed (T9 close check).
    app.once('close', () => {
      appClosed = true;
    });

    // Collect stdout and stderr as they arrive. Playwright cannot read them after exit.
    const proc = app.process();
    proc.stdout?.on('data', (chunk: Buffer) => {
      appOutput += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      appOutput += chunk.toString('utf8');
    });
    const finished = await waitUntil(() => /\[agent\] spike finished/.test(appOutput), 60_000);
    expect(
      finished,
      `the spike did not print "[agent] spike finished" within 60 s\n${outputReport('app run', appOutput)}`,
    ).toBe(true);

    // Main ran the one read_file call the gate allowed, for the reader job.
    expect(
      /\[harness\] tool call ran: job=reader tool=read_file outcome=ok/.test(appOutput),
      `the reader job's read_file call did not run with outcome=ok\n${outputReport('app run', appOutput)}`,
    ).toBe(true);
    expect(
      /\[agent\] spike finished stopped=answered turns=2/.test(appOutput),
      `the spike did not finish with stopped=answered turns=2\n${outputReport('app run', appOutput)}`,
    ).toBe(true);
    // The streamed answer reached the agent's stdout.
    // The text is the openai fixture's answer (the anthropic fixture has its own wording).
    expect(
      appOutput.includes('The file notes.txt contains'),
      `the streamed answer ("The file notes.txt contains") did not reach the agent's stdout\n${outputReport('app run', appOutput)}`,
    ).toBe(true);

    // Every chat request carried the stored key, so it came from the store. The classes are
    // printed, never the header values.
    const classes = authorizations.map(classifyAuthorization);
    expect(
      classes.length > 0,
      `no chat request reached the replay server\n${outputReport('app run', appOutput)}`,
    ).toBe(true);
    expect(
      classes.every((item) => item === 'sentinel'),
      `chat request Authorization classes, in order: [${classes.join(', ')}]; every request must be "sentinel"\n${outputReport('app run', appOutput)}`,
    ).toBe(true);

    // The sentinel is in neither run's output and not in the secrets file.
    expectNoSentinel('the app run output', appOutput);
    expectNoSentinel('the seed run output', seed.output);
    const secretsFile = readFileSync(join(userDataDir, 'secrets.json'), 'utf8');
    expectNoSentinel('secrets.json', secretsFile);
    expect(JSON.parse(secretsFile)).toMatchObject({
      version: 1,
      entries: { agentgateway: expect.any(String) },
    });
  } finally {
    if (app) {
      const proc = app.process();
      await app.close();
      // Wait for the app's close event, or the process exit, with a timeout (T9 close check).
      shutdownOk = await waitUntil(
        () => appClosed || proc.exitCode !== null || proc.signalCode !== null,
        15_000,
      );
    }
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  expect(
    shutdownOk,
    `the app did not close or exit within 15 s after app.close()\n${outputReport('app run', appOutput)}`,
  ).toBe(true);
});
