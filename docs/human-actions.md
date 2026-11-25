# Human-only actions

Five actions can change a feature's state in ways that only a person may decide: approve the spec, approve the result, mark the feature done, change the project's rules and edit an approved spec (D3). No agent tool exists for them. The app runs them only when a person has just used the app's own window. This page is the reference for how that works. The decision and its reasons are in [`decisions.md`](decisions.md#d33--human-only-actions-gesture-check-channel-and-handler-registry) (D33).

## The five actions

| Id                   | What the person does in the UI                              |
| -------------------- | ----------------------------------------------------------- |
| `approve-spec`       | Approves the spec and locks it                              |
| `approve-result`     | Approves the build's result, so the app may commit and push |
| `mark-done`          | Marks the feature done                                      |
| `change-rules`       | Changes the project's rules                                 |
| `edit-approved-spec` | Allows an edit to an approved spec                          |

The ids are in `HUMAN_ACTION_IDS` in `src/shared/human-actions.ts`. The table above is the plain-language meaning; the UI copy belongs to Phase 3 and later.

**Status:** `approve-spec` and `edit-approved-spec` have handlers from `p3-spec-lock` (D36). They are registered when a project root exists (`HARNESS_SPIKE_ROOT`). Without a root, every request that passes the checks is answered `not-available`. `edit-approved-spec` also asks the feature's build controller before it records the edit (D37): the edit is refused once a build has started. `approve-result` and `mark-done` have handlers from `p3-ship` (D38), registered in the same place and under the same rule. They are described in [The ship handlers](#the-ship-handlers). `change-rules` has no handler and is not scheduled.

## The request and the result

The renderer calls `window.harness.humanAction(request)`. The request is a plain object with exactly two fields:

- `action`: one of the five ids above;
- `feature`: a feature slug, which is lowercase letters and digits joined by single dashes, at most 64 characters (for example `p2-human-only-channel`).

Nothing else is accepted: no extra field, no path, no free text. The result is either `{ ok: true }` or `{ ok: false, code, reason }`, where `code` is one of the five refusal codes below. A `reason` is fixed text and never repeats a value from the request.

The contract is in `src/shared/human-actions.ts`. Its guard, `parseHumanActionRequest`, is the only place a request is read.

## The checks, in order

Main runs these in `handle()` in `src/main/human/channel.ts`, on the channel `harness:human-action`. Each check stops the call at its first refusal.

1. **Sender.** The call must come from the app's own window and its top-level page. This is the same `isTrustedSender` check the window calls use (`src/main/security.ts`). A call from anywhere else is refused as `untrusted-sender`, and its request is not read.
2. **Request.** The guard checks the request. A refused request is `invalid`, with the guard's reason.
3. **Gesture.** Main must have recorded a gesture in the last 1000 ms, and it must be unused. Otherwise the call is `no-gesture`. A call that reaches this step uses the gesture, whatever the result of the later steps.
4. **Registry.** If no handler is registered for the action, the call is `not-available`.
5. **Handler.** The handler runs with the checked request, and its result is returned. If it throws, the caller gets `not-available` with the reason `the action failed`. The error is logged by its name only.

Checks 1 and 2 do not touch the gesture, so an outside or malformed call cannot use up a real click.

## What counts as a gesture

Main records real input from the app's main window (`input-event` on its `webContents`). Page script cannot produce these events: a `dispatchEvent` or `element.click()` in the page never enters the window's input pipeline.

| Input                                                             | Counts?                          |
| ----------------------------------------------------------------- | -------------------------------- |
| Left-button `mouseDown`                                           | Yes                              |
| `keyDown` of Enter                                                | Yes, unless it is an auto-repeat |
| `keyDown` of Space (`' '`)                                        | Yes, unless it is an auto-repeat |
| Right or middle `mouseDown`, `mouseUp`, `mouseMove`, `mouseWheel` | No                               |
| `keyUp`, `char`, any other key, an unknown type                   | No                               |

