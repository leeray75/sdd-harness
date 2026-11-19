// Maps the SDK errors from both adapters to ProviderError (AC4). The SDK error messages can
// echo headers, URLs and the key, so the mapping keeps only the kind and the status. Each
// adapter's errors are checked by their own class, because the two SDKs are separate packages.

import {
  APIConnectionError as AnthropicConnectionError,
  APIError as AnthropicAPIError,
  APIUserAbortError as AnthropicAbortError,
} from '@anthropic-ai/sdk';
import {
  APIConnectionError as OpenAIConnectionError,
  APIError as OpenAIAPIError,
  APIUserAbortError as OpenAIAbortError,
} from 'openai';
import { ProviderError, type ProviderErrorKind } from './types';

/** The kind for an HTTP status: auth for 401 and 403, rate-limit for 429, otherwise 4xx and 5xx. */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 429) {
    return 'rate-limit';
  }
  if (status >= 400 && status < 500) {
    return 'bad-request';
  }
  if (status >= 500 && status < 600) {
    return 'server';
  }
  return 'unknown';
}

/** True for a fetch or DOM abort that the SDK did not wrap. */
function isAbortLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Converts any error from an adapter's SDK call into a ProviderError. Pure. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof OpenAIAbortError || error instanceof AnthropicAbortError) {
    return new ProviderError('aborted');
  }
  if (isAbortLike(error)) {
    return new ProviderError('aborted');
  }
  if (error instanceof OpenAIConnectionError || error instanceof AnthropicConnectionError) {
    // Covers timeouts too: the timeout classes extend the connection error.
    return new ProviderError('network');
  }
  if (error instanceof OpenAIAPIError || error instanceof AnthropicAPIError) {
    const status = typeof error.status === 'number' ? error.status : undefined;
    if (status === undefined) {
      return new ProviderError('unknown');
    }
    return new ProviderError(kindForStatus(status), status);
  }
  return new ProviderError('unknown');
}
