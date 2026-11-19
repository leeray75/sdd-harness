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

- **Outcome:** The harness writes its own agent loop behind its own provider interface. The adapters use the official SDKs for transport, streaming and retries: `@anthropic-ai/sdk` for the Anthropic Messages API and the `openai` SDK (with a base URL and extra headers) for every OpenAI-compatible server and gateway. No SDK type crosses the provider interface. Tool calls the model asks for still go to main's policy gate before they run.
- **Why:** The loop is small for two adapters, and owning it keeps the tool gate, redaction, usage counting and the "self-hosted only" check in our code. The SDKs handle SSE parsing and retry details we would otherwise maintain. Writing the transport on plain `fetch` was the alternative and was not chosen, because it adds SSE and retry code to maintain. Adopting a multi-provider agent library (Vercel AI SDK) was the alternative and was not chosen, because its abstractions and release pace would sit between the gate and the model.
- **Date:** 2026-11-18

## D24 · Testing provider adapters

- **Outcome:** Unit tests replay recorded HTTP and SSE fixtures through a `fetch` injected into each SDK client, so `pnpm test` and CI need no keys and no network. A separate live suite runs only when the provider's key or base URL is set in the environment, and CI does not set them. Fixtures contain no real keys.
- **Why:** Fixtures make adapter tests fast and repeatable on every OS; the optional live suite catches API drift on demand. In-process mock servers were the alternative and were not chosen, because hand-written mocks drift from the real APIs. Fixtures only, with no live suite, was the alternative and was not chosen, because nothing would check the fixtures against the real servers.
- **Date:** 2026-11-18

## D25 · Provider key storage, delivery and redaction

- **Outcome:** Provider keys live only in main, as `safeStorage` ciphertext in `userData/secrets.json` (`{ "version": 1, "entries": { "<name>": "<base64>" } }`), written atomically with mode `0o600`. Names match `^[a-z0-9][a-z0-9-]{0,63}$`. On Linux, a `basic_text` or `unknown` backend makes `save` refuse, with nothing written; the test-only override `HARNESS_ALLOW_WEAK_SECRETS=1` allows `basic_text`, and only the e2e tests set it. A stored key reaches a model call through a per-run `model-key` message from main to the agent (D19), so it is never in the agent's environment. The agent holds it in memory only and never writes it to stdout, stderr, a file or a log. Every line main writes, including the agent output it forwards, passes a redactor first: each value the store has handed out, `Bearer` tokens, `Authorization` and `x-api-key` header values, and `sk-` or `sk-ant-` strings of 20 or more key characters become `[redacted]`. The dev-only `pnpm secrets:set|list|delete` script hands a `set` value to main over a one-shot local socket: a random named pipe on Windows, or a socket in a private `0o700` temp dir elsewhere. Only the address goes on the command line; the value never goes on the command line, in an environment variable or in a file.
- **Why:** `safeStorage` uses the OS keychain, which the PRD requires; a `basic_text` backend stores values in effectively plain form, so it is refused, and the override keeps Linux CI running without a keyring. A per-run message keeps the key out of the process environment, where a child process or a log dump would see it. Holding the key in agent memory is the accepted trade-off: the agent has no tools of its own and its only output goes through main's redaction (see the `p1-secrets` plan). The dev script uses a socket because Electron's main process on Windows receives no stdin: an empty stdin was observed on 2026-11-19 for both a pipe and a file redirect. Alternatives not chosen: a loopback proxy in main that adds the key, so the agent never holds it (more code: a local listener, SSE pass-through and a per-run token); main making the model calls and streaming chunks to the agent (moves transport out of the agent and amends D23); importing `HARNESS_SPIKE_API_KEY` into the store at startup (the key still starts in the environment); accepting `basic_text` with a warning (effectively plaintext); starting gnome-keyring in Linux CI with no override (fragile CI); the dev script's stdin (empty on Windows); a one-time private file (the plaintext touches disk briefly); an inherited fd 3 pipe (unverified on Windows); a dev-only window with a hidden input (adds renderer and preload code).
- **Date:** 2026-11-19