A gesture stays usable for `GESTURE_WINDOW_MS` (1000 ms, in `src/main/human/gesture.ts`). Each gesture is used by one call. A later gesture replaces an unused one.

## Refusal codes

| Code               | Meaning                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `untrusted-sender` | The call did not come from the app's own window and page.                                                                                                   |
| `invalid`          | The request failed the guard. The reason says which rule it broke, without the value.                                                                       |
| `no-gesture`       | No unused gesture from the last second.                                                                                                                     |
| `not-available`    | The request passed every check, but no handler is registered, or the handler failed.                                                                        |
| `refused`          | A registered handler declined the request. The reason is that handler's fixed text, for example that SPECS.md lacks a heading. The request changed no file. |

## Logging

Every call writes exactly one decision line through the app's log (`src/main/log.ts`). A refused call writes to stderr, and an accepted one to stdout.

```
human action approve-spec: refused (no-gesture) feature=p2-human-only-channel
human action approve-spec: refused (not-available) feature=demo
human action approve-spec: refused (refused) feature=demo
human action invalid: refused (invalid)
human action invalid: refused (untrusted-sender)
human action approve-spec: accepted (ok) feature=demo
```

The line holds the action, the outcome, the code and, for a request that passed the guard, the feature. Nothing else from the request is logged, and no refused request's raw value is ever logged. If a handler throws, one extra line names the error (`handler threw (TypeError)`) and the error's message is not logged.

## How a handler is registered

The channel is created in `src/main/index.ts`. `startSpecLock` registers the two spec handlers on it (D36) and the two ship handlers (D38), and `register` throws if the action already has one.

```ts
humanActions.register('approve-spec', async (request) => {
  // Check the workflow state, hash the spec and lock it, then return the result.
  return { ok: true };
});
```

A handler gets the checked `{ action, feature }` request only. It must not read anything else from the renderer. A handler that refuses returns `{ ok: false, code, reason }` with one of the codes above. The ship handlers call the ship steps, which run git only through `src/main/git/git.ts` (D38). No agent tool reaches them.

## The ship handlers

Both run only on the channel, after its sender, guard and gesture checks, and they never throw. Each refusal is `code: 'refused'` with a fixed reason. After every call the lock is refreshed, whether the call succeeded or not.

- **`approve-result`** commits the feature's approved work and pushes its branch. It is legal only at build-done, with the spec approved, on a feature branch, with the build controller not running and SUMMARY holding a Git state line. Only the changed paths of the feature's allowed set are committed. A push that fails keeps the commit, and approving again only pushes.
- **`mark-done`** closes the feature. It is legal once the approved work is pushed. It sets SPECS.md's status to `done`, removes the state file when it names the feature, and commits `Close <feature> spec` with those two paths. A push that fails keeps the close commit, and marking done again only pushes.

The reasons are fixed texts such as "the build is not done", "the spec is not approved", "HEAD is detached", "the work is on the default branch", "the tree has changes that are not part of this feature", "approve the result first" and "push the approved work first". The full list is `SHIP_REASONS` in `src/main/workflow/ship.ts`. A reason never names a path, a branch, a commit message or git's output.

## Limits

## Limits

- **A gesture is not a choice of control.** It proves that a person acted in the app's window in the second before the call. It does not prove which button or key they used. A script in the page could ride on a real click made within that second. The renderer loads only the app's own page under the navigation guards and the sandbox, which keeps page script to that page. Phase 3 can narrow the check, for example by requiring the gesture to land on the Next bar's button.
- **Assistive input.** A screen reader or a switch device that sends its activation another way may not produce a gesture. Keyboard users who activate a control with Enter or Space and mouse users are covered. The UI in Phase 5 needs a runtime check for the rest.
- **No agent route.** The agent process cannot reach the channel: its protocol refuses such a message, no tool or job table names an action, and its source does not import the bridge or name the channel. These are checked by tests, not by the agent's own rules.
- **Only in the app.** Refusals and decisions are logged, but they are not Rule events, because a human action is not a tool call (D30).
