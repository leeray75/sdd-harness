// Picks the environment backend for a project (D41, p4-env-local). `environmentFor` takes the
// project's environment descriptor (D40) and returns the backend, or a fixed refusal for a kind this
// version does not support. `localEnvironment` is the same object for the local kind; tests use it.
// `toolEnvironment` gives the narrower view the tools, commands and agent host take (no git).

import { localEnvironment } from './local';
import type { Environment, ToolEnvironment } from './types';

export { localEnvironment } from './local';
export type * from './types';

/** The refusal for an environment kind this version does not have. Fixed: it never echoes the kind. */
export const UNSUPPORTED_ENVIRONMENT =
  "this project's environment is not supported in this version";

/** The outcome of choosing a backend. */
export type EnvironmentResult = { ok: true; env: Environment } | { ok: false; reason: string };

/**
 * The backend for a project's environment descriptor. Only the local kind exists in this version;
 * any other kind is refused with UNSUPPORTED_ENVIRONMENT, and the registry refuses the project.
 */
export function environmentFor(descriptor: { readonly kind: string }): EnvironmentResult {
  if (descriptor.kind === 'local') {
    return { ok: true, env: localEnvironment() };
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
