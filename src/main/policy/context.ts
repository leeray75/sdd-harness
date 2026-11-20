// The inputs the gate needs besides the request: the feature open in the project, the spec
// state, the project's tightening, and the command check. The caller builds this; the gate
// only reads it. Pure: no Electron or file-system imports.

import type { JobId } from '../../shared/agent-protocol';
import type { Tightening } from './tightening';

/** The spec state as the gate sees it. Real workflow states arrive in Phase 3. */
export type SpecState = 'none' | 'draft' | 'approved';

/** One command request as the command check receives it. */
export interface CommandCall {
  job: JobId;
  program: string;
  args: readonly string[];
  cwd?: string;
}

/** Decides whether a command may run. A denial carries the reason shown to the agent. */
export type CommandCheck = (
  call: CommandCall,
) => { allow: true } | { allow: false; reason: string };

export interface PolicyContext {
  /** Feature slug. Anything not matching FEATURE_SLUG_PATTERN is treated as null. */
  feature: string | null;
  spec: SpecState;
  tightening: Tightening;
  commandCheck: CommandCheck;
}

const FEATURE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The feature slug to use, or null when none is open or the value is not a valid slug. */
export function effectiveFeature(feature: string | null): string | null {
  if (feature === null || !FEATURE_SLUG_PATTERN.test(feature)) {
    return null;
  }
  return feature;
}

const NO_COMMAND_ALLOWLIST = 'commands are not allowed yet: no allowlist is configured';

/** The command check used until an allowlist exists: every command is denied. */
export const denyAllCommands: CommandCheck = () => ({
  allow: false,
  reason: NO_COMMAND_ALLOWLIST,
});

export const DEFAULT_POLICY_CONTEXT: PolicyContext = {
  feature: null,
  spec: 'none',
  tightening: { remove: {} },
  commandCheck: denyAllCommands,
};
