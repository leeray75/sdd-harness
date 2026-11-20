import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const root = join(__dirname, '..', '..');

test('agent runs in its own process, main logs a rule event for its denied write, and it exits cleanly', async () => {
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

    // Main's policy gate denies the writer's write_file call (D30). It logs a Rule event with
    // the job, the tool, the cleaned-up relative target and the reason. The target is logged on
    // purpose; the file body is not.
    await expect
      .poll(() => output, { timeout: 20_000 })
      .toMatch(
        /\[harness\] rule blocked: job=writer tool=write_file target=selfcheck\.txt reason=not allowed: source files can be edited only after the spec is approved/,
      );

    // The agent receives the denied result for the same id, with the same reason.
    await expect
      .poll(() => output, { timeout: 20_000 })
      .toMatch(
        /\[agent\] received denied result id=selfcheck-1 reason=not allowed: source files can be edited only after the spec is approved/,
      );

    // The body of the self-check call never reaches the output.
    expect(output).not.toContain('probe-body');

    // No Rule event carries the absolute repo path. The path may appear with either slash
    // direction on Windows, so both forms are checked.
    const absoluteRoots = [root, root.replace(/\\/g, '/')];
    const ruleLines = output.split(/\r?\n/).filter((line) => line.includes('rule '));
    expect(ruleLines.length).toBeGreaterThan(0);
    for (const line of ruleLines) {
      for (const absoluteRoot of absoluteRoots) {
        expect(line).not.toContain(absoluteRoot);
      }
    }
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
