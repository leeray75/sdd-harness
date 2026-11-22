# SDD Harness

An Electron desktop app for spec-driven development: plan a feature with an AI, approve its spec, let separate agents build and review it, approve the result, ship. Any hosted or self-hosted model per job; the workflow rules are enforced by the app.

Status: **Phase 3 (workflow engine) in progress**; Phases 0–2 are done. See [`docs/roadmap.md`](docs/roadmap.md) and [`docs/phases/phase-03-progress.md`](docs/phases/phase-03-progress.md).

## Development setup

### Prerequisites

- **Node 24** (see `.nvmrc`).
- **pnpm 12.21.0**, pinned in `package.json` and provided by Corepack. Run `corepack enable` once per machine, or prefix commands with `corepack` (`corepack pnpm install`).
- **Windows, macOS or Linux, natively.** So far the app has only been built and tested on Windows. Checks on macOS and Linux arrive with CI in Phase 0.

### Install and run

```sh
pnpm install   # installs dependencies and downloads the Electron binary for this OS
pnpm dev       # opens the app with hot reload
```

| Command              | What it does                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Run the app (electron-vite dev server, hot reload)                                                                                                                                    |
| `pnpm build`         | Build main, preload and renderer to `out/`                                                                                                                                            |
| `pnpm typecheck`     | Strict `tsc` for the Node side and the web side                                                                                                                                       |
| `pnpm lint`          | ESLint                                                                                                                                                                                |
| `pnpm format`        | Prettier: rewrite files (`pnpm format:check` checks only)                                                                                                                             |
| `pnpm test`          | Vitest unit tests                                                                                                                                                                     |
| `pnpm e2e`           | Build, then the Playwright-for-Electron tests                                                                                                                                         |
| `pnpm test:live`     | Opt-in live suites (the spike loop and the model probes) against the spike's address (`HARNESS_SPIKE_BASE_URL`, or the preset default); skipped without one, never in CI              |
| `pnpm record:spike`  | Dev only: records the spike fixture from agentgateway (`AGENTGATEWAY_BASE_URL` without `/v1`, `AGENTGATEWAY_API_KEY`); `pnpm record:spike anthropic` for the Anthropic format         |
| `pnpm record:probes` | Dev only: records the model probe fixtures from agentgateway (`AGENTGATEWAY_BASE_URL` without `/v1`, `AGENTGATEWAY_API_KEY`); `pnpm record:probes anthropic` for the Anthropic format |
| `pnpm package`       | Unsigned electron-builder build for the current OS                                                                                                                                    |

### Run the spike (dev only)

The spike sends one prompt through the server named by `HARNESS_SPIKE_PRESET` (agentgateway by default), in the OpenAI-compatible format (the default) or the Anthropic Messages format (`HARNESS_SPIKE_PROVIDER=anthropic`, where the preset offers it). The spike runs as the reader job (D32), so the model may ask for one of its read-only tools (`read_file`, `list_files`, `search_text` or `read_ticket`). Main checks each call and runs it, file tools stay inside the folder below, and the model finishes its answer. Set these before `pnpm dev`:

| Variable                 | What it does                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HARNESS_AGENT_SPIKE=1`  | The agent runs the spike loop once, when main sends its key message. The spike variables reach the agent only when this is `1`                                                                                                          |
| `HARNESS_SPIKE_PRESET`   | The server type: `agentgateway` (the default), `vllm`, `ollama`, `lm-studio`, `llama-cpp`, `tgi-sglang`, `litellm` or `other` (presets in `src/shared/server-presets.ts`, D27). An unknown preset skips the spike with a message        |
| `HARNESS_SPIKE_BASE_URL` | The address, for example `http://spark-8013.taileaa4a8.ts.net:4100`. It may be unset when the preset has a default address. One address serves both formats: the openai format adds `/v1`, the anthropic format posts to `/v1/messages` |
| `HARNESS_SPIKE_PROVIDER` | The wire format: `openai` or `anthropic`. The default is the preset's first format; a format the preset does not offer skips the spike with a message                                                                                   |
| `HARNESS_SPIKE_HEADERS`  | Extra headers as `Name: value`, one per line. `Authorization`, `x-api-key`, `anthropic-version`, `Content-Type`, `Content-Length` and `Host` are refused (D27)                                                                          |
| `HARNESS_SPIKE_MODEL`    | The model name. Default `qwen3.8-flash-next-nothink` for openai, `claude-haiku-5-5` for anthropic                                                                                                                                       |
| `HARNESS_SPIKE_ROOT`     | The one folder `read_file` may read inside. Absolute paths and paths that leave it are refused                                                                                                                                          |

