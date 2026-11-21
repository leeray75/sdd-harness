# Human-only action channel with a gesture check (p2-human-only-channel)

**Parent:** none (no parent chosen)
**Spec:** docs/specs/p2-human-only-channel/SPECS.md
**Repo and base branch:** sdd-harness, `main`, feature branch `feature/p2-human-only-channel`

## Context

D3 says approve spec, approve result, mark done, change rules and edit an approved spec are UI-only actions. Main accepts them only from a user click in the app's own window. No channel carries them yet, and nothing verifies a gesture. This subtask adds:

- the shared request and result contract;
- a gesture tracker in main fed by the main window's own input events (a left mouse press, or Enter or Space; each gesture counts for 1000 ms and is used once);
- the `harness:human-action` channel, which checks the sender, then the request, then the gesture, and dispatches to a handler registry that Phase 3 fills;
- the bridge call;
- tests that the agent process, its tools, and text in a file or ticket can't reach it.

It settles the phase's open question as D33.

## Required work

- T1 Shared contract
- T2 Gesture tracker
- T3 Channel
- T4 Bridge and wiring
- T5 The agent can't reach it
- T6 e2e
- T7 Docs
- T8 Full checks

## Acceptance criteria

The full wording of each criterion is in the spec.

- AC1: `src/shared/human-actions.ts`: five action ids, request and result types, a guard (exact keys, slug rules, no echoed values).
- AC2: a pure gesture tracker: left `mouseDown`, or Enter or Space without repeat; a 1000 ms window; used once.
- AC3: a pure channel: checks the sender, then the request, then the gesture; the registry; `not-available` with no handler; one log line per call.
- AC4: the `harness:human-action` IPC channel, the `harness.humanAction` bridge member, main wiring with no handlers.
- AC5: the protocol guard refuses human-action types; no tool names a human action; no `src/agent/` file references the channel or bridge.
- AC6: a file and a ticket saying "approve the spec" and "git push" lead only to refused, Rule-logged tool calls; no handler is called.
- AC7: e2e: a scripted call gets `no-gesture`; after a real click or Enter, `not-available`; one call per gesture; a stale click is refused.
- AC8: D33, `docs/human-actions.md`, CHANGELOG, the progress file's open question, the stale-doc check.
- AC9: typecheck, lint, format:check and test pass; CI green on every job on the PR.

## Out of scope

- Real handlers, workflow state, spec locking, commit and push (Phase 3).
- Any UI; a native confirm dialog.
- Changes to the agent protocol's message types, the tool registry, the jobs table or the gate.

## Links

- Plan: docs/specs/p2-human-only-channel/PLAN.md
- Spec and tasks: docs/specs/p2-human-only-channel/SPECS.md, docs/specs/p2-human-only-channel/tasks.md
