// Detects a project's test and build commands from its marker files (D31). Node, Python, Go and
// Rust are read; a missing, unreadable or unparseable marker contributes nothing and never
// throws. The reader is synchronous and runs once, at host start. Runs only in main.

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One command the project runs: a bare program name and its exact arguments. */
export interface CommandForm {
  program: string;
  args: readonly string[];
}

export interface DetectedCommands {
  test: CommandForm[];
  build: CommandForm[];
}

/** Reads the project's marker files by root-relative path. */
export interface MarkerFiles {
  /** True when a regular file (not a folder, not a symlink) exists at the path. */
  exists(relPath: string): boolean;
  /** The file's text, or null when it is missing, unreadable, not a regular file or too large. */
  readText(relPath: string): string | null;
}

/** Largest marker file read, in bytes. Anything bigger is treated as unreadable. */
export const MARKER_MAX_BYTES = 1024 * 1024;

/** A reader over one project root. Symlinks are not followed, so a marker cannot point outside. */
export function rootMarkerFiles(root: string, maxBytes: number = MARKER_MAX_BYTES): MarkerFiles {
  const statOf = (relPath: string) => {
    try {
      return lstatSync(join(root, relPath));
    } catch {
      return null;
    }
  };
  return {
    exists(relPath) {
      return statOf(relPath)?.isFile() === true;
    },
    readText(relPath) {
      const stat = statOf(relPath);
      if (stat === null || !stat.isFile() || stat.size > maxBytes) {
        return null;
      }
      try {
        return readFileSync(join(root, relPath), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Managers that also have a bare `<pm> build` form. */
const BARE_BUILD_MANAGERS: readonly PackageManager[] = ['pnpm', 'yarn', 'bun'];

/** Lockfiles in the order they are read; the first one present decides. */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

const PYTHON_PYTEST_SECTION = /^\s*\[tool\.pytest(?:\.|\])/m;
const PYTHON_BUILD_SECTION = /^\s*\[build-system\]/m;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/** The parsed package.json object, or null when it is missing or is not a JSON object. */
function parsePackageJson(text: string | null): Record<string, unknown> | null {
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The package manager: the name before `@` in `packageManager` when it is one of the four,
 * otherwise the first lockfile present, otherwise npm.
 */
function packageManagerOf(pkg: Record<string, unknown>, files: MarkerFiles): PackageManager {
  const field = pkg['packageManager'];
  if (typeof field === 'string') {
    const at = field.indexOf('@');
    const name = at === -1 ? field : field.slice(0, at);
    if (isPackageManager(name)) {
      return name;
    }
  }
  for (const [file, manager] of LOCKFILES) {
    if (files.exists(file)) {
      return manager;
    }
  }
  return 'npm';
}

function nodeCommands(files: MarkerFiles): DetectedCommands {
  const empty: DetectedCommands = { test: [], build: [] };
  const pkg = parsePackageJson(files.readText('package.json'));
  const scripts = pkg !== null && isRecord(pkg['scripts']) ? pkg['scripts'] : null;
  if (pkg === null || scripts === null) {
    return empty;
  }
  const hasTest = typeof scripts['test'] === 'string';
  const hasBuild = typeof scripts['build'] === 'string';
  if (!hasTest && !hasBuild) {
    return empty;
  }
  const manager = packageManagerOf(pkg, files);
  const test: CommandForm[] = hasTest
    ? [
        { program: manager, args: ['test'] },
        { program: manager, args: ['run', 'test'] },
      ]
    : [];
  const build: CommandForm[] = [];
  if (hasBuild) {
    build.push({ program: manager, args: ['run', 'build'] });
    if (BARE_BUILD_MANAGERS.includes(manager)) {
      build.push({ program: manager, args: ['build'] });
    }
  }
  return { test, build };
}

function pythonCommands(files: MarkerFiles): DetectedCommands {
  const pyproject = files.readText('pyproject.toml');
  const validPyproject = pyproject !== null && isStructurallyValidToml(pyproject);
  const pytestMarked =
    files.exists('pytest.ini') ||
    files.exists('conftest.py') ||
    (validPyproject && PYTHON_PYTEST_SECTION.test(pyproject));
  const built = validPyproject && PYTHON_BUILD_SECTION.test(pyproject);
  return {
    test: pytestMarked
      ? [
          { program: 'pytest', args: [] },
          { program: 'python', args: ['-m', 'pytest'] },
        ]
      : [],
    build: built ? [{ program: 'python', args: ['-m', 'build'] }] : [],
  };
}

function goCommands(files: MarkerFiles): DetectedCommands {
  if (!files.exists('go.mod')) {
    return { test: [], build: [] };
  }
  return {
    test: [{ program: 'go', args: ['test', './...'] }],
    build: [{ program: 'go', args: ['build', './...'] }],
  };
}

function rustCommands(files: MarkerFiles): DetectedCommands {
  if (!files.exists('Cargo.toml')) {
    return { test: [], build: [] };
  }
  return {
    test: [{ program: 'cargo', args: ['test'] }],
    build: [{ program: 'cargo', args: ['build'] }],
  };
}

/**
 * Every command the project has, from every type whose marker is present. A mixed repo gets
 * every matching type. Pure over the reader: it never throws on bad input.
 */
export function detectCommands(files: MarkerFiles): DetectedCommands {
  const parts = [
    nodeCommands(files),
    pythonCommands(files),
    goCommands(files),
    rustCommands(files),
  ];
  return {
    test: parts.flatMap((part) => part.test),
    build: parts.flatMap((part) => part.build),
  };
}

type TomlMode = 'code' | 'comment' | 'basic' | 'literal' | 'multi-basic' | 'multi-literal';

/**
 * A structural check of TOML text, not a full parser. It accepts text whose strings and
 * brackets are closed, and whose top-level lines are table headers or key/value pairs. It is
 * enough to refuse garbage such as an unclosed array or a line with no `=`. Lines inside a
 * multi-line value or an array are not checked line by line.
 */
export function isStructurallyValidToml(text: string): boolean {
  let depth = 0;
  let mode: TomlMode = 'code';
  let lineHasContent = false;
  let lineHasKeyOrHeader = false;
  // A line that starts inside an array or a multi-line string continues a value.
  let lineContinues = false;

  const endLine = (): boolean => {
    const ok = !lineHasContent || lineHasKeyOrHeader || lineContinues;
    lineHasContent = false;
    lineHasKeyOrHeader = false;
    lineContinues = depth > 0;
    return ok;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (mode === 'basic' || mode === 'literal') {
      if (char === '\n') {
        return false;
      }
      if (mode === 'basic' && char === '\\') {
        i++;
      } else if (char === (mode === 'basic' ? '"' : "'")) {
        mode = 'code';
      }
      continue;
    }
    if (mode === 'multi-basic' || mode === 'multi-literal') {
      if (mode === 'multi-basic' && char === '\\') {
        i++;
      } else if (text.startsWith(mode === 'multi-basic' ? '"""' : "'''", i)) {
        mode = 'code';
        i += 2;
      }
      continue;
    }
    if (mode === 'comment') {
      if (char !== '\n') {
        continue;
      }
      mode = 'code';
    }
    if (char === '\n') {
      if (!endLine()) {
        return false;
      }
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      continue;
    }
    if (char === '#') {
      mode = 'comment';
      continue;
    }
    // A line that begins with `[` is a table header.
    if (!lineHasContent && char === '[') {
      lineHasKeyOrHeader = true;
    }
    lineHasContent = true;
    if (char === '=') {
      lineHasKeyOrHeader = true;
    }
    if (char === '"') {
      if (text.startsWith('"""', i)) {
        mode = 'multi-basic';
        i += 2;
      } else {
        mode = 'basic';
      }
    } else if (char === "'") {
      if (text.startsWith("'''", i)) {
        mode = 'multi-literal';
        i += 2;
      } else {
        mode = 'literal';
      }
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }
  if (
    mode === 'basic' ||
    mode === 'literal' ||
    mode === 'multi-basic' ||
    mode === 'multi-literal'
  ) {
    return false;
  }
  return depth === 0 && endLine();
}