The provider key is not an environment variable. Store it in the app's secret store first (dev only; the value is never on the command line, and the script builds the app first when `out/` is missing):

```sh
pnpm secrets:set agentgateway     # hidden prompt, or piped stdin: echo value | pnpm secrets:set agentgateway
pnpm secrets:list                # names only
pnpm secrets:delete agentgateway
```

Main sends the stored `agentgateway` key to the agent once per run, in memory only (D25). With no stored key, the agent sends no key.

The streamed answer is written to the agent's output. `pnpm test:live` runs the same loop against `HARNESS_SPIKE_BASE_URL` when it is set. `pnpm record:spike` records the openai fixture from agentgateway, and `pnpm record:spike anthropic` records the Anthropic one (both in `tests/fixtures/spike/<format>/`).

### Windows and WSL

On Windows, run `pnpm` from **PowerShell** (or Git Bash) with Windows Node, not from WSL.

- `node_modules` holds OS-specific native files: the Electron binary, and the native parts of rolldown and esbuild. If you run `pnpm install` from WSL in a checkout under `/mnt/c/...`, it overwrites the Windows files with Linux ones in the same folder. After that, the app is broken on both sides.
- Electron opens a desktop window. Under WSL that needs WSLg plus Linux GUI libraries, and it hasn't been tested.
- Node is much slower on `/mnt/c` than on either native filesystem.

WSL is fine for tools that don't touch `node_modules`, such as `git` and `gh`. To develop inside WSL, clone the repo into the Linux filesystem (for example `~/repos/sdd-harness`) so it has its own `node_modules`. Never install from both sides into the same folder.

### Troubleshooting

**`Error: Electron uninstall` from `pnpm dev`.** The Electron binary is missing: `node_modules/electron/` has no `dist/` folder or `path.txt`. This usually happens after an install from another OS (see above) or an interrupted download. Reinstall from the OS you run the app on:

```sh
rm -rf node_modules            # PowerShell: Remove-Item -Recurse -Force node_modules
pnpm install --frozen-lockfile
node -e "console.log(require('electron'))"   # prints the path to the Electron binary
```

If the binary is still missing, run `node node_modules/electron/install.js` and read its error (often a proxy or network problem). Electron's install script is allowed to run in `pnpm-workspace.yaml` (`allowBuilds`), so don't remove that entry.

## Docs

| File                                                 | What it is                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                         | Product requirements: goals, features F1–F7, acceptance criteria, delivery plan                                                                         |
| [`docs/decisions.md`](docs/decisions.md)             | Settled decisions D1–D35                                                                                                                                |
| [`docs/design-notes.md`](docs/design-notes.md)       | Design system, components, screen behaviour, states                                                                                                     |
| [`docs/workflow.md`](docs/workflow.md)               | Workflow diagrams and who can do what                                                                                                                   |
| [`docs/workflow-engine.md`](docs/workflow-engine.md) | Workflow engine reference: nodes, events, transitions, stages, event kinds, the document layer and folder detection (table in `src/shared/workflow.ts`) |
| [`docs/design/`](docs/design/README.md)              | 16 screens: HTML source and PNG renders                                                                                                                 |
| [`docs/roadmap.md`](docs/roadmap.md)                 | Ten phases from scaffold to pilot, with status                                                                                                          |
| [`docs/phases/`](docs/phases/README.md)              | One document per phase: open it in a new Claude Code chat to run that phase                                                                             |
| `docs/specs/`                                        | Feature specs written by the sdd plugin during development                                                                                              |

## Building it with Claude Code and the sdd plugin

1. **Load the plugin** when starting Claude Code in this repo:

   ```bash
   claude --plugin-dir "/path/to/ai-skills/plugins/sdd-plugin"
   ```

2. **Optional plugin config.** Create `.claude/sdd/config` yourself (Claude can't write there; the folder is git-ignored). For example:

   ```text
   SDD_MODE=enforce
   SDD_TRACKER=none
   SDD_COMMIT_FORMAT={summary}
   ```

   Set `SDD_TRACKER=jira` (or `github`, `youtrack`) once the tracker for this project is decided, and `SDD_TEST_CMD="pnpm test"` for the test command (`pnpm e2e` runs in CI; see CLAUDE.md, CI).

3. **Add a remote** (for example a GitHub repo) as `origin`: each sdd cycle ends by pushing a feature branch.

4. **Run the phases in order**, one new chat each. Start Phase 0 by sending:

   ```text
   Read docs/phases/phase-00-scaffold.md and follow its instructions.
   ```

   Claude proposes the phase's subtasks and gives you, for each one, the brief to paste after `/sdd:start` and the `/compact` command to run after `/sdd:close`. See [`docs/phases/README.md`](docs/phases/README.md).
