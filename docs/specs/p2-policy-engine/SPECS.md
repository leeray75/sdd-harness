---
status: approved
ticket:
---

# p2-policy-engine

## Problem

The gate in `src/main/policy/gate.ts` allows exactly one call, the reader's `read_file`, and denies everything else. So the seven registry tools from `p2-tools` (D29) can't be used by the jobs that need them. F1 needs these four things, enforced in main and not in prompts:

- each job gets its fixed tool set from the "What each agent can do" table;
- the spec folder is writable only by the planner before approval, and source only by the writer after approval;
- a project can remove tools but never add them;
- every decision is visible as a Rule event.

## Goals

- **G1:** A per-job policy table over the seven registry tools, matching the design table. Projects can tighten it but never widen it.
- **G2:** Path rules for writes, decided from a policy context that the caller passes in (the feature, the spec state, the tightening, the command check). Spec files are read-only to every agent once the spec is approved, and no agent can write the app's own files.
- **G3:** Every decision, allowed or denied, is a typed Rule event with the job, tool, target and reason, logged through the redacting logger. A denied call returns `denied` with a fixed reason and never runs.
- **G4:** A second layer in the tools:
  - the write and edit runners refuse when a symlink moves a write into a different area;
  - `list_files` and `search_text` refuse paths into `node_modules`.

## Non-goals

- The command allowlist and its detection, the read-only spec folder while commands run, the changed-file check, network limits, and Windows `.cmd`/`.bat` runs (`p2-command-allowlist`). Here `run_command` is decided by a command check that denies everything.
- Job prompts, and advertising tools to models (`p2-jobs-and-prompts`).
- The human-only channel (`p2-human-only-channel`).
- Real workflow states, the spec hash, and the build loop (Phase 3). The spec state is an input here.
- Loading tightening from a project file (Phase 4).
- Any UI, read restrictions (for example `.env` files), and changes to the registry's tool list or argument schemas.

## Design

All new policy code is in `src/main/policy/`. It has no Electron import and no file-system access; `node:path/posix` is allowed.

**Policy table** (`policy-table.ts`, `BASE_TOOLS: Record<JobId, readonly ToolName[]>`):

| Tool | planner | writer | reviewer | reader |
| --- | --- | --- | --- | --- |
| `read_file`, `list_files`, `search_text` | yes | yes | yes | yes |
| `write_file`, `edit_file` | yes (path rules) | yes (path rules) | no | no |
| `run_command` | no | yes (command check) | yes (command check) | no |
| `read_ticket` | yes | no | no | yes |

**Policy context** (`context.ts`):

```ts
type SpecState = 'none' | 'draft' | 'approved';
interface PolicyContext {
  feature: string | null;      // slug; anything not matching /^[a-z0-9][a-z0-9-]{0,63}$/ is treated as null
  spec: SpecState;
  tightening: Tightening;
  commandCheck: CommandCheck;  // (call: { job, program, args, cwd }) => { allow: true } | { allow: false; reason: string }
}
```

`DEFAULT_POLICY_CONTEXT` is `{ feature: null, spec: 'none', tightening: { remove: {} }, commandCheck: denyAllCommands }`. `denyAllCommands` returns the reason `commands are not allowed yet: no allowlist is configured`.

**Path areas** (`path-areas.ts`, `classifyPath(path: string): PathArea`). The path is normalized first:

- `\` becomes `/`;
- empty and `.` segments are dropped, and `..` removes the previous segment;
- each segment loses its trailing dots and spaces and is lower-cased (on every OS).

The areas:

- `outside`: an empty result; a path starting with `/`, `//` or a drive letter (`x:`); a `..` that climbs above the root; or any segment containing `:`.
- `git`: any segment equal to `.git`.
- `spec-doc`: exactly `docs/specs/<feature>/<name>`, where `<name>` is one of `plan.md`, `specs.md`, `tasks.md` or `subtask.md`. The area carries `<feature>` as normalized.
- `spec-other`: anything else that is `docs/specs` or below it.
- `source`: everything else.

**Tightening** (`tightening.ts`):

- The shape is `Tightening = { remove: Partial<Record<JobId, readonly ToolName[]>> }`.
- `parseTightening(raw: unknown)` returns `{ ok: true; tightening } | { ok: false; reason }`.
  - It accepts only an object whose only key is `remove`, or an empty object, which means no removals.
  - `remove` must be an object whose keys are job ids and whose values are arrays of registry tool names.
  - Anything else is refused with a fixed reason that never echoes a value: another key (`add` or `allow`, for example), an unknown job, an unknown tool, or a wrong type.
- `effectiveTools(job, tightening)` is `BASE_TOOLS[job]` minus the removed names. It reads only `remove[job]`, so no input can add a tool.

