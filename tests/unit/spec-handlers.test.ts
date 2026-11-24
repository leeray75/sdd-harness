import { mkdirSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHumanActionChannel,
  type HumanActionChannel,
  type HumanActionSender,
} from '../../src/main/human/channel';
import { createSpecHandlers } from '../../src/main/human/spec-handlers';
import type { GestureTracker } from '../../src/main/human/gesture';
import { MAX_SPEC_FILE_BYTES } from '../../src/main/workflow/spec-folders';
import { approvalOf, readSpecState } from '../../src/main/workflow/spec-lock';
import type { HumanActionResult } from '../../src/shared/human-actions';

const TRUSTED: HumanActionSender = { senderId: 1, frameUrl: 'app://page' };
const NOW = new Date('2026-11-22T10:00:00.000Z');
const SPEC = [
  '---',
  'status: draft',
  'ticket:',
  '---',
  '',
  '# Spec',
  '',
  '## Goals',
  '',
  '- **G1:** x',
  '',
  '## Acceptance criteria',
  '',
  '- **AC1:** y',
  '',
].join('\n');

const REASON_UNREADABLE = 'SPECS.md is missing, unreadable or too large';
const REASON_HEADINGS = 'SPECS.md needs a Goals heading and an Acceptance criteria heading';
const REASON_ALREADY = 'this spec is already approved and has not changed';
const REASON_STATE_WRITE = 'the approval could not be saved, so SPECS.md was put back';
const REASON_NO_LOCK = 'no spec is approved, so there is nothing to edit';
const REASON_OTHER = 'the approved spec is for another feature';
const REASON_NOT_APPROVED = 'this spec is not approved, so it cannot be edited';
const REASON_FAILED = 'the action failed';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-spec-handlers-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(relative: string, text: string): Promise<void> {
  const path = join(root, 'docs', 'specs', relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function specPath(feature: string): string {
  return join(root, 'docs', 'specs', feature, 'SPECS.md');
}

function specsDir(): string {
  return join(root, 'docs', 'specs');
}

function gestureTracker(answer: boolean): GestureTracker {
  return { record: vi.fn(), consume: vi.fn(() => answer) };
}

interface Harness {
  channel: HumanActionChannel;
  approve: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  onLockChanged: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

/** A channel with the real spec handlers, wrapped in spies, and fakes for the sender and gesture. */
function harness(
  options: {
    trusted?: boolean;
    gesture?: boolean;
    now?: () => Date;
    onLockChanged?: () => unknown;
    onEditRequested?: (feature: string) => { ok: true } | { ok: false; reason: string };
  } = {},
): Harness {
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const onLockChanged = vi.fn(options.onLockChanged ?? (() => undefined));
  const handlers = createSpecHandlers({
    root,
    now: options.now ?? (() => NOW),
    onLockChanged,
    ...(options.onEditRequested === undefined ? {} : { onEditRequested: options.onEditRequested }),
  });
  const approve = vi.fn(handlers['approve-spec']);
  const edit = vi.fn(handlers['edit-approved-spec']);
  const channel = createHumanActionChannel({
    isTrustedSender: () => options.trusted ?? true,
    tracker: gestureTracker(options.gesture ?? true),
    logger: { info, error },
  });
  channel.register('approve-spec', approve);
  channel.register('edit-approved-spec', edit);
  return { channel, approve, edit, onLockChanged, info, error };
}

function call(
  h: Harness,
  action: string,
  feature = 'p3-x',
  sender: HumanActionSender = TRUSTED,
): Promise<HumanActionResult> {
  return h.channel.handle(sender, { action, feature });
}

function refusedWith(result: HumanActionResult, reason: string): void {
  expect(result).toEqual({ ok: false, code: 'refused', reason });
}

describe('the channel checks run before the handlers (AC4)', () => {
  it('never reaches a handler from an untrusted sender, an invalid request or a call with no gesture', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const untrusted = harness({ trusted: false });
    expect((await call(untrusted, 'approve-spec')).ok).toBe(false);
    expect(untrusted.approve).not.toHaveBeenCalled();

    const invalid = harness();
    expect(
      (await invalid.channel.handle(TRUSTED, { action: 'approve-spec', feature: 'a--b' })).ok,
    ).toBe(false);
    expect(invalid.approve).not.toHaveBeenCalled();

    const noGesture = harness({ gesture: false });
    expect(await call(noGesture, 'approve-spec')).toMatchObject({ code: 'no-gesture' });
    expect(noGesture.approve).not.toHaveBeenCalled();
    expect(noGesture.edit).not.toHaveBeenCalled();
    expect(await readFile(specPath('p3-x'), 'utf8')).toBe(SPEC);
  });

  it('registers both handlers, and a valid gesture call reaches them', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    expect(await call(h, 'approve-spec')).toEqual({ ok: true });
    expect(h.approve).toHaveBeenCalledTimes(1);
  });
});

describe('approve-spec success (AC1, AC4)', () => {
  it('writes the frontmatter status and the state file, and reads back as approved', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    expect(await call(h, 'approve-spec')).toEqual({ ok: true });

    expect(await readFile(specPath('p3-x'), 'utf8')).toContain('status: approved\n');
    const read = await readSpecState(root);
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') {
      expect(read.state).toEqual({
        version: 1,
        feature: 'p3-x',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        approvedAt: '2026-11-22T10:00:00.000Z',
        editing: false,
      });
    }
    expect(await approvalOf(root, 'p3-x')).toBe('approved');
    expect(h.onLockChanged).toHaveBeenCalledTimes(1);
  });

  it('leaves no temp file in the feature folder or docs/specs', async () => {
    await put('p3-x/SPECS.md', SPEC);
    await call(harness(), 'approve-spec');
    const leftover = [...readdirSync(specsDir()), ...readdirSync(join(specsDir(), 'p3-x'))].filter(
      (name) => name.endsWith('.tmp'),
    );
    expect(leftover).toEqual([]);
  });

  it('reapproves after an edit, and clears editing', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    await call(h, 'approve-spec');
    await call(h, 'edit-approved-spec');
    await put('p3-x/SPECS.md', `${SPEC}\nchanged\n`);
    expect(await approvalOf(root, 'p3-x')).toBe('changed');
    expect(await call(h, 'approve-spec')).toEqual({ ok: true });
    expect(await approvalOf(root, 'p3-x')).toBe('approved');
    const read = await readSpecState(root);
    expect(read.kind === 'ok' && read.state.editing).toBe(false);
  });

  it('replaces another active feature', async () => {
    await put('p3-x/SPECS.md', SPEC);
    await put('p3-y/SPECS.md', SPEC);
    const h = harness();
    await call(h, 'approve-spec', 'p3-x');
    expect(await call(h, 'approve-spec', 'p3-y')).toEqual({ ok: true });
    const read = await readSpecState(root);
    expect(read.kind === 'ok' && read.state.feature).toBe('p3-y');
  });
});

