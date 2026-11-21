import { describe, expect, it } from 'vitest';
import { COMMON_RULES } from '../../src/agent/jobs/rules';
import { JOB_PROMPTS, JOB_ROLES, REVIEWER_TASKS, WRITER_TASKS } from '../../src/agent/jobs';
import { JOB_IDS, type JobId } from '../../src/shared/agent-protocol';
import { BASE_TOOLS } from '../../src/shared/jobs';
import { TOOL_NAMES } from '../../src/shared/tools';

/** Every text a job sends: its system prompt, and (for the writer and reviewer) its task texts. */
function textsOf(job: JobId): { label: string; text: string }[] {
  const texts = [{ label: `${job} system`, text: JOB_PROMPTS[job].system }];
  if (job === 'writer') {
    for (const [key, text] of Object.entries(WRITER_TASKS)) {
      texts.push({ label: `writer task ${key}`, text });
    }
  }
  if (job === 'reviewer') {
    for (const [key, text] of Object.entries(REVIEWER_TASKS)) {
      texts.push({ label: `reviewer task ${key}`, text });
    }
  }
  return texts;
}

const ALL_TEXTS = JOB_IDS.flatMap((job) => textsOf(job).map((entry) => ({ job, ...entry })));

/** The plugin-only references AC4 leaves out: plugin paths, tool names, MCP and its scripts. */
const PLUGIN_ONLY: { name: string; pattern: RegExp }[] = [
  { name: '.claude path', pattern: /\.claude/ },
  { name: 'the word plugin', pattern: /\bplugin\b/i },
  { name: 'ToolSearch', pattern: /ToolSearch/ },
  { name: 'MCP', pattern: /\bMCP\b/ },
  { name: 'NEEDS-DATA-AGENT', pattern: /NEEDS-DATA-AGENT/ },
  {
    name: 'plugin tool names (Bash, Edit, Grep, Glob, Write)',
    pattern: /\b(Bash|Edit|Grep|Glob|Write)\b/,
  },
  { name: 'the Read tool', pattern: /\bRead tool\b/ },
  { name: 'scripts', pattern: /\bscripts?\b/i },
  { name: 'the sdd plugin name', pattern: /\bsdd\b/i },
];

/** Words that, in a line, tell the agent to do a git or workflow action unless negated. */
const SENSITIVE = /\b(git|commit|push|approve|close)\b/i;
const NEGATED = /\b(never|not|no|nothing)\b/i;

describe('job system prompts: rules and role (AC4)', () => {
  it('has a system prompt for every job id', () => {
    expect(Object.keys(JOB_PROMPTS).sort()).toEqual([...JOB_IDS].sort());
    for (const job of JOB_IDS) {
      expect(JOB_PROMPTS[job].system.length).toBeGreaterThan(0);
    }
  });

  it('holds the five common rules, (b) to (f), in every system prompt', () => {
    expect(COMMON_RULES).toHaveLength(5);
    for (const job of JOB_IDS) {
      for (const rule of COMMON_RULES) {
        expect(JOB_PROMPTS[job].system).toContain(rule);
      }
    }
  });

  it('states the job role (a) first in every system prompt', () => {
    for (const job of JOB_IDS) {
      expect(JOB_PROMPTS[job].system.startsWith(JOB_ROLES[job])).toBe(true);
      expect(JOB_ROLES[job].length).toBeGreaterThan(0);
    }
  });
});

describe('job prompts: tools (AC4)', () => {
  it('names only tools the job has, in every system prompt and task text', () => {
    for (const { job, label, text } of ALL_TEXTS) {
      for (const name of TOOL_NAMES) {
        if (new RegExp(`\\b${name}\\b`).test(text)) {
          expect(BASE_TOOLS[job], `${label} names ${name}`).toContain(name);
        }
      }
    }
  });

  it('keeps write and edit out of the reviewer and the reader prompts', () => {
    for (const job of ['reviewer', 'reader'] as const) {
      expect(JOB_PROMPTS[job].system).not.toMatch(/\b(write_file|edit_file)\b/);
    }
  });
});

