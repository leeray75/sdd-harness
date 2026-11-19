// Names an error for the agent's log without its message. SDK and fetch error messages can
// echo request details, including headers and the key, so only the status or the error name
// is returned. A ProviderError's message is already built from its kind and status only, so it
// is returned as it is. Pure, so tests can check that nothing secret gets through.

import { APIError as AnthropicAPIError } from '@anthropic-ai/sdk';
import { APIError as OpenAIAPIError } from 'openai';
import { ProviderError } from './provider/types';

export function describeError(error: unknown): string {
  if (error instanceof ProviderError) {
    return error.message;
  }
  if (error instanceof OpenAIAPIError || error instanceof AnthropicAPIError) {
    return error.status !== undefined ? `HTTP ${error.status}` : error.name;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
