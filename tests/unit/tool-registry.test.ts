import { describe, expect, it } from 'vitest';
import { MAX_STRING_LENGTH } from '../../src/shared/agent-protocol';
import {
  MAX_CONTENT_LENGTH,
  TOOL_ARG_CHECKS,
  TOOL_NAMES,
  TOOL_SPECS,
  isToolName,
  type JsonSchemaProperty,
  type ToolName,
} from '../../src/shared/tools';

/** A valid value for one schema property. */
function sampleValue(property: JsonSchemaProperty): unknown {
  if (property.type === 'string') return 'x';
  if (property.type === 'boolean') return true;
  return ['x'];
}

/** A value of the wrong JSON type for one schema property. */
function wrongValue(property: JsonSchemaProperty): unknown {
  if (property.type === 'string') return 42;
  if (property.type === 'boolean') return 'yes';
  return 'not-an-array';
}

/** A full, valid argument object for a tool: every property present. */
function fullArgs(name: ToolName): Record<string, unknown> {
  const { properties } = TOOL_SPECS[name].parameters;
  const out: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    out[key] = sampleValue(property);
  }
  return out;
}

/** A minimal valid argument object: only the required keys. */
function requiredOnlyArgs(name: ToolName): Record<string, unknown> {
  const { properties, required } = TOOL_SPECS[name].parameters;
  const out: Record<string, unknown> = {};
  for (const key of required) {
    out[key] = sampleValue(properties[key] as JsonSchemaProperty);
  }
  return out;
}

function expectRefused(name: ToolName, args: unknown): string {
  const result = TOOL_ARG_CHECKS[name](args);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a refusal');
  expect(result.reason.length).toBeGreaterThan(0);
  return result.reason;
}

describe('tool names', () => {
  it('lists the seven tools', () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      [
        'edit_file',
        'list_files',
        'read_file',
        'read_ticket',
        'run_command',
        'search_text',
        'write_file',
      ].sort(),
    );
  });

  it('accepts only listed names', () => {
    expect(isToolName('read_file')).toBe(true);
    expect(isToolName('delete_file')).toBe(false);
    expect(isToolName('toString')).toBe(false);
    expect(isToolName(7)).toBe(false);
    expect(isToolName(undefined)).toBe(false);
  });

  it('has a spec and a guard for every name, with the same name', () => {
    for (const name of TOOL_NAMES) {
      expect(TOOL_SPECS[name].name).toBe(name);
      expect(typeof TOOL_ARG_CHECKS[name]).toBe('function');
      expect(TOOL_SPECS[name].description.length).toBeGreaterThan(0);
    }
  });
});

describe('spec shape', () => {
  it.each(TOOL_NAMES)('%s has an object schema with no additional properties', (name) => {
    const { parameters } = TOOL_SPECS[name];
    expect(parameters.type).toBe('object');
    expect(parameters.additionalProperties).toBe(false);
    expect(Array.isArray(parameters.required)).toBe(true);
    for (const key of parameters.required) {
      expect(Object.keys(parameters.properties)).toContain(key);
    }
  });
});

describe('specs match their guards (AC1)', () => {
  it.each(TOOL_NAMES)('%s accepts a full argument object built from its schema', (name) => {
    expect(TOOL_ARG_CHECKS[name](fullArgs(name)).ok).toBe(true);
  });

  it.each(TOOL_NAMES)('%s accepts only its required keys', (name) => {
    expect(TOOL_ARG_CHECKS[name](requiredOnlyArgs(name)).ok).toBe(true);
  });

  it.each(TOOL_NAMES)('%s refuses each missing required key', (name) => {
    const { required } = TOOL_SPECS[name].parameters;
    for (const key of required) {
      const args = fullArgs(name);
      delete args[key];
      expect(expectRefused(name, args)).toContain(key);
    }
  });

  it.each(TOOL_NAMES)('%s refuses a key that is not in its schema', (name) => {
    const args = { ...fullArgs(name), not_in_schema: 'x' };
    expect(expectRefused(name, args)).toContain('unknown argument');
  });

  it.each(TOOL_NAMES)('%s refuses a wrong type for each property', (name) => {
    const { properties } = TOOL_SPECS[name].parameters;
    for (const [key, property] of Object.entries(properties)) {
      const args = fullArgs(name);
      args[key] = wrongValue(property);
      expect(expectRefused(name, args)).toContain(key);
    }
  });

  it.each(TOOL_NAMES)('%s refuses a non-object argument', (name) => {
    expectRefused(name, null);
    expectRefused(name, 'x');
    expectRefused(name, ['x']);
    expectRefused(name, undefined);
  });

  it.each(TOOL_NAMES)('%s refuses an own-property name that is not in its schema', (name) => {
    expectRefused(name, JSON.parse('{"__proto__": "x"}') as unknown);
  });
});

