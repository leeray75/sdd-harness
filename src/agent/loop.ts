// Agent loop (D23, D32). Asks a Provider for one model reply per turn. Each request carries the
// run's job: its system prompt and the tools that job advertises. Tool calls run through an
// injected callTool, and each result goes back to the model. It imports no SDK: the provider
// adapters own the wire formats. It never reads the environment, never logs, and never sees the
// key. The caller's job decides what the model may ask for; main's gate decides what runs.
//
// Unparseable arguments, non-object arguments and a throwing callTool go back to the model as
// tool error text, never thrown.

import type { JobId } from '../shared/agent-protocol';
import { JOB_PROMPTS, jobToolDefinitions } from './jobs';
import type { Message, Provider, StreamEvent, ToolCall, Usage } from './provider/types';

/** Most model requests one run makes. Tool calls in the last allowed reply are not run. */
export const MAX_TURNS = 4;

/** What the tool runner reports back: the output, or why the call did not complete. */
export type ToolCallOutcome = { ok: true; output: string } | { ok: false; reason: string };

/** Runs one tool call. The caller decides whether it is allowed (main checks it). */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>;

export interface LoopInput {
  provider: Provider;
  model: string;
  /** The job this run does. Its system prompt and advertised tools come from the job table. */
  job: JobId;
  prompt: string;
  callTool: CallTool;
  /** Receives each streamed text chunk, in order. */
  onText: (text: string) => void;
  /** Most model requests this run makes. A value below 1 or not an integer means MAX_TURNS. */
  maxTurns?: number;
  /** Earlier messages of the same job's conversation, sent before the prompt. Not changed. */
  history?: Message[];
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
  /**
   * The run's full message list: the history, the prompt, the assistant turns and the tool
   * results. Passed back as the next run's history to continue the conversation.
   */
  messages: Message[];
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
    system: JOB_PROMPTS[input.job].system,
    messages: [...messages],
    tools: jobToolDefinitions(input.job),
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

/** The turn cap of a run: a positive integer as given, otherwise MAX_TURNS. */
function turnCap(maxTurns: number | undefined): number {
  return maxTurns !== undefined && Number.isInteger(maxTurns) && maxTurns >= 1
    ? maxTurns
    : MAX_TURNS;
}

/**
 * Runs the loop: the history, then one user prompt, up to the turn cap of model requests, tool
 * calls run in between. With no history and no cap, the requests are the same as before.
 */
export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const cap = turnCap(input.maxTurns);
  const messages: Message[] = [...(input.history ?? []), { role: 'user', text: input.prompt }];
  const perTurn: (Usage | null)[] = [];
  let total: Usage | null = null;
  let text = '';
  const usageOf = (): LoopUsage => ({ perTurn: [...perTurn], total });
  for (let turn = 1; turn <= cap; turn++) {
    const reply = await streamReply(input, messages);
    text = reply.text;
    perTurn.push(reply.usage);
    total = addUsage(total, reply.usage);
    if (reply.calls.length === 0) {
      messages.push({ role: 'assistant', text: reply.text, toolCalls: [] });
      return { stopped: 'answered', turns: turn, text, usage: usageOf(), messages };
    }
    if (turn === cap) {
      break;
    }
    messages.push({ role: 'assistant', text: reply.text, toolCalls: reply.calls });
    for (const call of reply.calls) {
      const content = await runCall(input.callTool, call);
      messages.push({ role: 'tool', toolCallId: call.id, content });
    }
  }
  return { stopped: 'turn-limit', turns: cap, text, usage: usageOf(), messages };
}