describe('approve-spec refusals change no file and throw nothing (AC4)', () => {
  it('refuses when SPECS.md is missing, and when it is over the cap', async () => {
    const h = harness();
    refusedWith(await call(h, 'approve-spec'), REASON_UNREADABLE);
    await put('p3-x/SPECS.md', 'x'.repeat(MAX_SPEC_FILE_BYTES + 1));
    refusedWith(await call(h, 'approve-spec'), REASON_UNREADABLE);
    expect(readdirSync(specsDir())).toEqual(['p3-x']);
  });

  it('refuses a spec with no Goals or no Acceptance criteria heading', async () => {
    await put('p3-x/SPECS.md', '## Goals\n');
    const h = harness();
    refusedWith(await call(h, 'approve-spec'), REASON_HEADINGS);
    expect(await readFile(specPath('p3-x'), 'utf8')).toBe('## Goals\n');
  });

  it('refuses a feature already approved with the same hash and not editing', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    await call(h, 'approve-spec');
    const before = await readFile(specPath('p3-x'), 'utf8');
    refusedWith(await call(h, 'approve-spec'), REASON_ALREADY);
    expect(await readFile(specPath('p3-x'), 'utf8')).toBe(before);
  });

  it('restores SPECS.md when the state file cannot be written', async () => {
    await put('p3-x/SPECS.md', SPEC);
    // A folder where the state file goes: renaming the temp file onto it fails.
    mkdirSync(join(specsDir(), '.sdd-state.json'), { recursive: true });
    const h = harness();
    refusedWith(await call(h, 'approve-spec'), REASON_STATE_WRITE);
    expect(await readFile(specPath('p3-x'), 'utf8')).toBe(SPEC);
    expect(readdirSync(specsDir()).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(h.onLockChanged).not.toHaveBeenCalled();
  });

  it('turns a failing clock into the fixed refusal, and leaves SPECS.md as it was', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness({
      now: () => {
        throw new Error('clock broke');
      },
    });
    refusedWith(await call(h, 'approve-spec'), REASON_FAILED);
    expect(await readFile(specPath('p3-x'), 'utf8')).toBe(SPEC);
  });

  it('still returns ok when the lock listener throws', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness({
      onLockChanged: () => {
        throw new Error('listener broke');
      },
    });
    expect(await call(h, 'approve-spec')).toEqual({ ok: true });
  });

  it('logs a refusal as one decision line with its code, and nothing from the spec', async () => {
    const h = harness();
    await call(h, 'approve-spec');
    expect(h.error).toHaveBeenCalledWith(
      'human action approve-spec: refused (refused) feature=p3-x',
    );
  });
});

