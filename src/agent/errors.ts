// Names an error for the agent's log without its message. SDK and fetch error messages can
// echo request details, including headers and the key, so only the status or the error name
// is returned. Pure, so tests can check that nothing secret gets through.

import { APIError } from 'openai';

export function describeError(error: unknown): string {
  if (error instanceof APIError) {
    return error.status !== undefined ? `HTTP ${error.status}` : error.name;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
