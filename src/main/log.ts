// Main-process log helper. Lines go to stdout and stderr only; there are no log files and
// no logging library. Callers must never pass tool arguments: log the job, the tool name
// and the reason only.

const PREFIX = '[harness]';

/** The part of the log that the agent router needs. */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export const log: Logger & {
  /** Writes a line from the agent's own output unchanged, to stdout or stderr. */
  forward(line: string, toStderr: boolean): void;
} = {
  info(message: string): void {
    process.stdout.write(`${PREFIX} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${PREFIX} ${message}\n`);
  },
  forward(line: string, toStderr: boolean): void {
    const stream = toStderr ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  },
};
