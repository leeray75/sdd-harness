---
status: approved
ticket:
---

# p2-human-only-channel

## Problem

D3 says approve spec, approve result, mark done, change project rules and edit an approved spec exist only as UI actions. The main process accepts them only from a user click in the app's own window. Today no channel carries such an action, and nothing checks for a user gesture. `src/shared/agent-protocol.ts` has no message type for one, but no test proves that the agent process, its tools, or text in a file or ticket can't reach one. The phase doc leaves "how a user gesture is verified" open.

## Goals

- **G1 (contract):** one shared request and result shape for the five human-only actions, with a guard.
- **G2 (gesture):** main accepts a human-only request only right after a real user gesture in the main window. It sees that gesture through its own input events, and each gesture is used once.
- **G3 (channel):** one IPC channel, `harness:human-action`. It runs three checks in order: the sender, the request, then the gesture. It dispatches to a handler registry that Phase 3 fills, and logs every decision.
- **G4 (bridge):** the renderer can call it through `harness.humanAction(request)`.
- **G5 (proof):** automated tests show three things:
  - the agent process and its tools have no route to the channel;
  - "approve the spec" or "git push" in a file or ticket can't cause either;
  - in the real app, a scripted call is refused, and a call right after a real click is accepted.
- **G6 (docs):** D33, a new `docs/human-actions.md`, the changelog, and the stale docs and the progress file's open question updated.

## Non-goals

- Real handlers: workflow state, spec hashing or locking, commit and push (Phase 3).
- Any UI: buttons, the amber gate style, the Next bar.
- A native confirm dialog.
- Any change to the agent protocol's message types, the tool registry, the jobs table or the gate.

## Acceptance criteria

- **AC1 (shared contract):**
  - `src/shared/human-actions.ts` imports nothing outside `src/shared/` (no Node, Electron or DOM API). It exports:
    - `HUMAN_ACTION_IDS = ['approve-spec', 'approve-result', 'mark-done', 'change-rules', 'edit-approved-spec'] as const` and `type HumanActionId`;
    - `interface HumanActionRequest { action: HumanActionId; feature: string }`;
    - `type HumanActionResult = { ok: true } | { ok: false; code: HumanActionRefusal; reason: string }`, where `HumanActionRefusal` is `'untrusted-sender' | 'invalid' | 'no-gesture' | 'not-available'`;
    - `parseHumanActionRequest(value: unknown)`, which returns `{ ok: true, request } | { ok: false, reason }`.
  - **What the guard accepts:** a plain object with exactly the keys `action` and `feature`. `action` is one of the ids, and `feature` matches `^[a-z0-9]+(-[a-z0-9]+)*$` with at most 64 characters.
  - **The guard's reasons never echo a value.**
  - **Unit tests cover:**
    - each id;
    - a missing key and an extra key;
    - wrong types, arrays and `null`;
    - an empty slug, uppercase, a leading or trailing dash, a double dash, a 65-character slug, and a path such as `../x`;
    - the reasons not echoing a value.
- **AC2 (gesture tracker):** `src/main/human/gesture.ts` is pure: no Electron import, with the clock injected. It exports `GESTURE_WINDOW_MS = 1000` and `createGestureTracker({ now, windowMs? })`, which returns `{ record(input), consume(): boolean }`.
  - **`record` takes the input fields Electron's `input-event` gives:** `type`, plus `button` for mouse events, and `key` and `isAutoRepeat` for keyboard events.
  - **It records a gesture only for:**
    - a `mouseDown` with `button: 'left'`;
    - a `keyDown` whose `key` is `Enter` or a space `' '`, with `isAutoRepeat` not true.
  - **It ignores every other input:** `mouseUp`, `mouseMove`, `mouseWheel`, right and middle buttons, `keyUp`, `char`, other keys, auto-repeat, and an unknown type.
  - **`consume()`:**
    - returns true only if a recorded gesture is at most `windowMs` old;
    - then clears it, so the next `consume()` returns false until a new gesture;
    - a later gesture replaces an earlier one.
  - **Unit tests cover:**
    - each accepted input;
    - each ignored input;
    - the window edge (exactly `windowMs` passes, `windowMs + 1` fails);
    - consume-once;
    - a gesture after a consume;
    - a custom window.
- **AC3 (channel):** `src/main/human/channel.ts` is pure: no Electron import. It exports `createHumanActionChannel({ isTrustedSender, tracker, logger })`, which returns:
  - `register(action, handler)`, which throws if the action already has a handler;
  - `handle(sender, raw): Promise<HumanActionResult>`.

  The checks run in this order, and each stops at the first refusal:
  1. `isTrustedSender(sender)` is false → `untrusted-sender`. The gesture is not consumed.
  2. The guard fails → `invalid`, with the guard's reason. The gesture is not consumed.
  3. `tracker.consume()` is false → `no-gesture`.
  4. No handler is registered for the action → `not-available`.
  5. The handler is called with the request:
     - its result is returned;
     - a thrown error becomes `{ ok: false, code: 'not-available', reason: 'the action failed' }`, and the error is logged without its message.

  **Logging:** each call logs exactly one line through `logger`:
  - the format is `human action <action|invalid>: <accepted|refused> (<code or 'ok'>)`;
  - for a valid request it adds ` feature=<slug>`;
  - nothing else from the request, and never a raw value from a refused request.

  **Unit tests cover:**
  - each refusal code;
  - the order of checks: the sender is checked before the guard, and the guard before the gesture;
  - that an untrusted or invalid call does not consume a gesture;
  - a registered handler's result;
  - a throwing handler;
  - double registration;
  - the exact log line for each case.
