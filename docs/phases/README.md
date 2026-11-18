# Phase documents

Each file here starts one Claude Code chat session for one phase of the [roadmap](../roadmap.md).

## Running a phase

1. Open a **new** Claude Code chat in this repo with the sdd plugin loaded.
2. Send: `Read docs/phases/phase-NN-<name>.md and follow its instructions.`
3. Claude reads the context, proposes the phase's subtasks (each one sdd feature named `pN-<slug>`), asks you to confirm, and writes `docs/phases/phase-NN-progress.md`.
4. For each subtask:
   1. Type `/sdd:start`, choose "no spec, describe it in chat", and paste the brief Claude gave you.
   2. Answer the planning questions, approve the plan, `/sdd:approve <feature>`, build, approve the result, `/sdd:close`.
   3. Claude updates the progress file and gives you the exact `/compact` command with a focus message. Run it.
   4. Repeat with the next subtask's brief.
5. When every subtask is done, Claude checks the phase's Definition of done, marks the phase done in the roadmap and tells you which phase document to open in a new chat.

## Files

- `phase-NN-<name>.md`: the phase brief and the instructions Claude follows. Written up front; don't change them mid-phase except to fix scope with the user's agreement.
- `phase-NN-progress.md`: created by Claude at the start of a phase; the subtask list, status, commits and follow-ups. This is what lets a session continue after `/compact`.
