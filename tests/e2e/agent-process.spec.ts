import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const root = join(__dirname, '..', '..');

test('agent runs in its own process, its tool call is denied by main, and it exits cleanly', async () => {
  // Drop the dev-server URL so the app loads the built page, and set the self-check flag.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value;
    }
  }
  env['HARNESS_AGENT_SELFCHECK'] = '1';

  const app = await electron.launch({
    args: [root],
    cwd: root,
    env,
  });

  // Collect stdout and stderr as they arrive. Playwright cannot read them after exit.
  const proc = app.process();
  let output = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const closed = new Promise<void>((resolve) => {
    proc.once('close', () => resolve());
  });

  try {
    // The agent reports ready with its own pid, which differs from main's.
    await expect.poll(() => output, { timeout: 20_000 }).toMatch(/\[agent\] ready pid=\d+/);
    const readyMatch = /\[agent\] ready pid=(\d+)/.exec(output);
    expect(readyMatch).not.toBeNull();
    const agentPid = Number(readyMatch?.[1]);
    expect(agentPid).toBeGreaterThan(0);
    expect(agentPid).not.toBe(proc.pid);

    // Main denies the self-check tool call and logs job, tool and reason.
    await expect
      .poll(() => output, { timeout: 20_000 })
      .toMatch(
        /\[harness\] tool call denied: job=writer tool=write_file reason=not allowed: only the reader job/,
      );

    // The agent receives the denied result for the same id.
    await expect
      .poll(() => output, { timeout: 20_000 })
      .toMatch(
        /\[agent\] received denied result id=selfcheck-1 reason=not allowed: only the reader job/,
      );

    // The arguments of the self-check call never reach the log.
    expect(output).not.toContain('selfcheck.txt');
    expect(output).not.toContain('probe-body');
  } finally {
    await app.close();
  }

  // The agent was stopped on quit, so no unexpected exit was logged.
  await Promise.race([
    closed,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('app did not close')), 20_000),
    ),
  ]);
  expect(output).not.toMatch(/agent exited unexpectedly/);
});
