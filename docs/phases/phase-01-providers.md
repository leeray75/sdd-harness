# Phase 1: Agent loop spike and provider adapters

> **How to use this document.** Start a **new** Claude Code chat in the `sdd-harness` repo with the sdd plugin loaded, and send:
>
> `Read docs/phases/phase-01-providers.md and follow its instructions.`
>
> Claude will propose the subtasks, write a progress file, and tell you when to type `/sdd:start` and what to paste. Between subtasks, run the `/compact` command Claude gives you; the progress file keeps your place.

## Goal

Prove the agent loop end to end, then build the provider layer: one interface, an Anthropic adapter and an OpenAI-compatible adapter that covers vLLM, LM Studio, llama.cpp, TGI/SGLang, Ollama (`/v1`), LiteLLM and agentgateway.

**Before this phase:** Phases 0–0 are done (check `docs/roadmap.md` and their progress files).

## Inputs

- **PRD:** `docs/PRD.md`: F6 (backend parts), Risks (agent runtime, open-weight tool use)
- **Decisions:** `docs/decisions.md`: D1, D2, D13, plus the Secrets row of the NFRs
- **Design:** `docs/design/screens/Models2Add.dc.html` (presets and fields) and `Models3Test.dc.html` (what probes report)
- **Workflow:** `docs/workflow.md`

## In scope

- A minimal agent loop in the agent process: one model, streaming, one read-only tool round trip
- A provider interface: messages, tool calls, streaming, token usage, errors and retries
- Anthropic Messages adapter
- OpenAI-compatible adapter with base URL, optional key, custom headers and presets for each server type
- Model listing (`/models`) and two probes: chat, and tool use
- API keys in the OS keychain via safeStorage, never logged

## Out of scope

- Edit-and-run probe (needs the tools from phase 2; comes in phase 8)
- Any settings UI (phase 8)
- Cloud platforms (Bedrock, Azure, Vertex)

## Decide during planning

- Write the loop yourself or adopt a multi-provider agent library (PRD risk table); record as a D-number
- How CI tests adapters without live keys (recommend recorded fixtures plus an optional live suite)

## Suggested subtasks

A starting point. Claude adjusts it in step 2 and you confirm.

| # | Feature | Delivers |
| --- | --- | --- |
| 1 | `p1-spike-agent-loop` | Smallest working loop against one provider with one read-only tool and streaming; may be rewritten later, but kept tested |
| 2 | `p1-provider-interface` | Provider interface and the Anthropic adapter, with streaming and usage |
| 3 | `p1-openai-compatible` | OpenAI-compatible adapter, presets for every server type in D13, custom headers |
| 4 | `p1-model-probes` | `/models` listing, chat probe and tool-use probe, with results a UI can show later |
| 5 | `p1-secrets` | Keychain storage for keys, redaction in logs and errors, tests that keys never appear in output |

## Definition of done

- [ ] The same loop runs against Anthropic and an OpenAI-compatible server (fixture tests in CI)
- [ ] Probes report chat and tool use per model
- [ ] No key appears in logs, errors or test output

## Instructions for Claude (follow these in order)

You are running **Phase 1** of SDD Harness in this chat. The phase is split into subtasks; each subtask is one sdd plugin cycle (`/sdd:start` → plan → `/sdd:approve` → `/sdd:build` → result approval → `/sdd:close`), and the user runs `/compact` between subtasks. The progress file is the memory that survives `/compact`.

1. **Orient.** Read `CLAUDE.md`, `docs/roadmap.md`, `docs/decisions.md`, the PRD sections and design files listed under Inputs, and `git log --oneline -20`. If `docs/phases/phase-01-progress.md` exists, read it and **resume** from its next pending subtask (skip step 2).
2. **Propose the subtasks.** Start from "Suggested subtasks" below and adjust them to the code as it stands. Rules:
   - one subtask = one sdd feature, named `p1-<slug>` (lowercase letters, digits and dashes);
   - each is small enough for one build: about 3–8 tasks, testable and committable on its own;
   - ordered by dependency; together they meet the phase "Definition of done";
   - nothing outside this phase's scope.
   Before asking, explain in one or two sentences what is being decided. Then ask the user to confirm or change the list, with choices (recommended first). Also raise any item under "Decide during planning" that the first subtask needs.
3. **Write the progress file** `docs/phases/phase-01-progress.md` from the template at the end of this document (files under `docs/` are editable without a spec). Commit it on its own with message `docs: phase 1 plan`.
4. **Hand off the first pending subtask.** End your reply with a **Next step** block:
   1. Type `/sdd:start` (in its own code block).
   2. When asked, choose that no spec exists and that you will describe it in chat.
   3. Paste the subtask brief, which you give in a fenced block with: feature name, goal, in scope, out of scope, files and docs to read, acceptance criteria (from the PRD where they exist).
5. **During the cycle** follow the sdd plugin exactly. Never write product code outside an approved spec. If planning needs a new decision, ask the user and add it to `docs/decisions.md` as the next D-number.
6. **After `/sdd:close`:** make sure the next subtask will start from this work. The sdd cycle commits and pushes a feature branch; ask the user, with choices, how to bring it into `main` (recommended: open a pull request and merge it; or merge locally with `git merge --ff-only` if there is no remote yet), and confirm `main` is up to date before handing off the next subtask. Then update the progress file (status `done`, commit hash, link to `docs/specs/<feature>/SUMMARY.md`, follow-ups, decisions added) and commit it with `docs: phase 1 progress`. Then give a **Next step** block with:
   1. the exact `/compact` command and focus message, in its own code block:
      `/compact Continue Phase 1. Read docs/phases/phase-01-providers.md and docs/phases/phase-01-progress.md; next subtask is <name>.`
   2. `/sdd:start` and the next subtask brief, as in step 4.
7. **Phase complete:** when every subtask is done, check the Definition of done item by item and report any gap as a new subtask. When all items hold: mark the phase done in `docs/roadmap.md`, add a short phase summary to the progress file, commit both, and tell the user to start a new chat with `docs/phases/phase-02-tool-policy.md`.

## Progress file template

```markdown
# Phase 1 progress: Agent loop spike and provider adapters

Status: in progress · Started: <date>

| # | Feature | Goal | Status | Spec | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | p1-... | ... | pending | | |

## Decisions added
- (none yet)

## Follow-ups
- (none yet)

## Phase summary
(written when the phase is done)
```
