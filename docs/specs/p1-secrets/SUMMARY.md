# Summary Report: p1-secrets
Ticket: none   Date: 2026-11-19
Outcome: Clean
Review rounds: 2 of 3 per revision (in revision 1); revisions: 1 of 2
Models: implementor haiku; reviewer sonnet; data agent not used (all chosen by the user); respawns: none

## What was built

Provider keys now live in a main-process secret store (G1). The store keeps only `safeStorage` ciphertext in `userData/secrets.json`, written atomically with mode `0o600`. It refuses to save, writing nothing, when encryption is unavailable, or on Linux with the `basic_text` or `unknown` backend unless the test-only `HARNESS_ALLOW_WEAK_SECRETS=1` is set. Every line main writes goes through a redactor (G2): its own log lines, router logs, error paths and forwarded agent output. The redactor covers registered values, Bearer tokens, `Authorization` and `x-api-key` header values, and `sk-` and `sk-ant-` strings. The key reaches the agent only in a per-run `model-key` message sent after the pong (G3, D25), and the agent env carries no key variable. The spike runs on the stored `spike` key (G4). Before the settings UI exists, `pnpm secrets:set|list|delete` hands a value to the app's dev secrets mode over a one-shot local socket. Sentinel tests cover the logger, router, SDK errors, the store and the spike e2e, and the docs match the code (G5).

## Files changed
Product files (group 1):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| src/main/secrets/redact.ts | created | Redactor (`register`, `redact`) and the process-wide instance; Bearer separator narrowed to spaces and tabs in round 1 | T1; R1-1 |
| src/main/secrets/store.ts | created | Store over injected crypto, path, platform, override and redactor; atomic `0o600` writes; refusal before any disk change; registration on read | T2 |
| src/main/secrets/electron.ts | created | Store built from `safeStorage`, `userData/secrets.json`, the platform, `HARNESS_ALLOW_WEAK_SECRETS` and the shared redactor | T3 |
| src/main/log.ts | edited | `info`, `error` and `forward` redact every line | T4 |
| src/shared/agent-protocol.ts | edited | `model-key` main-to-agent message and guard; reasons never echo the key | T5 |
| src/main/agent/host.ts | edited | Key removed from the spike variables; `model-key` sent once per agent process after the pong | T6, T7 |
| src/main/agent/model-key.ts | created | Pure `decideModelKey` (flag off, present, absent, store error) | T7 |
| src/agent/index.ts | edited | Spike starts on `model-key`, once; no key read from the env; `model-key` ignored without the flag | T8 |
| src/agent/errors.ts | created | `describeError` moved here for tests | T8 |
| src/main/secrets/dev-mode.ts | created | Pure parts of the dev secrets mode (switches, store call, output lines); failure text fixed in round 1 | T10; R1-2 |
| src/main/secrets/pipe.ts | created | One-shot socket client: address check, 10 s timeout, 4,096-character cap, nothing logged | T10 (revision 1) |
| src/main/index.ts | edited | Unpackaged `--harness-secrets=` mode: no window, no agent, socket read for `set`, exit 0/1 | T10 (revision 1) |
| scripts/secrets.ts | created | `pnpm secrets:*`: hidden prompt or piped stdin, one-connection server (named pipe or `0o700` temp socket), starts the app, cleans up | T10 (revision 1) |
| package.json | edited | `secrets:set`, `secrets:list`, `secrets:delete` scripts | T10 (revision 1) |
| tests/unit/redact.test.ts | created | Every rule, repeats, JSON, near-misses, Bearer before a line break | T1; R1-1 |
| tests/unit/secret-store.test.ts | created | No plaintext on disk, refusal writes nothing, `basic_text` rules, bad names and values, registration, decrypt failure | T2 |
| tests/unit/log.test.ts | created | Sentinel and Bearer absent from all three log methods | T4 |
| tests/unit/agent-protocol.test.ts | edited | `model-key` cases and sentinel check on reasons | T5 |
| tests/unit/agent-env.test.ts | edited | Spike key and `HARNESS_ALLOW_WEAK_SECRETS` dropped, flag on and off, win32 case-insensitive | T6 |
| tests/unit/model-key.test.ts | created | Fake store: present, absent, throwing, flag off; no key in logs | T7 |
| tests/unit/agent-loop.test.ts | edited | 401 echoing the key, and a fetch throwing with the key; no sentinel after naming and redaction | T9 |
| tests/unit/agent-router.test.ts | edited | Sentinel through a throwing runner and a failure reason; absent from logs and reply | T9 |
| tests/unit/pipe.test.ts | created | Socket read against a real local server: success, limits, timeout, nothing listening, bad address, empty | T10 (revision 1) |
| tests/unit/dev-mode.test.ts | created | Switch parsing, per-platform address check, store outcomes | T10 (revision 1); R1-2 |
| tests/e2e/spike-agent.spec.ts | edited | Seeds the store over the socket in a temp `--user-data-dir`; no env key; every request carried `Bearer <sentinel>`; sentinel absent from output and `secrets.json` | T11 (revision 1) |
| docs/decisions.md | edited | D25 added; D19 amended for `model-key` | T12 |
| CHANGELOG.md | edited | `[Unreleased]` entries | T12 |
| README.md | edited | Spike key row removed; dev-only store block; spike wording | T12 |
| CLAUDE.md | edited | Spike section and commands describe `pnpm secrets:set spike`; `HARNESS_SPIKE_API_KEY` is read only by `pnpm test:live` | T12 |
| docs/phases/phase-01-progress.md | edited | `p1-secrets` follow-up struck as done | T12 |

