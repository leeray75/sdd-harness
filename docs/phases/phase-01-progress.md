# Phase 1 progress: Agent loop spike and provider adapters

Status: in progress · Started: 2026-11-18

Remote: `origin` = https://github.com/leeray75/sdd-harness.git; feature branches come into `main` through pull requests. agentgateway for live runs: `http://spark-8013.taileaa4a8.ts.net:4100/v1` (the `/v1` is needed for chat; `/models` also answers at the root).

Order changed from the suggested list: secrets come second, so every adapter reads keys from the keychain from the start; the spike uses a dev-only environment-variable key.

Subtask 1 runs against the user's agentgateway (OpenAI-compatible, `openai` SDK) instead of Anthropic; the Anthropic adapter and the check that the same loop runs on both providers move to `p1-provider-interface`.

| #   | Feature               | Goal                                                                                                                                                                                              | Status  | Spec                                                                                        | Commit                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | p1-spike-agent-loop   | Smallest streaming loop in the agent process against an OpenAI-compatible server (agentgateway), with one read-only tool round trip checked by main's gate; allowlisted agent env; fixture-tested | done    | [SUMMARY](../specs/p1-spike-agent-loop/SUMMARY.md)                                          | `36f5542` (PR #7; work in `0f40119`, close in `844bb44`)                     |
| 2   | p1-secrets            | API keys in the OS keychain via safeStorage, kept in main; redaction in logs and errors; tests that keys never appear in logs, errors or test output                                              | done    | [SUMMARY](../specs/p1-secrets/SUMMARY.md); fix [SUMMARY](../specs/p1-secrets-ci/SUMMARY.md) | `afaf22d` (PR #8; work `c871c28`, close `1ec6235`); CI fix `d9ca80d` (PR #9) |
| 3   | p1-provider-interface | Provider interface (messages, tool calls, streaming, token usage, errors, retries) and the Anthropic adapter; the spike loop moves onto it and runs on both providers                             | done    | [SUMMARY](../specs/p1-provider-interface/SUMMARY.md)                                        | `5d030ef` (PR #10; work `0995dbe`, close `a70723f`)                          |
| 4   | p1-openai-compatible  | OpenAI-compatible adapter: base URL, optional key, extra headers, presets for vLLM, Ollama, LM Studio, llama.cpp, TGI/SGLang, LiteLLM, agentgateway and Other; same loop runs                     | done    | [SUMMARY](../specs/p1-openai-compatible/SUMMARY.md)                                         | `84e2409` (PR #11; work `2d1816b`, close `2957757`)                          |
| 5   | p1-model-probes       | `/models` listing, chat probe and tool-use probe per model, with results (passed, unreliable, failed; latency; speed) a UI can show later                                                         | pending |                                                                                             |                                                                              |

## Decisions added

- D23 Agent loop and provider transport (own loop behind our interface; `@anthropic-ai/sdk` and `openai` SDKs for transport)
- D24 Testing provider adapters (recorded fixtures through an injected `fetch`; optional live suite only when keys or URLs are set)
- D17 amended by `p1-spike-agent-loop`: opt-in live suite in `tests/live` (`pnpm test:live`), outside `pnpm test`
- D19 amended by `p1-spike-agent-loop`: an allowed tool call runs in main and its output returns in `tool-call-result`; `failed` error code; the gate still denies by default
- D25 Provider key storage, delivery and redaction (`p1-secrets`; on Linux the test-only override also turns on plain-text encryption, `p1-secrets-ci`)
- D19 amended by `p1-secrets`: main sends the spike key to the agent in a per-run `model-key` message after its pong
- D26 Every model through agentgateway in development and the pilot (Bearer for Anthropic-format calls, base URL plus `/v1` for OpenAI-format calls) (`p1-provider-interface`); D23 and D25 notes added
- D27 Server presets, one address for both formats, and extra headers (`p1-openai-compatible`); D23 note on `defaultHeaders`

## Follow-ups

- `p1-spike-agent-loop` took one spec revision: `agentEnv` matched `SystemRoot` case-sensitively and dropped `SYSTEMROOT` on Windows, which broke the agent's sockets (`connect UNKNOWN`). Allowlist matching is now case-insensitive on win32 and `WINDIR` is allowed; keep this in mind whenever the env allowlist changes.
- PR #7 was merged while its CI run (and the `main` run 44462000669) was still in progress; it is the first macOS/Linux run of `tests/e2e/spike-agent.spec.ts` and of the symlink-escape tests in `read-file.test.ts`. Check that run is green before starting `p1-secrets`, and wait for green checks before merging from now on.
- ~~The spike e2e test checks for no "agent exited unexpectedly" line after `app.close()` instead of waiting on the close event (lint removed the unused promise); tighten it when the spike moves onto the provider interface.~~ Done in `p1-provider-interface`.
- On win32, if the parent env holds two spellings of one variable, `agentEnv` keeps the first seen.
- ~~`p1-provider-interface` should move `src/agent/loop.ts` onto the interface, add the Anthropic adapter, and re-run the same fixture and live tests on both providers (the phase "Definition of done").~~ Done in `p1-provider-interface`: fixture tests for both formats in CI; the user's live run passed for both.
- ~~`p1-secrets` replaces the spike's environment-variable key (`HARNESS_SPIKE_API_KEY`) with keychain storage in main; decide then whether main passes the key to the agent per request or makes the model calls itself.~~ Done in `p1-secrets`: the key lives in the secret store and reaches the agent in a per-run `model-key` message (D25); main makes no model calls.
- Agent-supplied strings are still logged without escaping control characters (Phase 0 follow-up, Phase 2).
- `p1-secrets-ci` fixed the spike e2e on Linux and macOS in two parts. (1) On Linux with no keyring, `HARNESS_ALLOW_WEAK_SECRETS=1` now also calls `safeStorage.setUsePlainTextEncryption(true)`, once per process, through the pure `shouldUsePlainTextEncryption` (D25). (2) The seed run in the spike e2e passes Playwright's `--use-mock-keychain` and `--password-store=basic`, so it encrypts with the same key source as the app run. Keep the two in step if either changes.
- PR #8 (`p1-secrets`) was merged while CI was red on Linux and macOS; `p1-secrets-ci` (PR #9) fixed it and was merged only after green CI on all three OSes (`main` green again at `d9ca80d`).
- Electron warns that the sync `safeStorage.decryptString` is deprecated; move the store to the async calls in a later subtask.
- Open `p1-secrets` notes: `secrets:delete` of a missing name exits 1; escaped-quote JSON header forms are not redacted; the spike e2e duplicates the socket server.
- The e2e uses Playwright's mock keychain, so the real macOS keychain (and any unsigned-app keychain prompt) is a runtime check, not covered by CI. Check it by hand on a Mac before a release that ships the secret store.
- `p1-provider-interface` follow-ups:
  - The Anthropic adapter is Bearer only. `@anthropic-ai/sdk` 1.10.0 sends `Authorization: Bearer` for `apiKey` too and never sends `x-api-key`, so the `x-api-key` mode was dropped (revision 1, D26). Recheck if the SDK changes.
  - The adapter sends the SDK's default `anthropic-version` (`2026-10-21`); the recorder uses the same constant, and a unit test checks it. The gateway accepted it, so the `2023-06-01` fallback was not needed.
  - The `anthropic` fixtures were re-recorded under the new version, and the user ran the recording. The `pnpm test:live` run for both formats is the user's, before result approval.
  - The base URL differs by format: the openai adapter adds `/v1`, the anthropic adapter adds `/v1/messages` itself. `HARNESS_SPIKE_BASE_URL` is the gateway root without `/v1` in the docs.
  - The spike e2e checks the openai fixture's wording ("The file notes.txt contains") and waits on the app's close event after `app.close()` (15 s). The "agent exited unexpectedly" check is gone, so the note above about it is closed.
  - The openai adapter sends `max_tokens` only when a request sets `maxTokens`; the spike sets none. Revisit when the cost display needs it.
  - ~~`p1-openai-compatible` should add the agentgateway preset with both formats (D26), and settle what a base URL ending in `/v1` does for the Anthropic format (today it gives `/v1/v1/messages`).~~ Done in `p1-openai-compatible` (D27): the agentgateway preset offers both formats, and one trailing `/v1` is stripped for the Anthropic format.
  - The old `spike` store entry is no longer read; run `pnpm secrets:set agentgateway` before using the spike in the app.
  - ~~The adapters use `key ?? 'no-key-set'`, so an empty-string key would send an empty token (likely unreachable: the store returns null or a non-empty value).~~ Done in `p1-openai-compatible`: both adapters use `key || 'no-key-set'`.
  - PR #10 was merged while its CI run was still in progress; the `main` run 44535131364 then passed on all three OSes (`main` green at `5d030ef`). Wait for green checks before merging.
- `p1-openai-compatible` follow-ups:
  - The live suite was not seen run against this build: the newest `pnpm test:live` run in the Terminal panel predates it. Run it once with a base URL ending in `/v1` to check the new address rule for both formats.
  - The reviewer did not open the test files, the e2e, the live suite or the docs other than `decisions.md`; AC7 to AC9 rest on the implementor's notes and its passing runs.
  - A header name that fails the HTTP-token rule is not echoed in the refusal (it could be a pasted value); reserved and duplicate names are.
  - `HARNESS_SPIKE_HEADERS` takes one `Name: value` per line (in PowerShell, separate lines with `` `n ``).
  - Header values are configuration, not secrets (D27). If a server needs a token header other than `Authorization` or `x-api-key`, revisit the reserved list and the redactor.
  - PR #11 was merged while its CI run was still in progress; the `main` run 44647948765 then passed on all three OSes, including the spike e2e header check on Linux and macOS (`main` green at `84e2409`). Wait for green checks before merging.

## Phase summary

(written when the phase is done)
