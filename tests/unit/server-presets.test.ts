import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getServerPreset,
  SERVER_PRESETS,
  type ServerPresetId,
} from '../../src/shared/server-presets';

const SOURCE = fileURLToPath(new URL('../../src/shared/server-presets.ts', import.meta.url));

describe('SERVER_PRESETS (AC1)', () => {
  it('has exactly the rows of the table, in order', () => {
    expect(SERVER_PRESETS.map((p) => [p.id, p.label, p.defaultBaseURL, [...p.formats]])).toEqual([
      ['vllm', 'vLLM', 'http://localhost:8000', ['openai']],
      ['ollama', 'Ollama', 'http://localhost:11434/v1', ['openai']],
      ['lm-studio', 'LM Studio', 'http://localhost:1234', ['openai']],
      ['llama-cpp', 'llama.cpp server', 'http://localhost:8080', ['openai']],
      ['tgi-sglang', 'TGI / SGLang', null, ['openai']],
      ['litellm', 'LiteLLM', 'http://localhost:4000', ['openai']],
      ['agentgateway', 'agentgateway', null, ['openai', 'anthropic']],
      ['other', 'Other', null, ['openai', 'anthropic']],
    ]);
  });

  it('offers at least one format for every preset, with openai first', () => {
    for (const preset of SERVER_PRESETS) {
      expect(preset.formats.length).toBeGreaterThan(0);
      expect(preset.formats[0]).toBe('openai');
    }
  });

  it('has unique ids', () => {
    const ids = SERVER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getServerPreset', () => {
  it('returns the preset for each id in the table', () => {
    for (const preset of SERVER_PRESETS) {
      expect(getServerPreset(preset.id)).toBe(preset);
    }
  });

  it('returns undefined for an unknown id, a case variant or an inherited name', () => {
    expect(getServerPreset('nope')).toBeUndefined();
    expect(getServerPreset('VLLM')).toBeUndefined();
    expect(getServerPreset('constructor')).toBeUndefined();
    expect(getServerPreset('')).toBeUndefined();
  });

  it('types its ids as the union of the table ids', () => {
    const id: ServerPresetId = 'agentgateway';
    expect(getServerPreset(id)?.label).toBe('agentgateway');
  });
});

describe('server-presets.ts imports', () => {
  it('imports nothing from src/agent, src/main or either SDK', () => {
    const source = readFileSync(SOURCE, 'utf8');
    // Module specifiers: `from '...'` in import and re-export statements, or a bare `import '...'`.
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm),
    ].map((match) => match[1] ?? match[2] ?? '');
    expect(specifiers).toEqual([]);
    const forbidden = /(^|\/)(agent|main)(\/|$)|^src\/(agent|main)|^openai$|^@anthropic-ai\/sdk/;
    for (const specifier of specifiers) {
      expect(forbidden.test(specifier), `forbidden import: ${specifier}`).toBe(false);
    }
    expect(source).not.toMatch(/require\(/);
  });
});