describe('job prompts: plugin-only references (AC4)', () => {
  it('leaves out every plugin-only reference', () => {
    for (const { label, text } of ALL_TEXTS) {
      for (const { name, pattern } of PLUGIN_ONLY) {
        expect(text, `${label} mentions ${name}`).not.toMatch(pattern);
      }
    }
  });
});

describe('job prompts: no instruction to run git or to commit, push, approve or close (AC4)', () => {
  it('uses those words only in a negated sentence, in every prompt and task text', () => {
    for (const { label, text } of ALL_TEXTS) {
      for (const line of text.split('\n')) {
        if (SENSITIVE.test(line)) {
          expect(line, `${label}: ${line}`).toMatch(NEGATED);
        }
      }
    }
  });
});

describe('writer prompt and tasks (AC4)', () => {
  const writer = JOB_PROMPTS.writer.system;

  it('carries the changes-file rule and the NEEDS-SPEC-CHANGE report', () => {
    expect(writer).toContain('docs/specs/<feature>/changes.md');
    expect(writer).toContain('NEEDS-SPEC-CHANGE');
    expect(writer).toContain('candidate resolutions');
  });

  it('carries the Implementation report and the Findings analysis formats', () => {
    expect(writer).toContain('## Implementation report');
    expect(writer).toContain('## Findings analysis (round <n>)');
  });

  it('has the three task texts: implement, fix findings and resume', () => {
    expect(WRITER_TASKS.implement).toContain('"- [ ]" to "- [x]"');
    expect(WRITER_TASKS.implement).toContain('Implementation report');
    expect(WRITER_TASKS.fixFindings).toContain('ACCEPT, REJECT or NEEDS-SPEC-CHANGE');
    expect(WRITER_TASKS.fixFindings).toContain('round <n>');
    expect(WRITER_TASKS.resume).toContain('revised in revision N');
    expect(WRITER_TASKS.resume).toContain('Implementation report');
  });

  it('names the feature in every task text', () => {
    for (const text of Object.values(WRITER_TASKS)) {
      expect(text).toContain('<feature>');
    }
  });
});

describe('reviewer prompt and task (AC4)', () => {
  const reviewer = JOB_PROMPTS.reviewer.system;

  it('reads the changes file and the files it lists, and runs only the test command', () => {
    expect(reviewer).toContain('docs/specs/<feature>/changes.md');
    expect(reviewer).toContain('test command');
    expect(reviewer).toMatch(/no build/);
    expect(reviewer).toContain('run_command');
  });

  it('has the findings and verdict format, with spec-change findings', () => {
    expect(reviewer).toContain('## Review round <n>');
    expect(reviewer).toContain('Verdict: PASS | ISSUES');
    expect(reviewer).toContain('type: spec-change');
  });

  it('has the review-round task text', () => {
    expect(REVIEWER_TASKS.review).toContain('Review round <n> for feature <feature>');
    expect(REVIEWER_TASKS.review).toContain('changes.md');
  });
});

describe('reader prompt (AC4)', () => {
  const reader = JOB_PROMPTS.reader.system;

  it('is read-only and returns the Data report', () => {
    expect(reader).toMatch(/Read-only/);
    expect(reader).toContain('## Data report');
    expect(reader).toContain('Unreachable:');
  });

  it('quotes text that looks aimed at it', () => {
    expect(reader).toMatch(/Quote any that look aimed at you/);
  });
});

describe('planner prompt (AC4)', () => {
  const planner = JOB_PROMPTS.planner.system;

  it('writes only the four planning documents before approval, and never approves', () => {
    for (const file of ['PLAN.md', 'SPECS.md', 'tasks.md', 'SUBTASK.md']) {
      expect(planner).toContain(file);
    }
    expect(planner).toContain('Any other path is refused');
    expect(planner).toMatch(/Never approve a spec/);
  });

  it('asks about load-bearing ambiguity with choices and a recommendation', () => {
    expect(planner).toContain('two or three choices');
    expect(planner).toContain('(recommended)');
  });
});
