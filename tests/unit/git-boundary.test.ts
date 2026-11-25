import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE_TOOLS } from '../../src/shared/jobs';
import { TOOL_NAMES } from '../../src/shared/tools';

// The git boundary of the agents (p3-ship, D4, AC3). Agents have no git tool, and no file the agent
// side or the shared code holds names the git module. The scans read the source text, so they hold
// for any later edit.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every .ts file under a folder of the repo, as repo-relative POSIX paths. */
function tsFiles(relative: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const path = join(dir, name).replace(/\\/g, '/');
      if (statSync(join(ROOT, path)).isDirectory()) {
        walk(path);
      } else if (name.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(relative);
  return found;
}

function textOf(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('the agent side never names the git module (AC3)', () => {
  it('no file under src/agent or src/shared names src/main/git or its module', () => {
    const files = [...tsFiles('src/agent'), ...tsFiles('src/shared')];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(textOf(file), file).not.toMatch(/main\/git|\/git\/git['"`]/);
    }
  });
});

describe('only src/main/git runs git through node:child_process (AC3, revision 1)', () => {
  it('no other file under src starts a git program, and protect.ts no longer imports child_process', () => {
    const importers = tsFiles('src').filter((file) =>
      /from 'node:child_process'/.test(textOf(file)),
    );
    expect(importers).toContain('src/main/git/git.ts');
    for (const file of importers) {
      if (file === 'src/main/git/git.ts') continue;
      // A call that starts a git program, with the program name as its first argument.
      expect(textOf(file), file).not.toMatch(
        /\b(execFile|execFileSync|spawn|spawnSync|exec|execSync)\(\s*['"`]git['"`]/,
      );
    }
    expect(textOf('src/main/commands/protect.ts')).not.toMatch(/child_process/);
    expect(textOf('src/main/git/git.ts')).toMatch(/execFile\(\s*'git'/);
  });
});

describe('no tool is a git tool (AC3, D4)', () => {
  it('no registry tool name and no job base tool is git', () => {
    for (const name of TOOL_NAMES) {
      expect(name, name).not.toMatch(/git/i);
    }
    for (const [job, tools] of Object.entries(BASE_TOOLS)) {
      for (const tool of tools) {
        expect(tool, `${job}: ${tool}`).not.toMatch(/git/i);
      }
    }
  });
});
