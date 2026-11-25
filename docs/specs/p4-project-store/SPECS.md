---
status: done
ticket:
---

# p4-project-store

## Problem

The app knows one folder: `HARNESS_SPIKE_ROOT` (`src/main/index.ts`). F3 needs many projects, each a repo folder with its own rules, kept across restarts. Today a project's round limit cannot reach the build loop, and the commit format is fixed in `ship.ts`.

A human-only request carries only `{ action, feature }`. With more than one project, a request cannot say which repo it is for. Removing a project must never delete its files (F3 acceptance).

## Goals

- **G1:** A project store in main keeps the projects in `projects.json` in app data (D7), with add, list, get, rename, set rules and remove. It survives restarts, and remove never touches the project's folder.
- **G2:** Each project has validated rules: the round limit (1–3, default 3), the model policy (`defaults`, `self-hosted-only` or `custom`) and the commit format. Spec approval and review before every result are always on and cannot be set.
- **G3:** A project's round limit reaches the build controller's options, and its commit format makes the `approve-result` commit message.
- **G4:** A human-only request names its project. The spec lock and the four handlers (`approve-spec`, `edit-approved-spec`, `approve-result`, `mark-done`) work per project, from the store.
- **G5:** A corrupt or unreadable store file never stops the app. It is set aside and reported without its content, and the app starts with no projects.
- **G6:** `HARNESS_SPIKE_ROOT` keeps working in unpackaged runs as an in-memory `dev` project, so the existing dev and e2e flows still work.
- **G7:** The docs are updated in the same change: D40, the D33 amendment, the CHANGELOG and every stale doc.

## Non-goals

- Environment backends other than local: WSL, SSH and dev containers (`p4-env-*`). The environment type only leaves room for them.
- Automatic checks on a project's folder (`p4-project-checks`).
- Any UI, and any IPC for the store: no list, add, rename, remove or change-rules call from the renderer (`p4-projects-screen`, `p4-add-project-wizard`). `change-rules` keeps no handler and answers `not-available`.
- Model routing beyond storing the model-policy value (phase 8).
- A build start in the app (D39): no UI or IPC calls the build loop yet.
- Changing the close commit's message (`Close <feature> spec`).

## Design

### Rules (`src/shared/project-rules.ts`, pure)

- `ProjectRules = { roundLimit: 1 | 2 | 3; modelPolicy: 'defaults' | 'self-hosted-only' | 'custom'; commitFormat: string }`.
- `DEFAULT_RULES = { roundLimit: 3, modelPolicy: 'defaults', commitFormat: '{ticket}: {summary}' }`.
- `parseRules(value: unknown)` returns `{ ok: true, rules }` or `{ ok: false, reason }`:
  - the value is a plain object whose keys are a subset of the three fields;
  - a missing field takes its default, and any other key is refused, including `specApproval` and `review`;
  - `roundLimit` is 1, 2 or 3. The 1–3 check moves here as `checkRoundLimit`, and `build-loop.ts`'s `roundLimit` calls it with the same results;
  - `modelPolicy` is one of the three values;
  - `commitFormat` holds `{summary}` exactly once and `{ticket}` at most once, has no other `{` or `}`, has no line break, and is 1–120 characters.
- `formatCommitMessage(format, ticket, summary)`:
  - with a non-empty ticket, it fills `{ticket}` and `{summary}`;
  - with an empty ticket, it returns `summary` alone, whatever the format.
- The refusal reasons are fixed text and never echo the input.

### Store (`src/main/projects/store.ts`, no Electron import)

- `createProjectStore({ filePath, newId, now, platform, logger })`. Like the secret store, it takes its inputs, so tests use a temp folder.
- The file is `{ "version": 1, "projects": Project[] }`, saved whole after each write through `src/main/tools/atomic-write.ts`.
- `Project = { id: string; name: string; environment: ProjectEnvironment; root: string; rules: ProjectRules }`.
  - `ProjectEnvironment` is a union keyed by `kind`. Only `{ kind: 'local' }` exists now; later subtasks add `wsl`, `ssh` and `container`.
