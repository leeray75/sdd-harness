// Picks the environment backend for a project (D41, p4-env-local; D42, p4-env-wsl). `environmentFor` takes
// the project's environment descriptor (D40) and returns the backend, or a fixed refusal for a kind or a
// case this version does not support. `localEnvironment` is the same object for the local kind; tests use
// it. `toolEnvironment` gives the narrower view the tools, commands and the agent host take (no git).
// The WSL kind is built on Windows only, and the platform and the transport maker can be injected for
// the tests.

import type { SshServer } from '../projects/servers';
import type { SecretStore } from '../secrets/store';
import type { Logger } from '../log';
import {
  appContainerTransport,
  parseDockerHost,
  isContainerFolder,
  type ContainerTransport,
  type DockerHost,
} from './container-transport';
import { createContainerEnvironment } from './container';
import { localEnvironment } from './local';
import { createSshEnvironment } from './ssh';
import { appSshTransport, type SshTransport } from './ssh-transport';
import { appWslTransport, createWslEnvironment, type WslTransport } from './wsl';
import { isDistributionName } from './wsl-detect';
import type { Environment, ToolEnvironment } from './types';

export { localEnvironment } from './local';
export type * from './types';

/** The refusal for an environment kind this version does not have. Fixed: it never echoes the kind. */
export const UNSUPPORTED_ENVIRONMENT =
  "this project's environment is not supported in this version";

/** The refusal for a WSL project off Windows. Fixed. */
export const WSL_UNAVAILABLE = 'WSL projects are available only on Windows';

/** The outcome of choosing a backend. */
export type EnvironmentResult = { ok: true; env: Environment } | { ok: false; reason: string };

/**
 * The descriptor of a project's environment: the kind, the WSL distribution, the SSH server id, or the dev
 * container's folder and Docker host (D44).
 */
export interface EnvironmentDescriptor {
  readonly kind: string;
  readonly distribution?: unknown;
  readonly server?: unknown;
  readonly folder?: unknown;
  readonly docker?: unknown;
}

/** What the SSH kind needs (D43): the saved servers, the secrets and the log, and the transport maker for tests. */
export interface SshDeps {
  /** The saved server with this id, or null. */
  servers: { get(id: string): SshServer | null };
  secrets: SecretStore;
  logger: Logger;
  /** Makes a server's transport. Default: the app's transport over ssh2. Tests inject a fake. */
  transportFor?: (server: SshServer) => SshTransport;
}

/** What environmentFor may be given: the platform and the transport maker for WSL, the SSH deps, and the docker maker (D44). */
export interface EnvironmentDeps {
  platform?: NodeJS.Platform;
  transportFor?: (distribution: string) => WslTransport;
  ssh?: SshDeps;
  /** Makes the docker transport of a Docker host. Default: the app's transport. Tests inject a fake. */
  containerTransportFor?: (host: DockerHost) => ContainerTransport;
}

/** A saved server id: a lowercase UUID (D43). */
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One transport per saved server id (D43): every project on a server shares its client and its connection.
 * Made when the first project on the server needs one. Making one does not connect.
 */
const sshTransports = new Map<string, SshTransport>();

function sshTransportFor(server: SshServer, ssh: SshDeps): SshTransport {
  let transport = sshTransports.get(server.id);
  if (transport === undefined) {
    transport =
      ssh.transportFor?.(server) ??
      appSshTransport(server, {
        secrets: ssh.secrets,
        logger: ssh.logger,
        latest: (id) => ssh.servers.get(id),
      });
    sshTransports.set(server.id, transport);
  }
  return transport;
}

/**
 * The backend for a project's environment descriptor. The local kind is the local backend. The WSL kind is
 * built on Windows for a valid distribution name. The name is checked first (UNSUPPORTED_ENVIRONMENT for a
 * bad or missing name, on any platform), then the platform (WSL_UNAVAILABLE off Windows). The container kind is built
 * for a valid folder and Docker host (D44), with the same checks for a WSL Docker host. Any other kind is refused
 * with UNSUPPORTED_ENVIRONMENT.
 * No reason echoes a value from the descriptor.
 */
export function environmentFor(
  descriptor: EnvironmentDescriptor,
  deps: EnvironmentDeps = {},
): EnvironmentResult {
  if (descriptor.kind === 'local') {
    return { ok: true, env: localEnvironment() };
  }
  if (descriptor.kind === 'wsl') {
    const distribution = descriptor.distribution;
    if (!isDistributionName(distribution)) return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
    const platform = deps.platform ?? process.platform;
    if (platform !== 'win32') return { ok: false, reason: WSL_UNAVAILABLE };
    const transport = (deps.transportFor ?? appWslTransport)(distribution);
    return { ok: true, env: createWslEnvironment({ distribution, transport }) };
  }
  if (descriptor.kind === 'ssh') {
    // An unknown or malformed server id is refused; nothing is connected here (D43).
    const id = descriptor.server;
    if (typeof id !== 'string' || !SERVER_ID.test(id) || deps.ssh === undefined) {
      return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
    }
    const server = deps.ssh.servers.get(id);
    if (server === null) return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
    const transport = sshTransportFor(server, deps.ssh);
    return { ok: true, env: createSshEnvironment({ server, transport }) };
  }
  if (descriptor.kind === 'container') {
    // A malformed folder or Docker host is refused before anything is made (D44). Making the backend starts nothing.
    const folder = descriptor.folder;
    const docker = parseDockerHost(descriptor.docker);
    if (!isContainerFolder(folder) || docker === null)
      return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
    if (docker.kind === 'wsl') {
      if (!isDistributionName(docker.distribution))
        return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
      const platform = deps.platform ?? process.platform;
      if (platform !== 'win32') return { ok: false, reason: WSL_UNAVAILABLE };
    }
    const transport = (deps.containerTransportFor ?? appContainerTransport)(docker);
    return {
      ok: true,
      env: createContainerEnvironment({ descriptor: { folder, docker }, transport }),
    };
  }
  return { ok: false, reason: UNSUPPORTED_ENVIRONMENT };
}

/** The narrower view for tools, commands and the agent host: paths, files, programs and ignored entries. */
export function toolEnvironment(env: Environment): ToolEnvironment {
  return {
    path: env.path,
    files: env.files,
    process: env.process,
    ignoredEntries: (root, processEnv) => env.git.ignoredEntries(root, processEnv),
  };
}
