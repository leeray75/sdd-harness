# SDD Harness

An Electron desktop app for spec-driven development: plan a feature with an AI, approve its spec, let separate agents build and review it, approve the result, ship. Any hosted or self-hosted model per job; the workflow rules are enforced by the app.

Status: **design and requirements complete, no code yet.**

## Docs

| File | What it is |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements: goals, features F1–F7, acceptance criteria, delivery plan |
| [`docs/decisions.md`](docs/decisions.md) | Settled decisions D1–D13 |
| [`docs/design-notes.md`](docs/design-notes.md) | Design system, components, screen behaviour, states |
| [`docs/workflow.md`](docs/workflow.md) | Workflow diagrams and who can do what |
| [`docs/design/`](docs/design/README.md) | 16 screens: HTML source and PNG renders |
| `docs/specs/` | Feature specs written by the sdd plugin during development |

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

3. **Spike first** (throwaway branch, no spec): an agent loop with Anthropic plus one OpenAI-compatible server, and the tool policy enforcing one path rule. See PRD "Delivery plan".

4. **Then one feature at a time**, in PRD order (F1, F2, F3 …):

   ```text
   /sdd:plan
   ```

   then describe it, for example:

   > F1 from docs/PRD.md: agent runtime and tool policy. Follow docs/decisions.md D1, D3, D4 and D6, and the "What each agent can do" table in docs/design/screens/Providers.dc.html.

   > F4 from docs/PRD.md: the Workspace. Match docs/design/screens/Flow0Empty.dc.html through Flow6Closed.dc.html (and Main.dc.html), the PNGs in docs/design/png/, and docs/design-notes.md.

   Review the plan, `/sdd:approve <feature>`, build, approve the result, `/sdd:close`.
