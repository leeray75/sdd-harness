// Agent loop for the spike (D23). Asks a Provider for one model reply per turn, runs the one
// read_file tool through an injected callTool, and feeds each result back to the model. It
// imports no SDK: the provider adapters own the wire formats. It never reads the environment,
// never logs, and never sees the key.
//
// Unparseable arguments, non-object arguments and a throwing callTool go back to the model as
// tool error text, never thrown.

import type {
  Message,
  Provider,
  StreamEvent,
  ToolCall,
  ToolDefinition,
  Usage,
} from './provider/types';

/** Most model requests one run makes. Tool calls in the last allowed reply are not run. */
export const MAX_TURNS = 4;

export const READ_FILE_TOOL: ToolDefinition = {
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
};

/** What the tool runner reports back: the output, or why the call did not complete. */
export type ToolCallOutcome = { ok: true; output: string } | { ok: false; reason: string };

/** Runs one tool call. The caller decides whether it is allowed (main checks it). */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>;

export interface LoopInput {
  provider: Provider;
  model: string;
  prompt: string;
  callTool: CallTool;
  /** Receives each streamed text chunk, in order. */
  onText: (text: string) => void;
}

export interface LoopUsage {
  /** The usage of each model request, in order. null for a turn that sent no usage event. */
  perTurn: (Usage | null)[];
  /** The sum over the turns that sent usage, or null when no turn sent usage. */
  total: Usage | null;
}

export interface LoopResult {
  /** 'answered': a reply had no tool call. 'turn-limit': MAX_TURNS replies were used. */
  stopped: 'answered' | 'turn-limit';
  /** Model requests made. */
  turns: number;
  /** Text of the last reply. */
  text: string;
  usage: LoopUsage;
}

interface Reply {
  text: string;
  calls: ToolCall[];
  usage: Usage | null;
}

/** Streams one reply. Text goes to onText as it arrives; tool calls and usage are collected. */
async function streamReply(input: LoopInput, messages: Message[]): Promise<Reply> {
  const stream = input.provider.stream({
    model: input.model,
    messages: [...messages],
    tools: [READ_FILE_TOOL],
  });
  let text = '';
  const calls: ToolCall[] = [];
  let usage: Usage | null = null;
  for await (const event of stream) {
    switch (event.type) {
      case 'text':
        if (event.text !== '') {
          text += event.text;
          input.onText(event.text);
        }
        break;
      case 'tool-call':
        calls.push({ id: event.id, name: event.name, arguments: event.arguments });
        break;
      case 'usage':
        usage = toUsage(event);
        break;
      case 'done':
        break;
    }
  }
  return { text, calls, usage };
}

/** Copies the counts of a usage event, leaving out the event type and absent cache counts. */
function toUsage(event: Extract<StreamEvent, { type: 'usage' }>): Usage {
  const usage: Usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
  if (event.cacheReadTokens !== undefined) {
    usage.cacheReadTokens = event.cacheReadTokens;
  }
  if (event.cacheWriteTokens !== undefined) {
    usage.cacheWriteTokens = event.cacheWriteTokens;
  }
  return usage;
}

/** Runs one tool call and returns the text to send back as the tool message. */
async function runCall(callTool: CallTool, call: ToolCall): Promise<string> {
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

/** Adds the counts of one turn to the running total. Cache counts appear once any turn sends them. */
export function addUsage(total: Usage | null, turn: Usage | null): Usage | null {
  if (turn === null) {
    return total;
  }
  if (total === null) {
    return { ...turn };
  }
  const sum: Usage = {
    inputTokens: total.inputTokens + turn.inputTokens,
    outputTokens: total.outputTokens + turn.outputTokens,
  };
  const cacheRead = (total.cacheReadTokens ?? 0) + (turn.cacheReadTokens ?? 0);
  if (total.cacheReadTokens !== undefined || turn.cacheReadTokens !== undefined) {
    sum.cacheReadTokens = cacheRead;
  }
  const cacheWrite = (total.cacheWriteTokens ?? 0) + (turn.cacheWriteTokens ?? 0);
  if (total.cacheWriteTokens !== undefined || turn.cacheWriteTokens !== undefined) {
    sum.cacheWriteTokens = cacheWrite;
  }
  return sum;
}

/** Runs the loop: one user prompt, up to MAX_TURNS model requests, tool calls run in between. */
export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const messages: Message[] = [{ role: 'user', text: input.prompt }];
  const perTurn: (Usage | null)[] = [];
  let total: Usage | null = null;
  let text = '';
  const usageOf = (): LoopUsage => ({ perTurn: [...perTurn], total });
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const reply = await streamReply(input, messages);
    text = reply.text;
    perTurn.push(reply.usage);
    total = addUsage(total, reply.usage);
    if (reply.calls.length === 0) {
      return { stopped: 'answered', turns: turn, text, usage: usageOf() };
    }
    if (turn === MAX_TURNS) {
      break;
    }
    messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.calls });
    for (const call of reply.calls) {
      const content = await runCall(input.callTool, call);
      messages.push({ role: 'tool', toolCallId: call.id, content });
    }
  }
  return { stopped: 'turn-limit', turns: MAX_TURNS, text, usage: usageOf() };
}
