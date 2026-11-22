// The inputs the gate needs besides the request: the feature open in the project, the spec
// state, the project's tightening, and the command check. The caller builds this; the gate
// only reads it. Pure: no Electron or file-system imports.

import type { JobId } from '../../shared/agent-protocol';
import type { Approval } from '../../shared/spec-detect';
import { FEATURE_SLUG_PATTERN, MAX_FEATURE_LENGTH } from '../../shared/human-actions';
import type { Tightening } from './tightening';

/**
 * The spec state as the gate sees it (D36). `none`: no feature is locked. `draft`: the locked
 * spec was edited since its approval. `approved`: the locked spec is unchanged. `locked`: the
 * approval can't be checked (the state file or the spec can't be read), so nothing is written.
 */
export type SpecState = 'none' | 'draft' | 'approved' | 'locked';

/** The live values the gate reads per call: the feature open and its spec state. */
export interface LiveSpec {
  feature: string | null;
  spec: SpecState;
}

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
  /** Feature slug. Anything not matching the shared slug rules is treated as null. */
  feature: string | null;
  spec: SpecState;
  tightening: Tightening;
  commandCheck: CommandCheck;
}

/** The spec state for an approval value: approved, changed (draft), unchecked (locked) or none. */
export function specStateOf(approval: Approval): SpecState {
  switch (approval) {
    case 'approved':
      return 'approved';
    case 'changed':
      return 'draft';
    case 'unchecked':
      return 'locked';
    case 'none':
      return 'none';
  }
}

/** The feature slug to use, or null when none is open or the value is not a valid slug. */
export function effectiveFeature(feature: string | null): string | null {
  if (
    feature === null ||
    feature.length > MAX_FEATURE_LENGTH ||
    !FEATURE_SLUG_PATTERN.test(feature)
  ) {
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
