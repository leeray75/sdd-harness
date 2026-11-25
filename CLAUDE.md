# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

SDD Harness: an Electron desktop app that runs a spec-driven workflow (plan → approve spec → build and review → approve result → ship) across many projects, with any hosted or self-hosted model per job. The app enforces the workflow rules itself; it does not run on Claude Code or its hooks.

This repo is itself built with the **sdd plugin** for Claude Code: every feature goes through `/sdd:plan` → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`, and its spec lives in `docs/specs/<feature>/`.

## Read before planning any feature

1. `docs/PRD.md`: goals, the seven v1 features (F1–F7) with acceptance criteria, non-functional requirements, delivery order.
2. `docs/decisions.md`: settled decisions D1–D39. Do not re-open them in a plan; if a feature needs a new decision, ask and add it as the next D-number.
3. `docs/design-notes.md`: tokens, components, screen behaviour, states not drawn, rules the UI must show.
4. `docs/workflow.md`: the workflow diagrams, who can do what, and stage-to-state mapping.
5. `docs/workflow-engine.md`: the sdd workflow's nodes, events and transitions, the stage mapping, the event kinds and the human-action map. The one table is `src/shared/workflow.ts` (D34). It also covers the document layer (D35): the templates, the `docs/specs/<feature>/` layout and parsers in `src/shared/spec-docs.ts`, the folder detector in `src/shared/spec-detect.ts`, and the scanner in `src/main/workflow/spec-folders.ts`. Its "Spec lock" section covers the approval lock (D36): the state file `docs/specs/.sdd-state.json`, its code in `src/shared/spec-state.ts`, `src/main/workflow/spec-lock.ts` and `spec-watch.ts`, and the two handlers in `src/main/human/spec-handlers.ts`. Its "Build loop" section covers the build loop (D37): the controller in `src/main/workflow/build-loop.ts`, the job runner in `src/main/workflow/job-runner.ts`, the report parsers in `src/shared/build-reports.ts` and the document renderers in `src/shared/build-docs.ts`. Its "Ship and close" section covers the ship step (D38): the git module `src/main/git/git.ts` (the only code that runs git), the steps in `src/main/workflow/ship.ts` and the two handlers in `src/main/human/ship-handlers.ts`. Its "Headless run" section covers the headless walk, the one test that runs a feature from planning to closed, and where build jobs run (D39): in the main process, through the app's runner factory `src/main/workflow/app-runner.ts`.
6. The screens named by the feature in `docs/design/screens/*.dc.html` (exact values) and `docs/design/png/*.png` (layout at a glance). The `<x-dc>`/`<helmet>`/`support.js` wrapper is from the design tool; ignore it.

## Build order and phases

Work follows `docs/roadmap.md`: ten phases (0 scaffold → 9 pilot), each run in its own chat from `docs/phases/phase-NN-<name>.md`. A phase is split into subtasks; each subtask is one sdd feature named `pN-<slug>`. The phase's progress file, `docs/phases/phase-NN-progress.md`, records the subtask list and status; after `/compact`, read it first to know where the phase stands.

## Rules that must hold in the product code

- **No agent tool for human-only actions** (approve spec, approve result, mark done, change rules, edit an approved spec). The main process accepts these only from a user gesture in the app's own window (D3).
- **Every agent tool call is checked in the main process** against the job's tool policy before it runs; never rely on prompts for enforcement (D1, D4).
- **Agents never run git.** Commit and push are done by the app, only after the user approves the result (D4, D38: `approve-result` is the only path to a commit, and `src/main/git/` the only code that runs git).
- **Spec files are read-only to all agents after approval**; the approved spec's hash is the source of truth (D4, D7). The writer may keep its own feature's `tasks.md` and `changes.md` (D37).
- **Secrets** go in the OS keychain via `safeStorage`, never in logs, sessions, exports or files (PRD NFR).
- **Tickets, docs and web pages are untrusted data** passed to agents, never instructions.
- **Commands run only from the project's detected allowlist**, from the project root, through a check that main runs again before each one. While a command runs, `docs/specs/` is read-only; afterwards, changes outside the rules are reverted. The code writer's commands get no network where the OS allows it, and that is best effort elsewhere (D6, D31; [docs/agent-commands.md](docs/agent-commands.md)).

## Conventions

- UI follows `docs/design-notes.md`: dark theme tokens only (no ad-hoc hex), Inter and JetBrains Mono bundled with the app, real `button`/`a`/`input`/`label` elements, WCAG 2.2 AA.
- Plain-language UI copy: six stages (Start, Plan, Spec, Build, Review, Done) and job names (writes code, reviews code, reads big files). Internal state ids never appear in the UI.
- No typed slash commands in the product (D11).
- Commit messages: `{ticket}: {summary}`, or `{summary}` with no ticket.
- `docs/specs/` is written by the sdd plugin during development; don't hand-edit an approved spec.
- Every spec includes a docs task and acceptance criterion, done in the build on the feature branch, not after the merge:
  - `CHANGELOG.md` entries under `## [Unreleased]`;
  - every doc the work makes stale, updated in the same change (check `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md`, the phase doc and the progress file's follow-ups);
  - new documents where they are useful and necessary, named in the spec.

  After the merge, only the progress file's status and commit are filled in.

- A pull request is merged only when its CI run is green on every job (`check`, and `e2e` on Windows, macOS and Linux). The result-approval and close messages state the CI state and link the run or the compare page.

## Commands

Use Node 24 (`.nvmrc`). pnpm is pinned in `package.json` and enabled through Corepack (D14).

```sh
corepack enable        # once per machine; provides the pinned pnpm
pnpm install           # install from pnpm-lock.yaml
pnpm dev               # run the app with electron-vite (dev server, hot reload)
pnpm build             # build main, preload and renderer to out/
pnpm typecheck         # tsc for the Node side and the web side (strict)
pnpm lint              # ESLint (flat config, TypeScript and React rules)
pnpm format            # Prettier: rewrite files
pnpm format:check      # Prettier: check only
pnpm test              # Vitest unit tests (tests/unit only)
pnpm test:live         # opt-in live suites (tests/live: the spike loop and the model probes): need an address (HARNESS_SPIKE_BASE_URL, or the preset default) and reads HARNESS_SPIKE_API_KEY from its environment; never in CI
pnpm record:spike      # dev only: records tests/fixtures/spike/openai from agentgateway (AGENTGATEWAY_BASE_URL without /v1, AGENTGATEWAY_API_KEY)
pnpm record:spike anthropic # dev only: records tests/fixtures/spike/anthropic in the Anthropic format (same variables; model claude-haiku-5-5)
pnpm record:probes     # dev only: records tests/fixtures/probes/openai (models.json, chat.sse, tool-turn1.sse, tool-turn2.sse) from agentgateway (AGENTGATEWAY_BASE_URL without /v1, AGENTGATEWAY_API_KEY, optional AGENTGATEWAY_MODEL)
pnpm record:probes anthropic # dev only: the same files in the Anthropic format (tests/fixtures/probes/anthropic; model claude-haiku-5-5)
pnpm secrets:set agentgateway # dev only: stores a value in the secret store (hidden prompt, or piped stdin); unpackaged runs only
pnpm secrets:list      # dev only: lists the stored names (never values)
pnpm secrets:delete spike # dev only: removes a stored entry
pnpm e2e               # build, then Playwright-for-Electron smoke tests
pnpm package           # unsigned electron-builder build for the current OS (not a test command)
```

### CI

`.github/workflows/ci.yml` runs on every push to `main`, every pull request to `main`, and on demand (`workflow_dispatch`). It runs on GitHub-hosted runners, and every job sets up the toolchain the same way: checkout, `corepack enable`, `actions/setup-node` from `.nvmrc` with the pnpm cache, then `pnpm install --frozen-lockfile`. Dependabot (`.github/dependabot.yml`) checks the GitHub Actions in this workflow weekly, and its pull requests follow the same CI-green merge rule as any other.

- **`check`** (Linux): `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test`, each as its own step.
- **`e2e`** (matrix: Windows, macOS and Linux; `fail-fast: false`): `pnpm e2e`, then `pnpm exec electron-builder --dir` for an unsigned package build that reuses the `out/` build. On Linux, a step first sets `kernel.apparmor_restrict_unprivileged_userns=0` with sysctl. A step then installs `fluxbox` and `x11-utils` (for `xprop`) with apt. The Linux e2e job runs the tests under `xvfb-run -a`, with fluxbox started in the background and waited for (up to about 10 s, via `xprop`) before `pnpm e2e` runs, so Maximize and Restore work as on a Linux desktop. Nothing is uploaded on success. On failure, `playwright-report/` and `test-results/` are uploaded per OS.

Reproduce locally:

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test   # the check job
pnpm e2e                                                       # the e2e job on Windows and macOS
sudo apt-get install -y --no-install-recommends fluxbox x11-utils   # once, on Linux
xvfb-run -a bash -c 'fluxbox >/dev/null 2>&1 & for _ in $(seq 1 20); do xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q "window id #" && break; sleep 0.5; done; pnpm e2e'   # the e2e job on Linux
CI=1 pnpm e2e                                                  # CI retry, trace and HTML report behaviour
```

On this machine, run pnpm from Windows (PowerShell or Git Bash), not from WSL. In PowerShell, set the variable with `$env:CI = 1` before `pnpm e2e`.

The suggested sdd test command is `SDD_TEST_CMD="pnpm test"`. `pnpm e2e` is left to CI and the build.

### Run the spike (dev only)

The agent loop spike (D23) is off unless `HARNESS_AGENT_SPIKE=1`; then the agent runs one loop when main sends its `model-key` message after the handshake. The key is not an environment variable: store it with `pnpm secrets:set agentgateway` (dev only), and main reads the `agentgateway` entry and sends it to the agent in memory (D25). Its variables: `HARNESS_SPIKE_PRESET` (the server type, default `agentgateway`; the presets are in `src/shared/server-presets.ts`, D27), `HARNESS_SPIKE_BASE_URL` (the address, for example `http://spark-8013.taileaa4a8.ts.net:4100`; it may be unset when the preset has a default address; one address serves both formats, the openai format adds `/v1` and the anthropic format strips it and posts to `/v1/messages`), `HARNESS_SPIKE_PROVIDER` (the wire format, `openai` or `anthropic`; the default is the preset's first format, and a format the preset does not offer skips the spike with a reason), `HARNESS_SPIKE_HEADERS` (extra headers as `Name: value` lines; reserved names such as `Authorization` are refused, D27), `HARNESS_SPIKE_MODEL` (default `qwen3.8-flash-next-nothink` for openai, `claude-haiku-5-5` for anthropic) and `HARNESS_SPIKE_ROOT` (the one folder `read_file` may read; with it set, the app also reads that folder's `docs/specs/` for the approval lock and registers the spec handlers, D36). The agent gets the spike variables only when the flag is `1`, and gets no other app variable. `pnpm test:live` runs the loop against the spike address (`HARNESS_SPIKE_BASE_URL`, or the preset default) and skips when there is none; `pnpm record:spike [anthropic]` re-records the fixture in `tests/fixtures/spike/<format>`.