Workflow files (group 2: PLAN.md, SPECS.md, SUBTASK.md, tasks.md, build-ledger.md, changes.md, this report):
| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p1-secrets/PLAN.md | created | Approved plan | planning |
| docs/specs/p1-secrets/SPECS.md | created | Approved spec, revised once (AC12, revision 1) | planning, revision 1 |
| docs/specs/p1-secrets/SUBTASK.md | created | Child-ticket draft (not published; tracker none) | planning |
| docs/specs/p1-secrets/tasks.md | created | T1–T13, all ticked (T10 revised in revision 1) | all |
| docs/specs/p1-secrets/build-ledger.md | created | Build ledger | workflow |
| docs/specs/p1-secrets/changes.md | created | Implementor's change notes | workflow |
| docs/specs/p1-secrets/SUMMARY.md | created | This report | workflow |

## Acceptance criteria
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Met | `store.ts`; `secret-store.test.ts` (fake crypto, temp dir, no plaintext on disk) |
| AC2 | Met | Checks run before any load or write; refusal and `basic_text` tests; fixed error strings |
| AC3 | Met | `electron.ts`; the override is not in the agent env (`agent-env.test.ts`) |
| AC4 | Met | `redact.ts`; `redact.test.ts`, including near-misses and line breaks |
| AC5 | Met | Registration on `read`, tested |
| AC6 | Met | `log.ts`; `log.test.ts` |
| AC7 | Met | `agent-protocol.ts`; protocol tests with a sentinel on reasons |
| AC8 | Met | `host.ts` spike variables; `agent-env.test.ts` |
| AC9 | Met | `model-key.ts` and host wiring; `model-key.test.ts` |
| AC10 | Met | `src/agent/index.ts`; spike e2e |
| AC11 | Met | `agent-loop.test.ts` and `agent-router.test.ts` sentinel tests |
| AC12 | Met (revision 1) | `dev-mode.ts`, `pipe.ts`, `index.ts`, `scripts/secrets.ts`; `pipe.test.ts`, `dev-mode.test.ts`; manual set/list/delete check on Windows, value never printed |
| AC13 | Met on Windows | `spike-agent.spec.ts` passes locally; macOS/Linux first run in CI |
| AC14 | Met | D25, D19 amendment, CHANGELOG, README, CLAUDE.md, progress file; the reviewer found them consistent with the code |
| AC15 | Met | typecheck, lint, format:check pass; `pnpm test` 237 passed, 2 skipped; `pnpm e2e` 15 passed, 2 skipped (macOS-only), on Windows before the round 1 fixes (regex separator and a message string only) |

## Needs a runtime check
- The spike e2e and the socket handoff on macOS and Linux (first run is CI). On macOS, check whether `safeStorage` raises a keychain prompt for the unsigned app. On Linux, the e2e relies on `HARNESS_ALLOW_WEAK_SECRETS=1`.
- `JSON_HEADER_PATTERN` and `PLAIN_HEADER_PATTERN` do not match escaped-quote forms such as `\"x-api-key\":\"abc\"` (JSON inside a JSON string). Bearer tokens and registered values are still caught, and AC4 names only the plain and `"name":"value"` forms.
- The named-pipe handoff and the `app.exit` flush in secrets mode were verified only by the implementor's T10 and e2e runs on Windows.

## Review ledger
Covers every revision, copied from `docs/specs/p1-secrets/build-ledger.md`.
### Revision 1, round 1  (ISSUES)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1: `BEARER_PATTERN` uses `\s+`, so a bare "Bearer" at a line end redacts the next line's first word | minor | src/main/secrets/redact.ts:16 | ACCEPT | A line break is not a separator under the spec; "Bearer is a word" still redacts "is" (over-redaction kept) | Separator `[ \t]+`; test for `Bearer\n` and `Bearer\r\n` |
| R1-2: failure text says "no value on stdin" though the value now comes over the socket | minor | src/main/secrets/dev-mode.ts:79 | ACCEPT | Revision 1 moved the value to the socket | Text "no value received"; test updated |

### Revision 1, round 2  (PASS)
| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| (none) | | | | | |

No review ran in revision 0; the build paused at the implementor's spec problem before review.

## Spec revisions
- Revision 1: on Windows 11 the unpackaged app in secrets mode received an empty stdin, both piped and redirected, because Electron's main process is a GUI-subsystem app. AC12's stdin handoff could not work. The user chose **Revise the spec**. The dev script now hands the value over a one-shot local socket: a random named pipe on Windows, or a socket in a private `0o700` temp dir elsewhere. Only the address goes on the command line. Not chosen: a one-time private file, an inherited fd 3 pipe, a dev-only window. AC13 was unchanged (`--user-data-dir` confirmed). Re-approved by the user.

## Rejected findings
none

## Open issues
none. Notes for your judgement:
- `pnpm secrets:delete` of a missing name exits 1. The spec doesn't say what it should do.
- Electron 45 prints deprecation warnings for the sync `safeStorage.isEncryptionAvailable` and `encryptString`. The async variants are the replacement, which is a possible follow-up.
- The e2e test re-implements the one-shot socket server (about 30 lines), because `scripts/secrets.ts` takes no `--user-data-dir`.
- The T2 box in `tasks.md` was ticked with `sed`, with identical content.
- A leftover probe folder, `%TEMP%\tmp.c6tsAo2ygJ`, holds dummy values only. The implementor was not allowed to delete it.

## Git state
feature/p1-secrets; approved; committed and pushed in the commit that adds this report.

## Next steps
Approve, commit and push; or request changes; or not yet.
