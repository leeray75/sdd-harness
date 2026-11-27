---
status: done
ticket:
---

# p4-project-checks

## Problem

F3's Add project wizard, step 2 "Folder and checks", shows five automatic checks: Git repository, Code host, Tracker, Test command and Earlier specs. Nothing in the app computes them. The parts exist (the git part, the test-command detector, the spec-folder scanner), but there is no single runner that reaches the project through its environment (D41), and no result type the wizard (row 8) and the projects screen (row 7) can show. The git part also cannot read the origin remote, so the code host cannot be named.

## Goals

- **G1:** One runner in main, `runProjectChecks(env, root)`, returns the five check results for a project folder through its environment, on any of the four backends. It never throws, and one failing check never hides another.
- **G2:** A shared result type with a fixed status set and plain-language text, matching the design's rows.
- **G3:** The git part gains `originUrl(root)` for every backend, and no credential from an origin URL ever reaches a check result.
- **G4:** An unreachable environment runs nothing and reports every check as not checked; nothing reconnects (D43).
- **G5:** The rules are written down as D45 and in `docs/environments.md`, so rows 7 and 8 build on them.

## Non-goals

- IPC, preload or any UI: no renderer channel calls the runner in this subtask.
- Connecting a tracker, and any sign-in or network probe of the code host (`git ls-remote`, fetch, API calls).
- Storing check results in the project store or anywhere on disk.
- Reconnecting an unreachable environment.
- Running the test command; it is only detected.
- Changing the detector (`src/main/commands/detect.ts`) or the spec scanner beyond reading their results.

## Design

### Shared types and helpers: `src/shared/project-checks.ts` (no Node imports)

- `CHECK_IDS = ['git', 'code-host', 'tracker', 'test-command', 'earlier-specs'] as const`, and `CheckId`.
- `CHECK_STATUSES = ['ok', 'warn', 'info', 'fail', 'not-checked'] as const`, and `CheckStatus`.
- `ProjectCheck = { id: CheckId; status: CheckStatus; title: string; detail: string; fix?: string }`.
- `ProjectChecks = { checks: ProjectCheck[] }`, always five, in `CHECK_IDS` order.
- `parseOrigin(url: string): { host: string } | null`. It accepts these forms:
  - `https://[user[:pass]@]host[:port]/path` and `http://…`;
  - `ssh://[user@]host[:port]/path`;
  - `git://host/path`;
  - scp-like `[user@]host:path`.
  It returns the host name only, lower-cased, with no user, password, token, port or path. It returns null for:
  - local paths (`/srv/repo.git`, `C:\repo`, `file://…`);
  - empty text;
  - text with a line break or control character;
  - a host that is not letters, digits, `.` and `-`.
  It never throws.
- `codeHostOf(host)`:
  - `github.com` gives `GitHub`;
  - `gitlab.com` gives `GitLab`;
  - `bitbucket.org` gives `Bitbucket`;
  - `dev.azure.com` or `*.visualstudio.com` gives `Azure DevOps`;
  - anything else gives `Other: <host>`.
- `inferTracker(ticketIds: readonly string[], codeHost: string | null): 'Jira' | 'GitHub Issues' | 'GitLab Issues' | null`:
  - `Jira` when any id matches `^[A-Z][A-Z0-9]+-[0-9]+$`;
  - else `GitHub Issues` for GitHub and `GitLab Issues` for GitLab;
  - else null.

### Git: `originUrl(root)`

- In `createGit` (`src/main/git/git.ts`), `originUrl(root): Promise<GitResult<string | null>>` runs `git config --local --default '' --get remote.origin.url` through `runGit`. Empty output (after trimming) is `{ ok: true, value: null }`; other output is the trimmed first line.
- Outside a repository git prints `--local can only be used inside a git repository`, and that failure maps to `not-a-repo`: `NOT_A_REPO` also matches that text.
- The call is added to the `Git` interface, to `GitPart` (`src/main/env/types.ts`), to the local backend's mapping (`src/main/env/local.ts`), and to every test fake that implements `GitPart`. The WSL, SSH and container backends get it through `createGit`, with no change of their own.
- The raw URL is returned only to main-side callers. It is never logged.

### Runner: `src/main/projects/checks.ts`

`runProjectChecks(env: Environment, root: string): Promise<ProjectChecks>`. It never rejects, and it imports no `node:fs`, `node:fs/promises` or `node:child_process`.

1. If `env.connection.state()` is `unreachable`, it calls nothing else on the environment. It returns all five checks as `not-checked`, with the detail `PROJECT_UNREACHABLE` (from `src/main/projects/registry.ts`, or the same text moved to a shared constant).
2. Otherwise it runs the checks in `CHECK_IDS` order, each in its own `try/catch`. A throw becomes that check's `fail` with a fixed detail (`The check could not run`), and the error text is never used. Before each check it reads the state again. Once the state is `unreachable`, that check and every later one are `not-checked` with the unreachable detail.
3. **Git repository** (title `Git repository`):
   - `currentBranch` and `changedPaths` both ok gives `ok`. The detail is `Branch <name> · clean`, or `Branch <name> · <n> changed files` (`1 changed file` for one). A detached head shows `Detached HEAD`.
   - `not-a-repo` gives `fail`, with the detail `Not a git repository` and the fix `Run git init in this folder, or pick the repository's folder`.
   - `git-missing` gives `fail`, with the detail `Git is not installed in this environment` and the fix `Install git in this environment`.
   - `timeout` or `failed` gives `fail`, with the detail `Git did not answer`.
