// Starts the agent process and connects it to the router. Electron imports live here,
// not in the router, so the router stays unit testable.

import { app, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { MainToAgentMessage } from '../../shared/agent-protocol';
import { log } from '../log';
import { checkToolCall } from '../policy/gate';
import { handleAgentMessage } from './router';

const SELFCHECK_FLAG = 'HARNESS_AGENT_SELFCHECK';

/**
 * The environment the agent gets. It is the app's environment, and the self-check flag
 * is passed through only when it is set in the app's environment.
 */
export function agentEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env[SELFCHECK_FLAG];
  const flag = parent[SELFCHECK_FLAG];
  if (flag !== undefined) {
    env[SELFCHECK_FLAG] = flag;
  }
  return env;
}

/** Copies the agent's output lines into main's log, unchanged. */
function forwardLines(stream: NodeJS.ReadableStream | null, toStderr: boolean): void {
  if (!stream) {
    return;
  }
  createInterface({ input: stream }).on('line', (line) => {
    log.forward(line, toStderr);
  });
}

/**
 * Forks the agent after app ready and routes its messages. The agent is not restarted:
 * an unexpected exit is logged with its code and nothing else happens.
 */
export function startAgentHost(): void {
  let stopping = false;

  const child: UtilityProcess = utilityProcess.fork(join(__dirname, 'agent.js'), [], {
    serviceName: 'SDD Harness agent',
    stdio: 'pipe',
    env: agentEnv(process.env),
  });

  forwardLines(child.stdout, false);
  forwardLines(child.stderr, true);

  child.on('message', (message: unknown) => {
    const outcome = handleAgentMessage(message, { checkToolCall, logger: log });
    if (outcome.reply) {
      child.postMessage(outcome.reply);
    }
    if (outcome.ready) {
      const ping: MainToAgentMessage = { type: 'ping' };
      child.postMessage(ping);
    }
  });

  child.on('exit', (code: number) => {
    if (stopping) {
      log.info('agent stopped');
      return;
    }
    log.error(`agent exited unexpectedly with code ${code}; not restarting`);
  });

  // Mark the stop as ours before killing, so the exit is not logged as unexpected.
  app.once('before-quit', () => {
    stopping = true;
    child.kill();
  });
}