describe('valid arguments are returned typed', () => {
  it('read_file keeps path', () => {
    expect(TOOL_ARG_CHECKS.read_file({ path: 'a.txt' })).toEqual({
      ok: true,
      args: { path: 'a.txt' },
    });
  });

  it('list_files returns only the keys given', () => {
    expect(TOOL_ARG_CHECKS.list_files({})).toEqual({ ok: true, args: {} });
    expect(TOOL_ARG_CHECKS.list_files({ pattern: '*.md', path: 'docs' })).toEqual({
      ok: true,
      args: { pattern: '*.md', path: 'docs' },
    });
  });

  it('search_text needs a pattern and takes optional path and glob', () => {
    expect(TOOL_ARG_CHECKS.search_text({ pattern: 'needle', glob: '**/*.ts' })).toEqual({
      ok: true,
      args: { pattern: 'needle', glob: '**/*.ts' },
    });
  });

  it('write_file keeps path and content', () => {
    expect(TOOL_ARG_CHECKS.write_file({ path: 'a.txt', content: 'hi' })).toEqual({
      ok: true,
      args: { path: 'a.txt', content: 'hi' },
    });
  });

  it('edit_file keeps replace_all when given', () => {
    expect(
      TOOL_ARG_CHECKS.edit_file({ path: 'a.txt', old_text: 'a', new_text: 'b', replace_all: true }),
    ).toEqual({
      ok: true,
      args: { path: 'a.txt', old_text: 'a', new_text: 'b', replace_all: true },
    });
  });

  it('run_command keeps the argument array and cwd', () => {
    expect(TOOL_ARG_CHECKS.run_command({ program: 'node', args: ['-e', '1'], cwd: 'sub' })).toEqual(
      {
        ok: true,
        args: { program: 'node', args: ['-e', '1'], cwd: 'sub' },
      },
    );
  });

  it('read_ticket keeps id', () => {
    expect(TOOL_ARG_CHECKS.read_ticket({ id: 'T-1' })).toEqual({ ok: true, args: { id: 'T-1' } });
  });
});

describe('length caps and reasons', () => {
  it('caps ordinary strings at MAX_STRING_LENGTH', () => {
    const tooLong = 'a'.repeat(MAX_STRING_LENGTH + 1);
    expect(expectRefused('read_file', { path: tooLong })).toContain('path');
    expect(TOOL_ARG_CHECKS.read_file({ path: 'a'.repeat(MAX_STRING_LENGTH) }).ok).toBe(true);
  });

  it('gives content and edit texts the 1 MiB cap instead', () => {
    const atCap = 'a'.repeat(MAX_CONTENT_LENGTH);
    const overCap = 'a'.repeat(MAX_CONTENT_LENGTH + 1);
    expect(TOOL_ARG_CHECKS.write_file({ path: 'a', content: atCap }).ok).toBe(true);
    expect(expectRefused('write_file', { path: 'a', content: overCap })).toContain('content');
    expect(expectRefused('edit_file', { path: 'a', old_text: overCap, new_text: 'b' })).toContain(
      'old_text',
    );
    expect(expectRefused('edit_file', { path: 'a', old_text: 'a', new_text: overCap })).toContain(
      'new_text',
    );
  });

  it('caps each run_command argument entry at MAX_STRING_LENGTH', () => {
    const tooLong = 'a'.repeat(MAX_STRING_LENGTH + 1);
    expect(expectRefused('run_command', { program: 'node', args: [tooLong] })).toContain('args');
    expect(expectRefused('run_command', { program: 'node', args: ['a', 3] })).toContain('args');
  });

  it('never echoes an argument value in a reason', () => {
    const secret = 'SECRET-VALUE-9f3a';
    const cases: Array<[ToolName, unknown]> = [
      ['read_file', { path: 7 }],
      ['read_file', { path: secret, extra: 1 }],
      ['write_file', { path: secret, content: 9 }],
      ['edit_file', { path: 'a', old_text: 'x', new_text: 'y', replace_all: secret }],
      ['run_command', { program: secret, args: 'nope' }],
      ['read_ticket', { id: secret, other: secret }],
      ['search_text', { pattern: 'a'.repeat(MAX_STRING_LENGTH + 1) + secret }],
    ];
    for (const [name, args] of cases) {
      expect(expectRefused(name, args)).not.toContain(secret);
    }
  });
});
