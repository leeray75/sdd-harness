// The main-side scanner of docs/specs (p3-spec-docs, D35). It lists a project's feature folders,
// reads the known files with node:fs/promises, and detects each folder's node with the shared
// parsers and detector (src/shared/spec-docs.ts, src/shared/spec-detect.ts). It only reads: it
// writes nothing. It never throws for a missing, unreadable or odd entry: that is reported in the
// result. Symbolic links and junctions are not followed, and each file read is capped in bytes.

import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { type Approval, type FolderDetection, detectFolder } from '../../shared/spec-detect';
import {
  SPEC_FILES,
  SPECS_DIR,
  type LedgerFile,
  type PlanFile,
  type SpecFileName,
  type SpecsFile,
  type TasksFile,
  isFeatureSlug,
  parseLedger,
  parsePlan,
  parseSpecs,
  parseTasks,
} from '../../shared/spec-docs';

/** The most bytes read from one file. Longer files are read up to this many, and reported. */
export const MAX_SPEC_FILE_BYTES = 256 * 1024;

/** One known file of a folder: present, absent, or unreadable (with the reason). */
export interface FileState {
  state: 'present' | 'absent' | 'unreadable';
  /** Why the file is unreadable: a fixed phrase, or the error code. '' otherwise. */
  reason: string;
  /** The file's modification time in ms, -1 when it was not a regular file or is absent. */
  mtimeMs: number;
  /** True when the file is longer than MAX_SPEC_FILE_BYTES and only its start was read. */
  truncated: boolean;
}

/** One feature folder, read and detected. */
export interface SpecFolder {
  feature: string;
  /** The state of every known file, by name. */
  files: Record<SpecFileName, FileState>;
  /** The parsed files. A missing or unreadable file parses as absent, with a problem noted. */
  parsed: { plan: PlanFile; specs: SpecsFile; tasks: TasksFile; ledger: LedgerFile };
  detection: FolderDetection;
  /** The newest modification time of a known file, in ms (-1 when there is none). */
  newestMtime: number;
}

/** The approval of one feature, by name. The default is `none`, with no lock. */
export type ApprovalOf = (feature: string) => Approval;

const ABSENT: FileState = { state: 'absent', reason: '', mtimeMs: -1, truncated: false };

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'error';
}

function unreadable(reason: string): FileState {
  return { state: 'unreadable', reason, mtimeMs: -1, truncated: false };
}

