// Builds the right adapter from a server config (AC5, D27, p1-openai-compatible). A config names a
// preset (src/shared/server-presets.ts), a wire format, an address and extra headers. The factory
// checks them in a fixed order and refuses the first problem with a reason. A reason names the
// rule broken and never holds the key, a header value or the address, so a refusal cannot leak
// a secret. The key reaches the adapter only here, from the caller (D25).

import {
  getServerPreset,
  SERVER_PRESETS,
  type ServerPresetId,
  type WireFormat,
} from '../../shared/server-presets';
import { createAnthropicProvider } from './anthropic';
import { createOpenAIProvider } from './openai';
import { validateHeaders } from './headers';
import type { Provider } from './types';

export interface ServerConfig {
  /** A preset id from SERVER_PRESETS. */
  preset: string;
  /** A wire format the preset offers. Unset or empty means the preset's first format. */
  format?: string;
  /** The address. Unset or empty means the preset's default, when it has one. */
  baseURL?: string;
  /** Extra headers, validated by validateHeaders (reserved names are refused). */
  headers?: Record<string, string>;
}

export interface FactoryOptions {
  /** SDK retries for the adapter. The adapter's default when unset. */
  maxRetries?: number;
  /** Replaces the global fetch. Tests inject a fake here. */
  fetch?: typeof globalThis.fetch;
}

export type FactoryResult =
  | {
      ok: true;
      preset: ServerPresetId;
      format: WireFormat;
      baseURL: string;
      provider: Provider;
    }
  | { ok: false; reason: string };

/**
 * Builds the adapter for a server config and key. Refuses, in order: an unknown preset; a format
 * the preset does not offer; no address (none given and no default); an address that is not an
 * http or https URL, or that holds a user name or password; headers that fail validateHeaders.
 */
export function createProvider(
  config: ServerConfig,
  key: string | null,
  options: FactoryOptions = {},
): FactoryResult {
  const preset = getServerPreset(config.preset);
  if (preset === undefined) {
    const ids = SERVER_PRESETS.map((p) => p.id).join(', ');
    return { ok: false, reason: `the server preset is unknown; the presets are: ${ids}` };
  }

  const requested = (config.format ?? '').trim();
  let format: WireFormat;
  if (requested === '') {
    format = preset.formats[0];
  } else if (preset.formats.some((offered) => offered === requested)) {
    format = requested as WireFormat;
  } else {
    return {
      ok: false,
      reason: `preset "${preset.id}" does not offer the requested format; it offers ${preset.formats.join(', ')}`,
    };
  }

  const given = (config.baseURL ?? '').trim();
  let baseURL: string;
  if (given !== '') {
    baseURL = given;
  } else if (preset.defaultBaseURL !== null) {
    baseURL = preset.defaultBaseURL;
  } else {
    return {
      ok: false,
      reason: `preset "${preset.id}" has no default address; a base URL is required`,
    };
  }

  const addressRule = checkAddress(baseURL);
  if (addressRule !== null) {
    return { ok: false, reason: addressRule };
  }

  const headers = validateHeaders(config.headers ?? {});
  if (!headers.ok) {
    return { ok: false, reason: headers.reason };
  }

  const shared = {
    baseURL,
    key,
    headers: headers.headers,
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  const provider =
    format === 'openai' ? createOpenAIProvider(shared) : createAnthropicProvider(shared);
  return { ok: true, preset: preset.id, format, baseURL, provider };
}

/** The rule an address breaks, or null when it is usable. Never echoes the address. */
function checkAddress(baseURL: string): string | null {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return 'the base URL does not parse as a URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'the base URL must use http or https';
  }
  if (url.username !== '' || url.password !== '') {
    return 'the base URL must not contain a user name or a password';
  }
  return null;
}
