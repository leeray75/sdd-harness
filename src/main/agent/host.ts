// Starts the agent process and connects it to the router. Electron imports live here,
// not in the router, so the router stays unit testable.

import { app, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { validateAgentToMainMessage, type MainToAgentMessage } from '../../shared/agent-protocol';
import { log } from '../log';
import { checkToolCall } from '../policy/gate';
import { createElectronSecretStore } from '../secrets/electron';
import { readFileInRoot } from '../tools/read-file';
import { decideModelKey } from './model-key';
import { handleAgentMessage, type ToolRunner } from './router';

const SELFCHECK_FLAG = 'HARNESS_AGENT_SELFCHECK';
const SPIKE_FLAG = 'HARNESS_AGENT_SPIKE';
const SPIKE_ROOT_VAR = 'HARNESS_SPIKE_ROOT';

/** OS basics the agent needs to run. Nothing else from the app's environment is passed. */
const OS_VARS = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LANG',
];
/** Dev flags for the agent. */
const FLAG_VARS = [SELFCHECK_FLAG, SPIKE_FLAG];
/**
 * Spike settings for the agent. Passed only when SPIKE_FLAG is '1'. The key is not here: main
 * sends it in a `model-key` message (D25), so no key variable ever reaches the agent's env.
 */
const SPIKE_VARS = ['HARNESS_SPIKE_BASE_URL', 'HARNESS_SPIKE_MODEL'];

/**
 * Runs the tools the gate can allow. Only `read_file` exists so far, and it reads inside
 * the one root given to main. Any other name is refused.
 */
export function makeToolRunner(root: string | undefined): ToolRunner {
  return ({ tool, args }) => {
    if (tool === 'read_file') {
      return readFileInRoot(root, args['path']);
    }
    return Promise.resolve({ ok: false, reason: 'no such tool' });
  };
}

/**
 * The name used to compare two variable names. On win32 names are case-insensitive, so the
 * comparison key is upper-cased; elsewhere the name is compared as it is.
 */
function compareKey(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? name.toUpperCase() : name;
}

/**
 * The environment the agent gets: an allowlist of the app's variables. On win32 names match
 * case-insensitively (the parent's spelling is kept, and a name is passed once); on other
 * platforms they match exactly. The spike variables are included only when the spike flag
 * is '1'. Everything else (API keys for other providers, the root, COMSPEC and the rest of
 * the app's environment) is dropped.
 */
export function agentEnv(parent: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const allowedNames = [...OS_VARS, ...FLAG_VARS];
  const parentNames = Object.keys(parent).filter((name) => parent[name] !== undefined);

  // The spike flag is read with the same matching rule as the other names.
  const spikeFlagKey = parentNames.find(
    (name) => compareKey(name, platform) === compareKey(SPIKE_FLAG, platform),
  );
  if (spikeFlagKey !== undefined && parent[spikeFlagKey] === '1') {
    allowedNames.push(...SPIKE_VARS);
  }

  const allowed = new Set(allowedNames.map((name) => compareKey(name, platform)));
  const env: NodeJS.ProcessEnv = {};
  const passed = new Set<string>();
  for (const name of parentNames) {
    const key = compareKey(name, platform);
    if (allowed.has(key) && !passed.has(key)) {
      passed.add(key);
      env[name] = parent[name];
    }
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
    env: agentEnv(process.env, process.platform),
  });

  forwardLines(child.stdout, false);
  forwardLines(child.stderr, true);

  const runTool = makeToolRunner(process.env[SPIKE_ROOT_VAR]);

  // The key is sent once per agent process, after its pong (D25). The store is built here,
  // which is after app ready; it reads the disk only when a key is asked for.
  const store = createElectronSecretStore();
  const spikeFlag = process.env[SPIKE_FLAG] === '1';
  let modelKeySent = false;

  child.on('message', (message: unknown) => {
    const parsed = validateAgentToMainMessage(message);
    const isPong = parsed.ok && parsed.message.type === 'pong';
    handleAgentMessage(message, { checkToolCall, runTool, logger: log })
      .then((outcome) => {
        if (outcome.reply) {
          child.postMessage(outcome.reply);
        }
        if (outcome.ready) {
          const ping: MainToAgentMessage = { type: 'ping' };
          child.postMessage(ping);
        }
        if (isPong && !modelKeySent) {
          modelKeySent = true;
          const keyMessage = decideModelKey({ spikeFlag, store, logger: log });
          if (keyMessage) {
            child.postMessage(keyMessage);
          }
        }
      })
      .catch(() => {
        log.error('agent message could not be handled');
      });
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
