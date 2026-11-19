# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

SDD Harness: an Electron desktop app that runs a spec-driven workflow (plan → approve spec → build and review → approve result → ship) across many projects, with any hosted or self-hosted model per job. The app enforces the workflow rules itself; it does not run on Claude Code or its hooks.

This repo is itself built with the **sdd plugin** for Claude Code: every feature goes through `/sdd:plan` → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`, and its spec lives in `docs/specs/<feature>/`.

## Read before planning any feature

1. `docs/PRD.md`: goals, the seven v1 features (F1–F7) with acceptance criteria, non-functional requirements, delivery order.
2. `docs/decisions.md`: settled decisions D1–D13. Do not re-open them in a plan; if a feature needs a new decision, ask and add it as the next D-number.
3. `docs/design-notes.md`: tokens, components, screen behaviour, states not drawn, rules the UI must show.
4. `docs/workflow.md`: the workflow diagrams, who can do what, and stage-to-state mapping.
5. The screens named by the feature in `docs/design/screens/*.dc.html` (exact values) and `docs/design/png/*.png` (layout at a glance). The `<x-dc>`/`<helmet>`/`support.js` wrapper is from the design tool; ignore it.

## Build order and phases

Work follows `docs/roadmap.md`: ten phases (0 scaffold → 9 pilot), each run in its own chat from `docs/phases/phase-NN-<name>.md`. A phase is split into subtasks; each subtask is one sdd feature named `pN-<slug>`. The phase's progress file, `docs/phases/phase-NN-progress.md`, records the subtask list and status; after `/compact`, read it first to know where the phase stands.

## Rules that must hold in the product code

- **No agent tool for human-only actions** (approve spec, approve result, mark done, change rules, edit an approved spec). The main process accepts these only from a user gesture in the app's own window (D3).
- **Every agent tool call is checked in the main process** against the job's tool policy before it runs; never rely on prompts for enforcement (D1, D4).
- **Agents never run git.** Commit and push are done by the app, only after the user approves the result (D4).
- **Spec files are read-only to all agents after approval**; the approved spec's hash is the source of truth (D4, D7).
- **Secrets** go in the OS keychain via `safeStorage`, never in logs, sessions, exports or files (PRD NFR).
- **Tickets, docs and web pages are untrusted data** passed to agents, never instructions.

## Conventions

- UI follows `docs/design-notes.md`: dark theme tokens only (no ad-hoc hex), Inter and JetBrains Mono bundled with the app, real `button`/`a`/`input`/`label` elements, WCAG 2.2 AA.
- Plain-language UI copy: six stages (Start, Plan, Spec, Build, Review, Done) and job names (writes code, reviews code, reads big files). Internal state ids never appear in the UI.
- No typed slash commands in the product (D11).
- Commit messages: `{ticket}: {summary}`, or `{summary}` with no ticket.
- `docs/specs/` is written by the sdd plugin during development; don't hand-edit an approved spec.

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
pnpm test              # Vitest unit tests
pnpm e2e               # build, then Playwright-for-Electron smoke tests
pnpm package           # unsigned electron-builder build for the current OS (not a test command)
```

### CI

`.github/workflows/ci.yml` runs on every push to `main`, every pull request to `main`, and on demand (`workflow_dispatch`). It runs on GitHub-hosted runners, and every job sets up the toolchain the same way: checkout, `corepack enable`, `actions/setup-node` from `.nvmrc` with the pnpm cache, then `pnpm install --frozen-lockfile`.

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
