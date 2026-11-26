# Build ledger: p4-env-ssh

state: done
revision: 1
resume on approve: no
current round: 2 of 3, in revision 1
phase: reviewing
Implementor: a03d9e022fa8b4ae1, haiku    Reviewer: ae181b1c06876001f, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1 to T11 are done and ticked. T12 is partly done: the store part is done, but the registry part is blocked by the spec problem below. T13 to T16 have not started, and T14 (the live walk) was not attempted.

Checks run:
- install --frozen-lockfile, build (`require("ssh2")` stays external), typecheck, lint and format:check pass.
- `pnpm test`: 1870 passed, 18 skipped.
- Not run yet: e2e, `electron-builder --dir`, `git diff main -- tests/`.

## Implementation (revision 1, Mode 3)

T12 to T16 are done, so T1 to T16 are all ticked.
- **Checks:** typecheck, lint and format:check pass. `pnpm test`: 1885 passed, 18 skipped. e2e: 21 passed, 2 skipped. `electron-builder --dir` passes, with `ssh2` in app.asar.
- **Test diff:** `git diff main -- tests/` changes no assertion; `project-registry.test.ts:469-487` is unchanged.
- **Live SSH walk:** passed once (144 s) against a throwaway sshd started without sudo in WSL Ubuntu, on 127.0.0.1:2222.
- **Deviations reported:**
  - `electron-builder.yml` has `npmRebuild: false`, since the build of the optional native `cpu-features` failed;
  - the live walk found a transport bug in `stat`, `lstat` and the handle `stat`, which never settled for a missing path; it is now fixed;
  - `headless-walk.ts` gained an optional `WalkFiles`, and `WalkSetup` an optional `files` and `environmentFor`;
  - `rm` was used on the implementor's own debug test file, and a shell redirect copied the throwaway key outside the repo;
  - live-test leftovers: the sshd process, a line in `authorized_keys`, `/tmp/sddssh` in WSL, and a key copy in Windows temp;
  - progress row 4 is set to `in build`.

## Revision 1, round 1  (ISSUES)

| Finding | Severity | Location | Implementor decision | Reasoning | Action |
| --- | --- | --- | --- | --- | --- |
| R1-1 | minor | bash.exe.stackdump (repo root) | REJECT | The file predates the feature (it is in the session's first git status), the brief said to leave it alone, and the implementor never touched it | None; the orchestrator keeps it out of the commit |
| R1-2 | minor (optional) | src/main/env/ssh.ts:598-608 | REJECT the code change; ACCEPT the limit as a doc note | SPECS.md: "When the group id never arrived, only the channel is closed"; the code matches the spec, and waiting for the marker would need a revision | A note on the limit in the SSH section of docs/environments.md; the changes.md row is updated |

The reviewer judged the listed deviations acceptable. Runtime checks:
- the ssh2 event order when the host verifier refuses a key;
- the group kill on macOS and other Linux servers.

## Revision 1, round 2  (PASS)

No findings. The reviewer accepted both round 1 decisions, confirmed the doc note in docs/environments.md, and found that nothing else changed since round 1.

## Spec problems

- Revision 0 pause, from the implementation report (T12).
  - The spec line (Design, "Store and registry"): "A project whose environment cannot be made, or whose connect fails, gets an `unreachable` entry with no watcher, instead of no entry." AC11 then requires such a project to be "refused for each human-only action with `PROJECT_UNREACHABLE`", while AC11 and AC18 also require that no existing assertion changes.
  - What is wrong: `tests/unit/project-registry.test.ts:469-487` asserts that a project whose environment cannot be made answers 'no project with this id' (NO_PROJECT). Both cannot hold unchanged.
  - Candidates:
    1. split by cause: a project whose environment cannot be made is listed and removable but keeps answering NO_PROJECT, and only a made-but-unreachable project answers PROJECT_UNREACHABLE (the implementor recommends this);
    2. keep AC11 and revise the one assertion at :485, named in a spec revision;
    3. a project whose environment cannot be made keeps no entry (today's behaviour), recorded as a limitation.
  - User chose: Revise the spec. Decision: split by cause (candidate 1). SPECS.md was amended in the Registry design bullet, AC11 and Open questions (revision 1). T12 in tasks.md gained a revision note. Awaiting `/sdd:approve p4-env-ssh`; the build resumes at T12.

## Carried findings

- None, since no review has run yet.
- Implementor deviations to pass to the reviewer:
  - one heredoc append to `env-ssh.test.ts`;
  - interface additions: `SshTransport.platform/identity/connectionId`, `SshSftp.unlink`, `WslTransport.rediscover`, `ServerStore.load`, optional `pollMs`, and the WSL share root read on each call;
  - `secretName`/`SecretKind` moved to `ssh-command.ts` to avoid an import cycle;
  - WSL recognises a missing distribution only in `reconnect()`;
  - `platform` before the first connect is `linux`;
  - the `STORE_REASONS.environment` text names SSH;
  - `allowBuilds` entries in `pnpm-workspace.yaml`.
