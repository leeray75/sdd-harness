import { describe, expect, it } from 'vitest';
import {
  MAX_STRING_LENGTH,
  MAX_TOOL_OUTPUT_LENGTH,
  isAgentToMainMessage,
  isMainToAgentMessage,
  validateAgentToMainMessage,
} from '../../src/shared/agent-protocol';

const validRequest = {
  type: 'tool-call-request',
  id: 'req-1',
  job: 'writer',
  tool: 'write_file',
  args: { path: 'notes.txt', content: 'hello', nested: { list: [1, true, null] } },
};

describe('isAgentToMainMessage: valid messages', () => {
  it('accepts ready, pong and a tool call request', () => {
    expect(isAgentToMainMessage({ type: 'ready', pid: 1234 })).toBe(true);
    expect(isAgentToMainMessage({ type: 'pong' })).toBe(true);
    expect(isAgentToMainMessage(validRequest)).toBe(true);
  });

  it('accepts each of the four job ids', () => {
    for (const job of ['planner', 'writer', 'reviewer', 'reader']) {
      expect(isAgentToMainMessage({ ...validRequest, job })).toBe(true);
    }
  });
});

describe('isAgentToMainMessage: invalid messages', () => {
  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'ready', 42, true, ['ready', 1]]) {
      expect(isAgentToMainMessage(value)).toBe(false);
    }
  });

  it('rejects unknown and missing type values', () => {
    expect(isAgentToMainMessage({ type: 'hello' })).toBe(false);
    expect(isAgentToMainMessage({ pid: 1 })).toBe(false);
    expect(validateAgentToMainMessage({ type: 'hello' })).toEqual({
      ok: false,
      reason: 'unknown message type',
    });
  });

  it('rejects a ready message with a missing or bad pid', () => {
    expect(isAgentToMainMessage({ type: 'ready' })).toBe(false);
    expect(isAgentToMainMessage({ type: 'ready', pid: '1234' })).toBe(false);
    expect(isAgentToMainMessage({ type: 'ready', pid: 0 })).toBe(false);
    expect(isAgentToMainMessage({ type: 'ready', pid: 1.5 })).toBe(false);
  });

  it('rejects a tool call request with a missing or wrongly typed field', () => {
    const without = (field: string): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...validRequest };
      delete copy[field];
      return copy;
    };
    expect(isAgentToMainMessage(without('id'))).toBe(false);
    expect(isAgentToMainMessage(without('tool'))).toBe(false);
    expect(isAgentToMainMessage(without('args'))).toBe(false);
    expect(isAgentToMainMessage(without('job'))).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, id: 7 })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, id: '' })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, tool: 3 })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: 'x' })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: ['x'] })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: { f: undefined } })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: { f: Number.NaN } })).toBe(false);
  });

  it('rejects unknown job ids', () => {
    expect(isAgentToMainMessage({ ...validRequest, job: 'approver' })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, job: 'Writer' })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, job: undefined })).toBe(false);
  });

  it('rejects strings over the length limit, including nested args', () => {
    const long = 'a'.repeat(MAX_STRING_LENGTH + 1);
    const atLimit = 'a'.repeat(MAX_STRING_LENGTH);
    expect(isAgentToMainMessage({ ...validRequest, id: long })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, tool: long })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: { content: long } })).toBe(false);
    expect(isAgentToMainMessage({ ...validRequest, args: { content: atLimit } })).toBe(true);
  });

  it('rejects args nested too deeply', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) {
      deep = { next: deep };
    }
    expect(isAgentToMainMessage({ ...validRequest, args: { deep } })).toBe(false);
  });
});

describe('human-only actions (AC5)', () => {
  const humanOnly = [
    'approve-spec',
    'approve-result',
    'close',
    'mark-done',
    'change-rules',
    'edit-spec',
    'approve_spec',
    'spec-approved',
  ];

  it('rejects agent-to-main messages with human-only type values', () => {
    for (const type of humanOnly) {
      expect(isAgentToMainMessage({ type })).toBe(false);
      expect(isAgentToMainMessage({ type, id: 'x', job: 'writer', tool: 'x', args: {} })).toBe(
        false,
      );
    }
  });

  it('rejects main-to-agent messages with human-only type values', () => {
    for (const type of humanOnly) {
      expect(isMainToAgentMessage({ type })).toBe(false);
    }
  });

  it('has no human-only job id', () => {
    expect(isAgentToMainMessage({ ...validRequest, job: 'approver' })).toBe(false);
  });
});

describe('isMainToAgentMessage', () => {
  it('accepts ping and both kinds of tool call result', () => {
    expect(isMainToAgentMessage({ type: 'ping' })).toBe(true);
    expect(
      isMainToAgentMessage({ type: 'tool-call-result', id: 'req-1', ok: true, output: 'text' }),
    ).toBe(true);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'req-1',
        ok: false,
        error: { code: 'denied', reason: 'not allowed by policy' },
      }),
    ).toBe(true);
  });

  it('accepts a success with empty output and with output at the cap', () => {
    expect(isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: true, output: '' })).toBe(
      true,
    );
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: true,
        output: 'a'.repeat(MAX_TOOL_OUTPUT_LENGTH),
      }),
    ).toBe(true);
  });

  it('rejects a success without output, with non-string output, or with oversized output', () => {
    expect(isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: true })).toBe(false);
    expect(isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: true, output: 42 })).toBe(
      false,
    );
    expect(
      isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: true, output: null }),
    ).toBe(false);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: true,
        output: 'a'.repeat(MAX_TOOL_OUTPUT_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it('accepts a failed error and rejects an unknown error code', () => {
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: false,
        error: { code: 'failed', reason: 'file is missing' },
      }),
    ).toBe(true);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: false,
        error: { code: 'crashed', reason: 'x' },
      }),
    ).toBe(false);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: false,
        error: { code: 'failed' },
      }),
    ).toBe(false);
  });

  it('rejects a denial without the denied code or a reason', () => {
    expect(isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: false })).toBe(false);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: false,
        error: { code: 'other', reason: 'x' },
      }),
    ).toBe(false);
    expect(
      isMainToAgentMessage({
        type: 'tool-call-result',
        id: 'r',
        ok: false,
        error: { code: 'denied' },
      }),
    ).toBe(false);
  });

  it('rejects a result whose ok field is not a boolean', () => {
    expect(isMainToAgentMessage({ type: 'tool-call-result', id: 'r', ok: 'no' })).toBe(false);
  });
});