**Gate** (`gate.ts`). `checkToolCall(request, context): PolicyDecision`, where `PolicyDecision = { allow: boolean; reason: string; event: RuleEvent }`. It checks these in order, and the first that fails decides:

1. The tool is not a registry name: `not allowed: no such tool`.
2. The tool is not in the job's base set: `not allowed: the <job> job has no <tool> tool`.
3. The tool was removed by tightening: `not allowed: this project removed <tool> from the <job> job`.
4. The arguments fail the registry guard: `not allowed: the arguments are not valid for this tool`.
5. For `write_file` and `edit_file`, the path area:
   - `outside`: `not allowed: this path can't be written`.
   - `git`: `not allowed: paths inside .git are not allowed`.
   - Planner:
     - no feature: `not allowed: no feature is open, so the planner can't write`;
     - the spec is `approved`: `not allowed: the spec is approved; spec files are read-only`;
     - anything other than `spec-doc` for the context's feature: `not allowed: the planner can write only PLAN.md, SPECS.md, tasks.md and SUBTASK.md in the current feature's spec folder`.
   - Writer:
     - `spec-doc` or `spec-other`: `not allowed: the spec is approved; spec files are read-only` when the spec is `approved`, else `not allowed: spec files can't be written by the code writer`;
     - `source` while the spec is not `approved`: `not allowed: source files can be edited only after the spec is approved`.
6. For `run_command`: the context's `commandCheck` with the checked arguments. A denial uses its reason.
7. Otherwise: allowed, reason `allowed`.

`<job>` and `<tool>` come only from validated job ids and registry names, never from agent text.

**Rule events** (`rule-event.ts`):

- The event is `RuleEvent = { kind: 'rule'; decision: 'allow' | 'deny'; job: JobId; tool: string; target: string; reason: string }`.
- The target:
  - the `path` argument for `read_file`, `write_file` and `edit_file`;
  - `path`, or `.` when it is absent, for `list_files` and `search_text`;
  - `program` for `run_command`;
  - `id` for `read_ticket`;
  - `-` when the tool is unknown or the arguments fail the guard.

  It is sanitized: control characters (U+0000–U+001F, U+007F) become `\uXXXX`, and anything past 200 characters is cut and ends with `…`. For an unknown tool, `tool` is `-` too.
- `formatRuleEvent(event)` returns `rule <allowed|blocked>: job=<job> tool=<tool> target=<target> reason=<reason>`.
- `logRuleEvent(logger)` makes a sink that writes the formatted line with `logger.info` for an allow and `logger.error` for a deny.

**Router** (`router.ts`):

- `RouterDeps.checkToolCall` becomes `(request: ToolCallRequest) => PolicyDecision`, with the context already bound by the caller.
- `RouterDeps` gains `onRuleEvent: (event: RuleEvent) => void`.
- For each validated `tool-call-request`, it emits exactly one event, from the decision, before it runs or replies.
- The `tool call denied` log line is replaced by the event. The `tool call ran` and `tool call failed` lines stay.

**Host** (`host.ts`) passes:

- `checkToolCall: (r) => checkToolCall(r, DEFAULT_POLICY_CONTEXT)`;
- `onRuleEvent: logRuleEvent(log)`.

**Tool layer:**

- `write-file.ts` and `edit-file.ts`: after `resolveInRoot` succeeds, `classifyPath(resolved.rel)` must equal `classifyPath(args.path)`: the same area, and for `spec-doc` the same feature and name. Otherwise they fail with `the real path is in a different area than the path given`.
- `src/main/tools/paths.ts` gains `hasNodeModulesSegment(path)`: a `node_modules` segment, ignoring case and trailing dots and spaces, with either separator. `list_files` and `search_text` refuse such a `path` with `paths inside node_modules are not searched`.

## Acceptance criteria

- **AC1 (table):** `BASE_TOOLS` equals the table above. With every context (each `spec` state, with and without a feature, any tightening):
  - the reviewer and the reader are denied `write_file` and `edit_file`, at step 2;
  - only the planner and the reader get `read_ticket`;
  - only the writer and the reviewer reach the command check.
- **AC2 (path areas):** `classifyPath` returns the areas in the Design for a table of at least 25 cases, covering:
  - `\` and `/`, `./` and `a/../`, a `..` above the root;
  - `DOCS/Specs/F/SPECS.md`, `docs/specs/f/specs.md.` and `docs/specs/f/specs.md ` (trailing dot and space);
  - `C:/x`, `/x`, `//server/x`, `docs/specs/f/SPECS.md:stream`;
  - `.GIT/config`, `docs/specs`, `docs/specs/f/state.json`, `docs/specs/f/build-ledger.md`, `docs/specs/f/SUMMARY.md`;
  - `docs/specs-old/x`, `src/docs/specs/f/SPECS.md` (source), and the empty string.
