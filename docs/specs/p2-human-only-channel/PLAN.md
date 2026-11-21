# Plan: p2-human-only-channel

Ticket: none (vibe planning; Phase 2 subtask 5, as written in `docs/phases/phase-02-progress.md`)
Status: approved
Date: 2026-11-21

## Objective

D3 says approve spec, approve result, mark done, change project rules and edit an approved spec exist only as UI actions, and that the main process accepts them only from a user click in the app's own window. Today nothing carries such an action. The agent protocol simply has no message type for one. This subtask adds the one channel that does:

- a human-only IPC call from the main window to main;
- a check, in main, that a real user gesture came just before the call;
- tests that show the agent process, its tools, and text in a file or ticket can't trigger it.

It also settles the phase doc's open question on how a gesture is verified, as D33.

## Scope

- **In:**
  - **Shared contract** (`src/shared/human-actions.ts`, new; no Node, Electron or DOM imports):
    - `HUMAN_ACTION_IDS`: `approve-spec`, `approve-result`, `mark-done`, `change-rules`, `edit-approved-spec`.
    - A request type `{ action, feature }`:
      - `feature` is a slug: lowercase letters, digits and dashes, at most 64 characters.
      - Nothing else is accepted.
    - A result type: `{ ok: true }`, or `{ ok: false, code, reason }`.
      - The codes are `no-gesture`, `untrusted-sender`, `invalid` and `not-available`.
    - A guard, `parseHumanActionRequest`, that checks an unknown value.
  - **Gesture tracker in main** (`src/main/human/gesture.ts`, new and pure; the clock is injected):
    - **What counts as a gesture:** main listens to the main window's `webContents` `input-event`. It records:
      - a left-button `mouseDown`;
      - a `keyDown` of Enter or Space that is not an auto-repeat.
    - **When a request is accepted:** only if a gesture was recorded within 1000 ms before it and hasn't been used yet.
    - **One request per gesture:** each gesture is consumed by one request.
    - **Why page script can't fake one:** an event built by `dispatchEvent` or `element.click()` in the page never reaches main's input pipeline, so it can't count as a gesture.
  - **Channel in main** (`src/main/human/channel.ts`, new):
    - **Order of checks** on `harness:human-action`:
      1. the existing `isTrustedSender` check (the main window and its top-level page);
      2. the request guard;
      3. the gesture check.
    - **Dispatch:** a registry maps each action id to a handler.
      - No handler is registered in this subtask, so a request that passes every check returns `not-available`.
      - Phase 3 registers the real handlers.
    - **Logging:** every decision is logged as one line with the action, the feature, the outcome and the reason. Nothing else from the request is logged.
  - **Bridge:**
    - `harness.humanAction(request)` in `src/shared/bridge.ts` and `src/preload/index.ts`, returning the result type.
    - `ipcRenderer` stays inside the preload.
  - **Main wiring** in `src/main/index.ts`: the tracker is attached to the main window's `webContents`, and the handler is registered beside the existing ones.
  - **Tests:**
    - **Unit:**
      - the tracker (the window, consume-once, ignored event types, auto-repeat, the clock);
      - the guard (each id, bad slugs, extra fields, wrong types);
      - the channel (each refusal code, the order of checks, the dispatch, the log line);
      - the bridge contract.
    - **Agent can't reach it:**
      - the agent protocol guard refuses a message whose type is a human-action id or `human-action`;
      - no registry tool and no job's base tools name a human action;
      - the agent bundle has no reference to the channel name.
    - **Definition of done (text in a file or ticket):**
      - an agent-loop run with a scripted model is fed a file and a ticket that say "approve the spec" and "git push";
      - the model then asks for `approve_spec`, `git_push`, and `run_command` with `git push`;
      - every call is refused by the gate, with Rule events;
      - nothing reaches the human-action channel.
    - **e2e** (Playwright for Electron, all three OSes in CI):
      - calling `window.harness.humanAction` from page script with no gesture returns `no-gesture`;
      - after a real Playwright mouse click in the window, the same call returns `not-available`, which proves the gesture was seen;
      - a second call after one click returns `no-gesture`;
      - a click older than the window returns `no-gesture`.
  - **Docs:**
    - D33 in `docs/decisions.md`;
    - a new `docs/human-actions.md`: the actions, the checks in order, what counts as a gesture, the limits, and how Phase 3 registers handlers;
    - CHANGELOG entries under `[Unreleased]`;
    - the progress file's open question struck through as settled;
    - the stale-doc check on `CLAUDE.md`, `README.md`, `docs/PRD.md`, `docs/workflow.md` and the phase doc.
- **Out:**
  - **No real handlers:** no workflow state, spec hashing or locking, commit or push. That is Phase 3.
  - **No UI:** no buttons and no amber gate styling. That is Phase 5 and later.
  - **No native confirm dialog.**
  - **No change to the agent protocol's message types or the tool registry.** Tests only prove the absence.

