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

## D18 · Node version

- **Outcome:** Node 24 LTS. `package.json` `engines` requires `>=24 <25`, and `.nvmrc` names `24`.
- **Why:** Node 24 is the current LTS line and matches the local toolchain. Node 22 was the alternative and was not chosen.
- **Date:** 2026-11-17
