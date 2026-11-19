# Plan: p1-secrets

Ticket: none (vibe planning; Phase 1, subtask 2)
Status: approved
Date: 2026-11-19

## Objective

Provider API keys live in the OS keychain through Electron `safeStorage`. Main holds them, and they never appear in logs, errors, files or test output. The spike's dev-only environment key (`HARNESS_SPIKE_API_KEY`) is replaced: main reads the key from the store and sends it to the agent in a typed message at the start of each run. Every line main writes, including the agent output it forwards, goes through a redaction helper first.

## Scope

- **In:** a main-process secret store (save, read, delete, list names) with safeStorage ciphertext in app data; refusing to save when encryption is unavailable or only `basic_text`; a redaction helper wired into main's logger (including forwarded agent lines), the router and error paths; a per-run key message from main to the agent; moving the spike onto the store; a dev-only `pnpm secrets:*` script; unit and e2e tests that a sentinel key never leaks; the decision recorded as D25; docs and CHANGELOG.
- **Out:** a settings UI for keys (Phase 8); the provider interface and adapters (`p1-provider-interface`, `p1-openai-compatible`); cloud platform credentials (Bedrock, Azure, Vertex); exports and sessions (the redaction helper is written so they can use it later); escaping control characters in agent strings (Phase 2 follow-up); the live suite, which keeps reading its key from the environment because it runs the loop outside the app.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base branch | `p1-secrets`, sdd-harness, `main` → `feature/p1-secrets` | (defaults, not asked) |
| How a stored key reaches a model call | Main sends the key to the agent in a typed message at the start of each run; the agent keeps it in memory only (never in its env, on disk or in a log). Recorded as D25 | A loopback proxy in main that adds the key, so the agent never holds it (more code: a local listener, SSE pass-through, a per-run token); main making the model calls and streaming chunks to the agent (moves transport out of the agent, amends D23) |
| Linux without a keyring (`basic_text` backend) | Treated as unavailable: saving is refused with a clear error. A test-only flag `HARNESS_ALLOW_WEAK_SECRETS=1`, set only by the e2e tests, allows it so Linux CI still runs | Accept `basic_text` with a warning (effectively plaintext); start gnome-keyring in Linux CI with no override (closer to real use, more fragile CI) |
| Getting a key into the store before Phase 8 | `pnpm secrets:set <name>` (plus `secrets:list`, `secrets:delete`): a dev-only Node script reads the key from hidden input and pipes it over stdin to the app started in a secrets mode, which writes it with the same store module. The e2e test seeds its store the same way | Main imports `HARNESS_SPIKE_API_KEY` from the env into the store at startup (simpler, but the key still starts in the env) |
| What redaction removes | Every key value the store has handed out (registered when read), plus Bearer tokens, `Authorization` and `x-api-key` header values, and `sk-…` / `sk-ant-…` strings, each replaced with `[redacted]` | Only registered key values (fewer false positives, but a key that never went through the store could leak) |
| Secrets file layout (default) | `secrets.json` in `app.getPath('userData')`: `{ "version": 1, "entries": { "<name>": "<base64 ciphertext>" } }`, written atomically (temp file and rename) with mode `0o600`. Names match `^[a-z0-9][a-z0-9-]{0,63}$` | (default, not asked) |
| Spike key name (default) | `spike`. With no stored key, main sends `null` and the agent uses the existing no-key placeholder, so servers that need no key still work | (default, not asked) |

## Approach

