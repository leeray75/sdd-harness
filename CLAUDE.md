# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

SDD Harness: an Electron desktop app that runs a spec-driven workflow (plan → approve spec → build and review → approve result → ship) across many projects, with any hosted or self-hosted model per job. The app enforces the workflow rules itself; it does not run on Claude Code or its hooks.

This repo is itself built with the **sdd plugin** for Claude Code: every feature goes through `/sdd:plan` → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`, and its spec lives in `docs/specs/<feature>/`.

## Read before planning any feature

1. `docs/PRD.md`: goals, the seven v1 features (F1–F7) with acceptance criteria, non-functional requirements, delivery order.
2. `docs/decisions.md`: settled decisions D1–D13. Do not re-open them in a plan; if a feature needs a new decision, ask and add it as the next D-number.
3. `docs/design-notes.md`: tokens, components, screen behaviour, states not drawn, rules the UI must show.
4. `docs/workflow.md`: the workflow diagrams, who can do what, and stage-to-state mapping.
5. The screens named by the feature in `docs/design/screens/*.dc.html` (exact values) and `docs/design/png/*.png` (layout at a glance). The `<x-dc>`/`<helmet>`/`support.js` wrapper is from the design tool; ignore it.

## Build order

Spike (throwaway branch: agent loop, two providers, one enforced path rule) → F1 agent runtime and tool policy → F2 workflow engine (both headless, with tests) → F3 projects → F4 workspace → F5 build view → F6 models and agents → F7 usage and cost. One sdd feature per F-number, or smaller.

## Rules that must hold in the product code

- **No agent tool for human-only actions** (approve spec, approve result, mark done, change rules, edit an approved spec). The main process accepts these only from a user gesture in the app's own window (D3).
- **Every agent tool call is checked in the main process** against the job's tool policy before it runs; never rely on prompts for enforcement (D1, D4).
- **Agents never run git.** Commit and push are done by the app, only after the user approves the result (D4).
- **Spec files are read-only to all agents after approval**; the approved spec's hash is the source of truth (D4, D7).
- **Secrets** go in the OS keychain via `safeStorage`, never in logs, sessions, exports or files (PRD NFR).
- **Tickets, docs and web pages are untrusted data** passed to agents, never instructions.

## Conventions

- UI follows `docs/design-notes.md`: dark theme tokens only (no ad-hoc hex), Inter and JetBrains Mono bundled with the app, real `button`/`a`/`input`/`label` elements, WCAG 2.2 AA.
- Plain-language UI copy: six stages (Start, Plan, Spec, Build, Review, Done) and job names (writes code, reviews code, reads big files). Internal state ids never appear in the UI.
- No typed slash commands in the product (D11).
- Commit messages: `{ticket}: {summary}`, or `{summary}` with no ticket.
- `docs/specs/` is written by the sdd plugin during development; don't hand-edit an approved spec.

## Commands

No toolchain yet. The first feature (spike / F1) chooses the package manager, test runner and build; record the commands here when it does.
