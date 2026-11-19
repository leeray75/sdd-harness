// Agent loop for the spike (D23). Streams one chat completion per turn through the openai
// SDK, runs the one read_file tool through an injected callTool, and feeds each result back
// to the model. Pure apart from the client and the callbacks it is given: it never reads the
// environment, never logs, and never sees the key except inside the client it is handed.
//
// The stream comes from vLLM behind agentgateway, so the loop is tolerant: chunks may carry
// extra fields, may have no choices, and may name a tool call (id and name) in one chunk
// with its arguments in later chunks. Unparseable arguments are sent back to the model as a
// tool error, never thrown.

import type OpenAI from 'openai';

/** Most model requests one run makes. Tool calls in the last allowed reply are not run. */
export const MAX_TURNS = 4;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

export const READ_FILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: "Read a text file under the agent's root and return its text.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the file, relative to the root.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
};

/** What the tool runner reports back: the output, or why the call did not complete. */
export type ToolCallOutcome = { ok: true; output: string } | { ok: false; reason: string };

/** Runs one tool call. The caller decides whether it is allowed (main checks it). */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>;

export interface LoopInput {
  client: OpenAI;
  model: string;
  prompt: string;
  callTool: CallTool;
  /** Receives each streamed text chunk, in order. */
  onText: (text: string) => void;
}

export interface LoopResult {
  /** 'answered': a reply had no tool call. 'turn-limit': MAX_TURNS replies were used. */
  stopped: 'answered' | 'turn-limit';
  /** Model requests made. */
  turns: number;
  /** Text of the last reply. */
  text: string;
}

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

interface Reply {
  text: string;
  calls: PendingCall[];
}

/** Adds one streamed tool call delta to the calls of this reply, keyed by its slot. */
function mergeToolCallDelta(slots: Map<number, PendingCall>, delta: ToolCallDelta): void {
  let slot: number;
  if (typeof delta.index === 'number') {
    slot = delta.index;
  } else if (delta.id) {
    // A call that names an id but no index starts a new slot.
    slot = slots.size;
  } else {
    // Otherwise it continues the last call.
    slot = Math.max(slots.size - 1, 0);
  }
  const call = slots.get(slot) ?? { id: '', name: '', arguments: '' };
  slots.set(slot, call);
  if (delta.id && call.id === '') {
    call.id = delta.id;
  }
  if (delta.function?.name && call.name === '') {
    call.name = delta.function.name;
  }
  if (delta.function?.arguments) {
    call.arguments += delta.function.arguments;
  }
}

/** Streams one reply. Text goes to onText as it arrives; tool calls are collected. */
async function streamReply(input: LoopInput, messages: ChatMessage[]): Promise<Reply> {
  const stream = await input.client.chat.completions.create({
    model: input.model,
    messages,
    tools: [READ_FILE_TOOL],
    stream: true,
  });
  let text = '';
  const slots = new Map<number, PendingCall>();
  for await (const chunk of stream) {
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (typeof delta?.content === 'string' && delta.content !== '') {
        text += delta.content;
        input.onText(delta.content);
      }
      for (const toolDelta of delta?.tool_calls ?? []) {
        mergeToolCallDelta(slots, toolDelta);
      }
    }
  }
  const calls = [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, call]) => ({
      ...call,
      id: call.id !== '' ? call.id : `call_spike_${slot}`,
    }));
  return { text, calls };
}

/** Runs one tool call and returns the text to send back as the tool message. */
async function runCall(callTool: CallTool, call: PendingCall): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    return 'tool error: the arguments were not valid JSON';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'tool error: the arguments must be a JSON object';
  }
  let outcome: ToolCallOutcome;
  try {
    outcome = await callTool(call.name, parsed as Record<string, unknown>);
  } catch {
    return 'tool error: the tool could not run';
  }
  return outcome.ok ? outcome.output : `tool error: ${outcome.reason}`;
}

/** Runs the loop: one user prompt, up to MAX_TURNS model requests, tool calls run in between. */
export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const messages: ChatMessage[] = [{ role: 'user', content: input.prompt }];
  let text = '';
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const reply = await streamReply(input, messages);
    text = reply.text;
    if (reply.calls.length === 0) {
      return { stopped: 'answered', turns: turn, text };
    }
    if (turn === MAX_TURNS) {
      break;
    }
    messages.push({
      role: 'assistant',
      content: reply.text === '' ? null : reply.text,
      tool_calls: reply.calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of reply.calls) {
      const content = await runCall(input.callTool, call);
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return { stopped: 'turn-limit', turns: MAX_TURNS, text };
}