4. **Code host:**
   - When the git check failed, it is `not-checked` with the detail `Needs a git repository`.
   - Otherwise `originUrl`:
     - null gives `warn`, with the title `Code host`, the detail `No origin remote`, and the fix `Add an origin remote to ship to a code host`;
     - a URL that `parseOrigin` rejects (a local path or otherwise) gives `warn`, with the title `Code host`, and the detail `The origin remote is not a code host`;
     - a parsed host gives `ok`, with the title `Code host: <name>` and the detail `From the origin remote`;
     - a failed `originUrl` gives `warn`, with the detail `The origin remote could not be read`.
   - No result text contains the URL, a user name or a password.
5. **Tracker:** the ticket ids are the non-empty `parsed.specs.ticket` values of `scanSpecFolders(env, root)`. The scan runs once and is shared with the Earlier specs check. The tracker is `inferTracker(ids, codeHostName)`, where `codeHostName` is the name from step 4 or null.
   - A named tracker gives `warn`, with the title `Tracker: <name>`, the detail `Not connected. Without it, tickets are typed by hand.`, and the fix `Connecting a tracker comes later; you can add it from the project's settings`.
   - Null gives `warn`, with the title `Tracker`, and the same detail.
6. **Test command:** `detectCommands(await rootMarkerFiles(toolEnvironment(env), root))`.
   - A first `test` form gives `ok`, with the title `Test command` and the detail `Found <program> <args…>`, plus ` in <marker>` from a fixed map of the program: `pnpm`, `npm`, `yarn` and `bun` give `package.json`, `go` gives `go.mod`, and `cargo` gives `Cargo.toml`. Any other program leaves the marker out. The detector itself does not change.
   - No test form gives `warn`, with the detail `No test command found`, and the fix `Add a test script, for example "test" in package.json`.
7. **Earlier specs:** from the same scan.
   - `n > 0` gives `info`, with the title `Earlier specs` and the detail `<n> found in docs/specs` (`1 found in docs/specs` for one).
   - `0` gives `info` with the detail `None yet`.
8. **Number of calls:** the runner uses at most two git calls for the git check, one for the code host, one spec scan and one root listing (through `rootMarkerFiles`). It calls nothing else that starts a program.

### Docs

- **D45 · Project checks** in `docs/decisions.md`:
  - the five checks and the five statuses;
  - `originUrl` and the credential rule (host only, never the URL);
  - the tracker inferred and never connected (D8);
  - no network and no sign-in probe;
  - unreachable: everything `not-checked`, no reconnect (D43);
  - results not stored.
- **`docs/environments.md`:** a "Project checks" section, and `originUrl` in the git part's list of calls.
- **`CHANGELOG.md` `[Unreleased]`:** an Added entry.
- **`docs/PRD.md` F3 "Built so far":** one sentence naming the checks and that the wizard shows them later.
- **`CLAUDE.md` reading list:** D41 to D45, and the checks in item 6.
- **The progress file's follow-ups:**
  - rows 7 and 8 call `runProjectChecks`;
  - "signed in" from the design is not shown;
  - the Connect tracker button has nothing to connect yet;
  - on a container the checks cost several `wsl.exe` round trips.
- The phase doc and `docs/workflow.md` are checked and changed only if they are stale.

## Acceptance criteria

- **AC1 — Result type:** `src/shared/project-checks.ts` exports the ids, the statuses, `ProjectCheck`, `ProjectChecks`, `parseOrigin`, `codeHostOf` and `inferTracker` as designed. It has no Node import. `runProjectChecks` always returns five checks in `CHECK_IDS` order.
- **AC2 — originUrl:** the git part has `originUrl` on every backend.
  - Unit tests on the launcher show: an origin gives the URL, an unset origin gives `null`, and outside a repository gives `not-a-repo`.
  - The local backend maps it.
  - Typecheck passes with every `GitPart` fake updated.
- **AC3 — Git check:** unit tests cover:
  - clean;
  - `n` changed files, with `1 changed file` for one;
  - detached;
  - not-a-repo, git-missing and timeout, each with the status, detail and fix from the design.
- **AC4 — Code host and credentials:**
  - unit tests cover the forms https (with and without `user:token@`), ssh with a port, scp-like, `git://`, and the local paths;
  - they also cover the four named hosts and Other;
  - they cover no origin, an unreadable origin, and `not-checked` when git failed.
  - For every URL with a user or token, no field of any check contains the user, the token or the URL.
- **AC5 — Tracker:** unit tests cover:
  - Jira from spec ticket ids;
  - GitHub Issues and GitLab Issues from the host;
  - null;
  - always `warn`, with "not connected".
- **AC6 — Test command and earlier specs:** unit tests cover:
  - a found test command, with its form in the detail;
  - none found (`warn`);
  - specs found (`info`, with the count, singular for one);
  - none yet.
- **AC7 — Robustness:**
  - a check whose environment call throws gives `fail` with the fixed detail, and the other checks still return;
  - the runner never rejects;
  - an unreachable environment gives five `not-checked` results, with no program run and no file read (the fake records the calls);
  - a state change to `unreachable` mid-run turns the remaining checks `not-checked`.
- **AC8 — Boundary:**
  - `src/main/projects/checks.ts` imports no `node:fs`, `node:fs/promises` or `node:child_process`, and `tests/unit/env-boundary.test.ts` passes;
  - no reconnect is called;
  - no network or sign-in call is added.
- **AC9 — Docs:**
  - D45 is in `docs/decisions.md`;
  - the "Project checks" section and `originUrl` are in `docs/environments.md`;
  - the CHANGELOG `[Unreleased]` entry;
  - PRD F3 "Built so far", the CLAUDE.md reading list and the progress follow-ups, all updated;
  - no other doc is stale.
- **AC10 — Checks:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass.

## Open questions

- None.
