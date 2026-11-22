import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEMPLATES, fillTemplate, type TemplateKind } from '../../src/shared/spec-docs';

// The plugin's v0.18.0 templates, copied byte for byte (tests/fixtures/sdd-plugin/README.md).
const FIXTURE_FILES: Record<TemplateKind, string> = {
  plan: 'PLAN.md',
  specs: 'SPECS.md',
  tasks: 'tasks.md',
  subtask: 'SUBTASK.md',
};

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/sdd-plugin/${name}`, import.meta.url)),
    'utf8',
  );
}

function lf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// Deliberate differences from the plugin's templates. The list is empty: the text is verbatim.
const DELIBERATE_CHANGES: string[] = [];

describe('bundled templates match the plugin (AC1)', () => {
  for (const kind of Object.keys(FIXTURE_FILES) as TemplateKind[]) {
    it(`${kind} equals tests/fixtures/sdd-plugin/templates/${FIXTURE_FILES[kind]}`, () => {
      expect(lf(TEMPLATES[kind])).toBe(lf(fixture(`templates/${FIXTURE_FILES[kind]}`)));
    });
  }

  it('lists no deliberate changes', () => {
    expect(DELIBERATE_CHANGES).toEqual([]);
  });

  it('exports exactly the four kinds', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['plan', 'specs', 'subtask', 'tasks']);
  });

  it('the fixture README names the plugin version and source', () => {
    const readme = fixture('README.md');
    expect(readme).toContain('0.18.0');
    expect(readme).toContain('plugins/sdd-plugin');
  });
});

describe('fillTemplate (AC1)', () => {
  it('replaces every known placeholder when every field is given', () => {
    const plan = fillTemplate('plan', {
      feature: 'p9-demo',
      title: 'Demo feature',
      ticket: 'STORY-42',
      storyTitle: 'Demo story',
      date: '2026-11-22',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.text).toContain('# Plan: Demo feature');
    expect(plan.text).toContain('Ticket: STORY-42 (Demo story)');
    expect(plan.text).toContain('Date: 2026-11-22');
    for (const placeholder of ['<Feature name>', '<STORY-ID>', '<story title>', '<YYYY-MM-DD>']) {
      expect(plan.text).not.toContain(placeholder);
    }
  });

  it('fills <feature> in the tasks and subtask templates, every occurrence', () => {
    const tasks = fillTemplate('tasks', { feature: 'p9-demo' });
    const subtask = fillTemplate('subtask', { feature: 'p9-demo' });
    expect(tasks.ok && tasks.text).toContain('# Tasks: p9-demo');
    expect(tasks.ok && tasks.text).not.toContain('<feature>');
    expect(subtask.ok && subtask.text).not.toContain('<feature>');
    // The SUBTASK template holds four <feature> placeholders (its three link lines and Spec line).
    expect(subtask.ok && subtask.text.split('p9-demo').length - 1).toBe(4);
  });

  it('uses the feature as the title when no title is given', () => {
    const specs = fillTemplate('specs', { feature: 'p9-demo' });
    expect(specs.ok && specs.text).toContain('# p9-demo\n');
    expect(specs.ok && specs.text).not.toContain('<Feature name>');
  });

  it('leaves the placeholder of an omitted optional field, and the guidance text, unchanged', () => {
    const plan = fillTemplate('plan', { feature: 'p9-demo' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.text).toContain('Ticket: <STORY-ID> (<story title>)');
    expect(plan.text).toContain('Date: <YYYY-MM-DD>');
    expect(plan.text).toContain('<What the story asks for and why, in two to four sentences');
    expect(plan.text).toContain('<e.g. Base branch>');
  });

  it('replaces in one pass, so a value containing a placeholder is kept as written', () => {
    const plan = fillTemplate('plan', { feature: 'p9-demo', title: '<feature> and more' });
    expect(plan.ok && plan.text.split('\n')[0]).toBe('# Plan: <feature> and more');
  });

  it('refuses an invalid feature slug with an error result, without throwing', () => {
    for (const feature of ['', 'Upper', '../escape', 'a/b', 'a\\b', '/abs', '.', 'x'.repeat(65)]) {
      expect(() => fillTemplate('plan', { feature })).not.toThrow();
      expect(fillTemplate('plan', { feature }).ok).toBe(false);
    }
  });

  it('refuses an unknown kind and a non-string optional field, without throwing', () => {
    expect(fillTemplate('ledger', { feature: 'p9-demo' }).ok).toBe(false);
    expect(fillTemplate('__proto__', { feature: 'p9-demo' }).ok).toBe(false);
    const wrong = fillTemplate('plan', { feature: 'p9-demo', ticket: 42 as unknown as string });
    expect(wrong.ok).toBe(false);
  });
});
