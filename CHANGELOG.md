# Changelog

All notable changes to SDD Harness are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Unit tests on every OS in CI** (`p4-macos-ci-fix`): the matrix job runs `pnpm test` on Windows, macOS and Linux, and is now named `unit, e2e and package`. Before this the unit tests ran only in `check (Linux)`, so a test that passed on Linux and failed on macOS was invisible — the macOS failures fixed in this change were found by running the suite by hand. On Linux the step runs before the sysctl that allows unprivileged user namespaces, so the Linux unit tests keep to the same `unshare`-less path that `check` runs. The one AC8 case whose result the OS network wrapper cannot produce is skipped wherever a wrapper is in place.
- **SSH projects** (`p4-env-ssh`, D43): a project can live on a saved SSH server. The SSH backend implements the whole environment interface (files over SFTP, programs and git over exec requests, polling watch, the connection part), with the same contract as the local and WSL backends.
  - Saved servers are kept in `ssh-servers.json` in app data with no secret in it. Passwords and key passphrases are in the secret store, read at connect time only. Host keys are pinned per server, and a changed key always refuses.
  - The project store and the registry accept `{ kind: 'ssh', server }`. A project whose environment was made but cannot be reached is listed, removable and read-only (`PROJECT_UNREACHABLE`), and `reconnect(id)` brings it back. A project whose environment cannot be made is listed as unreachable too.
  - A stopped or missing WSL distribution is unreachable in the same way, and reconnect starts it.
  - The headless walk runs on an SSH project in an opt-in live test (`pnpm test:live`, `HARNESS_SSH_*` variables).
