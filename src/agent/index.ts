// Agent process stub. Runs as an Electron utilityProcess started by main. It has no window,
// preload or renderer access, and it talks to main only through process.parentPort.
// It makes no tool calls except the self-check below, which main's gate denies.

import { validateMainToAgentMessage, type AgentToMainMessage } from '../shared/agent-protocol';

/** Set by main from the app's environment. The agent sends one self-check tool call when it is '1'. */
const SELFCHECK_FLAG = 'HARNESS_AGENT_SELFCHECK';
const SELFCHECK_ID = 'selfcheck-1';

const port = process.parentPort;
let selfCheckSent = false;

function say(line: string): void {
  process.stdout.write(`[agent] ${line}\n`);
}

function send(message: AgentToMainMessage): void {
  port.postMessage(message);
}

port.on('message', (event: { data: unknown }) => {
  const parsed = validateMainToAgentMessage(event.data);
  if (!parsed.ok) {
    say(`rejected main message: ${parsed.reason}`);
    return;
  }

  const message = parsed.message;
  switch (message.type) {
    case 'ping':
      send({ type: 'pong' });
      // Once per process, after the handshake (ready, ping, pong).
      if (process.env[SELFCHECK_FLAG] === '1' && !selfCheckSent) {
        selfCheckSent = true;
        send({
          type: 'tool-call-request',
          id: SELFCHECK_ID,
          job: 'writer',
          tool: 'write_file',
          args: { path: 'selfcheck.txt', content: 'probe-body' },
        });
        say(`sent self-check tool call id=${SELFCHECK_ID}`);
      }
      return;
    case 'tool-call-result':
      if (message.ok) {
        say(`received result id=${message.id} ok=true`);
      } else {
        say(`received denied result id=${message.id} reason=${message.error.reason}`);
      }
      return;
  }
});

send({ type: 'ready', pid: process.pid });
say(`ready pid=${process.pid}`);
