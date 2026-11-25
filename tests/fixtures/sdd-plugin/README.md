# sdd plugin fixtures

These files are copies of the sdd plugin's own files, kept byte for byte so that the harness's
document layer (`src/shared/spec-docs.ts`, `src/shared/spec-detect.ts`) can be checked against
them. Do not reformat or edit them. Prettier skips this folder (`.prettierignore`).

- **Plugin version:** sdd 0.18.0 (`.claude-plugin/plugin.json` in the plugin).
- **Source:** the `claude` repo, `plugins/sdd-plugin/`.
  - `templates/PLAN.md`, `templates/SPECS.md`, `templates/tasks.md`, `templates/SUBTASK.md` are copied from
    `plugins/sdd-plugin/skills/sdd/templates/`.
  - `specs/p3-state-machine/` is a plugin-written feature folder, copied from this repo's
    `docs/specs/p3-state-machine/` (written by the sdd plugin, closed and done).
  - `specs/p3-ship/` is a plugin-written feature folder at commit `c580d56` (the p3-ship work commit
    on `feature/p3-ship`). Its seven files (PLAN.md, SPECS.md, tasks.md, SUBTASK.md, build-ledger.md,
    changes.md, SUMMARY.md) are copied from `git show c580d56:docs/specs/p3-ship/<file>`, byte for byte.
    The p3-headless-e2e tests check each copy against a SHA-256 recorded in the test, so no git history
    is needed (CI's checkout is shallow).

The tests compare the template constants with `templates/` after CRLF is normalized to LF
(`tests/unit/spec-docs-templates.test.ts`), and read `specs/p3-state-machine/` as a closed folder
(`tests/unit/spec-folders.test.ts`).
