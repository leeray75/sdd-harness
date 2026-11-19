# Changes: p0-ci-linux-wm

| File | Action | What and why | Task |
| --- | --- | --- | --- |
| docs/specs/p0-ci-linux-wm/changes.md | created | Record of the files touched in this build. | T1-T3 |
| .github/workflows/ci.yml | edited | Added a Linux-only apt step for fluxbox and x11-utils, and changed the Linux test step to start fluxbox under `xvfb-run -a`, wait for it with `xprop` (about 10 s, fails naming fluxbox), then run `pnpm e2e`. Windows and macOS steps, package step, upload, check job, triggers, permissions and concurrency unchanged. | T1 |
| CLAUDE.md | edited | CI subsection: the Linux job installs fluxbox and runs it under `xvfb-run` before `pnpm e2e`; local Linux reproduction line shows the apt install and the fluxbox-first `xvfb-run -a bash -c` command. | T2 |
| docs/decisions.md | edited | D22: Outcome names fluxbox under `xvfb-run` on Linux; Why gives the window-manager reason and the alternatives not taken; added an amendment line dated 2026-11-18 naming p0-ci-linux-wm. | T2 |
| docs/specs/p0-ci-linux-wm/tasks.md | edited | Ticked T1, T2 and T3 after their checks passed. | T1, T2, T3 |