1. **Store** — `src/main/secrets/store.ts`: a pure module taking an injected crypto (`isEncryptionAvailable`, `getSelectedStorageBackend`, `encryptString`, `decryptString`), a file path, the platform and the weak-backend override. `save` refuses (with a clear error, writing nothing) when encryption is unavailable, or the backend is `basic_text` or `unknown` without the override. `read` decrypts and registers the value with the redactor. `delete` and `listNames` never decrypt. Errors never include a key or ciphertext. `src/main/secrets/electron.ts` builds it from Electron's `safeStorage` and `app.getPath('userData')`. It is used only after app ready.
2. **Redaction** — `src/main/secrets/redact.ts`: `register(value)` and `redact(text)` with the known-value and shape rules above. A process-wide redactor is shared by the store and the logger.
3. **Logger** — `src/main/log.ts`: `info`, `error` and `forward` all pass the line through `redact` before writing. The router and host error paths already log through it.
4. **Protocol** — `src/shared/agent-protocol.ts`: a new main-to-agent message `{ type: 'model-key', key: string | null }` (key ≤ 4,096 characters). The guard's rejection reasons never echo field values. D19 is amended.
5. **Host and agent** — `host.ts`: `HARNESS_SPIKE_API_KEY` is removed from the spike variables, so the agent env never carries a key. When the spike flag is `1`, main reads `spike` from the store after the pong and sends `model-key`. A store error is logged (redacted) and `null` is sent. `src/agent/index.ts`: the spike starts when `model-key` arrives, not on the ping, and builds its client from that key. The key is never printed.
6. **Dev secrets mode** — `src/main/index.ts`: when the app is not packaged and started with `--harness-secrets=<set|delete|list>` (and a name), main opens no window and no agent. It reads the key from stdin for `set`, runs the store call, prints only the name and outcome, and quits with a non-zero code on failure. `scripts/secrets.ts` (`pnpm secrets:set|list|delete`) prompts with hidden input and starts the built app in that mode with the key on stdin. It never puts the key on the command line or in the env.
7. **Tests** — unit tests for the store (fake crypto and a temp dir; no plaintext on disk; refusal writes nothing; the `basic_text` rules; bad names), redaction (each rule), the logger (forwarded agent lines are redacted), the protocol guard, the host's key message and the env (no key variable passes even when the flag is on), and an SDK error with a sentinel (a 401 whose body echoes the key, and a fetch that throws with the key in its message). Nothing the agent logs, and nothing main logs after redaction, contains the sentinel. The spike e2e seeds a temp user-data dir through the secrets mode, with `HARNESS_ALLOW_WEAK_SECRETS=1`. It then checks that the replay server received `Authorization: Bearer <sentinel>` (proving the key came from the store) and that the app output never contains the sentinel.
8. **Docs** — D25 in `docs/decisions.md`; D19 amended; `CHANGELOG.md` `[Unreleased]`; the spike section in `README.md` and `CLAUDE.md` (use `pnpm secrets:set spike`; `HARNESS_SPIKE_API_KEY` is now read only by `pnpm test:live`); the p1-secrets follow-up in `phase-01-progress.md` marked done; a grep for statements the change made false.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Main's log has one module, and every line goes through `info`, `error` or `forward` | `src/main/log.ts` |
| The agent env passes `HARNESS_SPIKE_API_KEY` today, only under the spike flag | `src/main/agent/host.ts:32` |
| The agent reads the key from its env and names errors without their messages | `src/agent/index.ts:63-77` |
| The router never logs args or output, and swallows tool error text | `src/main/agent/router.ts:46-58` |
| The spike e2e already uses a sentinel and a local replay server it controls, so it can check the Authorization header | `tests/e2e/spike-agent.spec.ts:9,16-44,63` |
| The live test runs the loop outside the app, with its key from the env | `tests/live/spike.live.test.ts:13,25` |
| The next decision number is D25 | `docs/decisions.md` ends at D24 |
| CI is green on `main` after PR #7 (all three OSes) | `gh run list`: 44462000669 and 44462161265 success |

## Risks

- **Electron's stdin on Windows.** On Windows the Electron main process is a GUI-subsystem app, so a piped stdin may not reach `process.stdin`. The secrets-mode task checks this first. If it fails, the script passes the key through an inherited pipe handle, or a one-time file in a private temp dir that is deleted right after it is read. That change would come back as a spec question.
- **macOS keychain prompt in CI.** safeStorage on macOS can show a keychain access prompt for an unsigned app. The first macOS e2e run in CI shows whether it does. If it does, the e2e sets `HARNESS_ALLOW_WEAK_SECRETS=1` only where the backend is weak, and a macOS-specific fallback is raised as a spec question.
- **`--user-data-dir` isolation.** The e2e relies on Electron honouring `--user-data-dir=<tmp>` for `app.getPath('userData')`. If it doesn't, main reads `HARNESS_USER_DATA_DIR` in unpackaged builds only. The e2e task checks this.
- **Over-eager shape redaction** could mask harmless text (for example an `sk-` prefix in prose). The shapes need a minimum length (≥ 20 characters after the prefix), and tests cover a near-miss.
- **Keys in agent memory.** The agent holds the key for the length of a run. It has no tools of its own and logs only through stdout, which main redacts. D25 records this as the accepted trade-off.

## Open questions

none
