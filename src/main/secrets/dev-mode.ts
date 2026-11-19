// The dev-only secrets mode (D25, AC12). Started with `--harness-secrets=set|delete|list` on an
// unpackaged build, main runs one store call and exits; it opens no window and starts no agent.
// This file is pure: the arguments and the store call are testable without Electron. For `set`
// the value comes over a one-shot local socket whose address is given with
// `--harness-secret-pipe=<address>` (revision 1); the value itself is never on the command line.

import { checkPipeAddress } from './pipe';
import type { SecretStore } from './store';

export const SECRETS_MODE_FLAG = '--harness-secrets=';
export const SECRETS_NAME_FLAG = '--harness-secret-name=';
export const SECRETS_PIPE_FLAG = '--harness-secret-pipe=';

export type SecretsCommand =
  | { op: 'set'; name: string; address: string }
  | { op: 'delete'; name: string }
  | { op: 'list' }
  | { op: 'invalid'; reason: string };

export interface SecretsOutcome {
  ok: boolean;
  /** Plain lines to log: the operation, the name and `ok`, or a failure reason. */
  lines: string[];
}

/**
 * Reads the secrets switches from argv. Returns null when the mode is not requested. The
 * reason in an `invalid` command never echoes a value.
 */
export function parseSecretsArgs(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SecretsCommand | null {
  const modeArg = argv.find((arg) => arg.startsWith(SECRETS_MODE_FLAG));
  if (modeArg === undefined) {
    return null;
  }
  const mode = modeArg.slice(SECRETS_MODE_FLAG.length);
  // The last switch of each kind wins.
  const name = lastValue(argv, SECRETS_NAME_FLAG);
  const address = lastValue(argv, SECRETS_PIPE_FLAG);

  if (mode === 'list') {
    return { op: 'list' };
  }
  if (mode !== 'set' && mode !== 'delete') {
    return { op: 'invalid', reason: 'secrets mode must be set, delete or list' };
  }
  if (name === '') {
    return { op: 'invalid', reason: `secrets ${mode} needs --harness-secret-name=<name>` };
  }
  if (mode === 'delete') {
    return { op: 'delete', name };
  }
  if (address === '' || !checkPipeAddress(address, platform)) {
    return { op: 'invalid', reason: 'secrets set needs a valid --harness-secret-pipe=<address>' };
  }
  return { op: 'set', name, address };
}

function lastValue(argv: readonly string[], flag: string): string {
  const matches = argv.filter((arg) => arg.startsWith(flag));
  const last = matches[matches.length - 1];
  return last === undefined ? '' : last.slice(flag.length);
}

/** Runs one secrets command. `value` is used only for `set`. Never throws. */
export function runSecretsCommand(
  store: SecretStore,
  command: SecretsCommand,
  value: string | null,
): SecretsOutcome {
  if (command.op === 'invalid') {
    return { ok: false, lines: [`secrets failed: ${command.reason}`] };
  }
  try {
    if (command.op === 'set') {
      if (value === null) {
        return { ok: false, lines: [`secrets set ${command.name} failed: no value received`] };
      }
      store.save(command.name, value);
      return { ok: true, lines: [`secrets set ${command.name} ok`] };
    }
    if (command.op === 'delete') {
      if (!store.delete(command.name)) {
        return {
          ok: false,
          lines: [`secrets delete ${command.name} failed: no secret with that name`],
        };
      }
      return { ok: true, lines: [`secrets delete ${command.name} ok`] };
    }
    const names = store.listNames();
    return { ok: true, lines: [...names.map((name) => `secret ${name}`), 'secrets list ok'] };
  } catch (error) {
    // Store errors name the entry and never hold a value; the caller also redacts every line.
    const reason = error instanceof Error ? error.message : 'unknown error';
    const label = command.op === 'list' ? 'list' : `${command.op} ${command.name}`;
    return { ok: false, lines: [`secrets ${label} failed: ${reason}`] };
  }
}