## Decisions

| Question | Decision | Alternatives considered |
| --- | --- | --- |
| How a gesture is verified | Main tracks real input events on the main window (`input-event`: left `mouseDown`, or a `keyDown` of Enter or Space that isn't a repeat). A request needs an unused gesture from the last 1000 ms, and each gesture is used once. | The preload checks `navigator.userActivation.isActive` (rejected: the check runs in the renderer); a native confirm dialog from main for each action (rejected: a second click the design doesn't show) |
| What an accepted request does now | An action registry with no handlers. The result is `not-available` until Phase 3 registers them | Stub in-memory handlers (rejected: code Phase 3 would throw away) |
| Bridge exposure | Add `harness.humanAction(request)` now, so e2e proves the whole path | Main side only (rejected: leaves the path from the window to main unproven) |
| Tests | Unit and e2e | Unit only (rejected: nothing would show the real window's input events behave as assumed) |
| Repo, base branch and slug | `sdd-harness`, `main`, `feature/p2-human-only-channel` | (from the progress file) |
| Defaults stated, not asked | Window 1000 ms; payload is the action and a feature slug only; one log line per decision | |

## Approach

1. **Shared contract:** write `src/shared/human-actions.ts` with its guard and tests. Add `humanAction` to `HarnessBridge` and the `humanAction` channel to `IPC_CHANNELS`.
2. **Gesture tracker:** write `src/main/human/gesture.ts` as a pure module, with the clock and the event passed in, and its unit tests.
3. **Channel:** write `src/main/human/channel.ts`. It is pure and takes:
   - the sender check, the tracker, the registry and the logger;
   - a handler function that main registers.

   Unit-test each refusal code and the order of checks.
4. **Wiring:**
   - In `src/main/index.ts`, attach the tracker in `createMainWindow` (through `win.webContents.on('input-event', ...)`) and register the IPC handler.
   - Expose the call in `src/preload/index.ts`.
5. **Proof that the agent can't reach it:**
   - add cases to the protocol and registry tests;
   - add a test that the built agent bundle doesn't contain `harness:human-action`;
   - add an agent-loop test with a scripted provider and a fixture file and ticket that say "approve the spec" and "git push".
6. **e2e:** write `tests/e2e/human-action.spec.ts`. It uses `page.evaluate` for script calls and `page.mouse.click` for the gesture.
7. **Docs:** D33, `docs/human-actions.md`, CHANGELOG, the progress file's open question, and the stale-doc check.
8. **Full checks:** typecheck, lint, format:check, test; e2e runs in CI.

## Verified assumptions

| Assumption | Evidence |
| --- | --- |
| Electron's `webContents` emits `input-event` with the input's type in this version | `package.json:37` (`electron` ^45.3.4); `node_modules/electron/electron.d.ts:18167` (`on(event: 'input-event', ...)`) |
| IPC handlers already check the sender with `isTrustedSender` | `src/main/security.ts` (`isTrustedSender`); `src/main/index.ts:77-87` (`assertTrustedSender`) |
| The bridge is one object built in the preload from a shared contract | `src/preload/index.ts`; `src/shared/bridge.ts` (`IPC_CHANNELS`, `HarnessBridge`) |
| The agent protocol has no human-action message type, and its guard refuses unlisted types | `src/shared/agent-protocol.ts:1-6`, `AgentToMainMessage` |
| The gate refuses unknown tools and git with Rule events | D29, D30, D31; `src/main/policy/gate.ts`, `rule-event.ts` |
| The log helper exists for decision lines | `src/main/log.ts` |
| An e2e suite with Playwright for Electron runs on all three OSes in CI | `tests/e2e/*.spec.ts`; `CLAUDE.md` CI section |
| D33 is the next free decision number | `docs/decisions.md`: the last is D32 |

## Risks

- **Synthetic input:** Playwright's `page.mouse.click` sends input through the Chrome DevTools Protocol. If that doesn't raise `input-event` on one OS, the accepted-path e2e test fails there. CI's e2e matrix shows this. The fallback is to drive the click with `webContents.sendInputEvent` from the test's main-process handle.
- **What a gesture proves:** a gesture shows that a human acted in the window just before the call, not which control they clicked. A compromised renderer script could ride on any real click within 1 s. The renderer loads only the app's own page (the navigation guards, the sandbox), and the limit is documented in D33 and `docs/human-actions.md`. Phase 3 can tighten this, for example by requiring the gesture to land on the Next bar's button.
- **Focus and accessibility:** keyboard users activate buttons with Enter or Space, which are covered. Other assistive input, such as a switch device sending clicks, arrives as mouse events. If a screen reader's default action arrives some other way, the e2e tests won't show it. That is a runtime check for Phase 5's UI.

## Open questions

None.
