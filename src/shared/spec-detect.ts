// The sdd folder detector, shared part (p3-spec-docs, D35): maps one feature folder's facts and its
// approval to a workflow node and its stage (src/shared/workflow.ts). It follows the precedence of
// the plugin's hooks/detect.ts (v0.18.0), without the session-marker and the seen-subagent inputs,
// which the harness does not have (D35). Pure: it imports only from ./workflow, and no Node,
// Electron or DOM API. docs/workflow-engine.md ("Detecting a folder's node") is the reference.

import { type PathId, type StageView, stageOf } from './workflow';

/** The approval state of a feature: `none` with no lock, else approved, changed, or unchecked. */
export type Approval = 'none' | 'approved' | 'changed' | 'unchecked';

/** The build's step a ledger's `phase:` line names: implementing, reviewing, or '' when none. */
export type Phase = 'implementing' | 'reviewing' | '';

/** Which of the folder's decisive files exist. */
export interface FolderFiles {
  plan: boolean;
  specs: boolean;
  summary: boolean;
}

/** The facts of one folder that the detector reads. */
export interface DetectInput {
  approval: Approval;
  files: FolderFiles;
  /** PLAN.md's Status value, '' when absent. */
  planStatus: string;
  /** build-ledger.md's state word, '' when absent. */
  ledgerState: string;
  /** The ledger's current round, null when absent. */
  currentRound: number | null;
  /** The ledger's phase, '' when absent or not a step. */
  phase: Phase;
}

/** Where a running build's node came from: its `phase:` line, or the ledger's fallback. */
export type DetectionSource = 'phase' | 'ledger' | null;

export interface FolderDetection {
  node: PathId;
  stage: StageView;
  /** The ledger's current round while implementing or reviewing, null otherwise. */
  round: number | null;
  /** Null unless the build is running. */
  source: DetectionSource;
}

/**
 * Detects a folder's node. The precedence (the plugin's, v0.18.0):
 * 1. `changed` is spec-changed, whatever the ledger says.
 * 2. `none`: SUMMARY.md is closed; else SPECS.md is spec-drafted; else PLAN.md with Status
 *    `approved` is plan-approved; else PLAN.md is planning; else idle. The ledger is ignored.
 * 3. `approved` or `unchecked`: ledger `paused-for-revision` is paused; ledger `done`, or SUMMARY.md
 *    with a ledger not in `running`, is build-done; a ledger in `running` is the `phase:` step
 *    (source phase), or implementing when the phase is empty (source ledger); else spec-approved.
 */
export function detectFolder(input: DetectInput): FolderDetection {
  if (input.approval === 'changed') return result('spec-changed', input, null);
  if (input.approval === 'none') return result(unlockedNode(input), input, null);
  if (input.ledgerState === 'paused-for-revision') return result('paused', input, null);
  if (input.ledgerState === 'done' || (input.files.summary && input.ledgerState !== 'running')) {
    return result('build-done', input, null);
  }
  if (input.ledgerState === 'running') {
    if (input.phase !== '') return result(input.phase, input, 'phase');
    return result('implementing', input, 'ledger');
  }
  return result('spec-approved', input, null);
}

// unlockedNode: the node of a folder with no approval lock held.
function unlockedNode(input: DetectInput): PathId {
  if (input.files.summary) return 'closed';
  if (input.files.specs) return 'spec-drafted';
  if (input.files.plan && input.planStatus === 'approved') return 'plan-approved';
  if (input.files.plan) return 'planning';
  return 'idle';
}

// result: the detection for a node. The round is set only while the build is implementing or
// reviewing.
function result(node: PathId, input: DetectInput, source: DetectionSource): FolderDetection {
  const building = node === 'implementing' || node === 'reviewing';
  return {
    node,
    stage: stageOf(node),
    round: building ? input.currentRound : null,
    source,
  };
}
