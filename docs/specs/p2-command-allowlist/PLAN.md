# Plan: p2-command-allowlist

Ticket: none (vibe planning; Phase 2, subtask 3)
Status: approved
Date: 2026-11-20

## Objective

`run_command` reaches the policy's command check, which today denies every command (D30), and the runner refuses `.cmd`/`.bat` on Windows (D29). This subtask makes commands usable and safe:

- a per-project allowlist of detected test and build commands: the writer may run tests and the build, and the reviewer tests only;
- the spec folder read-only while a command runs;
- a check of changed files after each command, which reverts anything outside the job's rules;
- no network for the writer, as strong as each OS allows, with the level recorded;
- Windows `.cmd` shims such as `pnpm test` run without an agent-chosen string reaching cmd.exe.

## Scope

- **In:**
  - **Detection** (`src/main/commands/detect.ts`, pure over a small file-reader input): reads marker files in the root and returns the test and build command forms. Mixed repos get every type that matches.

    | Type | Marker | Test forms | Build forms |
    | --- | --- | --- | --- |
    | Node | `package.json` with a `test` or `build` script | `<pm> test`, `<pm> run test` | `<pm> run build` (and `<pm> build` for pnpm, yarn and bun) |
    | Python | pytest configured: `pytest.ini`, root `conftest.py`, or `[tool.pytest` in `pyproject.toml` | `pytest`, `python -m pytest` | `python -m build`, when `pyproject.toml` has `[build-system]` |
    | Go | `go.mod` | `go test ./...` | `go build ./...` |
    | Rust | `Cargo.toml` | `cargo test` | `cargo build` |

    The package manager `<pm>` comes from the `packageManager` field, else the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`/`bun.lock`), else `npm`. A form is a bare program name plus an exact argument list. A missing or unparseable marker gives no forms for that type, never an error.
  - **The command check** (`src/main/policy/command-allowlist.ts`, pure): `makeCommandCheck(detected)` returns the `CommandCheck` for the context.
    - Writer: test and build forms. Reviewer: test forms only. Any other job: denied (the table already keeps them away).
    - Match: the program is a bare name (no `/` or `\`), compared case-insensitively on its base name with any `.exe`, `.cmd` or `.bat` dropped; the arguments must equal a form exactly. No extra arguments.
    - `cwd` must be absent or `.`; commands run from the root only.
    - Fixed reasons: "this command is not on the project's allowlist", "commands run only from the project root", and for the reviewer asking for a build, "the reviewer may run tests only".
    - Commands don't depend on the spec state: the job set already limits who reaches them.
  - **Runner** (`src/main/tools/run-command.ts` and new modules under `src/main/commands/`):
    - The router passes the job to the runner (`ToolRunner` gains `job`), so the runner can apply per-job guards. The runner re-checks the allowlist as a second layer.
    - **Program lookup:** main resolves the bare name on `PATH` itself (with `PATHEXT` on Windows) and spawns the resolved file. `shell: false` stays.
    - **Windows `.cmd`/`.bat`:** when the resolved file is a `.cmd` or `.bat`, main runs `cmd.exe /d /s /c` with a command line built only from an allowlisted form, and only when every token matches `^[A-Za-z0-9:_./-]+$` and the resolved path has no cmd metacharacters. Any other `.cmd`/`.bat` stays refused, as in D29.
    - **Spec lock:** before the command, snapshot every file under `docs/specs/` (path, hash, bytes) and make it read-only: `chmod a-w` on POSIX files and folders, the read-only attribute on Windows files. After the command, always (also on timeout or error), restore the original modes, then compare with the snapshot and restore any changed, created or deleted file.
    - **`.git` key files:** snapshot `.git/HEAD`, `.git/config`, `.git/packed-refs`, `.git/hooks/**` and `.git/refs/**` before; restore them on any change after. The index and objects are left alone.
    - **Changed-file check per job:**
      - Writer: the spec folder and the `.git` key files only; source changes are within its rules.
      - Reviewer: also every other file of the root that is not git-ignored and not under `node_modules` or `.git`: before the command, snapshot those files; after it, revert changes, creations and deletions. Main finds the ignored set with a read-only git query (`git ls-files --others --ignored --exclude-standard --directory` and `git check-ignore`); without a repo or git, only `node_modules` is skipped.
      - Snapshots live in memory up to a cap (256 MiB total). When the reviewer's snapshot would pass the cap, the command is refused with a fixed reason before it runs.
    - **Network for the writer**, best effort:
      - Linux: `unshare --user --map-root-user --net`, bringing loopback up, when a one-time probe shows unprivileged namespaces work.
      - macOS: `/usr/bin/sandbox-exec` with a profile that denies outbound network except loopback.
      - Windows, and the fallback everywhere: dead proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and lower-case forms pointing to `127.0.0.1:9`, `NO_PROXY` empty) and offline flags for the package managers. These are added on every OS as an extra layer.
      - The level reached (`os` or `proxy-only`) is reported.
    - **Reporting:** every revert, every restore of a `.git` file and the writer's network level is a Rule event through the existing sink (allow and deny events are unchanged; new event kinds are added). The tool result also lists, with fixed wording, which areas were reverted, so the agent can recover. Paths in events are sanitized as in D30.
  - **Host wiring:** `startAgentHost` detects the commands once from the root and passes `makeCommandCheck(detected)` in the policy context, in place of `denyAllCommands`. `DEFAULT_POLICY_CONTEXT` stays deny-all for tests and for a missing root.
  - **Tests:** detection for each type and package manager; the check per job; the Windows token rule and command-line building (pure); PATH resolution; the spec lock and restore, the `.git` restore and the reviewer revert on a temp root, driven by a stub command (a Node script) that edits, creates and deletes files; the network wrapper selection per platform (pure), plus a POSIX run that is skipped where the method is unavailable; the router passing the job.
  - **Docs:** a new decision, D31, records the allowlist, the Windows rule, the lock and revert, and how "no network for the writer" is enforced per OS and what is best effort. D29's open question is closed there. In the build, not after the merge:
    - the CHANGELOG entries;
    - a new reference page, `docs/agent-commands.md`;
    - every doc this work makes stale, updated in the same change.
- **Out:**
  - Job prompts and advertising tools (`p2-jobs-and-prompts`).
  - The human-only channel (`p2-human-only-channel`).
  - Real workflow states and the feature slug from the workflow (Phase 3).
  - A project settings file and user-edited allowlists (Phase 4).
  - Makefile and other build systems; extra arguments to commands.
  - An OS sandbox or container per build (a later option in D6).
  - Any UI.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| Feature slug, repo, branch | `p2-command-allowlist`; sdd-harness; base `main`; branch `feature/p2-command-allowlist` | (from the phase doc's subtask list) |
| Project types detected | Node, Python, Go, Rust | Node only (others later with the Phase 4 settings file); Node plus Makefile |
| Extra arguments | Exact forms only | Test filters after `--` with safe tokens; any arguments after `--` |
| Windows `.cmd`/`.bat` | `cmd.exe /d /s /c` only for allowlisted forms whose tokens are all in a safe set | Run the shim's JS entry with node; keep refusing on Windows |
| Network when the OS can't block it | Run with the strongest method available, best effort, and record the level | Refuse the writer's command unless a real block exists; proxy variables only on every OS |
| What is read-only and how | All of `docs/specs/`, with read-only bits plus a snapshot restored afterwards | The current feature's folder only; snapshot and restore without bits |
| What the changed-file check reverts | Per job: writer `docs/specs/**`; reviewer every change except git-ignored files and `node_modules` | `docs/specs/**` only for both jobs; report the reviewer's other changes without reverting |
| `.git` changes | Snapshot and restore `HEAD`, `config`, `hooks/**`, `refs/**` and `packed-refs`; leave the index and objects | Report only; leave `.git` out |
| Python forms | `pytest`, `python -m pytest`; `python -m build` with `[build-system]` | Python tests only |

## Approach

1. Detection and the pure command check, with their tests, and the check passed into the host's policy context.
2. Program lookup on `PATH` and the Windows `.cmd` rule in the runner, replacing the blanket refusal for allowlisted forms.
3. The snapshot module: collect, hash and restore a set of files; the spec lock with read-only bits; the `.git` key files; the reviewer's set with the git-ignored query and the cap.
4. The network wrapper per platform with the one-time Linux probe.
5. The router passes the job; the runner composes lookup, lock, network wrapper, run and restore, and reports through the Rule sink.
6. D31, the CHANGELOG, the new reference page and the stale docs, then full checks.

Main calling git read-only to list ignored files is the app's own action, not an agent's; agents still never run git (D4). The query uses an argument array and a minimal environment, like `run_command`.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| The gate already sends `run_command` to `context.commandCheck` with job, program, args and cwd | `src/main/policy/gate.ts:130-142` |
| The check type and the deny-all default exist to be replaced | `src/main/policy/context.ts` (`CommandCheck`, `denyAllCommands`, `DEFAULT_POLICY_CONTEXT`) |
| The runner refuses `.cmd`/`.bat` on Windows and spawns with `shell: false` and a minimal env | `src/main/tools/run-command.ts` (`programRefusal`, `commandEnv`, `spawn`) |
| The runner does not know the job today | `src/main/agent/router.ts:23-26` (`ToolRunner` takes `tool` and `args`) |
| The host binds `DEFAULT_POLICY_CONTEXT` and builds the runner from the spike root | `src/main/agent/host.ts:198-200` |
| Rule events already go through one sink with sanitized targets | `src/main/policy/rule-event.ts` (D30) |
| This repo's own `pnpm test` is reached through a `.cmd` shim on Windows | `package.json` `packageManager: pnpm@12.21.0`, run through Corepack (D14) |

## Risks

- **Linux namespaces:** Ubuntu 24 blocks unprivileged user namespaces through AppArmor, so the probe may fail and fall back to proxy-only. CI already lifts that restriction for e2e; a skipped test shows it.
- **`sandbox-exec`** is deprecated on macOS but still shipped. If it disappears, the level drops to proxy-only, which the probe reports.
- **Loopback inside a new namespace** must be brought up or tests that open local ports fail. A test that starts a local server under the wrapper reveals it.
- **Read-only bits on Windows** don't stop creating new files in a folder. The snapshot restore deletes them afterwards.
- **Reviewer snapshot size** on large repos. The cap refuses rather than running unguarded.
- **Restoring after a crash of main** mid-command can leave read-only bits set. A note in D31; recovery is a later concern.

## Open questions

None.
