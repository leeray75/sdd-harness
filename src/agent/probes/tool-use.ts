// The tool-use probe (p1-model-probes, AC6). One run is up to two streamed requests, like the loop.
// Step 1 asks for the lookup_code tool; the first call must be lookup_code with arguments whose name
// is "harness" (trimmed, lowercased). Step 2 sends the assistant's call and a fixed tool result; the
// reply passes when its text contains the result's code, case-insensitively. The constants are
// exported, because the recorder uses them, so the recorded fixtures match what the probe sends.

import type { Provider, ToolCall, ToolDefinition } from '../provider/types';
import type { ProbeFailure } from './types';
import { runRequest, type RequestOutcome } from './stream';
import type { ProbeRunOptions, RunAttempt } from './chat';

export const TOOL_NAME = 'lookup_code';
/** The name the model must pass to the tool. */
export const TOOL_TARGET = 'harness';
/** The code the fixed tool result gives, and the reply must contain. */
export const TOOL_CODE = 'ZEBRA-7341';
/** The fixed result sent back to the model in step 2. */
export const TOOL_RESULT = `The code for ${TOOL_TARGET} is ${TOOL_CODE}.`;
/** The fixed prompt for step 1. */
export const TOOL_PROMPT = `Look up the code for the name ${TOOL_TARGET} with the ${TOOL_NAME} tool, then reply with the code.`;

/** The one tool the probe offers: a required string `name`, no other properties. */
export const LOOKUP_TOOL: ToolDefinition = {
  name: TOOL_NAME,
  description: 'Looks up the code for a name and returns it.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name to look up.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

/** The failure for the first call's name or arguments, or null when it is the expected call. */
export function checkLookupCall(call: ToolCall): ProbeFailure | null {
  if (call.name !== TOOL_NAME) {
    return 'wrong-tool';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    return 'bad-arguments';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'bad-arguments';
  }
  const name = (parsed as Record<string, unknown>)['name'];
  if (typeof name !== 'string' || name.trim().toLowerCase() !== TOOL_TARGET) {
    return 'wrong-arguments';
  }
  return null;
}

/** One tool-use probe run: step 1 (the call), then step 2 (the answer) when step 1 passed. */
export async function runToolUseOnce(
  provider: Provider,
  model: string,
  options: ProbeRunOptions,
): Promise<RunAttempt> {
  const requests: RequestOutcome[] = [];
  const first = await runRequest(
    provider,
    {
      model,
      messages: [{ role: 'user', text: TOOL_PROMPT }],
      tools: [LOOKUP_TOOL],
      maxTokens: options.maxTokens,
    },
    options,
  );
  requests.push(first);
  if (first.failure !== null) {
    return { passed: false, failure: first.failure, requests };
  }
  const call = first.toolCalls[0];
  if (call === undefined) {
    return { passed: false, failure: 'no-tool-call', requests };
  }
  const callFailure = checkLookupCall(call);
  if (callFailure !== null) {
    return { passed: false, failure: callFailure, requests };
  }

  const second = await runRequest(
    provider,
    {
      model,
      messages: [
        { role: 'user', text: TOOL_PROMPT },
        { role: 'assistant', text: first.text, toolCalls: [call] },
        { role: 'tool', toolCallId: call.id, content: TOOL_RESULT },
      ],
      tools: [LOOKUP_TOOL],
      maxTokens: options.maxTokens,
    },
    options,
  );
  requests.push(second);
  if (second.failure !== null) {
    return { passed: false, failure: second.failure, requests };
  }
  const passed = second.text.toLowerCase().includes(TOOL_CODE.toLowerCase());
  return { passed, failure: passed ? null : 'missing-token', requests };
}