- `newId` makes a lowercase UUID (`crypto.randomUUID` in the app).
- `load()` is called once at start:
  - a missing file is an empty list;
  - a file that cannot be read, is not JSON, has another `version`, or holds a project that fails the checks is renamed to `projects.json.corrupt-<timestamp>`. The store then starts empty. One log line gives the reason code only, never the content;
  - if that rename fails, the store still starts empty, logs that the set-aside failed, and the next save replaces the file.
- Operations: `list()`, `get(id)`, `add({ name, environment, root, rules? })`, `rename(id, name)`, `setRules(id, rules)` and `remove(id)`. Each write returns `{ ok: true, project }` or `{ ok: false, reason }` with a fixed reason.
  - A failed save leaves the in-memory list as it was before the call.
- Add checks (local):
  - `root` is absolute and is an existing directory (checked with `stat`), stored after `path.resolve`;
  - no stored project has the same root. The comparison is case-insensitive on `win32` and `darwin` and exact on `linux`;
  - `name` is trimmed, 1–80 characters, with no line break;
  - `rules` go through `parseRules`.
- `remove(id)` drops the entry and saves. It never opens, stats, moves or deletes anything under the project's root.

### Human-only request (amends D33's guard)

- `HumanActionRequest = { action, project, feature }`. `parseHumanActionRequest` requires exactly these three keys.
- `project` is `dev` or a lowercase UUID (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`), with a fixed reason otherwise.
- The channel's checks and their order are unchanged. Its one decision line adds `project=<id>` next to `feature=<slug>` for a valid request.
- The bridge type follows the shared type, and `tests/e2e/human-action.spec.ts` sends `project`.

### Registry (`src/main/projects/registry.ts`, no Electron import)

- `createProjectRegistry({ store, devProject?, startLock, makeSpecHandlers, makeShipHandlers, controllerNode })`.
- `projects()` is the store's list plus the dev project, when there is one. The dev project's id is `dev`, so it cannot clash with a UUID.
- For each project it starts one spec-lock watcher through `startLock(root)`, which is `createSpecLockWatcher` in the app. It builds that project's spec and ship handlers from its root and rules: `createShipHandlers` gets the project's `commitFormat`. It refreshes the watcher once.
- `addProject` and `removeProject` wrap the store:
  - an add starts the new project's watcher;
  - a remove closes its watcher, then drops it;
  - `close()` closes every watcher.
- `handlerFor(action)` returns one channel handler per action. It looks up `request.project`. An unknown project is refused with `code: 'refused'` and a fixed reason ("no project with this id"), and changes nothing. Otherwise it calls that project's handler with the request.
- The build controllers are keyed by project and feature.
- `buildOptionsFor(project)` returns `{ root, roundLimit }` for the build controller (`roundLimit: project.rules.roundLimit`). No build start calls it yet (D39), so a test calls it.

### Ship (`src/main/workflow/ship.ts`, `src/main/human/ship-handlers.ts`)

- `commitMessage` becomes `formatCommitMessage(format, ticket, summary)`. The default format gives the same messages as today.
- `approveResult`'s options and `ShipHandlersDeps` take `commitFormat` (default `DEFAULT_RULES.commitFormat`).

### App (`src/main/index.ts`)

- After ready, the app creates the store at `join(app.getPath('userData'), 'projects.json')` and loads it.
- In an unpackaged run with `HARNESS_SPIKE_ROOT` set, the dev project is `{ id: 'dev', name: 'dev', environment: { kind: 'local' }, root, rules: DEFAULT_RULES }`. It is never saved. A packaged run ignores the variable.
- The app creates the registry and registers the four handlers on the channel with `registry.handlerFor(...)`, so with no projects every request is refused as an unknown project. `change-rules` stays unregistered.
- The spike agent's live context reads the dev project's watcher, as it reads the spike root's today. With no dev project, the agent gets the default context.
- The registry is closed at `before-quit`. The old single-root `startSpecLock` is removed.

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

## Open questions

- (none)