// isRealDir: a directory that is not a symbolic link or junction. False for anything else, and for
// an error (a missing folder is not a folder to scan).
async function isRealDir(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

// readCapped: the first MAX_SPEC_FILE_BYTES bytes of a file, as text. An error is returned as its
// code, never thrown.
async function readCapped(
  path: string,
  size: number,
): Promise<{ text: string } | { error: string }> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(Math.min(size, MAX_SPEC_FILE_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8') };
  } catch (error) {
    return { error: errorCode(error) };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

// inspect: the state of one known file, and its text when wanted. Never throws.
async function inspect(
  path: string,
  wantText: boolean,
): Promise<{ file: FileState; text: string | null }> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { file: ABSENT, text: null };
    return { file: unreadable(code), text: null };
  }
  if (stats.isSymbolicLink()) {
    return { file: unreadable('a symbolic link is not followed'), text: null };
  }
  if (!stats.isFile()) return { file: unreadable('not a regular file'), text: null };
  const present: FileState = {
    state: 'present',
    reason: '',
    mtimeMs: stats.mtimeMs,
    truncated: stats.size > MAX_SPEC_FILE_BYTES,
  };
  if (!wantText) return { file: present, text: null };
  const read = await readCapped(path, stats.size);
  if ('error' in read) return { file: unreadable(read.error), text: null };
  return { file: present, text: read.text };
}

// fileProblems: the problems a file's state adds to its parsed result.
function fileProblems(name: SpecFileName, file: FileState): string[] {
  const problems: string[] = [];
  if (file.state === 'unreadable') problems.push(`${name} could not be read: ${file.reason}`);
  if (file.truncated) {
    problems.push(`${name} is longer than ${MAX_SPEC_FILE_BYTES} bytes; only its start was read`);
  }
  return problems;
}

/**
 * Reads and detects one feature folder given its path. Returns null when the folder holds none of
 * the known files. Does not check the feature name: the callers do (readSpecFolder).
 */
export async function readSpecFolderAt(
  dir: string,
  feature: string,
  approval: Approval = 'none',
): Promise<SpecFolder | null> {
  const files = {} as Record<SpecFileName, FileState>;
  const texts = {} as Record<SpecFileName, string | null>;
  const wanted: ReadonlySet<SpecFileName> = new Set([
    'PLAN.md',
    'SPECS.md',
    'tasks.md',
    'build-ledger.md',
  ]);
  for (const name of SPEC_FILES) {
    const inspected = await inspect(join(dir, name), wanted.has(name));
    files[name] = inspected.file;
    texts[name] = inspected.text;
  }
  if (SPEC_FILES.every((name) => files[name].state === 'absent')) return null;

  const plan = parsePlan(texts['PLAN.md']);
  const specs = parseSpecs(texts['SPECS.md']);
  const tasks = parseTasks(texts['tasks.md']);
  const ledger = parseLedger(texts['build-ledger.md']);
  plan.problems.push(...fileProblems('PLAN.md', files['PLAN.md']));
  specs.problems.push(...fileProblems('SPECS.md', files['SPECS.md']));
  tasks.problems.push(...fileProblems('tasks.md', files['tasks.md']));
  ledger.problems.push(...fileProblems('build-ledger.md', files['build-ledger.md']));

  const detection = detectFolder({
    approval,
    files: {
      plan: files['PLAN.md'].state === 'present',
      specs: files['SPECS.md'].state === 'present',
      summary: files['SUMMARY.md'].state === 'present',
    },
    planStatus: plan.status,
    ledgerState: ledger.state,
    currentRound: ledger.currentRound,
    phase: ledger.phase,
  });
  const newestMtime = Math.max(-1, ...SPEC_FILES.map((name) => files[name].mtimeMs));
  return {
    feature,
    files,
    parsed: { plan, specs, tasks, ledger },
    detection,
    newestMtime,
  };
}

/**
 * Reads and detects the feature folder `docs/specs/<feature>/` of a project. Null when the feature
 * is not a valid slug, the folder or docs/specs is missing or a symbolic link, or the folder holds
 * none of the known files.
 */
export async function readSpecFolder(
  projectRoot: string,
  feature: string,
  approval: Approval = 'none',
): Promise<SpecFolder | null> {
  if (!isFeatureSlug(feature)) return null;
  const specsDir = join(projectRoot, SPECS_DIR);
  if (!(await isRealDir(specsDir))) return null;
  const dir = join(specsDir, feature);
  if (!(await isRealDir(dir))) return null;
  return readSpecFolderAt(dir, feature, approval);
}

/**
 * Scans docs/specs: every valid feature folder, sorted by slug, that holds a known file. Entries
 * that are not folders, not valid slugs, or symbolic links are skipped. Returns [] when docs/specs
 * is missing or unreadable. `approvalOf` gives each feature's approval; it defaults to `none`.
 */
export async function scanSpecFolders(
  projectRoot: string,
  approvalOf: ApprovalOf = () => 'none',
): Promise<SpecFolder[]> {
  const specsDir = join(projectRoot, SPECS_DIR);
  if (!(await isRealDir(specsDir))) return [];
  let entries;
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && isFeatureSlug(entry.name))
    .map((entry) => entry.name)
    .sort();
  const folders: SpecFolder[] = [];
  for (const name of names) {
    const folder = await readSpecFolder(projectRoot, name, approvalOf(name));
    if (folder) folders.push(folder);
  }
  return folders;
}
