// Server presets (D27, p1-openai-compatible): the server types the agent can reach, as pure data.
// A preset fills in the default address (or none) and the wire formats the server offers. It
// imports nothing from src/agent, src/main or an SDK, so the Phase 8 Add-a-server screen can read
// the same table. The first format a preset offers is its default.

/** The two wire formats an adapter speaks (D23, D26). */
export type WireFormat = 'openai' | 'anthropic';

export type ServerPresetId =
  | 'vllm'
  | 'ollama'
  | 'lm-studio'
  | 'llama-cpp'
  | 'tgi-sglang'
  | 'litellm'
  | 'agentgateway'
  | 'other';

export interface ServerPreset {
  id: ServerPresetId;
  label: string;
  /** The address the preset fills in, or null when the address must be given. */
  defaultBaseURL: string | null;
  /** The wire formats the server offers. Never empty; the first one is the default. */
  formats: readonly [WireFormat, ...WireFormat[]];
}

export const SERVER_PRESETS: readonly ServerPreset[] = [
  {
    id: 'vllm',
    label: 'vLLM',
    defaultBaseURL: 'http://localhost:8000',
    formats: ['openai'],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    defaultBaseURL: 'http://localhost:11434/v1',
    formats: ['openai'],
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    defaultBaseURL: 'http://localhost:1234',
    formats: ['openai'],
  },
  {
    id: 'llama-cpp',
    label: 'llama.cpp server',
    defaultBaseURL: 'http://localhost:8080',
    formats: ['openai'],
  },
  {
    id: 'tgi-sglang',
    label: 'TGI / SGLang',
    defaultBaseURL: null,
    formats: ['openai'],
  },
  {
    id: 'litellm',
    label: 'LiteLLM',
    defaultBaseURL: 'http://localhost:4000',
    formats: ['openai'],
  },
  {
    id: 'agentgateway',
    label: 'agentgateway',
    defaultBaseURL: null,
    formats: ['openai', 'anthropic'],
  },
  {
    id: 'other',
    label: 'Other',
    defaultBaseURL: null,
    formats: ['openai', 'anthropic'],
  },
];

/** The preset with this id, or undefined. Matches the id exactly. */
export function getServerPreset(id: string): ServerPreset | undefined {
  return SERVER_PRESETS.find((preset) => preset.id === id);
}
