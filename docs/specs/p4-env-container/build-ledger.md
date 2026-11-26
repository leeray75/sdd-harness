# Build ledger: p4-env-container

state: done
revision: 1
resume on approve: no
current round: 1 of 3, in revision 1
phase: reviewing
Implementor: a602fba2698c8a6ed, haiku    Reviewer: aba64c70325374824, sonnet
Data agent: none yet
Models: chosen by the user at the start of the build; reused on resume, not asked again.
Respawns: none

## Implementation (revision 0)

T1 to T8 are done and ticked. typecheck, lint, format:check and `pnpm test` pass (1960 passed, 69 skipped). `container-scripts.test.ts` is skipped on Windows and has not been run on Linux yet. T9 to T11 are not started. The implementor paused with NEEDS-SPEC-CHANGE at T4's group kill.

Interpretations it reported for the reviewer (no spec text changed):

- files scripts run with `-u <user> -w /`;
- `readlink` of a non-link gives `EINVAL`;
- a docker call that cannot start also moves the backend to unreachable;
- `addProject` reconnects the container before the root check, and a failed connect gives `STORE_REASONS.root`;
- `HARNESS_CONTAINER_ROOT` is a parent folder for temp repos;
- `WSL_EXE` is exported from `wsl.ts`.

Left for T9: image `sdd-walk-test:local` and container `sdd-walk-live` in WSL Docker, and the scratch folder `%TEMP%\sdd-container-walk`.

## Implementation (revision 1, Mode 3)

T1 to T11 are done and ticked.

- **Revision 1 changes:** the kill is `kill -s KILL -- "$1"`. `goneIn()` matches docker's own lines by their start; for a launched program it checks only before the marker. Seven AC7 cases were added.
- **Windows:** typecheck, lint and format:check pass. `pnpm test` gives 1967 passed, 69 skipped.
- **Linux, a Node 24 copy:**
  - `pnpm test` gives 2029 passed and 1 failed. The failure is a root-only artifact in `command-protect`, which passes when run as non-root.
  - `container-scripts.test.ts` gives 51 of 51. It found a GNU `realpath` bug, which is now fixed.
- **Live container walk:** passed in 735 s through WSL Docker.
- **e2e:** 21 passed, 2 skipped. There was one flaky run while the live walk shared the machine; the rerun was green.
- **`git diff main -- tests/`:** additions only, plus import lines that gained names.
- **Cleanup:** the container, the image, the scratch folder and the Linux copy are removed.
- **Extra interpretation:** the live test's time limit is 90 minutes (about 12 minutes per walk), recorded as a follow-up.

## Revision 1, round 1  (PASS)

No findings. The reviewer judged the six interpretations to be within the spec. Runtime checks it listed:

- the codes of a write into a read-only parent folder and of a failed rename on a real dash or BusyBox container;
- the marker being the first line under real `docker exec` output ordering;
- UTF-16 error text from docker started through `wsl.exe` defeating the line-start match when the engine is down.

## Spec problems

- Revision 0 pause, from the implementation step:
  - **Spec line:** "On timeout or abort, a second exec runs `kill -KILL -- -<pgid>`".
  - **Problem:** in dash, the `/bin/sh` of Debian and Ubuntu images, this fails with `kill: Illegal number: -`, so the group is never killed.
  - **Checked:** `kill -s KILL -- -<pgid>` works in dash on a live group.
  - **User chose:** Revise the spec, with `kill -s KILL -- -<pgid>`.
- Second item, from the same report:
  - **Spec line:** the gone-container stderr patterns ("No such container", "is not running", "Cannot connect to the Docker daemon").
  - **Problem:** they also match the program's own stderr.
  - **User chose:** Revise the spec: only docker's own message lines count, and for a launched program only before the marker.

## Carried findings

- none (no review has run yet)
