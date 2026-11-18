# SDD Harness

An Electron desktop app for spec-driven development: plan a feature with an AI, approve its spec, let separate agents build and review it, approve the result, ship. Any hosted or self-hosted model per job; the workflow rules are enforced by the app.

Status: **Phase 0 (scaffold) in progress.** See [`docs/roadmap.md`](docs/roadmap.md) and [`docs/phases/phase-00-progress.md`](docs/phases/phase-00-progress.md).

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

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | Run the app (electron-vite dev server, hot reload)        |
| `pnpm build`     | Build main, preload and renderer to `out/`                |
| `pnpm typecheck` | Strict `tsc` for the Node side and the web side           |
| `pnpm lint`      | ESLint                                                    |
| `pnpm format`    | Prettier: rewrite files (`pnpm format:check` checks only) |
| `pnpm test`      | Vitest unit tests                                         |
| `pnpm e2e`       | Build, then the Playwright-for-Electron tests             |
| `pnpm package`   | Unsigned electron-builder build for the current OS        |

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

| File                                           | What it is                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                   | Product requirements: goals, features F1–F7, acceptance criteria, delivery plan |
| [`docs/decisions.md`](docs/decisions.md)       | Settled decisions D1–D20                                                        |
| [`docs/design-notes.md`](docs/design-notes.md) | Design system, components, screen behaviour, states                             |
| [`docs/workflow.md`](docs/workflow.md)         | Workflow diagrams and who can do what                                           |
| [`docs/design/`](docs/design/README.md)        | 16 screens: HTML source and PNG renders                                         |
| [`docs/roadmap.md`](docs/roadmap.md)           | Ten phases from scaffold to pilot, with status                                  |
| [`docs/phases/`](docs/phases/README.md)        | One document per phase: open it in a new Claude Code chat to run that phase     |
| `docs/specs/`                                  | Feature specs written by the sdd plugin during development                      |

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
