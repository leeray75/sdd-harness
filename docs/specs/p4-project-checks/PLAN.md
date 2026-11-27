# Plan: p4-project-checks

Ticket: none (vibe planning; Phase 4 row 6)
Status: approved
Date: 2026-11-27

## Objective

Add a project's automatic checks, which the Add project wizard (step 2, "Folder and checks") and later the projects screen show: git repository, code host from origin, tracker, test command, and earlier specs. Each check runs in main, through the project's environment (D41), so it works the same on this computer, in WSL, on an SSH server and in a dev container. Each returns one result with a status, a title, a detail line and an optional fix. This subtask adds the runner and its result type, with unit tests; the screens that show the results come in rows 7 and 8.

## Scope

- **In:**
  - A shared result type, in `src/shared/project-checks.ts`: five check ids, the statuses `ok | warn | info | fail | not-checked`, a title, a detail line and an optional fix text. Pure helpers live in the same file: classifying the code host from an origin URL, stripping credentials from it, and inferring the tracker.
  - A runner in main, `src/main/projects/checks.ts`: `runProjectChecks(env, root)` returns all five results. It never throws, and the checks are independent, so one failing check never hides the others.
  - A new git call, `originUrl(root)`, in `createGit` (`src/main/git/git.ts`), the `GitPart` type and the local backend's mapping. WSL, SSH and the container get it through `createGit`.
  - Each check:
    - **Git repository:** the branch (or detached) and whether the tree is clean or has changes, with the count. If the folder is not a repository, git is missing or git times out, the check fails and names its fix.
    - **Code host:** the host from origin, named as GitHub, GitLab, Bitbucket or Azure DevOps, or `Other: <host>`. Every URL form is handled: https, ssh, scp-like `git@host:path`, and local paths. The detail shows the host only, never a user, token or full URL. No origin gives a warning. The check makes no sign-in or network call.
    - **Tracker:** inferred, never connected. It is `Jira` when earlier specs' `ticket:` lines hold Jira-style ids (`ABC-123`). Otherwise it is the code host's issues (GitHub Issues, GitLab Issues), or unknown. The status is always warn, "not connected; tickets are typed by hand".
    - **Test command:** from `detectCommands(rootMarkerFiles(env, root))`, for example `npm test` in package.json. If nothing is found, a warning.
    - **Earlier specs:** the number of feature folders found by `scanSpecFolders`, as info, "N found in docs/specs". If there are none, info "none yet".
  - An unreachable environment (`env.connection.state() === 'unreachable'`): nothing runs, and every check is `not-checked`, with the unreachable reason. A state change during the run turns the remaining checks to `not-checked`. Nothing reconnects (D43).
  - Unit tests on fake environments: each status of each check, every URL form, and the credential-stripping cases. A credential never appears in any result field. The unreachable case runs no program and reads no file. A git test for `originUrl` follows the existing launcher tests.
  - Docs:
    - D45 in `docs/decisions.md`;
    - a "Project checks" section in `docs/environments.md` (the `originUrl` call joins the git part's list);
    - the CHANGELOG `[Unreleased]` entry;
    - the PRD F3 "Built so far" line, the CLAUDE.md reading list (D41–D45), and the progress follow-ups for rows 7 and 8.
- **Out:**
  - IPC and UI: no renderer channel; the wizard (row 8) and the projects screen (row 7) call the runner.
  - Connecting a tracker, and any sign-in or network probe of the code host (`ls-remote`, API calls).
  - Storing check results in the project store.
  - Reconnecting an unreachable environment.
  - Running the test command (it is only detected).

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, base | `p4-project-checks` in sdd-harness, from `main`, branch `feature/p4-project-checks` | none |
| How far it goes | The runner in main and the shared result type, unit tested; no IPC, no UI | Also add an IPC call for the wizard now |
| Tracker check | Inferred from earlier specs' ticket ids (Jira-style) or the code host's issues; always warn, "not connected" | A fixed info row with no detection |
| Code host check | Host from origin through a new `originUrl` git call; credentials stripped; no sign-in state, no network | Also probe push access with `git ls-remote` |
| Unreachable environment | Every check `not-checked` with the unreachable reason; nothing runs; no reconnect | Try one reconnect first (conflicts with D43) |
| New decision | Record the rules as D45, with a "Project checks" section in `docs/environments.md` | Record them only in the spec and CHANGELOG |
| Statuses | `ok`, `warn`, `info`, `fail`, `not-checked`, with a title, a detail and an optional fix | `ok`, `warn`, `fail` only |

## Approach

1. **`originUrl` in the git module:** `git config --get remote.origin.url` through the existing `runGit`. It returns `GitResult<string | null>` (null when origin is unset; git exits 1 for a missing key, so that exit is read as null). Add it to the `Git` interface and to `GitPart` in `src/main/env/types.ts`, and map it in `src/main/env/local.ts`. The WSL, SSH and container backends get it through `createGit`. Update the test fakes that implement `GitPart`.
2. **Shared types and pure helpers** in `src/shared/project-checks.ts`:
   - `CheckId`, `CheckStatus` and `ProjectCheck`;
   - `parseOrigin(url)`, which returns `{ host } | null` with no user, password, token, port-only junk or path kept;
   - `codeHostOf(host)`;
   - `inferTracker(ticketIds, codeHost)`.
   No Node imports.
3. **Runner** in `src/main/projects/checks.ts`: it checks the connection state first. Then it runs the five checks, each in its own try/catch, and catches the connection turning unreachable mid-run. It uses `env.git.currentBranch`, `changedPaths` and `originUrl`, `scanSpecFolders` (which also gives the spec tickets through `parsed.specs.ticket`) and `rootMarkerFiles` plus `detectCommands`. It imports no `node:fs` or `node:child_process`: everything goes through the environment, so the env-boundary test holds.
4. **Tests:**
   - `tests/unit/project-checks.test.ts` for the helpers and the runner, on a fake environment;
   - `originUrl` cases in `tests/unit/git.test.ts`.
5. **Docs:** D45, the environments.md section, CHANGELOG, PRD F3, CLAUDE.md, and the progress follow-ups.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Every backend's git part comes from one `createGit`, so one new call covers all four | `src/main/git/git.ts:167`; `container.ts:565`, `ssh.ts:820` and `wsl.ts:451` call `createGit`; `local.ts:283-306` maps each call |
| The git part has no call that reads origin | `src/main/env/types.ts:168-179` (`GitPart`) |
| Branch and changed paths exist | `git.ts` `currentBranch` and `changedPaths` (`git.ts:192`, `:225`) |
| The test command detector reads through the environment | `src/main/commands/detect.ts` `rootMarkerFiles(env, root)` and `detectCommands(files)` (`:202`) |
| Earlier specs and their ticket lines can be read through the environment | `src/main/workflow/spec-folders.ts:220` `scanSpecFolders`; `SpecFolder.parsed.specs` has `ticket` (`src/shared/spec-docs.ts:242`) |
| The connection state is readable without reconnecting | `ConnectionPart.state()` in `src/main/env/types.ts`; D43 says nothing reconnects by itself |
| There is no tracker client; reading tickets is an interface only | `src/main/tools/read-ticket.ts` (`NO_TRACKER_REASON`); D8 |
| The design's rows and wording | `docs/design/screens/Projects3Setup.dc.html`: "Git repository · Branch main · clean", "Code host: GitHub · From the origin remote", "Tracker: Jira · Not connected…", "Test command · Found npm test in package.json", "Earlier specs · 3 found in docs/specs" |

## Risks

- **Credential leaks:** an origin like `https://user:token@github.com/…` must never put the token in a result. The tests assert the absence of the secret in every field, for every URL form.
- **Slow remote checks:** each git call on a container is a `wsl.exe` round trip (about 0.5 s). The runner keeps to a fixed number of calls (branch, status, origin, one spec scan, one root listing). The progress follow-up notes it for the wizard.
- **The new `GitPart` method** breaks the test fakes that implement it. The fakes are updated in the same change, and the typecheck reveals any that are missed.
- **Design wording:** "signed in" can't be known. The detail line says "From the origin remote" only, and the progress file records the gap for row 8.

## Open questions

None.
