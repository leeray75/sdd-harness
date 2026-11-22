// The two spec-lock handlers of the human-only channel (p3-spec-lock, D36): approve-spec and
// edit-approved-spec. They run only through the channel's checks (D33, src/main/human/channel.ts),
// and they never throw: a refusal is returned with a fixed reason, and an unexpected error becomes
// a refusal too. They run no command and no git. Each one writes only the approved SPECS.md's
// frontmatter status and the state file, through temp files and renames.

import type { HumanActionRequest, HumanActionResult } from '../../shared/human-actions';
import {
  SPEC_STATE_VERSION,
  approvalFor,
  hasRequiredHeadings,
  setFrontmatterStatus,
  type SpecStateFile,
} from '../../shared/spec-state';
import { MAX_SPEC_FILE_BYTES } from '../workflow/spec-folders';
import {
  featureFilePath,
  hashSpec,
  hashText,
  lockForApproval,
  readRegularText,
  readSpecState,
  writeAtomic,
  writeSpecState,
} from '../workflow/spec-lock';
import type { HumanActionHandler } from './channel';

export interface SpecHandlersDeps {
  /** The project root. The spec and the state file are read and written under it. */
  root: string;
  /** The clock for approvedAt. */
  now: () => Date;
  /** Called after a successful change, so the watcher re-reads the lock. Errors are ignored. */
  onLockChanged: () => unknown;
}

export interface SpecHandlers {
  'approve-spec': HumanActionHandler;
  'edit-approved-spec': HumanActionHandler;
}

// The fixed refusal reasons. None of them echoes a value from the request or the files.
const SPEC_UNREADABLE = 'SPECS.md is missing, unreadable or too large';
const SPEC_HEADINGS = 'SPECS.md needs a Goals heading and an Acceptance criteria heading';
const ALREADY_APPROVED = 'this spec is already approved and has not changed';
const SPEC_WRITE_FAILED = 'SPECS.md could not be written, so nothing was approved';
const STATE_WRITE_FAILED = 'the approval could not be saved, so SPECS.md was put back';
const STATE_UNREADABLE = 'the approval state could not be read';
const NO_LOCK = 'no spec is approved, so there is nothing to edit';
const OTHER_FEATURE = 'the approved spec is for another feature';
const NOT_APPROVED = 'this spec is not approved, so it cannot be edited';
const EDIT_WRITE_FAILED = 'the edit could not be recorded';
const ACTION_FAILED = 'the action failed';

function refuse(reason: string): HumanActionResult {
  return { ok: false, code: 'refused', reason };
}

/**
 * Builds the two handlers. The channel registers them by action. Each handler takes the checked
 * request only, and reads the feature from it.
 */
export function createSpecHandlers(deps: SpecHandlersDeps): SpecHandlers {
  const { root } = deps;

  async function notify(): Promise<void> {
    try {
      await deps.onLockChanged();
    } catch {
      // The watcher catches up on its next event.
    }
  }

  async function approve(request: HumanActionRequest): Promise<HumanActionResult> {
    const { feature } = request;
    const path = await featureFilePath(root, feature, 'SPECS.md');
    if (path === null) return refuse(SPEC_UNREADABLE);
    const read = await readRegularText(path, MAX_SPEC_FILE_BYTES);
    if (!read.ok) return refuse(SPEC_UNREADABLE);
    if (!hasRequiredHeadings(read.text)) return refuse(SPEC_HEADINGS);

    const lock = lockForApproval(await readSpecState(root));
    if (approvalFor(lock, feature, hashText(read.text)) === 'approved') {
      return refuse(ALREADY_APPROVED);
    }

    // The time is read before SPECS.md changes, so a failing clock cannot leave a spec half-approved.
    const approvedAt = deps.now().toISOString();
    const approvedText = setFrontmatterStatus(read.text, 'approved');
    const written = await writeAtomic(path, approvedText);
    if (!written.ok) return refuse(SPEC_WRITE_FAILED);

    const state: SpecStateFile = {
      version: SPEC_STATE_VERSION,
      feature,
      sha256: hashText(approvedText),
      approvedAt,
      editing: false,
    };
    const saved = await writeSpecState(root, state);
    if (!saved.ok) {
      // Put the previous text back, so the spec and the lock agree again.
      await writeAtomic(path, read.text);
      return refuse(STATE_WRITE_FAILED);
    }
    await notify();
    return { ok: true };
  }

  async function edit(request: HumanActionRequest): Promise<HumanActionResult> {
    const { feature } = request;
    const lock = lockForApproval(await readSpecState(root));
    if (lock === null) return refuse(NO_LOCK);
    if (lock === 'unreadable') return refuse(STATE_UNREADABLE);
    if (lock.feature !== feature) return refuse(OTHER_FEATURE);
    const hash = await hashSpec(root, feature);
    if (approvalFor(lock, feature, hash) !== 'approved') return refuse(NOT_APPROVED);

    const saved = await writeSpecState(root, { ...lock, editing: true });
    if (!saved.ok) return refuse(EDIT_WRITE_FAILED);
    await notify();
    return { ok: true };
  }

  // Each handler turns an unexpected error into a fixed refusal, so none of them can throw.
  return {
    'approve-spec': async (request) => {
      try {
        return await approve(request);
      } catch {
        return refuse(ACTION_FAILED);
      }
    },
    'edit-approved-spec': async (request) => {
      try {
        return await edit(request);
      } catch {
        return refuse(ACTION_FAILED);
      }
    },
  };
}
