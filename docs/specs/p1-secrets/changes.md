# Changes: p1-secrets

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/secrets/redact.ts | created | Redactor with `register` and `redact`, and the process-wide instance; known values, Bearer tokens, Authorization and x-api-key headers, sk- shapes (AC4). Round 1 narrows the Bearer separator to spaces and tabs, so a line break is not taken as a separator (R1-1, round 1). | T1; R1-1, round 1 |
| tests/unit/redact.test.ts | created | Unit tests for every redaction rule, a repeated value, a value inside JSON, and near-misses (AC4). Round 1 adds a test that a bare Bearer followed by a line break is unchanged (R1-1, round 1). | T1; R1-1, round 1 |
| src/main/secrets/store.ts | created | Secret store over injected crypto, path, platform, weak-backend override and redactor; atomic 0o600 writes; name and value checks; refusal before any disk change; registration on read (AC1, AC2, AC5). | T2 |
| tests/unit/secret-store.test.ts | created | Fake crypto and temp dir tests: no plaintext on disk, refusal writes nothing, basic_text rules, bad names and values, read registration, decrypt failure message (AC1, AC2, AC5). | T2 |
| src/main/secrets/electron.ts | created | Builds the store from safeStorage, `userData/secrets.json`, `process.platform`, `HARNESS_ALLOW_WEAK_SECRETS` and the shared redactor (AC3). | T3 |
| src/main/log.ts | edited | `info`, `error` and `forward` now pass each line through the process-wide redactor before writing (AC6). | T4 |
| tests/unit/log.test.ts | created | Stubbed stdout and stderr: a registered sentinel and a Bearer token are absent from all three methods, including forwarded agent lines (AC6). | T4 |
| src/shared/agent-protocol.ts | edited | Adds the main-to-agent `model-key` message (`key: string \| null`, at most 4,096 characters) and its guard; reasons never echo the key (AC7). | T5 |
| tests/unit/agent-protocol.test.ts | edited | Cases for `model-key` (valid, null, missing, non-string, oversized) and a sentinel check on the rejection reasons (AC7). | T5 |
| src/main/agent/host.ts | edited | Removes `HARNESS_SPIKE_API_KEY` from the spike variables (T6). Sends `model-key` once per agent process after the pong, using `decideModelKey` and the store (T7). | T6, T7 |
| tests/unit/agent-env.test.ts | edited | The spike key is dropped with the flag on and off, in any case on win32; `HARNESS_ALLOW_WEAK_SECRETS` is dropped (AC8). The spike variables expectation no longer includes the key. | T6 |
| src/main/agent/model-key.ts | created | Pure `decideModelKey`: null with the flag off; the stored `spike` key or null when absent; null with a redacted error when the store throws (AC9). | T7 |
| tests/unit/model-key.test.ts | created | Fake store: present, absent, throwing, flag off; no key in any log line (AC9). | T7 |
| src/agent/index.ts | edited | Spike starts on `model-key`, once per process, with the key from the message or the placeholder; the agent no longer reads any key from its env; `model-key` is ignored without the flag (AC10). | T8 |
| src/agent/errors.ts | created | `describeError`, moved out of the agent entry point so tests can use it (AC11). | T8 |
| tests/unit/agent-loop.test.ts | edited | Sentinel tests: a 401 that echoes the key and header, and a fetch that throws with the key in its message; naming and redaction leave no sentinel (AC11). | T9 |
| tests/unit/agent-router.test.ts | edited | Sentinel through a throwing runner and a failure reason; the router's log lines and reply hold no sentinel (AC11). | T9 |
| src/main/secrets/dev-mode.ts | created | Pure parts of the dev secrets mode: switch parsing (set takes `--harness-secret-pipe`, checked per platform), the store call and its output lines (AC12). Revision 1 removed the stdin trimming. | T10, revision 1 (first written in round 0); R1-2, round 1 |
| src/main/index.ts | edited | Secrets mode for unpackaged runs with `--harness-secrets=`: no window, no agent, exit codes 0 and 1 (AC12). Revision 1 replaces the stdin read with the one-shot socket client (`readSecretFromPipe`), and reports the reason for a failed read. | T10, revision 1 |
| src/main/secrets/pipe.ts | created | Client read of the value from the one-shot local socket: address check, one connection, 10 s timeout, 4,096-character cap, nothing logged (AC12). | T10, revision 1 |
| scripts/secrets.ts | created | `pnpm secrets:*` script: hidden prompt or its own piped stdin (one trailing newline trimmed, empty refused), a one-connection server at a random named pipe or a 0o700 temp socket, starts the app in secrets mode, removes the temp dir (AC12). | T10, revision 1 |
| package.json | edited | Adds the `secrets:set`, `secrets:list` and `secrets:delete` scripts. | T10, revision 1 |
| tests/unit/pipe.test.ts | created | Address checks, and the socket read against a real local server: success, length limit, oversized, timeout, nothing listening, bad address, empty value (AC12). | T10, revision 1 |
| tests/unit/dev-mode.test.ts | created | Switch parsing, the pipe address check per platform, and the store call outcomes with a fake store (AC12). Round 1 updates the asserted failure text to "no value received" (R1-2, round 1). | T10, revision 1; R1-2, round 1 |
| tests/e2e/spike-agent.spec.ts | edited | Seeds the `spike` entry through a one-shot socket handoff, in a temp `--user-data-dir`; no `HARNESS_SPIKE_API_KEY`; records each Authorization header; checks the sentinel is absent from both runs' output and from `secrets.json` (AC13). | T11, revision 1 |
| docs/decisions.md | edited | D25 added (key storage, delivery, redaction, alternatives, and the socket handoff); D19 amended for `model-key` (AC14). | T12, revision 1 |
| CHANGELOG.md | edited | `[Unreleased]` entries for the store, redaction, dev commands, `model-key`, and the spike key change (AC14). | T12, revision 1 |
| README.md | edited | Removes the spike key row; adds the dev-only store block; updates the spike wording and table alignment (AC14). | T12, revision 1 |
| CLAUDE.md | edited | Spike section and command list describe `pnpm secrets:set spike`; `HARNESS_SPIKE_API_KEY` is read only by `pnpm test:live` (AC14). | T12, revision 1 |
| docs/phases/phase-01-progress.md | edited | Strikes the `p1-secrets` follow-up as done (AC14). | T12, revision 1 |
| docs/specs/p1-secrets/tasks.md | edited | Ticked each task after its check passed (T1 to T13). T2's box was ticked with a `sed -i` call, not Edit, which breaks the file-edit rule; the resulting line is the same as an Edit would produce. | T1 to T13 |
