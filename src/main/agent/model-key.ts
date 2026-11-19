// Decides the `model-key` message main sends the agent once per agent process (D25). Pure:
// the store and the logger are passed in, so tests can use a fake store. It never throws, and
// it never logs the key: the log says only whether a key was sent.

import type { MainToAgentMessage } from '../../shared/agent-protocol';
import type { Logger } from '../log';
import type { SecretStore } from '../secrets/store';

/** The store entry the spike reads its provider key from. */
export const SPIKE_KEY_NAME = 'spike';

export interface ModelKeyInput {
  /** True when HARNESS_AGENT_SPIKE is '1'. With it off, no message is sent. */
  spikeFlag: boolean;
  store: Pick<SecretStore, 'read'>;
  logger: Logger;
}

/**
 * Returns the message to send after the agent's pong: null when the spike flag is off; the
 * stored key when there is one; `null` when there is none or the store could not be read.
 */
export function decideModelKey(input: ModelKeyInput): MainToAgentMessage | null {
  if (!input.spikeFlag) {
    return null;
  }
  let key: string | null;
  try {
    key = input.store.read(SPIKE_KEY_NAME);
  } catch {
    // The error text is not logged: it may echo what the store was reading.
    input.logger.error('the spike key could not be read from the secret store; sending no key');
    return { type: 'model-key', key: null };
  }
  if (key === null) {
    input.logger.info(`no secret named ${SPIKE_KEY_NAME} is stored; the agent gets no key`);
  } else {
    input.logger.info(`sent the ${SPIKE_KEY_NAME} key to the agent`);
  }
  return { type: 'model-key', key };
}
