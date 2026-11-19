import {
  APIConnectionError as AnthropicConnectionError,
  APIConnectionTimeoutError as AnthropicTimeoutError,
  APIError as AnthropicAPIError,
  APIUserAbortError as AnthropicAbortError,
} from '@anthropic-ai/sdk';
import {
  APIConnectionError as OpenAIConnectionError,
  APIConnectionTimeoutError as OpenAITimeoutError,
  APIError as OpenAIAPIError,
  APIUserAbortError as OpenAIAbortError,
} from 'openai';
import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/agent/errors';
import { kindForStatus, toProviderError } from '../../src/agent/provider/errors';
import { ProviderError } from '../../src/agent/provider/types';

const SENTINEL = 'SENTINEL-KEY-do-not-leak-7731';

/** Headers and bodies that carry the sentinel, the way an SDK error can. */
function secretHeaders(): Headers {
  return new Headers({ authorization: `Bearer ${SENTINEL}` });
}

interface Family {
  name: string;
  apiError: (status: number) => unknown;
  connection: () => unknown;
  timeout: () => unknown;
  abort: () => unknown;
}

const families: Family[] = [
  {
    name: 'openai',
    apiError: (status) =>
      new OpenAIAPIError(
        status,
        { error: { message: SENTINEL } },
        `${SENTINEL} failed`,
        secretHeaders(),
      ),
    connection: () => new OpenAIConnectionError({ message: SENTINEL }),
    timeout: () => new OpenAITimeoutError({ message: SENTINEL }),
    abort: () => new OpenAIAbortError({ message: SENTINEL }),
  },
  {
    name: 'anthropic',
    apiError: (status) =>
      new AnthropicAPIError(
        status,
        { error: { message: SENTINEL } },
        `${SENTINEL} failed`,
        secretHeaders(),
      ),
    connection: () => new AnthropicConnectionError({ message: SENTINEL }),
    timeout: () => new AnthropicTimeoutError({ message: SENTINEL }),
    abort: () => new AnthropicAbortError({ message: SENTINEL }),
  },
];

describe('kindForStatus', () => {
  it('maps auth, rate-limit, bad-request and server statuses', () => {
    expect(kindForStatus(401)).toBe('auth');
    expect(kindForStatus(403)).toBe('auth');
    expect(kindForStatus(429)).toBe('rate-limit');
    expect(kindForStatus(400)).toBe('bad-request');
    expect(kindForStatus(404)).toBe('bad-request');
    expect(kindForStatus(500)).toBe('server');
    expect(kindForStatus(503)).toBe('server');
    expect(kindForStatus(302)).toBe('unknown');
  });
});

describe.each(families)('$name SDK errors', (family) => {
  it('maps 401 and 403 to auth, not retryable', () => {
    for (const status of [401, 403]) {
      const error = toProviderError(family.apiError(status));
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.kind).toBe('auth');
      expect(error.status).toBe(status);
      expect(error.retryable).toBe(false);
    }
  });

  it('maps 429 to rate-limit, retryable', () => {
    const error = toProviderError(family.apiError(429));
    expect(error.kind).toBe('rate-limit');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('maps 400 to bad-request, not retryable', () => {
    const error = toProviderError(family.apiError(400));
    expect(error.kind).toBe('bad-request');
    expect(error.retryable).toBe(false);
  });

  it('maps 500 to server, retryable', () => {
    const error = toProviderError(family.apiError(500));
    expect(error.kind).toBe('server');
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(true);
  });

  it('maps a connection failure and a timeout to network, retryable, without a status', () => {
    for (const raw of [family.connection(), family.timeout()]) {
      const error = toProviderError(raw);
      expect(error.kind).toBe('network');
      expect(error.status).toBeUndefined();
      expect(error.retryable).toBe(true);
    }
  });

  it('maps an abort to aborted, not retryable', () => {
    const error = toProviderError(family.abort());
    expect(error.kind).toBe('aborted');
    expect(error.retryable).toBe(false);
  });

  it('never carries the sentinel in the message, the describeError text or the properties', () => {
    const raws = [family.apiError(401), family.apiError(500), family.connection(), family.abort()];
    for (const raw of raws) {
      const error = toProviderError(raw);
      expect(error.message).not.toContain(SENTINEL);
      expect(describeError(error)).not.toContain(SENTINEL);
      expect(describeError(raw)).not.toContain(SENTINEL);
      expect(JSON.stringify({ ...error })).not.toContain(SENTINEL);
    }
  });
});

describe('toProviderError on other errors', () => {
  it('maps a plain fetch AbortError to aborted', () => {
    expect(toProviderError(new DOMException('aborted', 'AbortError')).kind).toBe('aborted');
  });

  it('maps an unknown error to unknown, without its message', () => {
    const error = toProviderError(new Error(`${SENTINEL} boom`));
    expect(error.kind).toBe('unknown');
    expect(error.message).not.toContain(SENTINEL);
  });

  it('returns a ProviderError unchanged', () => {
    const original = new ProviderError('server', 503);
    expect(toProviderError(original)).toBe(original);
  });
});

describe('describeError', () => {
  it('returns the ProviderError message for a ProviderError', () => {
    const error = new ProviderError('rate-limit', 429);
    expect(describeError(error)).toBe(error.message);
    expect(describeError(error)).toBe('provider rate-limit error (HTTP 429)');
  });

  it('keeps the existing safe text for SDK errors', () => {
    expect(describeError(new OpenAIAPIError(401, {}, SENTINEL, secretHeaders()))).toBe('HTTP 401');
    expect(describeError(new AnthropicAPIError(500, {}, SENTINEL, secretHeaders()))).toBe(
      'HTTP 500',
    );
  });
});
