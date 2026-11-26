import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectCommands,
  isStructurallyValidToml,
  rootMarkerFiles,
  type MarkerFiles,
} from '../../src/main/commands/detect';
import { localEnvironment, toolEnvironment } from '../../src/main/env';

/** An in-memory reader over a map of root-relative paths to text. */
function memory(files: Record<string, string>): MarkerFiles {
  return {
    exists: (relPath) => Object.prototype.hasOwnProperty.call(files, relPath),
    readText: (relPath) =>
      Object.prototype.hasOwnProperty.call(files, relPath) ? (files[relPath] ?? null) : null,
  };
}

function pkg(scripts: Record<string, string>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'app', scripts, ...extra });
}

const NODE_TEST = [
  { program: 'npm', args: ['test'] },
  { program: 'npm', args: ['run', 'test'] },
];

describe('detectCommands: Node', () => {
  it('gives test and run-test forms, and run-build only, for npm without a bare build', () => {
    const detected = detectCommands(
      memory({ 'package.json': pkg({ test: 'vitest', build: 'tsc' }) }),
    );
    expect(detected.test).toEqual(NODE_TEST);
    expect(detected.build).toEqual([{ program: 'npm', args: ['run', 'build'] }]);
  });

  it.each([
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lockb'],
    ['bun', 'bun.lock'],
    ['npm', 'package-lock.json'],
  ])(
    'uses %s from the %s lockfile and adds the bare build form only for pnpm, yarn and bun',
    (pm, lock) => {
      const detected = detectCommands(
        memory({ 'package.json': pkg({ test: 'x', build: 'y' }), [lock]: '' }),
      );
      expect(detected.test).toEqual([
        { program: pm, args: ['test'] },
        { program: pm, args: ['run', 'test'] },
      ]);
      const bare = ['pnpm', 'yarn', 'bun'].includes(pm);
      expect(detected.build).toEqual([
        { program: pm, args: ['run', 'build'] },
        ...(bare ? [{ program: pm, args: ['build'] }] : []),
      ]);
    },
  );

  it('reads the package manager from packageManager before the lockfiles', () => {
    const detected = detectCommands(
      memory({
        'package.json': pkg({ test: 'x' }, { packageManager: 'pnpm@12.21.0' }),
        'package-lock.json': '',
      }),
    );
    expect(detected.test[0]).toEqual({ program: 'pnpm', args: ['test'] });
  });

  it('ignores a packageManager name it does not know and falls back to the lockfile', () => {
    const detected = detectCommands(
      memory({
        'package.json': pkg({ test: 'x' }, { packageManager: 'deno@2.0.0' }),
        'yarn.lock': '',
      }),
    );
    expect(detected.test[0]).toEqual({ program: 'yarn', args: ['test'] });
  });

  it('uses the first lockfile in order when several are present', () => {
    const detected = detectCommands(
      memory({
        'package.json': pkg({ test: 'x' }),
        'package-lock.json': '',
        'pnpm-lock.yaml': '',
      }),
    );
    expect(detected.test[0]?.program).toBe('pnpm');
  });

  it('gives npm when there is no packageManager field and no lockfile', () => {
    expect(detectCommands(memory({ 'package.json': pkg({ test: 'x' }) })).test[0]?.program).toBe(
      'npm',
    );
  });

  it('gives no test forms without scripts.test, and no build forms without scripts.build', () => {
    const onlyBuild = detectCommands(memory({ 'package.json': pkg({ build: 'tsc' }) }));
    expect(onlyBuild.test).toEqual([]);
    expect(onlyBuild.build.length).toBeGreaterThan(0);
    const onlyTest = detectCommands(memory({ 'package.json': pkg({ test: 'vitest' }) }));
    expect(onlyTest.build).toEqual([]);
  });

  it('ignores script values that are not strings', () => {
    const detected = detectCommands(
      memory({ 'package.json': JSON.stringify({ scripts: { test: ['x'], build: 3 } }) }),
    );
    expect(detected).toEqual({ test: [], build: [] });
  });

  it('gives nothing for a package.json without a scripts object', () => {
    expect(detectCommands(memory({ 'package.json': '{"name":"x"}' }))).toEqual({
      test: [],
      build: [],
    });
  });
});

