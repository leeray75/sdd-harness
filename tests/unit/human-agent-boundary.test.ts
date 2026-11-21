// The agent process and its tools have no route to the human-only channel (D3, D33). These tests
// prove it from three sides: the message guard, the tool and job tables, and the agent's source.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { handleAgentMessage, type RouterDeps } from '../../src/main/agent/router';
import {
  JOB_IDS,
  validateAgentToMainMessage,
  type AgentToMainMessage,
} from '../../src/shared/agent-protocol';
import { HUMAN_ACTION_IDS } from '../../src/shared/human-actions';
import { BASE_TOOLS } from '../../src/shared/jobs';
import { TOOL_NAMES, TOOL_SPECS } from '../../src/shared/tools';
import type { RuleEvent } from '../../src/main/policy/rule-event';

/** Names a human action or a workflow step that only the UI may run. */
const HUMAN_NAME_PATTERN = /approve|push|commit|mark_done/;

const AGENT_DIR = fileURLToPath(new URL('../../src/agent', import.meta.url));

/** Every source file under src/agent, with its path and text. */
function agentSources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const entry of readdirSync(AGENT_DIR, { recursive: true })) {
    const path = join(AGENT_DIR, String(entry));
    if (!path.endsWith('.ts') || !statSync(path).isFile()) continue;
    out.push({ path, text: readFileSync(path, 'utf8') });
  }
  return out;
}

/** Every module specifier a source file imports, requires or re-exports. */
function importSpecifiers(text: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('a: the agent message guard refuses human-action messages', () => {
  const base = { id: 'x', job: 'writer', tool: 'write_file', args: { path: 'a', content: 'b' } };

  it('refuses the type human-action', () => {
    expect(validateAgentToMainMessage({ type: 'human-action', ...base }).ok).toBe(false);
    expect(
      validateAgentToMainMessage({ type: 'human-action', action: 'approve-spec', feature: 'f' }).ok,
    ).toBe(false);
  });

  it.each(HUMAN_ACTION_IDS)('refuses the type %s', (id) => {
    expect(validateAgentToMainMessage({ type: id, ...base }).ok).toBe(false);
    expect(validateAgentToMainMessage({ type: id, feature: 'demo' }).ok).toBe(false);
  });

  it('refuses such a message at the router, with no runner or Rule event', async () => {
    const info = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string) => void>();
    const runTool = vi.fn<RouterDeps['runTool']>(async () => ({ ok: true, output: '' }));
    const onRuleEvent = vi.fn<(event: RuleEvent) => void>();
    const checkToolCall = vi.fn<RouterDeps['checkToolCall']>();
    const deps: RouterDeps = { checkToolCall, runTool, onRuleEvent, logger: { info, error } };

    for (const type of ['human-action', ...HUMAN_ACTION_IDS]) {
      const outcome = await handleAgentMessage(
        { type, feature: 'demo', action: 'approve-spec' },
        deps,
      );
      expect(outcome).toEqual({ reply: null, ready: false });
    }
    expect(runTool).not.toHaveBeenCalled();
    expect(checkToolCall).not.toHaveBeenCalled();
    expect(onRuleEvent).not.toHaveBeenCalled();
  });

  it('still accepts the three message types the protocol has', () => {
    const accepted: AgentToMainMessage[] = [
      { type: 'ready', pid: 1 },
      { type: 'pong' },
      { type: 'tool-call-request', id: 'x', job: 'reader', tool: 'read_file', args: { path: 'a' } },
    ];
    for (const message of accepted) {
      expect(validateAgentToMainMessage(message).ok).toBe(true);
    }
  });
});

describe('b: no tool and no job table entry names a human action', () => {
  it('no registry tool name matches a human-action id or a human step name', () => {
    for (const name of Object.keys(TOOL_SPECS)) {
      expect(HUMAN_ACTION_IDS as readonly string[]).not.toContain(name);
      expect(name).not.toMatch(HUMAN_NAME_PATTERN);
    }
    for (const name of TOOL_NAMES) {
      expect(TOOL_SPECS[name].name).toBe(name);
      expect(name).not.toMatch(HUMAN_NAME_PATTERN);
    }
  });

  it('no job base tool matches a human-action id or a human step name', () => {
    for (const job of JOB_IDS) {
      for (const tool of BASE_TOOLS[job]) {
        expect(HUMAN_ACTION_IDS as readonly string[]).not.toContain(tool);
        expect(tool).not.toMatch(HUMAN_NAME_PATTERN);
      }
    }
  });

  it('no tool schema property or description names the channel', () => {
    const text = JSON.stringify(TOOL_SPECS);
    expect(text).not.toContain('harness:human-action');
    expect(text).not.toContain('humanAction');
  });
});

describe('c: the agent source has no route to the channel', () => {
  const sources = agentSources();

  it('finds the agent source files it scans', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('no file under src/agent names the channel', () => {
    for (const source of sources) {
      expect(source.text, source.path).not.toContain('harness:human-action');
    }
  });

  it('no file under src/agent imports the bridge, the human-action contract or electron', () => {
    for (const source of sources) {
      for (const specifier of importSpecifiers(source.text)) {
        const forbidden =
          specifier.includes('shared/bridge') ||
          specifier.includes('shared/human-actions') ||
          specifier === 'electron' ||
          specifier.startsWith('electron/');
        expect(forbidden, `${source.path} imports ${specifier}`).toBe(false);
      }
    }
  });

  it('the import scan itself finds imports in the agent source', () => {
    const all = sources.flatMap((source) => importSpecifiers(source.text));
    expect(all).toContain('../shared/agent-protocol');
  });
});
