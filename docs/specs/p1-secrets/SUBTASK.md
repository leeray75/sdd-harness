# Secrets: provider keys in the OS keychain, redacted everywhere, sent to the agent per run

**Parent:** none: no parent chosen (Phase 1, subtask 2)
**Spec:** docs/specs/p1-secrets/SPECS.md
**Repo and base branch:** sdd-harness, main, feature branch feature/p1-secrets

## Context

The spike gets its provider key from the app's environment, and main passes it into the agent's environment. Nothing stores keys in the keychain or redacts them from logs. This subtask adds a `safeStorage` secret store in main that refuses weak encryption, and redacts every line main writes, including forwarded agent output. It sends the key to the agent in a per-run `model-key` message, moves the spike onto the store with a dev-only `pnpm secrets:*` script, and proves a sentinel key never leaks.

## Required work

- T1 Redaction helper.
- T2 Secret store.
- T3 Electron wiring.
- T4 Redacting logger.
- T5 model-key message.
- T6 Agent env without keys.
- T7 Host sends the key.
- T8 Agent starts on model-key.
- T9 SDK error and router leak tests.
- T10 Dev secrets mode and script.
- T11 Spike e2e on the store.
- T12 Documentation.
- T13 Full check.

## Acceptance criteria

See AC1–AC15 in docs/specs/p1-secrets/SPECS.md, copied here:

- **AC1 (store):** a store from injected crypto, path, platform, override and redactor; `save`, `read`, `delete`, `listNames`; name and value checks; JSON v1 file written atomically with `0o600`; `delete`/`listNames` never decrypt; a fake-crypto test shows no plaintext on disk and `read` returns the value.
- **AC2 (refusal):** `save` refuses with a value-free error when encryption is unavailable, or on Linux with `basic_text`/`unknown` and no override; nothing changes on disk; the override accepts `basic_text`; an undecryptable entry's error names the entry only; no store error contains a value or ciphertext.
- **AC3 (Electron wiring):** the store is built from `safeStorage`, `userData/secrets.json`, the platform, `HARNESS_ALLOW_WEAK_SECRETS` and the shared redactor, after app ready; the override never reaches the agent.
- **AC4 (redaction):** registered values, `Bearer` tokens, `Authorization`/`x-api-key` header values and `sk-`/`sk-ant-` strings of 20 or more characters are replaced with `[redacted]`; near-misses stay unchanged; unit tests cover each rule.
- **AC5 (store registers):** `read` registers each returned value with the redactor.
- **AC6 (logger):** `info`, `error` and `forward` redact before writing; tested with stubbed streams and a sentinel.
- **AC7 (protocol):** a `model-key` main-to-agent message with `key: string | null` (≤ 4,096 characters); the guard's cases are tested; rejection reasons never echo values.
- **AC8 (env):** the agent env passes no key variable, even with the spike flag on; `HARNESS_ALLOW_WEAK_SECRETS` is dropped.
- **AC9 (host):** with the spike flag, after the pong, main sends `model-key` once with the stored `spike` key or `null`; a store error is logged redacted and sends `null`; a pure function decides, with unit tests.
- **AC10 (agent):** the spike starts on `model-key` (once), uses its key or the no-key placeholder, reads no key from the env, never prints it; `model-key` is ignored without the flag; the self-check is unchanged.
- **AC11 (SDK errors):** a 401 echoing the sentinel and a fetch throwing with the sentinel leave no sentinel after error naming and redaction; a router test shows the same for tool failures and router logs.
- **AC12 (dev secrets mode):** unpackaged `--harness-secrets=set|delete|list` mode with no window or agent, the value from stdin, printing only operation, name and outcome, exit 0/1; `pnpm secrets:*` script with hidden input, never putting the value on the command line, in the env or in a file; Windows stdin checked during the build.
- **AC13 (spike e2e):** a temp user-data dir, seeded through the secrets mode; the app runs with no `HARNESS_SPIKE_API_KEY`; every chat request carried `Bearer <sentinel>`; the spike finishes as before; the sentinel is absent from all output and from `secrets.json`.
- **AC14 (docs):** D25 added and D19 amended; CHANGELOG, README and CLAUDE.md updated; the phase follow-up struck; no stale statements about `HARNESS_SPIKE_API_KEY`.
- **AC15 (full check):** typecheck, lint, format:check and test pass; `pnpm e2e` passes locally on Windows.

## Out of scope

- Any settings UI for entering keys (Phase 8).
- The provider interface and adapters (`p1-provider-interface`, `p1-openai-compatible`).
- Cloud platform credentials (Bedrock, Azure, Vertex).
- Exports and sessions, which don't exist yet; the redaction helper is written so they can use it later.
- Escaping control characters in agent-supplied strings in logs (Phase 2 follow-up).
- Changing the live suite: `pnpm test:live` keeps reading `HARNESS_SPIKE_API_KEY` from its environment.
- A loopback proxy, or model calls made from main.

## Links

- Plan: docs/specs/p1-secrets/PLAN.md
- Spec and tasks: docs/specs/p1-secrets/SPECS.md, docs/specs/p1-secrets/tasks.md
