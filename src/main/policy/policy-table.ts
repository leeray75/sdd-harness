// The per-job tool table now lives in src/shared/jobs.ts, so the agent and main read one copy
// (D32). This module re-exports it for the gate and tightening, and defines no table of its own.
// A project can only remove names from these sets (see tightening.ts); nothing here is changed
// at run time.

export { BASE_TOOLS } from '../../shared/jobs';
