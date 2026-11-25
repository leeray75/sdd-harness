# Persisted projects with per-project rules, and human-only requests that name their project

**Parent:** none: no parent chosen
**Spec:** docs/specs/p4-project-store/SPECS.md
**Repo and base branch:** sdd-harness, base `main`, feature branch `feature/p4-project-store`

## Context

The app knows one folder, `HARNESS_SPIKE_ROOT`. F3 needs many projects, each with its own rules, kept across restarts. A project's round limit cannot reach the build loop, and the commit format is fixed. A human-only request carries only `{ action, feature }`, so with several projects it cannot say which repo it is for.

This work adds a project store in app data, validated per-project rules that feed the build loop and the ship step, and a registry. The registry runs the spec lock and the four human-only handlers per project. A request names its project, and `HARNESS_SPIKE_ROOT` stays as an in-memory dev project.

## Required work

- T1 Rules.
- T2 Store.
- T3 Request shape.
- T4 Commit format in ship.
- T5 Registry.
- T6 App wiring.
- T7 Docs.
- T8 Full checks.

## Acceptance criteria

- **AC1:** Projects can be added, listed, got, renamed, given new rules and removed. A second store on the same file reads them back after a write (persistence across restarts). An add is refused, with a fixed reason and nothing saved, for:
  - a relative root;
  - a missing root;
  - a root that is a file;
  - a duplicate root (case rules per platform);
  - a bad name.
- **AC2:** `remove` leaves every file in the project's folder untouched. A test hashes every file's path and content under the folder before and after `remove`, and the two hashes are equal.
- **AC3:** `parseRules` accepts each valid round limit (1, 2, 3), model policy and commit format, and fills the defaults. It refuses, with fixed reasons that do not echo the input:
  - a round limit of 0, 4, `"3"` or 2.5;
  - an unknown model policy;
  - a format without `{summary}`;
  - `{summary}` twice;
  - `{ticket}` twice;
  - another placeholder;
  - a line break;
  - a format over 120 characters;
  - `specApproval`, `review` or any other unknown key.
- **AC4:** A project's round limit reaches the build controller's options through `buildOptionsFor`. A controller built with round limit 1 stops after one review round (a test with the scripted provider). A project's commit format reaches the `approve-result` commit (a ship test with a custom format, such as `[{ticket}] {summary}`). With no ticket, the commit message is the summary alone. The default format gives today's messages.
- **AC5:** A human-only request must be exactly `{ action, project, feature }`, with a valid project id. The four handlers resolve the project's root from the registry, and an unknown project is refused with `refused` and changes nothing (tests on two projects in two temp folders). `HARNESS_SPIKE_ROOT` gives the `dev` project in an unpackaged run. The existing unit tests and the e2e suite pass, with the e2e human-action test updated to send `project`.
- **AC6:** A store file that is not JSON, has another version, or holds an invalid project is renamed to `projects.json.corrupt-<timestamp>`. It is logged with a reason code and no file content, and the store starts empty. A missing file starts empty with no log line of error level. A failed rename still starts empty and logs that the set-aside failed.
- **AC7:** Removing a project from the registry closes its spec-lock watcher, and `close()` closes them all (a test with a fake `startLock`).
- **AC8:** Docs, done in the build on the feature branch:
  - a `CHANGELOG.md` entry under `## [Unreleased]`;
  - D40 in `docs/decisions.md`, covering the store's location and format, the rules model, the registry and the dev project, and the amendment of D33's request shape;
  - every doc made stale, updated: `docs/workflow-engine.md`, `docs/human-actions.md`, `CLAUDE.md` and `README.md` where they describe `HARNESS_SPIKE_ROOT` or the human-only request, `docs/PRD.md` and `docs/workflow.md` if they are affected, `docs/phases/phase-04-projects.md`, and the follow-ups in `docs/phases/phase-04-progress.md`.

## Out of scope

- Environment backends other than local: WSL, SSH and dev containers (`p4-env-*`). The environment type only leaves room for them.
- Automatic checks on a project's folder (`p4-project-checks`).
- Any UI, and any IPC for the store: no list, add, rename, remove or change-rules call from the renderer (`p4-projects-screen`, `p4-add-project-wizard`). `change-rules` keeps no handler and answers `not-available`.
- Model routing beyond storing the model-policy value (phase 8).
- A build start in the app (D39): no UI or IPC calls the build loop yet.
- Changing the close commit's message (`Close <feature> spec`).

## Links

- Plan: docs/specs/p4-project-store/PLAN.md
- Spec and tasks: docs/specs/p4-project-store/SPECS.md, docs/specs/p4-project-store/tasks.md
