// Dev container detection (D44, p4-env-container). `detectDocker` reports whether the docker CLI is here, whether
// its engine answers, and the dev containers it holds (the ones with a devcontainer.local_folder label). The add
// wizard (p4-add-project-wizard) calls it when a user asks; nothing calls it at import time or at app start. It runs
// `docker version` and the label listing through the transport with argument arrays and no shell, and never throws.
// A container whose folder fails the folder rule is left out. This module, with container-transport.ts, is the only
// code that names the docker program (AC12). The transport is injected for the tests.

import {
  appContainerTransport,
  causeOf,
  DOCKER_TIMEOUT_MS,
  isContainerFolder,
  LABEL_CONFIG_FILE,
  LABEL_LOCAL_FOLDER,
  textOf,
  type ContainerTransport,
  type DockerHost,
} from './container-transport';

/** One dev container the detection found, as the add wizard shows it. */
export interface DetectedContainer {
  /** The folder the container was built for (its devcontainer.local_folder label). */
  folder: string;
  /** The devcontainer.json the container was built from, or null when the label is absent. */
  configFile: string | null;
  /** docker's name for the container. */
  name: string;
  running: boolean;
}

/** What detection found: no CLI, a CLI whose engine does not answer, or the engine and its dev containers. */
export type DockerDetection =
  | { cli: false }
  | { cli: true; engine: false }
  | { cli: true; engine: true; containers: DetectedContainer[] };

/** The seam for the tests: the transport to ask. Default: the app's transport for the host. */
export interface DetectDeps {
  transport?: ContainerTransport;
}

/** The most output a listing may return, in bytes. */
const LISTING_MAX_BYTES = 1024 * 1024;

/** One line of the label listing, as far as detection needs it. */
interface ListedRow {
  id: string;
  name: string;
  running: boolean;
}

/** The rows of a `docker ps --format '{{json .}}'` listing. A line that is not a container entry is skipped. */
function rowsOf(stdout: string): ListedRow[] {
  const rows: ListedRow[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['ID'] !== 'string' || record['ID'] === '') continue;
    rows.push({
      id: record['ID'],
      name: typeof record['Names'] === 'string' ? record['Names'] : '',
      running: record['State'] === 'running',
    });
  }
  return rows;
}

/** The labels of one inspected container, or null when the line is not a JSON object. */
function labelsOf(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * What the docker CLI, its engine and the dev containers on a host are (D44). `{ cli: false }` when the program cannot
 * start, or its own stderr says it is missing. `{ cli: true, engine: false }` when the engine does not answer. Otherwise
 * the containers with a devcontainer.local_folder label whose folder passes the folder rule. Never throws.
 */
export async function detectDocker(
  host: DockerHost,
  deps: DetectDeps = {},
): Promise<DockerDetection> {
  const transport = deps.transport ?? appContainerTransport(host);
  try {
    const version = await transport.run(['version', '--format', '{{json .}}'], {
      timeoutMs: DOCKER_TIMEOUT_MS,
      capture: { maxBytes: LISTING_MAX_BYTES },
    });
    if (!version.started) return { cli: false };
    if (
      version.code !== 0 &&
      !version.timedOut &&
      causeOf(textOf(version.stderr)) === 'docker-missing'
    ) {
      return { cli: false };
    }
    if (version.timedOut || version.code !== 0) return { cli: true, engine: false };

    const listed = await transport.run(
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        `label=${LABEL_LOCAL_FOLDER}`,
        '--format',
        '{{json .}}',
      ],
      { timeoutMs: DOCKER_TIMEOUT_MS, capture: { maxBytes: LISTING_MAX_BYTES } },
    );
    if (!listed.started || listed.timedOut || listed.code !== 0)
      return { cli: true, engine: false };
    const rows = rowsOf((listed.stdout ?? Buffer.alloc(0)).toString('utf8'));
    if (rows.length === 0) return { cli: true, engine: true, containers: [] };

    const inspected = await transport.run(
      ['inspect', '--format', '{{json .Config.Labels}}', ...rows.map((row) => row.id)],
      { timeoutMs: DOCKER_TIMEOUT_MS, capture: { maxBytes: LISTING_MAX_BYTES } },
    );
    if (!inspected.started || inspected.timedOut || inspected.code !== 0) {
      return { cli: true, engine: true, containers: [] };
    }
    const lines = (inspected.stdout ?? Buffer.alloc(0)).toString('utf8').split('\n');
    const containers: DetectedContainer[] = [];
    rows.forEach((row, index) => {
      const labels = labelsOf(lines[index] ?? '');
      const folder = labels?.[LABEL_LOCAL_FOLDER];
      if (!isContainerFolder(folder)) return;
      const config = labels?.[LABEL_CONFIG_FILE];
      containers.push({
        folder,
        configFile: typeof config === 'string' ? config : null,
        name: row.name,
        running: row.running,
      });
    });
    return { cli: true, engine: true, containers };
  } catch {
    return { cli: false };
  }
}