- **AC3 (planner):**
  - With feature `f` and the spec `none` or `draft`, the planner may write and edit the four planning docs of `f` (any letter case).
  - It is denied, with the Design's reason:
    - the same files once the spec is `approved`;
    - the files of another feature;
    - `docs/specs/f/state.json`, `build-ledger.md` and `SUMMARY.md`;
    - any `source` path;
    - every write when there is no feature.
- **AC4 (writer):**
  - With the spec `approved`, the writer may write and edit `source` paths.
  - With the spec `none` or `draft`, it is denied every `source` path.
  - It is denied every `spec-doc` and `spec-other` path in every state. Its `edit_file` of `docs/specs/f/SPECS.md` with the spec `approved` is denied with `not allowed: the spec is approved; spec files are read-only`, and that produces a deny Rule event naming `writer`, `edit_file` and `docs/specs/f/SPECS.md`.
- **AC5 (commands):**
  - Under `DEFAULT_POLICY_CONTEXT`, `run_command` is denied for the writer and the reviewer with the default-check reason, and for the planner and the reader at step 2.
  - With a context whose command check allows, the writer's and the reviewer's calls are allowed. The check receives the job and the checked arguments.
- **AC6 (tightening):**
  - `parseTightening` accepts `{}` and `{ remove: { writer: ['run_command'] } }`.
  - It refuses each of these with a fixed reason that contains none of the input values:
    - `{ add: { reviewer: ['write_file'] } }`;
    - `{ allow: … }`;
    - `{ remove: { reviewer: 'write_file' } }`;
    - an unknown job;
    - an unknown tool;
    - a non-object.
  - A removed tool is denied with the step 3 reason.
  - A hand-built context whose tightening object also carries `add` or `allow` keys, or removes tools a job doesn't have, never makes a tool allowed that `BASE_TOOLS` denies. A test proves this for every job and tool.
- **AC7 (Rule events):**
  - Every validated `tool-call-request` passed to `handleAgentMessage` produces exactly one `onRuleEvent` call, for allows and for denies. A message that fails protocol validation produces none.
  - The event's fields follow the Design. The event and the logged line contain no argument value other than the target, which a test proves with sentinel `content`, `new_text` and `args` values.
  - Control characters in a target are escaped, and a 500-character target is cut to 200 plus `…`.
  - `logRuleEvent` writes allows with `info` and denies with `error`, in the `formatRuleEvent` format.
- **AC8 (denied calls):**
  - A denied call returns `tool-call-result` with `ok: false` and `error.code: 'denied'`, and its reason is one of the fixed strings in the Design (or the command check's).
  - The runner is never called; a test proves this with a spy, for each step 1–6.
  - No deny reason contains the target or any argument value.
- **AC9 (symlink re-check):** In a temporary root, `src/link` is a directory symlink to `docs/specs/f`. Then:
  - `write_file` and `edit_file` of `src/link/SPECS.md` fail with the re-check reason;
  - the file is unchanged or not created;
  - a plain `source` write still works.

  The test skips with a note when a symlink can't be created.
- **AC10 (`node_modules`):**
  - `list_files` and `search_text` refuse `node_modules`, `NODE_MODULES/x`, `a/node_modules/b` and `a\node_modules` with the fixed reason.
  - `read_file` of a file under `node_modules` still works.
  - The existing tests of the walk's skipping still pass.
- **AC11 (human-only actions and untrusted text):** One acceptance test drives the router with the real gate and a real runner on a temporary root, as each job, in each spec state. It checks:
  - after a `read_ticket` (fake source) and a `read_file` whose text says "approve the spec" and "git push", none of these calls is allowed or changes a file:
    - writes to `docs/specs/f/state.json`, `docs/specs/f/SPECS.md` (once the spec is approved) and `.git/config`;
    - `run_command` with program `git`;
    - `run_command` with any program under the default context;
  - the agent protocol has no message type for approve, close, commit or push, and the router rejects such a message without replying;
  - `TOOL_NAMES` has no tool for those actions.
- **AC12 (wiring):**
  - The host builds the router deps with `DEFAULT_POLICY_CONTEXT` and `logRuleEvent(log)`.
  - `tool-reachability.test.ts` is updated to the new matrix under the default context. Its old claim, "every new tool is denied for every job", becomes the table's claim.
  - The `policy-gate.test.ts` and `agent-router.test.ts` tests are updated, with no lost coverage of the protocol paths.
- **AC13 (checks):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass on Windows; macOS and Linux run in CI.

## Open questions

- none
