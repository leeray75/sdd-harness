# Decisions

Settled product and architecture decisions for SDD Harness. Add new ones at the bottom with the next number; never rewrite a settled one, supersede it with a new entry that names it.

Format: **Decision** · **Outcome** · **Why** · **Date**.

## D1 · What runs the agents

- **Outcome:** The harness's own agent runtime with provider adapters. Workflow rules and tool permissions live in code. No Claude Code hooks at runtime.
- **Why:** Hooks need bash and jq and only govern Claude Code; the harness must enforce the same rules for any model on any platform.
- **Date:** 2026-11-17

## D2 · How models are reached

- **Outcome:** Adapters for the Anthropic Messages API and OpenAI-compatible APIs. LiteLLM and agentgateway are supported as gateway providers.
- **Why:** Covers hosted Claude plus every common self-hosted server (vLLM, LM Studio, llama.cpp, TGI, SGLang, Ollama's OpenAI-compatible endpoint) with two adapters.
- **Date:** 2026-11-17

## D3 · Human-only actions

- **Outcome:** Approve spec, approve result, close (mark as done), change project rules and edit an approved spec exist only as UI actions. No agent tool exists for them. The main process accepts them only from a user click in the app's own window.
- **Why:** Keeps the sdd plugin's core guarantee (a typed prompt proves a human acted) without typed commands.
- **Date:** 2026-11-17

## D4 · Rule enforcement

- **Outcome:** In code: review round limit (3 by default; a project can lower it, never raise it automatically); commit and push done by the app only after result approval; spec files read-only to every agent after approval.
- **Why:** The plugin left the round cap and "no commit before approval" to instructions; the harness can make them hard limits.
- **Date:** 2026-11-17

## D5 · Reuse from the sdd plugin

- **Outcome:** Port the prompts, the document templates (PLAN, SPECS, tasks, SUBTASK), the tracker guides and the workflow states and events (`hooks/machine.ts`). Keep the `docs/specs/<feature>/` layout so existing specs open as history.
- **Why:** Proven content and compatibility with repos already using the plugin.
- **Date:** 2026-11-17

## D6 · Limits on running commands

- **Outcome:** Per-project allowlist (detected test and build commands); the spec folder is read-only while commands run; no network for the code writer. An OS sandbox or container per build is a later option.
- **Why:** Simple and cross-platform for v1; containers need Docker everywhere.
- **Date:** 2026-11-17

## D7 · Where state lives

- **Outcome:** Workflow state and the approved spec's hash in the repo (`docs/specs/<feature>/` plus a small state file), so it travels with the code. Sessions, providers and routing in app data. Secrets in the OS keychain (`safeStorage`).
- **Why:** The repo is the source of truth for the work; secrets never touch files.
- **Date:** 2026-11-17

## D8 · Tracker scope

- **Outcome:** v1 reads tickets for planning. Creating the child ticket and moving ticket status come in v1.1; until then the child ticket is a draft in the Ticket tab with a Copy action.
- **Why:** Reading covers the planning value; writes need per-tracker auth and error handling.
- **Date:** 2026-11-17

## D9 · Distribution

- **Outcome:** Internal first: signed builds for the pilot team. Decide on a public release after the success metrics are measured.
- **Date:** 2026-11-17

## D10 · Theme

- **Outcome:** Dark only in v1. Colors are tokens, so a light theme can follow.
- **Date:** 2026-11-17

## D11 · Typed commands

- **Outcome:** None. Every workflow action is a button; no slash commands, hidden or otherwise.
- **Why:** One way to do things; the harness exists to remove the need to learn commands.
- **Date:** 2026-11-17

## D12 · Pilot platforms

- **Outcome:** Windows, macOS and Linux builds for the first pilot.
- **Date:** 2026-11-17

## D13 · Pilot providers

- **Outcome:** Anthropic, any OpenAI-compatible server, LiteLLM and agentgateway. Cloud platforms (Bedrock, Azure, Vertex) come later.
- **Date:** 2026-11-17

## D14 · Package manager and Corepack

- **Outcome:** pnpm, with the exact version pinned in `package.json` `packageManager` (currently `pnpm@12.21.0`) and enabled through Corepack (`corepack enable`). No global `npm i -g pnpm`. The lockfile is `pnpm-lock.yaml`. Build scripts that must run (Electron's binary download, esbuild) are allowed by name in `pnpm-workspace.yaml` `allowBuilds`.
- **Why:** Corepack makes every machine use the pinned pnpm, so global installs cannot drift. pnpm's lockfile and content store keep installs reproducible and fast. Electron Forge was considered as the build path (see D15) and not chosen.
- **Date:** 2026-11-17

## D15 · Build tooling and packaging

- **Outcome:** electron-vite builds the main, preload and renderer bundles (`out/`). electron-builder packages the app through `electron-builder.yml`; `pnpm package` makes an unsigned build for the current OS only and is not part of the test commands. TypeScript runs in strict mode with two projects (`tsconfig.node.json` for main, preload and shared; `tsconfig.web.json` for the renderer and shared). TypeScript is pinned to the 6.x line (`typescript@^6.0.3`) because typescript-eslint does not yet support TypeScript 7.
- **Why:** electron-vite is the Electron-specific Vite setup with one config for all three targets; electron-builder is the mature packager with per-OS targets. Packaging stays separate from tests so a signing or installer problem never blocks the test loop. Electron Forge with its Vite plugin was the alternative build path and was not chosen. TypeScript 7 is revisited when typescript-eslint supports it.
- **Date:** 2026-11-17

## D16 · UI framework

- **Outcome:** React with TypeScript (strict) in the renderer. ESLint uses the flat config with typescript-eslint and the React and React Hooks rules; Prettier formats the repo.
- **Why:** React is the common choice for the component work the design notes describe, and it has the widest hiring and library support. Strict TypeScript catches bridge-contract mistakes at build time.
- **Date:** 2026-11-17

## D17 · Test runners

- **Outcome:** Vitest runs unit tests (`pnpm test`, files in `tests/unit`). Playwright for Electron runs the e2e smoke test against the built app (`pnpm e2e`, files in `tests/e2e`); `pnpm e2e` builds first.
- **Why:** Vitest shares the Vite config and runs fast for the pure main-process helpers. Playwright drives the real Electron window, so the e2e tests check the security settings as the user gets them.
- **Date:** 2026-11-17
- **Amended:** 2026-11-18, p1-spike-agent-loop: a live suite runs from `tests/live` through its own Vitest config (`vitest.live.config.mts`, script `pnpm test:live`). It is outside `pnpm test` and skips unless `HARNESS_SPIKE_BASE_URL` is set; CI never runs it. The Outcome above is otherwise unchanged.

## D18 · Node version

- **Outcome:** Node 24 LTS. `package.json` `engines` requires `>=24 <25`, and `.nvmrc` names `24`.
- **Why:** Node 24 is the current LTS line and matches the local toolchain. Node 22 was the alternative and was not chosen.
- **Date:** 2026-11-17

## D19 · Agent process, message channel and tool-call gate

- **Outcome:** The agent runs as an Electron `utilityProcess`, forked by main after app ready, with no window, preload or renderer access. Main and the agent talk over the built-in `parentPort` and `postMessage` channel. Messages are typed in `src/shared` and checked by hand-written guards on both sides; main treats every agent message as untrusted and logs a rejected one without replying. Every agent tool call goes through a pure policy gate in main that denies by default and returns the denial to the agent as an error result. There is no message type, job or tool for a human-only action. If the agent exits unexpectedly, main logs the exit code and does not restart it.
- **Why:** `utilityProcess` is Electron's own child process type: it runs in a separate OS process and its `parentPort` and `postMessage` channel is built in. `child_process.fork` was the alternative and was not chosen, because it needs its own message wiring and runtime handling in the packaged app. Hand-written guards add no dependency and keep the protocol types and their checks in one place; zod was the alternative and was not chosen. The gate lives in main, not in the agent, so the check stays outside anything an agent can change (D1, D4). Logging the exit and not restarting keeps a crash visible without hiding a loop; restart with backoff was the alternative and was not chosen.
- **Date:** 2026-11-17
- **Amended:** 2026-11-18, p1-spike-agent-loop: an allowed tool call now runs in main through an injected runner. Only `read_file` exists, for the reader job, and its output returns to the agent in a success `tool-call-result`; a tool that is allowed but fails returns the new `failed` error code. The gate still denies by default, and the router still logs job, tool and outcome only, never arguments or output. The Outcome above is otherwise unchanged.
- **Amended:** 2026-11-19, p1-secrets: main sends the agent a new main-to-agent message, `{ type: 'model-key', key: string | null }`, once per agent process after its pong, when the spike flag is `1`. The key is the stored `spike` entry, or `null` when there is none or the store cannot be read. The message is typed and checked by the same guards (`key` at most 4,096 characters), and the guard's reasons never echo the key. Nothing else in the message contract changes, and the Outcome above is otherwise unchanged.
- **Amended:** 2026-11-20, p2-tools: the injected runner (`makeToolRunner`) now knows all seven tools of the shared registry (D29). It checks each call's tool name and arguments with the registry's guard before it dispatches, and a failure returns `failed`. The gate (`checkToolCall`) is unchanged and still allows only `reader` with `read_file`, so the new tools can't be reached until the per-job policy table arrives (`p2-policy-engine`).
- **Amended:** 2026-11-20, p2-policy-engine: the reader-only gate is replaced by the per-job policy (D30). `checkToolCall(request, context)` returns a decision with a Rule event. The router emits that event for every validated call through a new `onRuleEvent` dep, which replaces its denial log line. It still logs job, tool and outcome for calls that run, never arguments or output.

## D20 · Window controls bridge shape

- **Outcome:** The renderer reads the platform from `window.harness.platform`, a constant of `'win32' | 'darwin' | 'linux'` that the preload takes from `process.platform` (any other value is reported as `win32`). Window controls sit in a nested `window.harness.window` namespace with `minimize()`, `toggleMaximize()`, `close()`, `isMaximized()` and `onMaximizedChange(cb)`; `onMaximizedChange` returns a function that removes its own listener. Main sends `harness:window-maximized-changed` to the renderer, the first main-to-renderer event, with a boolean payload only; the preload never passes the IPC event to the callback. Every window call runs the same sender check as `getVersion` and acts only on the app's main window.
- **Why:** The nested namespace groups the window controls, so the bridge gains one area instead of one top-level name per call. The platform is a constant set by the preload, so the renderer reads it at once with no IPC round trip. A boolean-only payload means no IPC event object or sender reference reaches the renderer. Flat keys (`minimizeWindow`, `getPlatform()`, and so on) were the alternative and were not chosen, because they add a top-level name for each call. Platform as a CSS class set by main through `executeJavaScript` was the alternative and was not chosen, because it runs script in the page from main and leaves a timing gap before the first paint.
- **Date:** 2026-11-17

## D21 · Design tokens and bundled fonts

- **Outcome:** The design tokens from `design-notes.md` §2–4 live in two files that a test keeps equal: `src/shared/tokens.ts` (a typed `as const` object that imports nothing, used by main and the renderer) and `src/renderer/styles/tokens.css` (the same values as custom properties on `:root`, the only file under `src/renderer` with hex colours). Inter (400, 500, 600, 700) and JetBrains Mono (400, 500) are bundled through `@fontsource`, with the Latin subset imported in `main.tsx`, so the app never loads fonts over the network and the CSP is unchanged. The gallery (`src/renderer/Gallery.tsx`, shown on `#gallery`) is loaded by main only under `pnpm dev` or with `HARNESS_GALLERY=1`. The `titlebar/close-hover` token (`#C42B1C`, with white text) is the Windows caption-button close colour, added to the colour set for the title bar.
- **Why:** One source for the values avoids hand-copied hex in every screen, and the parity test catches drift between the TypeScript and CSS copies. `@fontsource` gives versioned, reproducible font files through pnpm; committing woff2 files by hand was the alternative and was not chosen, because nothing would pin them to a version or a hash. The gallery flag keeps every Button and Chip variant reviewable without a screen to host it, and stays out of the packaged app by default; a dev-server-only gallery was the alternative and was not chosen, because the e2e tests run the built app. The close-hover colour is a token rather than an ad-hoc value, so the title bar follows the same rule as everything else.
- **Date:** 2026-11-17

## D22 · Continuous integration

- **Outcome:** CI is GitHub Actions on the GitHub-hosted runners, in `.github/workflows/ci.yml`, with triggers on push to `main`, pull requests to `main` and `workflow_dispatch`. A `check` job on Linux runs typecheck, lint, `format:check` and unit tests. An `e2e` job runs on a Windows, macOS and Linux matrix with `fail-fast: false`: `pnpm e2e`, then an unsigned `electron-builder --dir` build that reuses `out/`. No build artifact is uploaded. In CI only, Playwright retries a failed test twice, keeps a trace on the first retry and writes an HTML report; a failed e2e job uploads `playwright-report/` and `test-results/` under a per-OS name. On Linux, a step sets the AppArmor sysctl `kernel.apparmor_restrict_unprivileged_userns=0` before the tests run under `xvfb-run`, and the app keeps its sandbox. The Linux tests run under `xvfb-run` with the fluxbox window manager started inside it and ready (its `_NET_SUPPORTING_WM_CHECK` is set on the root window, polled for about 10 s) before `pnpm e2e` runs; fluxbox is installed with apt, with `x11-utils` for `xprop`. Every job sets up the toolchain in the same order (checkout, `corepack enable`, `setup-node` from `.nvmrc` with the pnpm cache, `pnpm install --frozen-lockfile`). Concurrency is `ci-${{ github.ref }}`, with cancel-in-progress for pull requests only, so every push to `main` finishes. The suggested sdd `SDD_TEST_CMD` is `pnpm test`.
- **Why:** Hosted runners cover all three OSes with no machines to maintain; self-hosted runners and other CI services (GitLab CI, CircleCI) were the alternatives and were not chosen. Running the check job on all three OSes was the alternative and was not chosen, because it repeats the same lint, format and unit checks with no OS-specific signal; the e2e job is on the matrix because the macOS title-bar test needs a macOS runner. Packaging on all three OSes was chosen over packaging on Linux only or not in CI, so a packaging problem on Windows or macOS shows before a pilot build; uploading the build artifacts was not chosen (non-goal). Retries only in CI were chosen over no retries, so a one-off launch crash does not block a pull request, and over retries everywhere, so a local launch problem shows on the first failure; a retried test is still marked flaky in the report, so the crash stays visible. A trace on the first retry only, rather than on every test, keeps uploads small. Cancelling every run, including pushes to `main`, was the alternative and was not chosen, because a push to `main` could be cancelled before its checks finish. The AppArmor sysctl was chosen over `--no-sandbox` on Linux CI, because `--no-sandbox` would test a launch that users never get; the sysctl changes the runner's host setting only. `SDD_TEST_CMD="pnpm test"` was chosen over typecheck, lint and test together (slower on every sdd check), and `pnpm e2e` is left to CI because it builds and launches Electron each time. The Linux e2e job runs a window manager, because on X11 the window manager carries out maximize, so `BrowserWindow.maximize()` does nothing under a bare `xvfb-run` display and the Maximize test cannot pass. Skipping that test on Linux was the alternative and was not chosen, because it would drop the one check of window behaviour from Linux CI. Running with no window manager was the alternative and was not chosen, for the same reason. openbox and xfwm4 were the alternatives for the window manager and were not chosen: openbox is kept as the fallback if fluxbox does not report maximize, and xfwm4 pulls in Xfce libraries that the job does not need. A fixed `sleep` instead of the readiness wait was the alternative and was not chosen, because it can race on a slow runner; the wait polls `xprop` and fails with a message that names fluxbox if no window manager appears in about 10 s.
- **Date:** 2026-11-18
- **Amended:** 2026-11-18, p0-ci-linux-wm: the Outcome now names fluxbox under `xvfb-run` on Linux, and the Why gives the window-manager reason and the alternatives not taken. The original Outcome and Why are otherwise unchanged.

## D23 · Agent loop and provider transport

- **Outcome:** The harness writes its own agent loop behind its own provider interface. The adapters use the official SDKs for transport, streaming and retries: `@anthropic-ai/sdk` for the Anthropic Messages API and the `openai` SDK (with a base URL and extra headers) for every OpenAI-compatible server and gateway. No SDK type crosses the provider interface. Tool calls the model asks for still go to main's policy gate before they run. The provider interface lives in `src/agent/provider/` (neutral types, `ProviderError`, the two adapters), and the loop in `src/agent/loop.ts` runs on it (`p1-provider-interface`).
- **Why:** The loop is small for two adapters, and owning it keeps the tool gate, redaction, usage counting and the "self-hosted only" check in our code. The SDKs handle SSE parsing and retry details we would otherwise maintain. Writing the transport on plain `fetch` was the alternative and was not chosen, because it adds SSE and retry code to maintain. Adopting a multi-provider agent library (Vercel AI SDK) was the alternative and was not chosen, because its abstractions and release pace would sit between the gate and the model.
- **Date:** 2026-11-18
- **Note (p1-openai-compatible, 2026-11-19):** extra server headers reach both SDK clients as `defaultHeaders` (D27). The `openai` SDK and `@anthropic-ai/sdk` each send them on every request; the key is still sent only as the bearer token.

## D24 · Testing provider adapters

- **Outcome:** Unit tests replay recorded HTTP and SSE fixtures through a `fetch` injected into each SDK client, so `pnpm test` and CI need no keys and no network. A separate live suite runs only when the provider's key or base URL is set in the environment, and CI does not set them. Fixtures contain no real keys.
- **Why:** Fixtures make adapter tests fast and repeatable on every OS; the optional live suite catches API drift on demand. In-process mock servers were the alternative and were not chosen, because hand-written mocks drift from the real APIs. Fixtures only, with no live suite, was the alternative and was not chosen, because nothing would check the fixtures against the real servers.
- **Date:** 2026-11-18

## D25 · Provider key storage, delivery and redaction

- **Outcome:** Provider keys live only in main, as `safeStorage` ciphertext in `userData/secrets.json` (`{ "version": 1, "entries": { "<name>": "<base64>" } }`), written atomically with mode `0o600`. Names match `^[a-z0-9][a-z0-9-]{0,63}$`. On Linux, a `basic_text` or `unknown` backend makes `save` refuse, with nothing written; the test-only override `HARNESS_ALLOW_WEAK_SECRETS=1` allows `basic_text`, and only the e2e tests set it. On Linux the same override also calls `safeStorage.setUsePlainTextEncryption(true)` (Electron 45 reports encryption as unavailable without a keyring otherwise), at most once per process and before the store's first use; the decision is the pure `shouldUsePlainTextEncryption` in `src/main/secrets/plain-text.ts`. Without the override that switch is never turned on, and on macOS and Windows the override has no effect on the switch. A stored key reaches a model call through a per-run `model-key` message from main to the agent (D19), so it is never in the agent's environment. The agent holds it in memory only and never writes it to stdout, stderr, a file or a log. Every line main writes, including the agent output it forwards, passes a redactor first: each value the store has handed out, `Bearer` tokens, `Authorization` and `x-api-key` header values, and `sk-` or `sk-ant-` strings of 20 or more key characters become `[redacted]`. The dev-only `pnpm secrets:set|list|delete` script hands a `set` value to main over a one-shot local socket: a random named pipe on Windows, or a socket in a private `0o700` temp dir elsewhere. Only the address goes on the command line; the value never goes on the command line, in an environment variable or in a file. The spike's entry is `agentgateway` (`p1-provider-interface`); the old `spike` entry is not read.
- **Why:** `safeStorage` uses the OS keychain, which the PRD requires; a `basic_text` backend stores values in effectively plain form, so it is refused, and the override keeps Linux CI running without a keyring. A per-run message keeps the key out of the process environment, where a child process or a log dump would see it. Holding the key in agent memory is the accepted trade-off: the agent has no tools of its own and its only output goes through main's redaction (see the `p1-secrets` plan). The dev script uses a socket because Electron's main process on Windows receives no stdin: an empty stdin was observed on 2026-11-19 for both a pipe and a file redirect. Alternatives not chosen: a loopback proxy in main that adds the key, so the agent never holds it (more code: a local listener, SSE pass-through and a per-run token); main making the model calls and streaming chunks to the agent (moves transport out of the agent and amends D23); importing `HARNESS_SPIKE_API_KEY` into the store at startup (the key still starts in the environment); accepting `basic_text` with a warning (effectively plaintext); starting gnome-keyring in Linux CI with no override (fragile CI); the dev script's stdin (empty on Windows); a one-time private file (the plaintext touches disk briefly); an inherited fd 3 pipe (unverified on Windows); a dev-only window with a hidden input (adds renderer and preload code).
- **Date:** 2026-11-19

## D26 · Agentgateway for every model in development and the pilot

- **Outcome:** In development and the pilot, every model is reached through agentgateway, with one gateway key stored as `agentgateway`. Anthropic-format calls post to the gateway root plus `/v1/messages` with Bearer auth (`authToken`), not `x-api-key`. OpenAI-format calls post to the base URL plus `/v1`. The `p1-openai-compatible` agentgateway preset offers both formats. The Anthropic adapter sends the SDK's default `anthropic-version`.
- **Why:** One gateway key and one routing point for every model, with both wire formats available for each one. Bearer auth is the only auth the installed `@anthropic-ai/sdk` (1.10.0) can send: it puts `apiKey` in an `Authorization: Bearer` header too and never sends `x-api-key`. Alternatives not chosen: a direct key per provider (more keys in the store, and the pilot would manage them all); keeping `x-api-key` through `defaultHeaders` (the Authorization header would also have to be suppressed, not verified); pinning an older SDK that sends `x-api-key` (not verified, and it keeps old SDK code); pinning `anthropic-version` to `2023-06-01` from the start (kept as the fallback if the gateway or Anthropic rejects the SDK default).
- **Date:** 2026-11-19

## D27 · Server presets, one address for both formats, and extra headers

- **Outcome:** The server types the agent can reach are one preset table, `SERVER_PRESETS` in `src/shared/server-presets.ts`: pure data with no SDK or `src/agent` import, so the Phase 8 Add-a-server screen reads the same table. The presets are vLLM (`http://localhost:8000`), Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234`), llama.cpp server (`http://localhost:8080`), TGI / SGLang (no default), LiteLLM (`http://localhost:4000`), agentgateway (no default) and Other (no default). Every preset except agentgateway and Other offers the `openai` format only; agentgateway and Other offer `openai` and `anthropic`, with `openai` first, and the first format is the default. `createProvider` in `src/agent/provider/factory.ts` builds the adapter from a preset, a format, an address and headers, and refuses in this order: an unknown preset, a format the preset does not offer, no address where the preset has no default, an address that is not an `http` or `https` URL or that holds a user name or password, and headers that fail the headers rule.
- **Address rule:** one address serves both formats. The openai format adds `/v1` when the address lacks it. The anthropic format strips trailing slashes, then one trailing `/v1`, then trailing slashes again, because the SDK adds `/v1/messages` itself. So `http://h:4100`, `http://h:4100/`, `http://h:4100/v1` and `http://h:4100/v1/` all reach the same endpoints for each format. The spike's `HARNESS_SPIKE_BASE_URL` may be unset when the preset has a default address.
- **Headers rule:** extra headers are `Name: value` lines (the spike reads them from `HARNESS_SPIKE_HEADERS`) or a record from a caller. Each line splits at its first colon, and names and values are trimmed. A name must be an HTTP token, a value must have no CR, LF or NUL, and a name may appear once (ignoring case). These names are reserved and refused, ignoring case: `authorization`, `x-api-key`, `anthropic-version`, `content-type`, `content-length` and `host`. A refusal names the line or the header name and the rule broken, never the value. Headers go to both SDK clients as `defaultHeaders`.
- **Values are configuration, not secrets:** header values are not stored in the secret store and are not redacted as secrets. Keys arrive only through the per-run `model-key` message (D25); the reserved names keep a key out of a header.
- **Why:** One preset table means the settings screen and the spike choose from the same data, and a server type is a row, not new code. One address for both formats means a user enters a gateway address once, whichever wire format a model needs. Reserving the names that carry the key or fix the request shape keeps the key path to D25 alone. Alternatives not chosen: an address rule that refuses a trailing `/v1` for the anthropic format (a valid address would fail); keeping the address unchanged for the anthropic format (`/v1/v1/messages`); presets next to the adapters only (the table would move in Phase 8); allowing any header name (a key could arrive outside `model-key`); storing header values as secrets (more store and redaction work now, and the headers are not credentials).
- **Date:** 2026-11-19

## D28 · Model probes: listing, chat and tool-use checks, and their results

- **Outcome:** Before a model is assigned to a job, the agent process tests it. `Provider` has `listModels(signal?)`, which returns `ModelInfo { id, contextWindow }` (`src/agent/provider/types.ts`). `src/agent/probes/` holds the probes, the runner and the plain result types. Nothing is stored, no agent-protocol message is added and there is no UI; Phase 8 wires those (`run-probes` and `probe-result`).
- **Listing, openai format:** `GET {base}/v1/models` through the SDK's `client.models.list()`, every page. `contextWindow` is the first positive integer among `max_model_len`, `context_length` and `context_window`, else null. Entries without a string `id` are skipped.
- **Listing, anthropic format:** `GET {base}/v1/models` (the root has no `/v1`, D27) through the SDK's `client.models.list()`, every page. `contextWindow` is `max_input_tokens` when it is a positive integer. When an entry has no `max_input_tokens`, the adapter reads the openai-format fields in the same order, so a gateway that answers in the openai list shape still reports the window (AC3 of `p1-model-probes`). Entries without a string `id` are skipped. Bearer auth, `anthropic-version` and the extra headers are sent as for chat (D26, D27).
- **What agentgateway returned (anthropic format):** recorded by the user's `pnpm record:probes anthropic` run in `tests/fixtures/probes/anthropic/models.json`. agentgateway answers the Anthropic-format `GET /v1/models` in the OpenAI list shape: `object: "list"` and `data[]`, each entry with `id` and `owned_by`, and no Anthropic paging fields. It lists all 21 gateway models, vLLM and Claude alike. The Claude entries (`owned_by: anthropic`) carry `max_input_tokens`, `context_window` and `context_length`, each 1000000 for claude-haiku-5-5 (200000 for the older 200k models). The vLLM entries carry none of these, so `contextWindow` is null for a model such as `qwen3.8-flash-next-nothink` through the gateway in either format. Because the gateway answers in the OpenAI shape, the anthropic adapter's fallback to the AC2 fields (`max_model_len`, `context_length`, `context_window`) is needed for any entry without `max_input_tokens`; this recording's Claude entries carry `max_input_tokens` directly, so the fallback is exercised only by the unit tests.
- **Chat probe:** one streamed request with the prompt "Reply with the word PROBE-OK and nothing else." and a token limit (default 256). The request sends no `tools` field: vLLM rejects an empty tools list with HTTP 400 (the first live run failed with `bad-request` on all three chat runs), so both adapters omit the field when the tool list is empty, and the recorder sends the same body. It passes when the text contains `PROBE-OK`, case-insensitively.
- **Tool-use probe:** two streamed requests. Step 1 offers `lookup_code` (one required string `name`, `additionalProperties: false`) and asks for the code of `harness`. It passes when the first call is `lookup_code` and its arguments parse to an object whose `name`, trimmed and lowercased, is `harness`. Step 2 sends the assistant's call and a fixed tool result, "The code for harness is ZEBRA-7341.", still offering the tool. It passes when the answer contains `ZEBRA-7341`, case-insensitively.
- **Failure codes:** one per failed run, in run order. Chat: `missing-token`. Tool use: `no-tool-call`, `wrong-tool`, `bad-arguments` (unparseable JSON or not an object), `wrong-arguments` (a missing or different name), `missing-token` (step 2). Either probe: `timeout`, or the kind of a provider error (`auth`, `rate-limit`, `bad-request`, `server`, `network`, `aborted`, `unknown`).
- **Status:** each probe runs 3 times by default (`runs`, at least 1). `passed` when every run passes, `failed` when none does, and `unreliable` when the runs disagree. Runs go one after another: the chat runs first, then the tool-use runs. Probes do not run in parallel and results are not cached.
- **Timeouts and abort:** each request has 60 s by default, through its own `AbortSignal`. A caller's abort stops the run and throws `ProviderError('aborted')`; no partial result is returned. Callers build the provider with `maxRetries: 0`, so retries do not skew latency.
- **Latency:** the time from just before a request to its first stream event of any kind. Thinking models stream reasoning before the answer, and that time counts. A run's latency is that of its first request. `latencyMs` is the median over runs that got an event, rounded to whole ms; null when none did. The listing's latency is the round trip of `listModels`, in whole ms.
- **Speed:** per request, output tokens from the usage event divided by the time from its first to its last stream event. A run's speed is its total output tokens over its total stream time across its requests, and is null when any request had no usage event or no stream time. `tokensPerSecond` is the median over runs, to one decimal. `ModelProbeResult.tokensPerSecond` is the median over the run speeds of both probes, to one decimal. The speed is indicative only: short replies and network jitter make it noisy, so the medians over 3 runs are the figure to read, and it is not a benchmark. The live run gave claude-haiku-5-5 a tool-use speed of about 1762 tok/s: its tool call arrived in one burst, so the stream span was tiny and the figure reflects that span, not the model's output rate. The formula is unchanged (AC7); the figure is indicative only.
- **Result shape:** plain JSON-safe types in `src/agent/probes/types.ts`: `ProbeStatus`, `ProbeFailure`, `ProbeResult`, `ModelProbeResult` and `ServerListing`. A result holds only these fields, model ids and numbers from `/models`. No field holds text from a server, a header, the address or the key. The probe module imports no SDK and nothing from `src/main`, never logs and never reads the environment; tests check this.
- **Live and recorded checks:** the fixtures are recorded from agentgateway by `pnpm record:probes` (dev only; it never saves request headers and refuses to write the key). CI replays them through `createProvider` with an injected `fetch`. The opt-in live suite (`tests/live/probes.live.test.ts`) lists the models and runs both probes on the spike's model for each format the preset offers, and asserts neither probe is `failed`.
- **Why:** The screen that assigns models needs per-model capability data, and the rules must be the same wherever they run. Fixed prompts and tokens, a structured tool check and a median over runs keep the results repeatable enough to compare models. Keeping the result as plain data lets Phase 8 send it over the protocol unchanged. Alternatives not chosen (from the plan): one run per probe, where unreliable would mean leniency on a single reply; a tool probe with one valid call and no second step (it would not show that the model uses the result); a whole-request time for latency and speed (it would count the length of the answer, not the wait for the first event); listing through the openai path for both formats, or no listing for the anthropic format (manual ids); leaving the context window out until Phase 8; hand-written SSE fixtures instead of recorded ones; folding these rules into D27.
- **Date:** 2026-11-19

## D29 · Agent tools: shared registry and tool-level limits

- **Outcome:** Seven agent tools run in the main process: `read_file`, `list_files`, `search_text`, `write_file`, `edit_file`, `run_command` and `read_ticket`. `read_ticket` is an interface only until a tracker client exists.
  - **Registry:** their names, descriptions, JSON schemas and args guards live in one shared registry, `src/shared/tools.ts`, which imports no Node, Electron or DOM API. Each schema and its guard are built from one field table.
  - **Runners:** in `src/main/tools/`, one per tool.
  - **Path rules:** every file tool resolves its path through `src/main/tools/paths.ts`:
    - the path must be relative;
    - it must stay inside the root after real paths are resolved. For a new file, the deepest existing parent folder is checked;
    - any `.git` segment is refused, ignoring case, with trailing dots or spaces, or as an 8.3 short name;
    - reasons are fixed strings that never echo the path or the contents.
  - **Search:** `list_files` and `search_text` walk the root in pure Node. They skip `.git` and `node_modules`, never follow symlinks, and stop at fixed caps with a note.
  - **Writes:** a temporary file in the same folder, then a rename.
  - **`run_command`:**
    - runs a program with an argument array and `shell: false`;
    - refuses `git`, whatever its case or extension, and on Windows refuses `.cmd`/`.bat` programs;
    - gives the child only `PATH` and the variables each OS needs to start a process;
    - kills the process tree after a timeout (10 minutes by default; only main can set it);
    - keeps the last 64 KiB of output.
  - **`read_ticket`:** returns ticket text inside a fixed untrusted-data frame whose markers can't be closed early.
  - **Limits:** every tool's output stays within `MAX_TOOL_OUTPUT_LENGTH` (64 KiB).
  - **Scope:** these limits hold under any policy. Which job may call which tool, the spec-folder and source rules, the command allowlist and network limits are separate (D4, D6; `p2-policy-engine`, `p2-command-allowlist`).
- **Why:**
  - One shared registry lets main check arguments and lets the agent advertise the same schemas, with no copy to drift.
  - Refusing git and leaving the root in the tools themselves gives a second layer under the policy engine, so "no git for any agent" (D4) holds even if a policy row is wrong.
  - With no shell, pipes, quoting and the `cmd`/`sh` differences can't get around the later allowlist.
  - A pure-Node walk behaves the same on all three pilot platforms (D12) and adds no native dependency.
  - Alternatives not chosen (from the `p2-tools` plan):
    - five coarse tools, or seven plus delete and move;
    - a temporary gate that allows the new tools now;
    - a shell command string, or leaving `run_command` out until the allowlist;
    - a bundled ripgrep;
    - schemas next to each runner in main;
    - git rules in the policy engine only.
- **Open:** Settled by D31 (how `run_command` runs `.cmd`/`.bat` commands such as `pnpm test` on Windows).
- **Date:** 2026-11-20

## D30 · Agent tool policy: per-job table, path areas, tightening and Rule events

- **Outcome:** Every agent tool call is decided in main by a pure gate, `checkToolCall(request, context)` in `src/main/policy/`.
  - **Table:** each job's base tools follow the design table ("What each agent can do"):
    - every job may read, list and search;
    - the planner and the writer may write and edit, under the path rules;
    - the writer and the reviewer reach `run_command` through a command check;
    - the planner and the reader may read tickets;
    - the reviewer and the reader have no write tool.
  - **Context:** the caller passes the feature slug (or none), the spec state (`none`, `draft` or `approved`), the project's tightening and the command check. Phase 3 maps its workflow states onto the spec state. Until then the host passes no feature, and a command check that denies every command until `p2-command-allowlist`.
  - **Path areas:** a write path is normalized (separators, `.` and `..`, letter case on every OS, trailing dots and spaces) and classed as `outside`, `git`, `spec-doc`, `spec-other` or `source`. A `spec-doc` is one of the four planning docs of a feature.
    - The planner may write only the `spec-doc` files of the current feature, before approval.
    - The writer may write only `source`, after approval.
    - The app's own files in `docs/specs/`, and approved specs, are therefore unreachable to every agent.
    - The write and edit runners classify the real path again and refuse when a symlink changes its area.
  - **Tightening:** only a per-job removal list. Anything else is refused, and the gate uses the base set minus the removals, so a project can never add a tool.
  - **Rule events:** every decision, allowed or denied, is a Rule event with the job, the tool, a sanitized target (the path, the program or the ticket id, never content or other arguments) and the reason. It is logged through the redacting logger. A denied call returns `denied` with a fixed reason that never echoes the target.
  - **`node_modules`:** `list_files` and `search_text` refuse a path inside `node_modules`.
- **Why:**
  - A pure gate with the workflow state as an input can be tested exhaustively now and wired to Phase 3 later, without a second gate.
  - Limiting the planner to four named files keeps the state file, the spec hash and the build ledger out of every agent's reach, so no agent can fake an approval (D3, D4, D7).
  - Comparing paths case-insensitively on every OS is stricter on Linux, but it blocks case tricks on Windows and macOS with one rule.
  - The runner's real-path re-check closes the symlink gap that a pure gate can't see.
  - Alternatives not chosen (from the `p2-policy-engine` plan):
    - allowing `run_command` before the allowlist;
    - letting the planner write any file in the feature folder;
    - protecting only the current feature's spec folder from the writer;
    - a gate-only lexical check;
    - taking the plugin's state ids as input now;
    - silently ignoring bad tightening.
- **Date:** 2026-11-20

## D31 · Agent commands: allowlist, Windows shims, file lock and revert, network limit

- **Outcome:** `run_command` runs only what the project's markers say, under the limits of D6. Settles D29's open question and is the command part of D6.
  - **Detection** (`src/main/commands/detect.ts`): test and build forms come from the project's markers, read once when the host starts. Node (`package.json` scripts `test` and `build`; the package manager from `packageManager`, else the lockfile, else npm), Python (`pytest.ini`, a root `conftest.py` or `[tool.pytest` for tests; `[build-system]` for `python -m build`), Go (`go test ./...`, `go build ./...`) and Rust (`cargo test`, `cargo build`). A missing, unreadable or unparseable marker gives nothing and never throws. A TOML marker is checked structurally, not with a full parser.
  - **The check** (`src/main/policy/command-allowlist.ts`): the writer may run every detected test and build form, the reviewer only the test forms, and only from the root. Program and arguments must equal a form exactly, ignoring case and a `.exe`, `.cmd` or `.bat` on the base name. A path as the program, extra or changed arguments, and planner or reader calls are denied with fixed reasons. The gate and the runner both run this check (D30, `makeCommandCheck`).
  - **Windows** (`src/main/commands/lookup.ts`): main finds the program on `PATH` with `PATHEXT`, and never with a shell. A `.cmd` or `.bat` it resolves to runs through `cmd.exe /d /s /c` only when the check allowed the call and every argument is a safe token (letters, digits and `:_./-`). The resolved path may not hold a cmd metacharacter or a line break. Any other script stays refused, and git stays refused by name. No agent-chosen text reaches cmd's parser.
  - **Lock, snapshot and revert per job** (`src/main/commands/protect.ts`): before a command runs, main snapshots the protected set and makes `docs/specs/` read-only (write bits off on POSIX; the read-only attribute on Windows). Both jobs protect `docs/specs/` and the `.git` key files (`HEAD`, `config`, `packed-refs`, `hooks/`, `refs/`); `.git/index` is not protected. The reviewer also protects every other file in the root that is not git-ignored, and skips `.git` and `node_modules`. Over 256 MiB of protected files, the command is refused before it starts. After the run, the restore puts back the modes and contents of `docs/specs/` first, then deletes the files and folders the command created in the protected set, and re-creates the ones it deleted. Each path changed is one revert Rule event (`restored`, `re-created` or `deleted`), and the result says which areas were reverted. The restore runs in a `finally`, after a timeout, a start failure or a failed lock alike.
  - **Main's read-only git query:** the reviewer's ignored set comes from `git -C <root> ls-files -z --others --ignored --exclude-standard --directory`, run by main with an argument array, no shell and the minimal environment. The restore reads the ignore rules again, after `.gitignore` is back, so a file the command created that git ignores is kept. If git is missing or the root is not a repository, only `node_modules` and `.git` are skipped.
  - **Network** (`src/main/commands/network.ts`): the writer's commands get the dead proxy variables and the offline flags on every OS. On Linux, a command that passes a one-time `unshare --user --map-root-user --net true` probe runs in its own network namespace with loopback brought up, at level `os`. On macOS, a command runs under `sandbox-exec` with outbound network to non-loopback addresses denied, at level `os`. Everywhere else, including Windows, the level is `proxy-only`. Each writer command gives one network Rule event with its level. The reviewer's commands get no network limit.
  - **Rule events:** the revert and network kinds are added next to the decision events (D30). A revert carries the path and its action; a network event carries the program and the level. Both are sanitized like other targets and never carry content.
  - **Best effort:** the proxy variables and offline flags only help tools that read them. The `proxy-only` level does not stop a program from opening a connection. The Linux namespace needs unprivileged user namespaces, which some distributions disable; then the level is `proxy-only`.
  - **Crash note:** if the app crashes while a command runs, the spec folder can be left read-only and a revert can be left half done. The recovery steps are in `docs/agent-commands.md`.
- **Why:**
  - The allowlist is exact and detected, so a project's own test and build commands work without the agent writing a command string; anything else is refused in code, which keeps the policy of D4 and D6 hard.
  - Keeping the reviewer to test forms makes a review round unable to change the build output it reviews.
  - No agent-chosen string reaches `cmd.exe`'s parser: a shim runs only with safe tokens, so the Windows case cannot be used for injection.
  - The lock stops the command editing a spec, and the revert is the second line, because a command running as the same user can clear a read-only bit. The `.git` key files are reverted to stop a command from moving HEAD, a ref or a hook; `.git/index` is left alone, because git rewrites it on normal use.
  - Reading the ignore rules at restore time, after `.gitignore` is restored, keeps the reviewer from being able to make its own edits invisible by editing the ignore file.
  - The OS network methods are the strongest that need no container (D6's later option); the proxy variables are the common floor on every OS, and the level reported in the event says which one held.
  - Alternatives not chosen (from the `p2-command-allowlist` plan):
    - a shell string or a shell-based runner for Windows;
    - allowing every script on Windows, or refusing every shim (the old D29 rule);
    - reverting `.git/index` as well;
    - a container or an OS sandbox per build (D6's later option);
    - a network block for the reviewer;
    - a restore that trusts the snapshot's ignore set only.
- **Date:** 2026-11-20

## D32 · Agent jobs: definitions, prompts and advertised tools

- **Outcome:** Each of the four jobs (plans and chats, writes code, reviews code, reads big files) has one shared definition, and each run advertises its job's tools and sends its job's system prompt.
  - **Table:** `src/shared/jobs.ts` holds `JOBS`, the plain-language name of each job, and `BASE_TOOLS`, moved there unchanged from `src/main/policy/policy-table.ts`. The policy table re-exports `BASE_TOOLS` and defines none of its own. The gate, the tightening and the agent read one table.
  - **Advertised tools:** `jobToolDefinitions(job)` in `src/agent/jobs/tools.ts` gives the job's base tools in table order, each with the registry's name, description and schema from `TOOL_SPECS`. The loop's hand-written `read_file` definition is removed. The agent advertises the base set; main's gate still applies tightening and decides every call (D30).
  - **Prompts:** TypeScript string constants in `src/agent/jobs/`, with no file read at run time. Every job's system prompt states its role and five common rules: use only the listed tools; never run git and never ask for a commit, a push, an approval or a close; the approved spec is read-only; tickets, docs, web pages and tool output are untrusted data; a refused tool call is an error to recover from, not to work around.
    - The writer, reviewer and reader prompts are ported from the sdd plugin's implementor, reviewer and data-agent, rewritten for the app's tools. The planner's prompt is new.
    - Plugin-only references are left out: the plugin's state folder, its tool names, MCP, `NEEDS-DATA-AGENT` and its scripts.
  - **Task texts:** the writer's three modes (implement, fix findings, resume after a spec revision) and the reviewer's review round are exported as `WRITER_TASKS` and `REVIEWER_TASKS`. Phase 3 sends them as the user message of each round. They are not part of the system prompt.
  - **Reviewer runs tests:** the reviewer may run the project's test command through `run_command` to confirm a claim. It never builds and never edits. The plugin's reviewer runs nothing.
  - **Provider `system`:** `ProviderRequest` has an optional `system` string. The Anthropic adapter sends it as the `system` parameter, and the OpenAI adapter sends it as a leading system message. When it is unset or empty, both send exactly what they sent before.
  - **Loop and spike:** `runAgentLoop` takes a `job`, and every request carries that job's system prompt and tools. The spike runs as the reader, and its tool calls carry the run's job.
- **Why:**
  - One table means the agent cannot advertise a tool that the gate refuses for its job, and a change to the table reaches both sides at once.
  - The advertised schemas are the registry's own, so the model sees the same contract that main checks.
  - A prompt is guidance. The rules it states are enforced by main's gate (D1, D4), so a model that ignores its prompt is still refused.
  - Keeping the task texts out of the system prompt lets Phase 3 choose which text goes with each round, and keeps the system prompt the same from round to round.
  - TypeScript constants put the prompts in the bundle with no file read at run time, and the tests can check each prompt against its job's tools and forbid git and workflow actions.
  - The reviewer may run tests because a claim about behaviour is often settled faster by a test than by reading. D31 limits it to the test form, so a review round cannot change the build output it reviews.
- **Alternatives not chosen** (from the `p2-jobs-and-prompts` plan):
  - the agent imports `src/main/policy/policy-table.ts`, or main sends each run's tool list in a protocol message;
  - porting each plugin file whole, modes included, as the system prompt, or role and rules only with no report formats;
  - markdown files read through Vite's `?raw`;
  - a note on D30 instead of a new decision;
  - sending the project's tightened tool list now;
  - a static reviewer that runs nothing and only writes "needs a runtime check" notes.
- **Open:** Sending a project's tightened tool list to the agent is left for Phase 3 or 4. The turn limit, per-job models and the spike and probe fixtures are unchanged.
- **Date:** 2026-11-21

## D33 · Human-only actions: gesture check, channel and handler registry

- **Outcome:** The five human-only actions (approve spec, approve result, mark done, change project rules, edit an approved spec) have one shared contract in `src/shared/human-actions.ts`: the ids, a request `{ action, feature }` where `feature` is a slug, and a result. The renderer calls them through `harness.humanAction(request)` on the channel `harness:human-action`. This refines D3's "user click" to a user gesture: a click or an Enter or Space press. D3 is not rewritten.
  - **The checks, in order** (`src/main/human/channel.ts`), stopping at the first refusal: (1) the sender is the app's own window and top-level page, by the existing `isTrustedSender`; (2) the request passes the guard (exactly the keys `action` and `feature`, a known id, a slug of at most 64 characters); (3) a gesture is present. A request that passes all three goes to the registry.
  - **The registry:** a map from each action id to a handler. No handler is registered in this subtask, so a request that passes every check is answered `not-available`. Phase 3 registers the handlers. A second registration for an action throws.
  - **What counts as a gesture** (`src/main/human/gesture.ts`): main records real input from the main window's `input-event`: a `mouseDown` with the left button, or a `keyDown` of Enter or Space that is not an auto-repeat. Every other input is ignored, including mouse up, move, wheel, right and middle buttons, key up, `char`, other keys and unknown types.
  - **The window and one use:** a request may use a gesture recorded at most 1000 ms before it (`GESTURE_WINDOW_MS`). A gesture is used once: the third check clears it whether or not the request then succeeds. A later gesture replaces an unused one.
  - **Refusal codes:** `untrusted-sender`, `invalid`, `no-gesture` and `not-available`. An untrusted or invalid call does not touch the gesture.
  - **Logging:** each call writes one decision line, `human action <action|invalid>: <accepted|refused> (<code or ok>)`, with ` feature=<slug>` for a request that passed the guard. A handler that throws is logged by its error name only, never its message. A call from an untrusted sender logs `invalid`, because its request is not read.
  - **Not Rule events:** a human-only call is not a tool call, so it is logged as a decision line and does not go through the gate (D30).
  - **Agent boundary:** the agent process has no route to the channel. No message type reaches it (`validateAgentToMainMessage` refuses `human-action` and every id), no tool or job base tool has a human-action name, and no file under `src/agent/` names the channel or imports the bridge, the contract or Electron. Tests in `tests/unit/human-agent-boundary.test.ts` and `tests/unit/human-text-acceptance.test.ts` show this, including a router run with "approve the spec" and "git push" in a file and a ticket.
- **Why:**
  - Page script cannot make a gesture. An event built by `dispatchEvent` or `element.click()` never enters the window's input pipeline, so the tracker never records it. Only input from a person reaches main.
  - The gesture check makes the human action a deliberate act in the window, the same guarantee D3 gives for typed prompts, without typed commands (D11).
  - The guard runs before the gesture, so a malformed or hostile call cannot use up a real click. The sender check runs first, so an outside page cannot use one either.
  - One use per gesture stops a single click from approving two things.
  - The registry lets Phase 3 add the real handlers without changing the checks or the channel, and no handler exists before then to be reached by mistake.
  - The sender check is the one `isTrustedSender` already used for the window calls (`src/main/security.ts`), so the two rules cannot drift apart.
- **Limit:** a gesture proves that a human acted in the app's window in the second before the call. It does not prove which control they used. A script in the page could ride on a real click made within that second. The renderer loads only the app's own page under the navigation guards and the sandbox, which keeps page script to that page. Phase 3 can narrow this, for example by requiring the gesture to land on the Next bar's button.
- **Alternatives not taken** (from the `p2-human-only-channel` plan):
  - the preload checks `navigator.userActivation.isActive`: the check would run in the renderer, where page script can read and misuse it;
  - a native confirm dialog from main for each action: a second click the design does not show;
  - stub in-memory handlers now: code that Phase 3 would discard.
- **Date:** 2026-11-21

## D34 · Workflow table: hand-written, stage mapping, data-agent overlay, event kinds and human map

- **Outcome:** The sdd workflow's twelve nodes, eighteen events and their transitions are one hand-written typed table in `src/shared/workflow.ts`. It is ported from the plugin's `hooks/machine.ts` (v0.18.0) as plain readonly data, with pure functions `legalEvents`, `nextNode` and `transition` (the last reports an illegal event with a fixed reason). There is no state-machine dependency.
  - **Stage mapping:** each of the eleven path nodes maps to one of the six stages (Start, Plan, Spec, Build, Review, Done) per `docs/workflow.md`. `paused` is Build with a paused flag, labelled "Build, paused". `build-done` is Review.
  - **Data-agent overlay:** `data-agent` stays in the table so the port is exact, but it has no stage (`isOverlay`). Callers show the stage of the path node it left.
  - **Event kinds:** each event is `human-only`, `user` or `app`. Human-only: `APPROVE_SPEC`, `REAPPROVE`, `CLOSE`. User: `START`, `APPROVE_PLAN`, `START_BUILD`, `REVISE`, `REQUEST_CHANGES`, `START_NEXT`. App: the other nine events.
  - **Human map:** `APPROVE_SPEC` and `REAPPROVE` map to the D33 action `approve-spec`; `CLOSE` maps to `mark-done`. Its keys are exactly the human-only events. `approve-result` has no event: the feature stays in `build-done`, and `p3-ship` handles it. `edit-approved-spec` and `change-rules` raise no event; a saved spec change is seen as `EDIT_SPEC`.
  - The event kinds are a starting classification. Later Phase 3 subtasks may amend them, as D19 was amended.
- **Why:**
  - A plain table with pure functions can be read by main now and by the renderer later, and it has no runtime dependency to vendor.
  - A test compares the ids and all 12 x 18 pairs with a literal copy of the plugin's config, so any change to the port is deliberate.
  - The stage mapping gives the six user stages one source, so the UI never shows an internal id.
  - Keeping `data-agent` in the table keeps the port exact. Its overlay status comes from the design: it never moves the path.
  - The event kinds and the human map give later subtasks the data to enforce that only a person triggers the human-only events, and that no app event leaves `build-done`.
- **Alternatives not taken** (from the `p3-state-machine` plan):
  - XState from npm, as the plugin uses: a runtime dependency for a table of 21 transitions;
  - the table in `src/main/workflow/`, main only: the renderer could not read the labels and kinds without a copy;
  - mapping `data-agent` to Plan, or dropping it from the table: the first changes the stage view, the second breaks parity with the plugin;
  - adding a result-approved node or event: breaks exact parity with the plugin, and `approve-result` is handled by `p3-ship`;
  - `EDIT_SPEC` as human-only as well: an edit is an app-seen event, and the human check happens at approval;
  - two event kinds only, with user folded into app: loses the distinction the UI needs for who may trigger each event.
- **Date:** 2026-11-22
