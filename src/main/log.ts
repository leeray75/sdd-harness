// Main-process log helper. Lines go to stdout and stderr only; there are no log files and
// no logging library. Callers must never pass tool arguments: log the job, the tool name
// and the reason only. Every line passes through the process-wide redactor first (D25), so
// a known secret value or a credential-shaped string never reaches stdout or stderr.

import { redactor } from './secrets/redact';

const PREFIX = '[harness]';

/** The part of the log that the agent router needs. */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export const log: Logger & {
  /** A warning: written to stderr, like an error, with the same prefix. */
  warn(message: string): void;
  /** Writes a line from the agent's own output, redacted, to stdout or stderr. */
  forward(line: string, toStderr: boolean): void;
} = {
  info(message: string): void {
    process.stdout.write(redactor.redact(`${PREFIX} ${message}`) + '\n');
  },
  warn(message: string): void {
    process.stderr.write(redactor.redact(`${PREFIX} ${message}`) + '\n');
  },
  error(message: string): void {
    process.stderr.write(redactor.redact(`${PREFIX} ${message}`) + '\n');
  },
  forward(line: string, toStderr: boolean): void {
    const stream = toStderr ? process.stderr : process.stdout;
    stream.write(redactor.redact(line) + '\n');
  },
};
