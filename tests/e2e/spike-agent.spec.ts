import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const root = join(__dirname, '..', '..');
const FIXTURES = join(root, 'tests', 'fixtures', 'spike');
const SENTINEL = 'SENTINEL-KEY-SPIKE-E2E-7319';
const NOTE = 'Spike note: the fixture was recorded from the gateway.';

/**
 * A local stand-in for the gateway: the first chat request gets the recorded tool-call
 * stream, the request that carries the tool result gets the recorded final stream.
 */
function startReplayServer(): Promise<{ server: Server; baseUrl: string }> {
  const toolTurn = readFileSync(join(FIXTURES, 'turn1-tool-call.sse'), 'utf8');
  const finalTurn = readFileSync(join(FIXTURES, 'turn2-final.sse'), 'utf8');
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
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
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

test('the allowlisted agent runs the spike against a replayed gateway, and main runs read_file', async () => {
  const { server, baseUrl } = await startReplayServer();
  const scratch = mkdtempSync(join(tmpdir(), 'spike-e2e-'));
  const spikeRoot = join(scratch, 'root');
  mkdirSync(spikeRoot);
  writeFileSync(join(spikeRoot, 'notes.txt'), `${NOTE}\n`);

  // Drop the dev-server URL so the app loads the built page; set the spike variables.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  env['HARNESS_AGENT_SPIKE'] = '1';
  env['HARNESS_SPIKE_BASE_URL'] = baseUrl;
  env['HARNESS_SPIKE_API_KEY'] = SENTINEL;
  env['HARNESS_SPIKE_MODEL'] = 'qwen3.8-flash-next-nothink';
  env['HARNESS_SPIKE_ROOT'] = spikeRoot;

  let output = '';
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    app = await electron.launch({ args: [root], cwd: root, env });

    // Collect stdout and stderr as they arrive. Playwright cannot read them after exit.
    const proc = app.process();
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    await expect.poll(() => output, { timeout: 60_000 }).toMatch(/\[agent\] spike finished/);

    // Main ran the one read_file call the gate allowed, for the reader job.
    expect(output).toMatch(/\[harness\] tool call ran: job=reader tool=read_file outcome=ok/);
    expect(output).toMatch(/\[agent\] spike finished stopped=answered turns=2/);
    // The streamed answer reached the agent's stdout.
    expect(output).toContain('The file says');
    // The key never appears in the output.
    expect(output).not.toContain(SENTINEL);
  } finally {
    await app?.close();
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  // The agent is stopped on quit, so no unexpected exit was logged.
  expect(output).not.toMatch(/agent exited unexpectedly/);
});
