# Phase 1 progress: Agent loop spike and provider adapters

Status: in progress · Started: 2026-11-18

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests. agentgateway for live runs: `http://spark-8013.taileaa4a8.ts.net:4100/v1` (the `/v1` is needed for chat; `/models` also answers at the root).

Order changed from the suggested list: secrets come second, so every adapter reads keys from the keychain from the start; the spike uses a dev-only environment-variable key.

Subtask 1 runs against the user's agentgateway (OpenAI-compatible, `openai` SDK) instead of Anthropic; the Anthropic adapter and the check that the same loop runs on both providers move to `p1-provider-interface`.

| #   | Feature               | Goal                                                                                                                                                                                              | Status  | Spec                                                                                        | Commit                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | p1-spike-agent-loop   | Smallest streaming loop in the agent process against an OpenAI-compatible server (agentgateway), with one read-only tool round trip checked by main's gate; allowlisted agent env; fixture-tested | done    | [SUMMARY](../specs/p1-spike-agent-loop/SUMMARY.md)                                          | `36f5542` (PR #7; work in `0f40119`, close in `844bb44`)                     |
| 2   | p1-secrets            | API keys in the OS keychain via safeStorage, kept in main; redaction in logs and errors; tests that keys never appear in logs, errors or test output                                              | done    | [SUMMARY](../specs/p1-secrets/SUMMARY.md); fix [SUMMARY](../specs/p1-secrets-ci/SUMMARY.md) | `afaf22d` (PR #8; work `c871c28`, close `1ec6235`); CI fix `d9ca80d` (PR #9) |
| 3   | p1-provider-interface | Provider interface (messages, tool calls, streaming, token usage, errors, retries) and the Anthropic adapter; the spike loop moves onto it and runs on both providers                             | pending |                                                                                             |                                                                              |
| 4   | p1-openai-compatible  | OpenAI-compatible adapter: base URL, optional key, extra headers, presets for vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other; same loop runs                     | pending |                                                                                             |                                                                              |
| 5   | p1-model-probes       | `/models` listing, chat probe and tool-use probe per model, with results (passed, unreliable, failed; latency; speed) a UI can show later                                                         | pending |                                                                                             |                                                                              |

## Decisions added

- D23 Agent loop and provider transport (own loop behind our interface; `@anthropic-ai/sdk` and `openai` SDKs for transport)
- D24 Testing provider adapters (recorded fixtures through an injected `fetch`; optional live suite only when keys or URLs are set)
- D17 amended by `p1-spike-agent-loop`: opt-in live suite in `tests/live` (`pnpm test:live`), outside `pnpm test`
- D19 amended by `p1-spike-agent-loop`: an allowed tool call runs in main and its output returns in `tool-call-result`; `failed` error code; the gate still denies by default
- D25 Provider key storage, delivery and redaction (`p1-secrets`; on Linux the test-only override also turns on plain-text encryption, `p1-secrets-ci`)
- D19 amended by `p1-secrets`: main sends the spike key to the agent in a per-run `model-key` message after its pong

## Follow-ups

- `p1-spike-agent-loop` took one spec revision: `agentEnv` matched `SystemRoot` case-sensitively and dropped `SYSTEMROOT` on Windows, which broke the agent's sockets (`connect UNKNOWN`). Allowlist matching is now case-insensitive on win32 and `WINDIR` is allowed; keep this in mind whenever the env allowlist changes.
- PR #7 was merged while its CI run (and the `main` run 44462000669) was still in progress; it is the first macOS/Linux run of `tests/e2e/spike-agent.spec.ts` and of the symlink-escape tests in `read-file.test.ts`. Check that run is green before starting `p1-secrets`, and wait for green checks before merging from now on.
- The spike e2e test checks for no "agent exited unexpectedly" line after `app.close()` instead of waiting on the close event (lint removed the unused promise); tighten it when the spike moves onto the provider interface.
- On win32, if the parent env holds two spellings of one variable, `agentEnv` keeps the first seen.
- `p1-provider-interface` should move `src/agent/loop.ts` onto the interface, add the Anthropic adapter, and re-run the same fixture and live tests on both providers (the phase "Definition of done").
- ~~`p1-secrets` replaces the spike's environment-variable key (`HARNESS_SPIKE_API_KEY`) with keychain storage in main; decide then whether main passes the key to the agent per request or makes the model calls itself.~~ Done in `p1-secrets`: the key lives in the secret store and reaches the agent in a per-run `model-key` message (D25); main makes no model calls.
- Agent-supplied strings are still logged without escaping control characters (Phase 0 follow-up, Phase 2).
- `p1-secrets-ci` fixed the spike e2e on Linux and macOS in two parts. (1) On Linux with no keyring, `HARNESS_ALLOW_WEAK_SECRETS=1` now also calls `safeStorage.setUsePlainTextEncryption(true)`, once per process, through the pure `shouldUsePlainTextEncryption` (D25). (2) The seed run in the spike e2e passes Playwright's `--use-mock-keychain` and `--password-store=basic`, so it encrypts with the same key source as the app run. Keep the two in step if either changes.
- PR #8 (`p1-secrets`) was merged while CI was red on Linux and macOS; `p1-secrets-ci` (PR #9) fixed it and was merged only after green CI on all three OSes (`main` green again at `d9ca80d`).
- Electron warns that the sync `safeStorage.decryptString` is deprecated; move the store to the async calls in a later subtask.
- Open `p1-secrets` notes: `secrets:delete` of a missing name exits 1; escaped-quote JSON header forms are not redacted; the spike e2e duplicates the socket server.
- The e2e uses Playwright's mock keychain, so the real macOS keychain (and any unsigned-app keychain prompt) is a runtime check, not covered by CI. Check it by hand on a Mac before a release that ships the secret store.

## Phase summary

(written when the phase is done)
