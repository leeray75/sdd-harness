# SDD Harness

An Electron desktop app for spec-driven development: plan a feature with an AI, approve its spec, let separate agents build and review it, approve the result, ship. Any hosted or self-hosted model per job; the workflow rules are enforced by the app.

Status: **design and requirements complete, no code yet.**

## Docs

| File                                           | What it is                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                   | Product requirements: goals, features F1–F7, acceptance criteria, delivery plan |
| [`docs/decisions.md`](docs/decisions.md)       | Settled decisions D1–D13                                                        |
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

   Set `SDD_TRACKER=jira` (or `github`, `youtrack`) once the tracker for this project is decided, and `SDD_TEST_CMD` once there is a test command.

3. **Add a remote** (for example a GitHub repo) as `origin`: each sdd cycle ends by pushing a feature branch.

4. **Run the phases in order**, one new chat each. Start Phase 0 by sending:

   ```text
   Read docs/phases/phase-00-scaffold.md and follow its instructions.
   ```

   Claude proposes the phase's subtasks and gives you, for each one, the brief to paste after `/sdd:start` and the `/compact` command to run after `/sdd:close`. See [`docs/phases/README.md`](docs/phases/README.md).
