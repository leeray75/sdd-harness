# Plan: p4-project-store

Ticket: none (vibe planning, Phase 4 subtask 1)
Status: approved
Date: 2026-11-25

## Objective

The app keeps a list of projects (repo folders) in app data, and each project carries its own rules. Those rules feed the workflow engine: the round limit goes to the build loop, and the commit format goes to the ship step's commit message (F3, D4, D7).

Today the app knows one folder, `HARNESS_SPIKE_ROOT`. After this change the spec lock and the four human-only handlers work per project from the store, and a human-only request names its project. `HARNESS_SPIKE_ROOT` stays as a dev-only way to get one local project.

## Scope

- **In:**
  - **A project store in main** (`src/main/projects/store.ts`, pure, with the file path and clock passed in, like the secret store), persisted as `projects.json` in `app.getPath('userData')` (D7).
    - **The file:** versioned JSON `{ "version": 1, "projects": [...] }`, written atomically through the existing temp-file-and-rename helper (`src/main/tools/atomic-write.ts`).
    - **A project:** `id` (a random UUID made by the store), `name`, `environment` (`{ kind: 'local' }` only for now; the type is a union keyed by `kind`, so `wsl`, `ssh` and `container` can be added by later subtasks), `root` (the absolute folder path) and `rules`.
    - **Operations:** `list`, `get(id)`, `add({ name, environment, root, rules? })`, `rename(id, name)`, `setRules(id, rules)` and `remove(id)`. Each write saves the whole file. A refusal is a fixed reason that never echoes the input.
    - **Add checks (local):** the root is an absolute path to an existing directory, and no stored project has the same root (compared case-insensitively on Windows and macOS, exactly on Linux, after resolving `.` and `..`). The name is 1–80 characters after trimming, on one line.
    - **Remove** only drops the entry from the file. It never opens, moves or deletes anything in the folder.
  - **Rules** (`src/shared/project-rules.ts`, pure, so the later UI can use the same checks):
    - `roundLimit`: 1, 2 or 3; default 3. It uses the build loop's existing `roundLimit` check, so there is one rule.
    - `modelPolicy`: `defaults`, `self-hosted-only` or `custom`; default `defaults`. Only the value is stored; routing is phase 8.
    - `commitFormat`: default `{ticket}: {summary}`. It must hold `{summary}` exactly once, may hold `{ticket}` at most once, no other `{…}` placeholder, one line, at most 120 characters.
    - Spec approval and review before every result are not fields: they are always on, and a rules object that tries to set them (or has any unknown key) is refused.
  - **Commit message from the format:** with a ticket, `{ticket}` and `{summary}` are filled in. With no ticket, the message is the summary alone, whatever the format. The close commit's message stays `Close <feature> spec`.
  - **The human-only request names its project:** the request becomes exactly `{ action, project, feature }`, where `project` is a project id (amends D33's guard). The channel stays the same. The handlers resolve the project's root from a project registry, and an unknown project is refused with a fixed reason and changes nothing.
  - **A project registry in main** (`src/main/projects/registry.ts`): the store's projects plus, in unpackaged runs only, the dev project. For each project it starts one spec-lock watcher (D36) and closes it when the project is removed or the app quits. The four handlers are registered once on the channel and look up the project, its root, its watcher and its rules for each request.
  - **Wiring rules into the engine:**
    - the round limit through a small helper that builds the build controller's options from a project (`roundLimit: project.rules.roundLimit`), tested, since no build start exists in the app yet (D39);
    - the commit format through the ship step: `approve-result` builds the message from the project's format.
  - **`HARNESS_SPIKE_ROOT` (dev only):** in an unpackaged run it adds an in-memory local project with the fixed id `dev`, the name `dev` and default rules. It is never written to `projects.json`. The spike agent's live context (feature and spec state) reads the dev project's watcher, as it reads the spike root's today. A packaged run ignores the variable.
  - **Corrupt or unreadable store:** a file that is not valid JSON, has the wrong version or holds an invalid project is renamed to `projects.json.corrupt-<timestamp>`. The rename is logged with the reason only, never the file's content, and the app starts with no projects. A missing file is an empty list and is not an error.
  - **Docs:** the CHANGELOG entry, the stale docs and D40 (see the acceptance criteria).
- **Out:**
  - Environment backends other than local (`p4-env-*`).
  - Automatic checks (`p4-project-checks`).
  - Any UI and any IPC for the store: no list, add, rename, remove or change-rules call from the renderer. These come with `p4-projects-screen` and `p4-add-project-wizard`, shaped by what they need. `change-rules` stays registered with no handler, so it answers `not-available`.
  - Model routing beyond storing the model-policy value (phase 8).
  - A build start in the app (no UI calls the build loop yet, D39).

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| How a human-only request names its project | Add a required `project` field: the request is exactly `{ action, project, feature }`; an unknown project is refused (amends D33) | Keep `{ action, feature }` and let main hold one active project set by a separate call (extra state that can drift) |
| IPC for the store in this subtask | None: a main-side module and tests only; IPC and `change-rules` come with the UI subtasks | A read-only list call now; full IPC (list, add, rename, remove, change-rules) now |
| Commit message with no ticket and a custom format | The summary alone, whatever the format (today's behaviour) | Substitute an empty ticket and trim (can leave stray brackets) |
| `HARNESS_SPIKE_ROOT` with a project store | Dev only (unpackaged): an in-memory local project with id `dev` and default rules, never persisted | Persist it to the store on first launch |
| Feature slug, repo and branch | `p4-project-store`, this repo, base `main`, branch `feature/p4-project-store` | — |
| Store location and format (default, stated) | `projects.json` in `userData`, versioned JSON, atomic write; corrupt file set aside as `projects.json.corrupt-<timestamp>` | One file per project; storing projects in the repo (D7 puts them in app data) |
| Rules shape (default, stated) | `roundLimit` 1–3 (default 3), `modelPolicy` of three values (default `defaults`), `commitFormat` with `{summary}` once and `{ticket}` at most once; approval and review are not fields | Storing approval and review as locked `true` fields |

## Approach

Order of work:

1. `src/shared/project-rules.ts`: the rules type, defaults, the validator (reusing `roundLimit` from `src/main/workflow/build-loop.ts` by moving the 1–3 check to shared and keeping the build loop's export) and `formatCommitMessage(format, ticket, summary)`. Unit tests.
2. `src/main/projects/store.ts`: the store with an injected file path, `fs` and id maker, the add checks, the atomic save and the corrupt-file set-aside. Unit tests against a temp folder, including persistence across two store instances, and a test that hashes a project folder before and after `remove`.
3. `src/shared/human-actions.ts`: add `project` to the request and the guard (a UUID or `dev`, at most 64 characters, from a fixed character set). Update the channel's log line to include the project id, `tests/unit/human-*.test.ts` and `tests/e2e/human-action.spec.ts`.
4. `src/main/projects/registry.ts`: projects from the store plus the dev project, one spec-lock watcher each, handler lookup by project. The spec and ship handlers keep their per-root factories (`createSpecHandlers`, `createShipHandlers`). The registry builds them per project and dispatches one registered handler per action.
5. `src/main/workflow/ship.ts`: `commitMessage` takes the format (default unchanged), and `createShipHandlers` takes the project's commit format. Add the build-options helper for the round limit. Tests.
6. `src/main/index.ts`: create the store in `userData`, the registry and the dev project. Register the four handlers through the registry, and point the spike agent's live context at the dev project. Remove the old single-root `startSpecLock`.
7. Docs: CHANGELOG, `docs/decisions.md` (D40, and the D33 amendment noted), `docs/workflow-engine.md` (projects and the request shape), `CLAUDE.md` and `README.md` where they describe `HARNESS_SPIKE_ROOT` and the human-only request, the phase doc and the progress file's follow-ups.

Constraints: no Electron import in the store or registry (they take their paths and clocks as inputs, like `src/main/secrets/store.ts`). Nothing here runs git or any command. Logs never carry a store file's content, a folder path's contents or a commit message.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The app's only root today is `HARNESS_SPIKE_ROOT` | `src/main/index.ts:172` |
| The four handlers are registered once, on one root | `src/main/index.ts` `startSpecLock` (registers approve-spec, edit-approved-spec, approve-result, mark-done) |
| The human-only request is exactly `{ action, feature }` | `src/shared/human-actions.ts` `parseHumanActionRequest` (keys must be exactly `action` and `feature`) |
| `change-rules` is already a human action id with no handler | `src/shared/human-actions.ts` `HUMAN_ACTION_IDS` |
| The round limit check (1–3, default 3) exists | `src/main/workflow/build-loop.ts:47` `roundLimit` |
| The commit message is fixed today | `src/main/workflow/ship.ts:158` `commitMessage(ticket, summary)` |
| The close commit has its own message | `src/main/workflow/ship.ts:162-164` `Close ${feature} spec` |
| App data is `userData`, used by the secret store | `src/main/secrets/electron.ts` (`app.getPath('userData')`) |
| An atomic write helper exists | `src/main/tools/atomic-write.ts` |
| The e2e human-action test sends `{ action, feature }` | `tests/e2e/human-action.spec.ts:48` and later calls |
| No build controller is created in the app yet | `src/main/index.ts` (`buildControllers` stays empty; D39) |

## Risks

- **Changing the request shape breaks the e2e tests and any caller.** The guard and every test change in one task. The e2e suite in CI shows it early.
- **One watcher per project.** Many projects means many watchers. The pilot has few projects; the registry closes a watcher on remove and at quit, and a test checks it.
- **Path comparison for duplicates.** Case rules differ by OS. The comparison is a small pure function with tests per platform rule.
- **A rename of the corrupt file can fail** (permissions). Then the app still starts with no projects and logs that the set-aside failed, and the next save overwrites the bad file. A test covers it.

## Open questions

(none)