describe('detectCommands: Python', () => {
  it('gives pytest forms for pytest.ini, a root conftest.py, or [tool.pytest in pyproject', () => {
    const forms = [
      { program: 'pytest', args: [] },
      { program: 'python', args: ['-m', 'pytest'] },
    ];
    expect(detectCommands(memory({ 'pytest.ini': '[pytest]\n' })).test).toEqual(forms);
    expect(detectCommands(memory({ 'conftest.py': '' })).test).toEqual(forms);
    expect(
      detectCommands(
        memory({
          'pyproject.toml': '[project]\nname = "x"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n',
        }),
      ).test,
    ).toEqual(forms);
  });

  it('gives python -m build when pyproject has [build-system]', () => {
    const detected = detectCommands(
      memory({ 'pyproject.toml': '[build-system]\nrequires = ["setuptools"]\n' }),
    );
    expect(detected.build).toEqual([{ program: 'python', args: ['-m', 'build'] }]);
    expect(detected.test).toEqual([]);
  });

  it('gives nothing when a [tool.pytest word is only a prefix of another table', () => {
    expect(detectCommands(memory({ 'pyproject.toml': '[tool.pytestx]\na = 1\n' })).test).toEqual(
      [],
    );
  });

  it('gives no forms for an invalid pyproject.toml, and does not throw', () => {
    const broken = [
      '[build-system\nrequires = ["setuptools"]',
      '[build-system]\nrequires = [',
      'this is not toml at all',
      '[tool.pytest.ini_options]\nname = "unclosed',
    ];
    for (const text of broken) {
      expect(() => detectCommands(memory({ 'pyproject.toml': text }))).not.toThrow();
      expect(detectCommands(memory({ 'pyproject.toml': text }))).toEqual({
        test: [],
        build: [],
      });
    }
  });

  it('still gives pytest forms from pytest.ini when pyproject is invalid', () => {
    const detected = detectCommands(
      memory({ 'pytest.ini': '', 'pyproject.toml': 'garbage with no equals' }),
    );
    expect(detected.test[0]).toEqual({ program: 'pytest', args: [] });
    expect(detected.build).toEqual([]);
  });
});

describe('isStructurallyValidToml', () => {
  it('accepts ordinary TOML with tables, arrays, strings and comments', () => {
    expect(
      isStructurallyValidToml(
        '# comment\n[project]\nname = "x" # trailing\nlist = [\n  "a",\n  "b",\n]\ntext = """\nmulti\n"""\ninline = { a = 1 }\nlit = \'v\'\n',
      ),
    ).toBe(true);
    expect(isStructurallyValidToml('')).toBe(true);
  });

  it('refuses unclosed strings, unclosed brackets and lines without a key or header', () => {
    expect(isStructurallyValidToml('a = "open')).toBe(false);
    expect(isStructurallyValidToml('a = [1, 2')).toBe(false);
    expect(isStructurallyValidToml('a = 1]')).toBe(false);
    expect(isStructurallyValidToml('just words')).toBe(false);
    expect(isStructurallyValidToml('a = "x\nb = 2')).toBe(false);
  });
});

describe('detectCommands: Go and Rust', () => {
  it('gives go test ./... and go build ./... for go.mod', () => {
    expect(detectCommands(memory({ 'go.mod': 'module x\n' }))).toEqual({
      test: [{ program: 'go', args: ['test', './...'] }],
      build: [{ program: 'go', args: ['build', './...'] }],
    });
  });

  it('gives cargo test and cargo build for Cargo.toml', () => {
    expect(detectCommands(memory({ 'Cargo.toml': '[package]\nname = "x"\n' }))).toEqual({
      test: [{ program: 'cargo', args: ['test'] }],
      build: [{ program: 'cargo', args: ['build'] }],
    });
  });
});

describe('detectCommands: mixed and empty repos', () => {
  it('gives every matching type in a mixed repo', () => {
    const detected = detectCommands(
      memory({
        'package.json': pkg({ test: 'x', build: 'y' }),
        'pnpm-lock.yaml': '',
        'go.mod': 'module x',
        'Cargo.toml': '[package]',
        'pytest.ini': '',
      }),
    );
    const programs = detected.test.map((form) => form.program);
    expect(programs).toEqual(['pnpm', 'pnpm', 'pytest', 'python', 'go', 'cargo']);
    expect(detected.build.map((form) => form.program)).toEqual(['pnpm', 'pnpm', 'go', 'cargo']);
  });

  it('gives nothing for a root with no markers', () => {
    expect(detectCommands(memory({ 'README.md': '# hi' }))).toEqual({ test: [], build: [] });
  });
});

describe('rootMarkerFiles: the root-backed reader', () => {
  let base: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'command-detect-'));
    mkdirSync(join(base, 'folder-marker'));
    writeFileSync(join(base, 'package.json'), pkg({ test: 'vitest' }));
    writeFileSync(join(base, 'big.json'), 'x'.repeat(2048));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reports files and not folders, and reads text', async () => {
    const reader = await rootMarkerFiles(toolEnvironment(localEnvironment()), base);
    expect(reader.exists('package.json')).toBe(true);
    expect(reader.exists('folder-marker')).toBe(false);
    expect(reader.exists('missing.txt')).toBe(false);
    expect(reader.readText('package.json')).toContain('vitest');
    expect(reader.readText('missing.txt')).toBeNull();
  });

  it('refuses to read a file over the size cap', async () => {
    expect(
      (await rootMarkerFiles(toolEnvironment(localEnvironment()), base, 1024)).readText('big.json'),
    ).toBeNull();
    expect(
      (await rootMarkerFiles(toolEnvironment(localEnvironment()), base, 4096)).readText('big.json'),
    ).not.toBeNull();
  });

  it('detects the commands of a real folder', async () => {
    expect(
      detectCommands(await rootMarkerFiles(toolEnvironment(localEnvironment()), base)).test[0],
    ).toEqual({
      program: 'npm',
      args: ['test'],
    });
  });

  it('gives nothing for a folder that does not exist, and does not throw', async () => {
    const reader = await rootMarkerFiles(
      toolEnvironment(localEnvironment()),
      join(base, 'no-such-root'),
    );
    expect(detectCommands(reader)).toEqual({ test: [], build: [] });
  });
});