describe('edit-approved-spec (AC4)', () => {
  it('sets editing true and keeps the hash, so the approval reads changed', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    await call(h, 'approve-spec');
    const before = await readSpecState(root);
    expect(await call(h, 'edit-approved-spec')).toEqual({ ok: true });
    const after = await readSpecState(root);
    expect(after.kind === 'ok' && after.state.editing).toBe(true);
    expect(after.kind === 'ok' && before.kind === 'ok' && after.state.sha256).toBe(
      before.kind === 'ok' ? before.state.sha256 : '',
    );
    expect(await approvalOf(root, 'p3-x')).toBe('changed');
    expect(h.onLockChanged).toHaveBeenCalledTimes(2);
  });

  it('with the hook allowing, records the edit and calls the hook with the feature', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const hook = vi.fn<(feature: string) => { ok: true }>(() => ({ ok: true }));
    const h = harness({ onEditRequested: hook });
    await call(h, 'approve-spec');
    expect(await call(h, 'edit-approved-spec')).toEqual({ ok: true });
    expect(hook).toHaveBeenCalledWith('p3-x');
    const after = await readSpecState(root);
    expect(after.kind === 'ok' && after.state.editing).toBe(true);
  });

  it('with the hook refusing, returns its reason and records nothing', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const hook = vi.fn<(feature: string) => { ok: false; reason: string }>(() => ({
      ok: false,
      reason: 'the build has started, so the spec cannot be edited',
    }));
    const h = harness({ onEditRequested: hook });
    await call(h, 'approve-spec');
    const before = await readSpecState(root);
    expect(await call(h, 'edit-approved-spec')).toEqual({
      ok: false,
      code: 'refused',
      reason: 'the build has started, so the spec cannot be edited',
    });
    expect(hook).toHaveBeenCalledTimes(1);
    const after = await readSpecState(root);
    expect(after.kind === 'ok' && after.state.editing).toBe(false);
    expect(after).toEqual(before);
    expect(await approvalOf(root, 'p3-x')).toBe('approved');
  });

  it('does not ask the hook when the approval checks already refuse', async () => {
    const hook = vi.fn<(feature: string) => { ok: true }>(() => ({ ok: true }));
    const h = harness({ onEditRequested: hook });
    expect((await call(h, 'edit-approved-spec')).ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it('refuses with no state file, a state for another feature, and an unapproved spec', async () => {
    await put('p3-x/SPECS.md', SPEC);
    const h = harness();
    refusedWith(await call(h, 'edit-approved-spec'), REASON_NO_LOCK);

    await call(h, 'approve-spec', 'p3-x');
    refusedWith(await call(h, 'edit-approved-spec', 'p3-y'), REASON_OTHER);

    await call(h, 'edit-approved-spec', 'p3-x');
    refusedWith(await call(h, 'edit-approved-spec', 'p3-x'), REASON_NOT_APPROVED);
  });

  it('refuses when the state file is unreadable, and changes nothing', async () => {
    await put('p3-x/SPECS.md', SPEC);
    await put('.sdd-state.json', '{broken');
    const h = harness();
    refusedWith(await call(h, 'edit-approved-spec'), 'the approval state could not be read');
    expect(await readFile(join(specsDir(), '.sdd-state.json'), 'utf8')).toBe('{broken');
  });
});