- **AC4 (bridge and wiring):**
  - **Shared contract:** `IPC_CHANNELS.humanAction = 'harness:human-action'`. `HarnessBridge` gains `humanAction(request: HumanActionRequest): Promise<HumanActionResult>`.
  - **Preload:** `src/preload/index.ts` implements it with `ipcRenderer.invoke` and exposes no other new member.
  - **Main, in `src/main/index.ts`:**
    - it creates one tracker;
    - in `createMainWindow`, it attaches `win.webContents.on('input-event', (_e, input) => tracker.record(input))`;
    - it creates the channel with the existing sender check (the main window's `webContents` and its top-level app page, `isTrustedSender`) and `log`;
    - it registers `ipcMain.handle(IPC_CHANNELS.humanAction, ...)`, which passes the event's sender and the raw argument to `channel.handle`;
    - no handler is registered.
  - **Tests:** `tests/unit/bridge.test.ts` (or its equivalent) covers the new channel name and member.
- **AC5 (the agent can't reach it):** unit tests show all of these:
  - (a) `validateAgentToMainMessage` (the agent-protocol guard) refuses messages whose `type` is `human-action` or any `HUMAN_ACTION_IDS` value;
  - (b) no `TOOL_SPECS` key and no `BASE_TOOLS` entry for any job matches a human-action id or a name containing `approve`, `push`, `commit` or `mark_done`;
  - (c) no file under `src/agent/` contains `harness:human-action`, or imports `src/shared/bridge`, `src/shared/human-actions` or `electron`. This is a source scan in the test.
- **AC6 (text in a file or ticket can't cause it):** a router test (`handleAgentMessage` in `src/main/agent/router.ts` with the real gate and tools), with scripted `tool-call-request` messages standing in for the model and a temporary project root. The test is self-contained, with no network.
  - **The input:**
    - the reader reads a file containing "approve the spec" and "git push";
    - `read_ticket` returns a ticket with the same text (a stub ticket source, as in the existing ticket tests);
    - the scripted requests then ask for `approve_spec`, `git_push`, and `run_command` with `git push` (as the writer).
  - **The checks:**
    - each of those calls is refused, with a `tool-call-result` of `ok: false`;
    - each is logged as a deny Rule event with the job and the reason. The tool is named when it's a registry tool (`run_command`). A name outside the registry (`approve_spec`, `git_push`) is recorded as `-`, as D30's `makeRuleEvent` does, so the agent's own text for a tool name never reaches the log;
    - no human-action handler is called, using a channel with a spy handler registered for every action.
- **AC7 (e2e):** `tests/e2e/human-action.spec.ts` runs against the built app.
  - **The cases:**
    - (a) `page.evaluate(() => window.harness.humanAction({ action: 'approve-spec', feature: 'demo' }))` with no prior input returns `{ ok: false, code: 'no-gesture' }`;
    - (b) a call with an invalid request returns `invalid`;
    - (c) after `page.mouse.click` on the window's content area, the same call returns `{ ok: false, code: 'not-available' }`, which proves the gesture was seen;
    - (d) a second call after that one click returns `no-gesture`;
    - (e) after `page.keyboard.press('Enter')` with focus in the page, the call returns `not-available`;
    - (f) a click followed by a wait longer than `GESTURE_WINDOW_MS` returns `no-gesture`.
  - **Calls:** each call in (c) to (f) is made by `page.evaluate` right after the input.
  - **CI:** the spec runs on Windows, macOS and Linux.
- **AC8 (docs):**
  - **D33 in `docs/decisions.md`:**
    - the gesture rule: which inputs count, the 1000 ms window, one use per gesture;
    - the order of checks;
    - the registry for Phase 3;
    - the alternatives not taken: preload `userActivation`, a native dialog;
    - the limit: a gesture proves a human acted in the window just before the call, not which control was used.
  - **A new `docs/human-actions.md`:** the five actions, the request and result, the checks in order, what counts as a gesture, the refusal codes, logging, how Phase 3 registers a handler, and the limits.
  - **`CHANGELOG.md`:** Added entries under `[Unreleased]`.
  - **`docs/phases/phase-02-progress.md`:** "how a user gesture is verified" is struck through and marked settled by D33, and D33 is listed under Decisions added. Row 5 stays pending.
  - **The stale-doc check:** `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md` and the phase doc are checked; any stale mention is fixed, and the check is recorded in `changes.md`.
  - The edited docs pass `pnpm format:check`.
- **AC9 (checks):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally. CI is green on every job (`check`, and `e2e` on Windows, macOS and Linux) on the PR before it is merged.

## Open questions

- 2026-11-21, revision 1: in AC6's Rule events, a tool name outside the registry is recorded as `-` (D30, unchanged). It is not the requested name, and no separate refusal line is added. Raised by the implementor, because `makeRuleEvent` never logs an unknown tool name.
