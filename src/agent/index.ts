// Agent process. Runs as an Electron utilityProcess started by main. It has no window,
// preload or renderer access, and it talks to main only through process.parentPort.
// It makes one self-check tool call when HARNESS_AGENT_SELFCHECK is '1' (main's gate denies
// it). When HARNESS_AGENT_SPIKE is '1' it also runs the spike loop once: the loop starts when
// main sends the run's `model-key` message (D25). A model streams a reply, asks for read_file,
// main checks and runs the call, and the model finishes. The streamed text goes to stdout.
// The key arrives only in that message and is held in memory; it is never read from the
// environment and never written to stdout or stderr.

import { validateMainToAgentMessage, type AgentToMainMessage } from '../shared/agent-protocol';
import { describeError } from './errors';
import { runAgentLoop, type ToolCallOutcome } from './loop';
import { chooseSpikeProvider } from './spike-provider';

/** Set by main from the app's environment. The agent sends one self-check tool call when it is '1'. */
const SELFCHECK_FLAG = 'HARNESS_AGENT_SELFCHECK';
const SELFCHECK_ID = 'selfcheck-1';

/** Set by main from the app's environment. The agent runs the spike loop once when it is '1'. */
const SPIKE_FLAG = 'HARNESS_AGENT_SPIKE';
const SPIKE_TIMEOUT_MS = 30_000;
const SPIKE_PROMPT =
  'Read the file notes.txt with the read_file tool, then answer in one sentence what it says.';

const port = process.parentPort;
let selfCheckSent = false;
let spikeStarted = false;
let spikeCalls = 0;

interface WaitingCall {
  resolve: (outcome: ToolCallOutcome) => void;
  timer: NodeJS.Timeout;
}
/** Spike tool calls waiting for main's result, by request id. */
const waiting = new Map<string, WaitingCall>();

function say(line: string): void {
  process.stdout.write(`[agent] ${line}\n`);
}

function send(message: AgentToMainMessage): void {
  port.postMessage(message);
}

/** Sends one read_file call to main as the reader job and waits for the result with its id. */
function callToolViaMain(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
  spikeCalls += 1;
  const id = `spike-${spikeCalls}`;
  return new Promise<ToolCallOutcome>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      say(`spike tool call timed out id=${id}`);
      resolve({ ok: false, reason: 'the tool call timed out after 30 seconds' });
    }, SPIKE_TIMEOUT_MS);
    waiting.set(id, { resolve, timer });
    send({ type: 'tool-call-request', id, job: 'reader', tool: name, args });
    say(`sent spike tool call id=${id} tool=${name}`);
  });
}

/**
 * Runs the spike loop once, streaming text to stdout. Never throws. The key is the one main
 * sent for this run, or null; it lives only in the client built here.
 */
async function runSpike(key: string | null): Promise<void> {
  const choice = chooseSpikeProvider(
    {
      preset: process.env['HARNESS_SPIKE_PRESET'],
      provider: process.env['HARNESS_SPIKE_PROVIDER'],
      model: process.env['HARNESS_SPIKE_MODEL'],
      baseURL: process.env['HARNESS_SPIKE_BASE_URL'],
      headers: process.env['HARNESS_SPIKE_HEADERS'],
    },
    key,
  );
  if (!choice.ok) {
    say(`spike skipped: ${choice.reason}`);
    return;
  }
  say(`spike started preset=${choice.preset} provider=${choice.format} model=${choice.model}`);
  try {
    const result = await runAgentLoop({
      provider: choice.provider,
      model: choice.model,
      prompt: SPIKE_PROMPT,
      callTool: callToolViaMain,
      onText: (text) => {
        process.stdout.write(text);
      },
    });
    process.stdout.write('\n');
    const total = result.usage.total;
    const usage = total ? `input=${total.inputTokens} output=${total.outputTokens}` : 'usage=none';
    say(`spike finished stopped=${result.stopped} turns=${result.turns} ${usage}`);
  } catch (error) {
    say(`spike failed: ${describeError(error)}`);
  }
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
    case 'model-key': {
      // Only the spike uses a key. Without the flag the message is ignored; the key is never logged.
      if (process.env[SPIKE_FLAG] !== '1') {
        say('model-key ignored: the spike flag is off');
        return;
      }
      if (spikeStarted) {
        say('model-key ignored: the spike already started in this process');
        return;
      }
      spikeStarted = true;
      void runSpike(message.key);
      return;
    }
    case 'tool-call-result': {
      const call = waiting.get(message.id);
      if (call) {
        waiting.delete(message.id);
        clearTimeout(call.timer);
        call.resolve(
          message.ok
            ? { ok: true, output: message.output }
            : { ok: false, reason: message.error.reason },
        );
        say(`received spike result id=${message.id} ok=${message.ok}`);
        return;
      }
      if (message.ok) {
        say(`received result id=${message.id} ok=true`);
      } else {
        say(`received denied result id=${message.id} reason=${message.error.reason}`);
      }
      return;
    }
  }
});

send({ type: 'ready', pid: process.pid });
say(`ready pid=${process.pid}`);
