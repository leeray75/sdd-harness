# Phase 1 progress: Agent loop spike and provider adapters

Status: in progress · Started: 2026-11-18

Order changed from the suggested list: secrets come second, so every adapter reads keys from the keychain from the start; the spike uses a dev-only environment-variable key.

| #   | Feature               | Goal                                                                                                                                                                          | Status  | Spec | Commit |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------ |
| 1   | p1-spike-agent-loop   | Smallest streaming loop in the agent process against Anthropic, with one read-only tool round trip checked by main's gate; allowlisted agent env; fixture-tested              | pending |      |        |
| 2   | p1-secrets            | API keys in the OS keychain via safeStorage, kept in main; redaction in logs and errors; tests that keys never appear in logs, errors or test output                          | pending |      |        |
| 3   | p1-provider-interface | Provider interface (messages, tool calls, streaming, token usage, errors, retries) and the Anthropic adapter; the spike loop moves onto it                                    | pending |      |        |
| 4   | p1-openai-compatible  | OpenAI-compatible adapter: base URL, optional key, extra headers, presets for vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other; same loop runs | pending |      |        |
| 5   | p1-model-probes       | `/models` listing, chat probe and tool-use probe per model, with results (passed, unreliable, failed; latency; speed) a UI can show later                                     | pending |      |        |

## Decisions added

- D23 Agent loop and provider transport (own loop behind our interface; `@anthropic-ai/sdk` and `openai` SDKs for transport)
- D24 Testing provider adapters (recorded fixtures through an injected `fetch`; optional live suite only when keys or URLs are set)

## Follow-ups

- (none yet)

## Phase summary

(written when the phase is done)
