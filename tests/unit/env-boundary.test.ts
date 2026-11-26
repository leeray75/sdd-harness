import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The environment boundary (D41, p4-env-local, AC2). The scans read the source text, so they hold for
// any later edit: only the environment's backends and the two app-data stores touch the file system
// and child processes; only the environment reaches the network module; and no tool, command, agent
// or agent-side file names the git module or a git member of an environment.

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

/**
 * An import, side-effect import, require() or dynamic import() of node:fs, node:fs/promises or
 * node:child_process, with or without the node: prefix, in either quote style.
 */
const SYSTEM_IMPORT =
  /(?:from\s*|require\(\s*|import\(\s*|import\s+)['"](?:node:)?(?:fs|fs\/promises|child_process)['"]/;

/** The files that may import node:fs, node:fs/promises or node:child_process under src/main. */
function mayTouchSystem(file: string): boolean {
  return (
    file.startsWith('src/main/env/') ||
    file.startsWith('src/main/git/') ||
    file === 'src/main/projects/store.ts' ||
    file === 'src/main/secrets/store.ts'
  );
}

describe('only the environment and the two app-data stores touch the file system (AC2)', () => {
  it('no file under src/main outside the allowed set imports node:fs, node:fs/promises or node:child_process', () => {
    const files = tsFiles('src/main');
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      if (mayTouchSystem(file)) continue;
      expect(textOf(file), file).not.toMatch(SYSTEM_IMPORT);
    }
  });

  it('the allowed set still holds the local backend and the stores', () => {
    expect(textOf('src/main/env/local.ts')).toMatch(/from 'node:fs'/);
    expect(textOf('src/main/projects/store.ts')).toMatch(/from 'node:fs'/);
    expect(textOf('src/main/secrets/store.ts')).toMatch(/from 'node:fs'/);
  });
});

describe('only the environment reaches the network module (AC2)', () => {
  it('nothing outside src/main/env imports src/main/commands/network', () => {
    for (const file of tsFiles('src/main')) {
      if (file.startsWith('src/main/env/')) continue;
      expect(textOf(file), file).not.toMatch(/commands\/network['"]/);
      // A sibling import from inside src/main/commands, written as './network'.
      if (file.startsWith('src/main/commands/')) {
        expect(textOf(file), file).not.toMatch(/from\s*['"]\.\/network['"]/);
      }
    }
  });
});

describe('tools, commands, the agent host and the agent side never name git (AC2)', () => {
  it('no file under the tool, command, agent or agent-side folders names src/main/git or a git member of an environment', () => {
    const files = [
      ...tsFiles('src/main/tools'),
      ...tsFiles('src/main/commands'),
      ...tsFiles('src/main/agent'),
      ...tsFiles('src/agent'),
    ];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = textOf(file);
      expect(text, file).not.toMatch(/main\/git|from '\.\.\/git\/git'/);
      expect(text, file).not.toMatch(/\.git\.\w+\s*\(/);
    }
  });
});

describe('only the WSL backend and its detection name wsl.exe (AC10, D42)', () => {
  it('no file under src outside src/main/env/wsl.ts and wsl-detect.ts names wsl.exe', () => {
    const files = tsFiles('src');
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      if (file === 'src/main/env/wsl.ts' || file === 'src/main/env/wsl-detect.ts') continue;
      expect(textOf(file), file).not.toMatch(/wsl\.exe/i);
    }
  });
});

describe('only the SSH transport imports ssh2 (AC14, D43)', () => {
  it('no file under src outside src/main/env/ssh-transport.ts imports ssh2', () => {
    const files = tsFiles('src');
    expect(files.length).toBeGreaterThan(40);
    const importsSsh2 = /(?:from\s*|require\(\s*|import\(\s*|import\s+)['"]ssh2(?:\/[^'"]*)?['"]/;
    for (const file of files) {
      if (file === 'src/main/env/ssh-transport.ts') continue;
      expect(textOf(file), file).not.toMatch(importsSsh2);
    }
    expect(textOf('src/main/env/ssh-transport.ts')).toMatch(/from 'ssh2'/);
  });

  it('the SSH modules under src/main import no node:fs, node:fs/promises or node:child_process (except the env folder)', () => {
    for (const file of [
      'src/main/projects/servers.ts',
      'src/main/env/ssh.ts',
      'src/main/env/ssh-command.ts',
    ]) {
      expect(textOf(file), file).not.toMatch(SYSTEM_IMPORT);
    }
  });
});