- **Frameless window** (`p0-window-chrome`, PR #3): `frame: false` on Windows and Linux, `titleBarStyle: 'hiddenInset'` with the native traffic lights on macOS. Default size 1280×800, minimum 1024×680.
- **Custom 40px title bar** (`src/renderer/TitleBar.tsx`):
  - it shows the app mark and an empty Location slot, and drags the window;
  - on Windows and Linux it has Minimize, Maximize/Restore and Close buttons (46×40) with accessible names, hover styles and a visible focus ring;
  - on macOS it leaves room for the traffic lights.
- **Window controls bridge** (D20): `window.harness.platform` and `window.harness.window` (`minimize`, `toggleMaximize`, `close`, `isMaximized`, `onMaximizedChange`). Main answers each call only from the app's own window and sends the maximized state back as a boolean-only event.
- **Tests:**
  - unit and e2e tests proving `window.open` is denied and foreign navigation is blocked (the guards now live in the pure `applyNavigationGuards`);
  - e2e tests for the title bar and the window controls;
  - the smoke test checks the new bridge keys.
- **Design tokens** (`p0-design-tokens`, PR #4, D21): every colour, type, spacing, height and radius token from design-notes §2–4 in `src/shared/tokens.ts` and `src/renderer/styles/tokens.css` (87 tokens), plus the new `titlebar/close-hover` token. A unit test keeps the two files equal, and another fails on any hex colour outside `tokens.css`.
- **Bundled fonts:** Inter (400–700) and JetBrains Mono (400, 500) through @fontsource, with no CSP change.
- **Base styles** (`src/renderer/styles/base.css`): the app background, primary text colour, Inter and one 2px accent focus ring. This fixes the shell's unreadable black-on-black text.
- **Button and Chip components:** Button (primary, gate, secondary, ghost, danger; 40px and 32px; disabled) and Chip (neutral, accent, amber, green, red; span or 28px button), with hover and pressed states. Tests check their contrast against WCAG AA.
- **Component gallery:** every Button and Chip variant and the font weights, shown under `pnpm dev` or with `HARNESS_GALLERY=1`.

- **Continuous integration** (`p0-ci`, PR #5, D22): `.github/workflows/ci.yml` runs on pushes and pull requests to `main` and on demand.
  - a `check` job on Linux runs typecheck, lint, format:check and the unit tests;
  - an `e2e` job on Windows, macOS and Linux runs `pnpm e2e`, then an unsigned `electron-builder --dir` build;
  - in CI only, Playwright retries twice, keeps a trace on the first retry and writes an HTML report, which a failed job uploads.
- **Window manager in Linux CI** (`p0-ci-linux-wm`, PR #6): the Linux e2e job runs fluxbox under `xvfb-run`, so maximize and restore work as on a Linux desktop.
- **macOS title-bar e2e test:** checks the traffic lights at `{ x: 14, y: 13 }` and the 78px title-bar padding on the macOS runner.
- **Docs:** a CI section in `CLAUDE.md` and the suggested `SDD_TEST_CMD="pnpm test"` in the README.
- **Agent loop spike** (`p1-spike-agent-loop`, D23): with `HARNESS_AGENT_SPIKE=1` the agent streams a chat completion from an OpenAI-compatible server through the `openai` SDK (`HARNESS_SPIKE_BASE_URL`, `HARNESS_SPIKE_API_KEY`, `HARNESS_SPIKE_MODEL`), makes at most four model turns, and may ask for one read-only tool, `read_file`, for the reader job.
- **`read_file` in main** (`src/main/tools/read-file.ts`): reads one regular file inside `HARNESS_SPIKE_ROOT`, after resolving real paths. It refuses absolute paths, `..` escapes, symlinks that resolve outside the root, directories, missing files and files over 64 KiB, and returns no partial text.
- **Tool results over the channel:** `tool-call-result` carries the tool's `output` on success, and a `failed` error code beside `denied`. The gate allows only `reader` with `read_file` and args `{ path: string }`; main runs the allowed call and returns its output or failure under the request's id.
- **Recording script** `pnpm record:spike` (dev only) and the recorded fixture in `tests/fixtures/spike/`, replayed in unit tests and in the Electron spike e2e test.
- **Live suite** `pnpm test:live` (`tests/live`, its own Vitest config): runs the same loop against `HARNESS_SPIKE_BASE_URL` and is skipped when it is unset. CI does not run it.
- **Secret store** (`p1-secrets`, D25): `src/main/secrets/store.ts` keeps provider keys as `safeStorage` ciphertext in `userData/secrets.json` (mode `0o600`, written atomically). It refuses to save when encryption is unavailable, or on Linux with a `basic_text` or `unknown` backend unless `HARNESS_ALLOW_WEAK_SECRETS=1` is set. Its errors never contain a value.
- **Redaction** (D25): `src/main/secrets/redact.ts` replaces every value the store has handed out, Bearer tokens, `Authorization` and `x-api-key` values, and `sk-` or `sk-ant-` strings with `[redacted]`. Every line main writes, including forwarded agent output, goes through it.
- **Dev secrets commands:** `pnpm secrets:set <name>`, `pnpm secrets:list` and `pnpm secrets:delete <name>` (unpackaged runs only). `set` reads the value with hidden input or from piped stdin, and hands it to the app over a one-shot local socket, so it is never on the command line.
- **`model-key` message** (D19, D25): main sends the spike key to the agent once per run, after its pong. The agent holds it in memory only.
- **Provider interface** (`p1-provider-interface`, D23, D26): `src/agent/provider/` has the provider-neutral types (messages, tool calls, stream events, usage, `ProviderError`), an OpenAI-compatible adapter and an Anthropic Messages adapter (Bearer auth). No SDK type crosses the interface. Errors are sorted into auth, rate-limit, bad-request, server, network, aborted and unknown, with the SDK's retries.
- **Spike provider choice:** `HARNESS_SPIKE_PROVIDER` (`openai`, the default, or `anthropic`) picks the adapter; the default model is per format and `HARNESS_SPIKE_MODEL` overrides it.
- **Anthropic and OpenAI fixtures:** recorded through agentgateway for both formats (`tests/fixtures/spike/<format>/`); `pnpm record:spike anthropic` records the Anthropic format. The fixture tests replay both formats at adapter and loop level.
- **Live suite for both formats** (`tests/live/spike.live.test.ts`, `pnpm test:live`) against `HARNESS_SPIKE_BASE_URL`, without `/v1`.
- **Server presets** (`p1-openai-compatible`, D27): `src/shared/server-presets.ts` holds one table for vLLM, Ollama, LM Studio, llama.cpp server, TGI / SGLang, LiteLLM, agentgateway and Other, with each default address and the wire formats it offers. agentgateway and Other offer both the openai and the anthropic format.
- **Provider factory** (`src/agent/provider/factory.ts`): `createProvider` builds the adapter from a preset, a format, an address and headers, and refuses an unknown preset, an unoffered format, a missing address, a non-http(s) address or one with a user name or password, and invalid headers, without echoing the key or a header value.
- **Extra headers** (`src/agent/provider/headers.ts`, D27): `Name: value` lines, sent on every request through the SDK's `defaultHeaders`. Names must be HTTP tokens, values must have no CR, LF or NUL, and `Authorization`, `x-api-key`, `anthropic-version`, `Content-Type`, `Content-Length` and `Host` are refused.
- **Spike settings** `HARNESS_SPIKE_PRESET` (default `agentgateway`) and `HARNESS_SPIKE_HEADERS`, passed to the agent only with `HARNESS_AGENT_SPIKE=1`.
- **Model listing** (`p1-model-probes`, D28): `Provider.listModels()` returns each model's id and context window (`max_model_len`, `context_length` or `context_window` for the openai format; `max_input_tokens` for the anthropic format), every page, through the SDKs' `models.list()`.
- **Model probes** (`src/agent/probes/`, D28): a chat probe and a two-step tool-use probe (`lookup_code`), each run three times by default. Each probe is passed, unreliable or failed, with median latency and speed and one failure code per failed run. The results are plain data for the Phase 8 "Test and assign" screen; no protocol message or UI yet.
- **Probe recorder and fixtures** (`pnpm record:probes [anthropic]`, `scripts/record-probe-fixtures.ts`, dev only): records `models.json`, `chat.sse`, `tool-turn1.sse` and `tool-turn2.sse` from agentgateway into `tests/fixtures/probes/<format>/`, with starter fixtures committed until the user's recording.
- **Probe tests:** fixture replays through `createProvider` for both formats (listing, passing probes, mixed runs, derived failure codes, fake-clock timing, sentinel leak checks), unit tests for the checks and the runner, and the opt-in live suite `tests/live/probes.live.test.ts` (`pnpm test:live`).
- **Tool registry** (`p2-tools`, D29): `src/shared/tools.ts` lists the seven agent tools (`TOOL_NAMES`, `isToolName`). Each tool has a `ToolSpec` (name, description and a strict JSON schema with `additionalProperties: false`) and a hand-written args guard. The schema and the guard are built from one field table, so they can't drift apart.
  - The guards reject unknown keys, missing keys, wrong types and over-long strings, and their reasons never echo a value.
  - File content and edit texts are capped at 1 MiB.
- **Agent tools in main** (`src/main/tools/`, D29). Every tool works inside one root and uses the shared path rules in `paths.ts`:
  - `list_files`: `*`, `**` and `?` globs. It skips `.git` and `node_modules` and never follows symlinks. It stops at 1,000 entries or 64 KiB of output, with a note.
  - `search_text`: a JavaScript regex over the same files. It skips binary files and files over 1 MiB. It stops at 200 matches or 64 KiB of output, and cuts each line at 500 characters.
  - `write_file`: creates or overwrites one file, creating missing parent folders. It writes through a temporary file and a rename, with a short retry, and leaves no temporary file behind.
  - `edit_file`: an exact text replacement. `old_text` must occur exactly once, unless `replace_all` is set. A `$` in the new text stays literal.
  - `run_command`: runs a program with an argument array and no shell, in a folder inside the root.
    - The environment is minimal: `PATH` plus what each OS needs to start a process.
    - After a timeout (10 minutes by default, set only by main) it kills the whole process tree.
    - It keeps the last 64 KiB of output and reports the exit code, the signal or the timeout.
  - `read_ticket`: an interface only (`TicketSource`, `makeReadTicket`). The default source says no tracker is configured. Ticket text comes back inside a `BEGIN`/`END UNTRUSTED TICKET DATA` frame, and any marker inside the ticket text is escaped.
- **Git refused by the tools themselves** (D29), underneath the policy engine:
  - every file tool refuses any `.git` path segment, ignoring case, with trailing dots or spaces, or as a Windows 8.3 short name;
  - `run_command` refuses the `git` program, whatever the case or extension.
- **Tool dispatch:** `makeToolRunner` checks each call against the registry and its guard, then sends it to the tool's runner. It takes `ToolRunnerOptions` (`commandTimeoutMs`, `ticketSource`), which only main sets.
- **Tool tests:** registry, path rule, file, write, command, ticket and reachability tests. The reachability test runs through the real gate and shows that every new tool is denied for every job, while reader + `read_file` still runs.
- **Per-job tool policy** (`p2-policy-engine`, D30): `BASE_TOOLS` in `src/main/policy/policy-table.ts` gives each job its tools from the design table:
  - every job may read, list and search;
  - the planner and the writer may write and edit, under the path rules;
  - the writer and the reviewer reach `run_command` through a command check;
  - the planner and the reader may read tickets;
  - the reviewer and the reader have no write tool at all.
- **Policy context** (`src/main/policy/context.ts`): the caller passes the feature, the spec state (`none`, `draft` or `approved`), the project's tightening and the command check. `DEFAULT_POLICY_CONTEXT` has no feature and a command check that refuses every command, so until Phase 3 and `p2-command-allowlist` no write or command is reachable in the app.
- **Path areas for writes** (`src/main/policy/path-areas.ts`): a write path is normalized (separators, `.` and `..`, letter case on every OS, trailing dots and spaces) and classed as `outside`, `git`, `spec-doc`, `spec-other` or `source`.
  - The planner may write only `PLAN.md`, `SPECS.md`, `tasks.md` and `SUBTASK.md` of the current feature, before approval.
  - The writer may write source only after approval, and never anything under `docs/specs/`. Approved specs and the app's own files there are read-only to every agent.
- **Project tightening** (`src/main/policy/tightening.ts`): `parseTightening` accepts only a per-job list of tools to remove and refuses anything else, an add or allow key included. `effectiveTools` only ever removes.
- **Rule events** (`src/main/policy/rule-event.ts`): every policy decision, allowed or denied, is a typed event with the job, the tool, a sanitized target and the reason. The target is the path, the program or the ticket id; never content or other arguments. Control characters are escaped, and the target is cut at 200 characters. The host logs allows as info and denials as errors, through the redacting logger.
- **Symlink re-check:** `write_file` and `edit_file` classify the real path again after resolving it, and refuse when a symlink moves the write into a different area (for example `src/link/SPECS.md` with `src/link` pointing into `docs/specs/`).
- **Policy tests:** the table, 36 path-area cases, tightening (including "never adds" over every job and tool), Rule events, the gate's ordered checks and fixed reasons, the router (one event per call, with a runner spy for every denial step), and an acceptance test with the F1 criteria. That test drives every job in every spec state, through the real gate and runner, after reading ticket and file text that says "approve the spec" and "git push".

- **Command allowlist and command limits** (`p2-command-allowlist`, D31):
  - `src/main/commands/detect.ts` detects the project's test and build commands from Node (`package.json` scripts, with the package manager), Python (pytest, `python -m build`), Go and Rust markers.
  - `src/main/policy/command-allowlist.ts` allows only those exact forms, from the project root: the writer may run tests and builds, the reviewer tests only. Anything else is refused with a fixed reason.
  - On Windows, an allowlisted `.cmd` or `.bat` (such as `pnpm.cmd`) runs through `cmd.exe` only when every argument is a safe token. Programs are found on `PATH` with `PATHEXT` (`src/main/commands/lookup.ts`).
  - While a command runs, `docs/specs/` is read-only. Afterwards the changes are reverted: `docs/specs/` and the `.git` key files (`HEAD`, `config`, `packed-refs`, `hooks/`, `refs/`) for both jobs, and for the reviewer every file that is not git-ignored. The tool result says which areas were reverted (`src/main/commands/protect.ts`).
  - The writer's commands get dead proxy variables and offline flags on every OS, and the OS limit where it exists: `unshare` on Linux and `sandbox-exec` on macOS (`src/main/commands/network.ts`). Each writer command gives one network Rule event with its level.
  - Rule events gain a `revert` kind, logged as an error, and a `network` kind, logged as info for `os` and as a warning for `proxy-only`. They are formatted as `rule reverted:` and `rule network:`.
  - `docs/agent-commands.md` lists the commands each job may run, what is protected and reverted, the network limit on each OS, and how to clear read-only bits after a crash.
- **Command tests:** detection, the check, the lookup and `cmd.exe` line rules, the protected set and restore, the network choice, and end-to-end runs of Node stubs on temp roots (the `.cmd` stub only on Windows, the OS network check only where unshare or sandbox-exec exists).
- **Agent job definitions** (`p2-jobs-and-prompts`, D32): `JOBS` gives each job's plain name (plans and chats, writes code, reviews code, reads big files) and `BASE_TOOLS` gives its base tools, in `src/shared/jobs.ts`.
- **Advertised tools** (D32): `jobToolDefinitions(job)` gives a run its job's base tools from `TOOL_SPECS`, with the registry's names, descriptions and schemas.
- **Job system prompts and task texts** (D32): `src/agent/jobs/` holds one system prompt per job and the five shared rules. The writer, reviewer and reader prompts are ported from the sdd plugin's agents, and the planner's is new. `WRITER_TASKS` and `REVIEWER_TASKS` hold the task texts Phase 3 sends. No file is read at run time.
- **Provider `system` field** (D32): `ProviderRequest.system` is sent by the Anthropic adapter as the `system` parameter and by the OpenAI adapter as a leading system message. It is left out when unset or empty.
- **Human-only channel** (`p2-human-only-channel`, D33): `harness:human-action` and `window.harness.humanAction(request)`. One shared contract in `src/shared/human-actions.ts` holds the five action ids, the `{ action, feature }` request, the result and its guard. Main runs three checks in order: the app's own window, the guard, then a real gesture.
- **Gesture check** (`src/main/human/gesture.ts`, D33): a left-button press, or an Enter or Space press that is not a repeat, in the main window counts as a gesture. It is usable for 1000 ms and only once. Page script cannot produce one.
- **Action registry** (`src/main/human/channel.ts`, D33): no handler is registered yet, so a request that passes every check is answered `not-available`. Phase 3 registers the handlers. Each call logs one decision line.
- **Tests that the agent can't reach the channel** (D33): the protocol guard refuses human-action messages; no tool or job base tool has a human-action name; no file under `src/agent/` names the channel or imports the bridge, the contract or Electron. A router test feeds a file and a ticket that say "approve the spec" and "git push", then shows the scripted `approve_spec`, `git_push` and `git push` calls are refused, with Rule events and no handler called.
- **e2e for the gesture** (`tests/e2e/human-action.spec.ts`): no input, a bad request, a real click, a real Enter, a second call after one click and a click older than the window.
- **`docs/human-actions.md`:** the five actions, the request and result, the checks in order, what counts as a gesture, the refusal codes, the logging, how Phase 3 registers a handler, and the limits.
- **`docs/agent-jobs.md`:** the four jobs and their tools, what each prompt tells the model, the task texts Phase 3 sends, and that main's gate enforces the rules.
- **Dependabot for GitHub Actions** (`chore-ci-actions-node24`): `.github/dependabot.yml` checks the actions in the CI workflow weekly and opens a pull request for each update.
- **Workflow table** (`p3-state-machine`, D34): `src/shared/workflow.ts` ports the sdd plugin's v0.18.0 states and events as a hand-written typed table, with no state-machine dependency.
  - It holds 12 nodes, 18 events and the 21 transitions, with `legalEvents`, `nextNode` and `transition`, which reports an illegal event with a fixed reason.
  - It maps the 11 path nodes to the six stages (Start, Plan, Spec, Build, Review, Done), with "Build, paused" for the paused node. `data-agent` is an overlay with no stage.
  - It classifies every event as human-only, user or app, and maps the three human-only events to the D33 actions `approve-spec` and `mark-done`.
  - Tests compare the table with a literal copy of the plugin's config, for every node and event pair, and check the stage labels, the `build-done` gate and the module's imports.
- **`docs/workflow-engine.md`:** the engine reference: nodes, events, transitions, stage mapping and labels, event kinds and the human-action map.
- **Document layer** (`p3-spec-docs`, D35): the plugin's v0.18.0 templates as constants with `fillTemplate` (`src/shared/spec-docs.ts`); the `docs/specs/<feature>/` layout and path helpers, which refuse traversal; and parsers for PLAN.md, SPECS.md, tasks.md and build-ledger.md that never throw.
  - `src/shared/spec-detect.ts` detects a folder's node and stage with the plugin's precedence, minus the session-marker and subagent inputs, and takes the approval as an input.
  - `src/main/workflow/spec-folders.ts` scans `docs/specs/` read-only: symlinks and junctions are skipped, reads are capped, and an unreadable file is reported. A plugin-written folder opens with its stage.
  - The four templates and the `p3-state-machine` folder are vendored byte for byte under `tests/fixtures/sdd-plugin/`, with a README. The 20 finished folders of this repo are detected as Done.
  - `docs/workflow-engine.md` gains the "Document layer" and "Detecting a folder's node" sections.
- **Spec lock** (`p3-spec-lock`, D36): the approval lives in `docs/specs/.sdd-state.json` (feature, SHA-256 of SPECS.md, approval time, `editing` flag), read with a size cap and written by rename. A watcher re-hashes the active spec when it or the state file changes. The `approve-spec` and `edit-approved-spec` handlers run on the human-only channel and refuse with fixed reasons, and they register when a project root is set. Folder detection now gets the real approval, and an unchecked approval locks spec and source writes for every agent.
- **Build loop** (`p3-build-loop`, D37): `src/main/workflow/build-loop.ts` runs one feature's build in main. The writer runs Mode 1, then review rounds with the reviewer, a Mode 2 fix with every finding unedited, and a decision each round. The round limit is 3 by default and may be 1, 2 or 3. Every node change goes through `transition()`.
- **Git module** (`src/main/git/git.ts`, D38): the only code that runs git. It uses `execFile` with no shell, a 30 s timeout for local commands and 120 s for a push, `GIT_TERMINAL_PROMPT=0`, and four fixed failure codes. It never returns or logs git's output.
- **Ship and close** (`p3-ship`, D38): `approve-result` commits the approved work and pushes the feature branch, and `mark-done` closes the feature. Both run on the human-only channel and refuse with fixed reasons.
  - `approve-result` is legal only at build-done with the spec approved, on a feature branch (not detached, not the default branch), and with the build controller not running. It rewrites SUMMARY's Git state line and commits only the feature's changed files, which must all be in the allowed set. The commit message is `<ticket>: <summary>` or `<summary>`, taken from SUBTASK.md's title.
  - A push that fails keeps the commit; approving again only pushes.
  - `mark-done` is legal once the approved work is pushed. It sets SPECS.md to `done`, removes the state file when it names the feature, commits `Close <feature> spec` and pushes.
- **Rule events** (`p3-ship`, D30): the job runner sends every gate decision, allowed or denied, to `onRuleEvent`, as well as the revert and network events of `run_command`. A throwing callback does not fail the run.
- **Pauses and change rounds** (D37): a spec problem from either job pauses the build after its step, and continue, revise or stop settles it. A revision has no cap and restarts the reviews at round 1. After a clean build, change requests go to the same writer and reviewer as `User-requested change round U<n>`, outside the round limit.
- **Build documents** (D37): `build-ledger.md` and `SUMMARY.md` are written in the plugin's formats (`src/shared/build-docs.ts`), and `parseLedger` and `detectFolder` read them back: implementing and reviewing with the current round, paused, and build-done.
- **Report parsers** (`src/shared/build-reports.ts`): the implementation report, the findings analysis and the review, each with a fixed reason on a bad reply. A reply that fails gets one restatement in the same history.
- **Job runner** (`src/main/workflow/job-runner.ts`, D37): each writer or reviewer request runs the agent loop with the job's history. Each tool call is checked by the gate before it runs, with turn caps of 40 for the writer and 20 for the reviewer.
- **Agent loop options:** `maxTurns` raises the cap and `history` is sent before the prompt. `messages` is returned, so a conversation can continue. The default of 4 turns is unchanged.
- **Workflow events** (D37, amends D34): `CONTINUE` and `STOP_BUILD` are user events, legal in `paused`. `END_BUILD` is an app event from `implementing`, `reviewing` and `paused` to `build-done`. The table has 21 events and 26 legal transitions.
- **Build ends without a verdict** (D37, revision 1): a failed step (a provider error, the turn limit, or a report still unreadable after one restatement), and a continue with nothing left to run, end the build with END_BUILD and the outcome Open issues remain. No fake IMPLEMENTED is raised, so the node agrees with the ledger and SUMMARY.
- **Change-round label** (D37, revision 1): a change round is `U<k>` in its prompts and in the reviewer's heading (`## Review round U<k>`), and `parseReview` returns the round as the string `U<k>`.
- **Writer's spec files** (amends D30): once the spec is approved, the writer may write its own feature's `tasks.md` and `changes.md`. The planner may not write `changes.md`, and no job writes the ledger, SUMMARY or the state file.
- **EDIT_SPEC** (D37): `edit-approved-spec` asks the feature's build controller before it records the edit, and the controller refuses once a build has started. No controller is created at startup yet.
- **Scripted provider** (`tests/support/scripted-provider.ts`): replays each job's turns, so the whole loop runs in unit tests with no network.
- **App job runner factory** (`src/main/workflow/app-runner.ts`, D39): `createAppJobRunner` builds the in-process job runner with the root's command context, read live for each call, and every rule event logged through `logRuleEvent(log)` (D30). The build start must use it; `index.ts` does not call it yet.
- **Headless walk** (`tests/unit/headless-e2e.test.ts`, D39): one feature goes from planning to closed on a temp git repo with a local bare remote and no network. It runs the real channel, spec and ship handlers, the build controller with the app's runner, the gate and the tools. It covers a denied SPECS.md write, an ISSUES fix, a spec-problem pause and revision, one change round, and the one commit on approve-result and the close commit on mark-done. Nothing is committed before approve-result.
- **Plugin folders in every state** (`tests/unit/plugin-folder-states.test.ts`): the seven `p3-ship` files at commit `c580d56`, vendored byte for byte under `tests/fixtures/sdd-plugin/specs/p3-ship/`, are checked against recorded SHA-256 values. Each state from planning to closed opens at its node and stage through the scanner.
- **Where build jobs run** (D39): build jobs run in the main process for v1. The agent utility process keeps the spike loop, and no new IPC message is added.
- **Project store** (`src/main/projects/store.ts`, D40, `p4-project-store`): projects are kept in `projects.json` in app data, with add, list, get, rename, set rules and remove. A remove never touches the project's folder. A file that is corrupt, not JSON or from another version is set aside as `projects.json.corrupt-<timestamp>`, with a log line that gives the reason code only, and the store starts empty.
- **Project rules** (`src/shared/project-rules.ts`, D40): the round limit (1–3, default 3), the model policy (`defaults`, `self-hosted-only` or `custom`, stored only) and the commit format (default `{ticket}: {summary}`), with fixed refusal reasons. Spec approval and review are not rules, so a rules value that names them is refused.
- **Project registry** (`src/main/projects/registry.ts`, D40): the stored projects plus the dev project, one spec-lock watcher per project, and the four human-only handlers answering for the project each request names. An unknown project is refused with `refused` and changes nothing. `buildOptionsFor` gives a project's round limit to the build controller.
- **Dev project** (D40): in an unpackaged run, `HARNESS_SPIKE_ROOT` is the `dev` project. It is never saved, and a packaged app ignores the variable.
- **Tests:** `tests/unit/project-rules.test.ts`, `project-store.test.ts` and `project-registry.test.ts`, covering every AC3 refusal, the folder hash around remove, the set-aside cases, per-project approval and the round limit of a project's build.

- **WSL backend** (`p4-env-wsl`, D42, [`docs/environments.md`](docs/environments.md)): `createWslEnvironment` runs one WSL distribution and one Linux root behind the environment interface. Files use `node:fs` on `\\wsl.localhost\<distro>` (or `\\wsl$\<distro>`); programs and git run through `wsl.exe` with an argument array; a fixed launcher gives each program its own process group, killed on timeout or abort; watching polls one folder. Environment variables cross through `WSLENV`, never the Windows `PATH`. `detectWsl` lists the installed distributions and the default one, and runs only when called.
- **WSL projects** in the project store and registry: `{ kind: 'wsl', distribution }`, with a Linux root checked through the project's environment. `environmentFor` builds the WSL backend on Windows and refuses it elsewhere with a fixed reason.
- **Live WSL walk** (`tests/live/wsl-walk.live.test.ts`, `pnpm test:live`): the headless walk on a temp repo inside the default distribution (or `HARNESS_WSL_DISTRO`). It is skipped off Windows, without WSL, or without git in the distribution, and never runs in CI.

### Changed

- **Human-only request shape** (D33, amended by D40): a request is `{ action, project, feature }`, where `project` is `dev` or a project id. The decision line adds `project=<id>`. The e2e test sends `project`, and with no projects its handler checks refuse the request as an unknown project.
- **Commit message** (`src/main/workflow/ship.ts`): the approve-result message comes from the project's commit format. The default format gives the same messages as before.
- **Spec and ship handlers** are registered per project through the registry, in place of the single `HARNESS_SPIKE_ROOT` root (`startSpecLock` is removed).

- `protect.ts` no longer runs git itself. Its read-only ignore query is `ignoredEntries` in the git module (D31, `p3-ship`), with the same arguments and results.
- The agent loop takes the run's `job`. Each request carries that job's system prompt and advertised tools (`jobToolDefinitions`), in place of the one hand-written `read_file` tool, which is removed. The spike runs as the reader, and its tool calls carry that job (D32).
- `BASE_TOOLS` moved from `src/main/policy/policy-table.ts` to `src/shared/jobs.ts` with the same contents and order. The policy table re-exports it, so the gate and tightening are unchanged (D32).
- `run_command` runs only through the project's command check. With a project root, the host builds the check from the detected commands, and the gate and the runner both use it. With no root, every command is still refused.
- `runCommandInRoot` takes the job, the check and the event sink. The router passes each call's job to the runner (`ToolRunner` gains `job`).
- `programRefusal` no longer refuses `.cmd` and `.bat` programs by name. The command check decides, and a Windows script runs only through the `cmd.exe` rule above; git stays refused.
- `RuleEvent` is a union: the allow and deny decisions are unchanged, and the revert and network kinds are added. The application's log gains a `warn` level for proxy-only network events.
- The agent gate's spec state comes from the approval lock (D36): `SpecState` gains `locked`, and each tool call reads the open feature and its state from the lock watcher. `effectiveFeature` uses the shared slug rules, so `a--b` and a slug over 64 characters are refused. `HumanActionRefusal` gains `refused`.
- The OpenAI-compatible and Anthropic adapters take an extra headers option. A `/v1` at the end of an Anthropic-format base URL is stripped, so `http://h:4100/v1` posts to `/v1/messages` (it gave `/v1/v1/messages` before).
- An empty-string key is sent as the `no-key-set` placeholder in both adapters, as a `null` key already was (it was sent as an empty token before).
- `HARNESS_SPIKE_BASE_URL` may be unset when the preset has a default address. A spike refusal (an unknown preset or format, a bad address or header) is reported as `spike skipped: <reason>`, and the start line is `spike started preset=<id> provider=<format> model=<model>`.

- The spike loop runs on the provider interface instead of the `openai` SDK. The finished line adds `input=<n> output=<n>` (or `usage=none`), and `LoopResult` gains per-turn and total usage.
- The spike's stored key is the `agentgateway` entry (`pnpm secrets:set agentgateway`), replacing `spike`.
- The old `tests/fixtures/spike/*.sse` files are removed; the spike e2e replays the `openai/` fixtures at `/v1/chat/completions`, with the app given the base URL without `/v1`.
- The title bar and the window's background colour now use the design tokens instead of local values.
- The agent process gets an allowlisted environment (OS basics, the spike flags, and the spike variables only when `HARNESS_AGENT_SPIKE=1`), in place of a full copy of the app's environment. On Windows the names match case-insensitively, so `SYSTEMROOT` passes.
- The gate's denial reason now says only the reader job may call tools, and the router runs allowed calls instead of refusing them.
- The spike's key comes from the secret store (the `spike` entry, set with `pnpm secrets:set spike`), not from `HARNESS_SPIKE_API_KEY`. The variable is no longer passed to the agent and is read only by the live suite (`pnpm test:live`).
- `read_file` resolves its path through the shared path rules (`p2-tools`). It now also refuses paths inside `.git`. Its root and path refusals use the shared reason texts (for example "no root is configured"). Its 64 KiB cap and its read behaviour are unchanged.
- The gate is unchanged: it still allows only `reader` with `read_file`. The new tools exist in main but can't be reached until `p2-policy-engine` adds the per-job table, and the agent loop still offers models only `read_file`.
- The reader-only gate is replaced by the per-job policy (`p2-policy-engine`). `checkToolCall(request, context)` runs seven ordered checks with fixed reasons, and returns the decision with its Rule event. A denied call still returns `denied` and never runs. Arguments that fail the registry guard are now refused at the gate as `denied`, before the runner's own guard.
- The router takes an `onRuleEvent` dependency and emits one Rule event for every validated tool call. The `tool call denied` log line is replaced by the event's `rule blocked:` line.
- `list_files` and `search_text` refuse a path inside `node_modules` (any case, trailing dots or spaces, either separator). `read_file` of one file there still works.
- The reachability test now follows the policy table under the default context, in place of "every new tool is denied for every job".
- **CI actions on Node 24** (`chore-ci-actions-node24`): `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` moved from v4 to v7, which run on the Node 24 runtime instead of the deprecated Node 20 one. The workflow is otherwise unchanged.

- **Environment interface** (`p4-env-local`, D41, [`docs/environments.md`](docs/environments.md)): every file, command, git and watch call inside a project goes through one `Environment` in `src/main/env/`, with a local backend that keeps today's error codes, containment, timeouts, tree kill, network limit and git calls. The tools and the agent host take a narrower `ToolEnvironment` with no git. The project registry makes each project's environment once, and a project whose environment cannot be made is refused like an unknown one. The project store's save uses the shared atomic writer. The secret store keeps its own synchronous `0o600` save, unchanged.

### Fixed

- **macOS unit test failures** (`p4-macos-ci-fix`): `pnpm test` had 9 failures on macOS, 8 of them from one cause. The WSL and SSH fakes stand in for the remote root with a temp folder, and `os.tmpdir()` on macOS is `/var/folders/…`, whose real path is `/private/var/folders/…`. `realpath` and `readlink` then returned a path that no longer began with the root as the test had written it, so the map back to a Linux or remote path failed and the tools said `the root is not a readable directory`, or failed with `ENOENT`. The three suites that map a temp folder back to POSIX paths (`tests/unit/env-wsl.test.ts`, `tests/unit/env-ssh.test.ts` and `tests/unit/env-recording.test.ts`) now build their temp root from `realpathSync(tmpdir())`, so the root they map against is the root the filesystem resolves. On Linux `/tmp` and on Windows the temp folder are already resolved, so nothing changes there. No file under `src/` changed, and no assertion changed. The unit tests run only in the `check (Linux)` job, which is why the macOS runners never reported this.
- **Linux CI unit test failures** (`p4-ci-linux-fix`, AC1 to AC4): the `check (Linux)` job had failed its Unit tests since `p4-env-wsl`, because two pieces of code assumed a Windows host. `linuxResult` in `src/main/env/wsl.ts` now maps a `realpath` or `readlink` result that lies inside a POSIX share root back to its Linux path, and refuses a host path outside it with `ENOENT`; a `/`-prefixed result is still returned unchanged for a UNC root, as on Windows. `environmentFor` in `src/main/env/index.ts` checks the WSL distribution name before the platform, so a missing name gives `UNSUPPORTED_ENVIRONMENT` on every platform. New unit cases cover both roots and the order. No existing assertion changed.
- **Linux CI unit test failure, last case** (`p4-ci-linux-fix-2`, AC1 and AC2): the WSL `run_command` case in `tests/unit/env-recording.test.ts` failed on `check (Linux)` because its fixture `share/usr/bin/tool` was written with mode `0644`, and `fs.access(…, X_OK)` on a Linux host rejects it. The fixture is now written with mode `0o755`. Only the test setup changed, and no assertion changed.
- **Spec lock atomic write retries a rename** (`p4-env-wsl`, revision 1, D41): `writeAtomic` in `src/main/workflow/spec-lock.ts` uses the shared `writeFileAtomic` and its rename retry. A rename over an existing file fails with `EPERM` now and then on a Windows share and under parallel load, and one attempt used to fail a build step or refuse an approval. The result and the reasons are unchanged: the Node code of the last error.
- **Linux e2e seed run** (`p1-secrets-ci`, D25): with no keyring, Electron 45 reported encryption as unavailable, so the test-only `HARNESS_ALLOW_WEAK_SECRETS=1` had no effect and the spike e2e's seed run exited 1. On Linux the override now also calls `safeStorage.setUsePlainTextEncryption(true)`, once per process and before the store's first use. Without the override nothing changes, and a weak Linux backend is still refused.
- **Spike e2e seed run on macOS and Linux** (`p1-secrets-ci`, AC5): the seed run now passes Playwright's `--use-mock-keychain` and `--password-store=basic`, the same switches the app run gets, so the stored key can be read back. The app run also sets `HARNESS_ALLOW_WEAK_SECRETS=1`, so both runs set up encryption the same way on Linux. The e2e therefore uses Playwright's mock keychain; the real macOS keychain is a runtime check.
- **Spike e2e failure output** (`p1-secrets-ci`): every seed and app-run assertion in `tests/e2e/spike-agent.spec.ts` now prints that run's captured output on failure (withheld if the sentinel appears in it), and the chat `Authorization` headers are reported as classes only, never as values.
- **CI e2e job green again** (`p2-fix-e2e-selfcheck`): the self-check e2e test in `tests/e2e/agent-process.spec.ts` waited for the reader-only gate's `tool call denied` line, which D30 had replaced. It now expects the `rule blocked` Rule event for the writer's `write_file` call and the agent's denied result with the same reason, and checks that no Rule line carries the absolute repo path and that the file body never appears. The e2e job had been red on all three OSes since PR #14. The app is unchanged.

### Known issues

- Dragging the window by the title bar has no automated check.
- The `read_file` symlink tests are skipped where the OS refuses to create symlinks. So are the 8 file-symlink tests of the `p2-tools` path rules and walker; macOS and Linux CI run them.
- The command network limit is best effort. On Windows, and wherever `unshare` (Linux) or `sandbox-exec` (macOS) is missing, a writer's command gets only the dead proxy variables and offline flags, which help only tools that read them.
- The OS network check runs only where `unshare` or `sandbox-exec` is available, and is skipped on Windows. The Linux namespace and the macOS profile were not run on their own OS in this build.
- **A writer's command that cannot start is reported as run, not refused, wherever the OS network wrapper is used.** The writer's command starts under the wrapper, so the wrapper is the program that starts and the target's failed `exec` comes back as the wrapper's own exit code (`sandbox-exec` on macOS exits 71 and writes an `execvp() … failed` line to stderr), not as a spawn error. `run_command` then returns output and an exit code where `the program could not be started` would be truer, because `runChild` decides "could not start" only from a spawn error raised before a pid exists. Without a wrapper — the reviewer's commands, and the writer's where the OS offers no namespace — a program that cannot start is still refused with that reason, which is how it was checked on macOS. The unit case that checks the refusal is skipped while a wrapper is in place, so no CI job covers that path on macOS until the product decides the rule for both wrappers.
- A crash while a command runs can leave `docs/specs/` read-only, and a revert half done. `docs/agent-commands.md` shows how to clear the read-only bits.
- If a protected file cannot be put back after a command, the tool result says so, but no Rule event is logged for it.
- The symlink re-check cases (`p2-policy-engine`) need a platform that allows creating a folder link; elsewhere they are skipped.
- `startAgentHost` has no unit test, because it needs Electron. Its command policy choice is tested through `commandPolicyFor`.
- Write paths are compared case-insensitively on every OS, so on Linux a source folder genuinely named `Docs/Specs/` is treated as the spec folder and refused for the writer.
- The POSIX process-group kill on a `run_command` timeout has only run in macOS and Linux CI.
- One e2e run crashed at launch (worker exit code 3221226505) and passed on rerun; not yet reproduced.
- `tests/unit/spec-watch.test.ts` is load-sensitive. The case that waits for `onChange` within 2 s of an edited `SPECS.md` fails now and then in a full parallel run, passes on rerun, and passes on its own every time. It ran only on Linux before; the unit tests now run on three OSes, so expect the odd red job from it.

## [0.1.0] - 2026-11-17

The first version: the Phase 0 scaffold, as far as subtasks 1 and 2.

### Added

- **Toolchain** (`p0-toolchain-and-skeleton`, PR #1):
  - pnpm pinned through Corepack (D14);
  - Node 24 LTS (D18);
  - electron-vite builds, and electron-builder packages unsigned builds for the current OS (D15);
  - React with strict TypeScript, pinned to the 6.x line until typescript-eslint supports 7 (D15, D16);
  - ESLint flat config and Prettier (D16);
  - Vitest unit tests and Playwright-for-Electron e2e tests (D17).
- **Secure Electron skeleton:**
  - the main window runs with `contextIsolation`, `sandbox`, no `nodeIntegration` and `webSecurity`;
  - `window.open` is denied, and navigation and redirects to foreign URLs are blocked;
  - the production page has a strict CSP (`'self'` only), relaxed only under the Vite dev server, and the build fails if the two policies drift apart.
- **Typed preload bridge:** `window.harness.getVersion()` is the only call exposed to the renderer. Its contract is in `src/shared/bridge.ts`, and main answers only when the request comes from the app's own window.
- **Empty React shell:** it shows the app version read through the bridge.
- **Agent process** (`p0-process-layout`, PR #2): an Electron `utilityProcess` stub (`src/agent/index.ts`) that main starts after the app is ready and stops on quit. An unexpected exit is logged, and the agent is not restarted (D19).
- **Typed agent channel:** `src/shared/agent-protocol.ts` defines the handshake, ping/pong, and the tool call request and result messages. Main checks every agent message with bounded, hand-written guards, and rejects and logs any that are malformed. No message exists for human-only actions (D3).
- **Default-deny policy gate:** `src/main/policy/gate.ts` checks every agent tool call request and denies it with a reason. The router returns the denial to the agent as an error result, and nothing is executed.
- **Tests:**
  - unit tests for the navigation and sender checks, the protocol guards, the gate and the router;
  - an e2e smoke test proving the renderer can't reach `require`, `process` or `module`;
  - an e2e test proving a tool call from the agent process comes back denied.
- **Commands:** `pnpm dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`, `e2e` and `package`, documented in `CLAUDE.md`.
- **Docs:**
  - decisions D14–D19 in `docs/decisions.md`;
  - the Phase 0 plan and progress file (`docs/phases/phase-00-progress.md`), with Phase 0 marked in progress in `docs/roadmap.md`;
  - the spec, tasks, build ledger and summary report for both subtasks in `docs/specs/`.

### Changed

- Prettier reformatted the existing Markdown docs. Only table alignment and blank lines changed; no text did.

### Known issues

- The agent process receives a full copy of the app's environment. It should get an allowlisted environment before Phase 1.
- Strings the agent supplies (such as the tool name) are logged without escaping newlines or control characters.
- `pnpm e2e` and `pnpm package` have only been run on Windows. CI for macOS and Linux comes in `p0-ci`.

[Unreleased]: https://github.com/leeray75/sdd-harness/commits/main
[0.1.0]: https://github.com/leeray75/sdd-harness/commits/main
