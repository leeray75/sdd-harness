// A recording test backend for the environment interface (D41, p4-env-local, AC6). It wraps the
// local backend and records every call by part and method, so a test can show that a step reached its
// result only through the interface. Each call still runs on the local backend, on a temp folder.

import { localEnvironment } from '../../src/main/env';
import type { Environment } from '../../src/main/env/types';

/** The parts of the interface, by name. */
export type EnvPart = 'path' | 'files' | 'process' | 'watch' | 'git';

/** One recorded call: the part, the method and the arguments it was given. */
export interface EnvCall {
  part: EnvPart;
  method: string;
  args: unknown[];
}

/** The wrapped environment and the calls made through it, in order. */
export interface RecordingEnv {
  env: Environment;
  calls: EnvCall[];
  /** The method names recorded for one part, in call order. */
  methodsOf(part: EnvPart): string[];
}

/**
 * A copy of one part whose functions record each call before they run on the local backend. Values
 * that are not functions (the platform, the path separator) are copied as they are.
 */
function recordPart<T extends object>(part: EnvPart, target: T, calls: EnvCall[]): T {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(target)) {
    const value = (target as Record<string, unknown>)[key];
    if (typeof value === 'function') {
      copy[key] = (...args: unknown[]) => {
        calls.push({ part, method: key, args });
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    } else {
      copy[key] = value;
    }
  }
  return copy as T;
}

/** A recording environment over the local backend. Each test makes its own. */
export function recordingEnvironment(): RecordingEnv {
  const base = localEnvironment();
  const calls: EnvCall[] = [];
  const env: Environment = {
    path: recordPart('path', base.path, calls),
    files: recordPart('files', base.files, calls),
    process: recordPart('process', base.process, calls),
    watch: recordPart('watch', base.watch, calls),
    git: recordPart('git', base.git, calls),
  };
  return {
    env,
    calls,
    methodsOf: (part) => calls.filter((call) => call.part === part).map((call) => call.method),
  };
}
