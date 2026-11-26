// The process launcher shared by the remote backends (D42 WSL, D43 SSH). A program runs as the argument
// `sh -c LAUNCHER sh <file> <args…>`: the outer shell runs `setsid --wait`, which makes the program a new
// session and process group, and the inner shell prints one marker line with the group id, then replaces
// itself with the program. No argument is ever parsed by a shell. The marker line is taken out of the
// output here (createMarkerReader), so the caller never sees it. Pure: no import of node:fs or a transport.

/** The text the launcher prints before the group id on its first line. */
export const GROUP_MARKER = 'SDD-GROUP-';

/**
 * The fixed launcher (D42, D43). The outer shell runs `setsid --wait`, which makes the program a new
 * session and process group, with its id as the group id. The inner shell prints the marker and its
 * own id (the group id, since the id is unchanged by exec), then replaces itself with the program
 * from the positional arguments, so no argument is ever parsed by a shell.
 */
export const LAUNCHER =
  'setsid --wait sh -c \'printf "%s%s\\n" "$0" "$$"; exec "$@"\' ' + GROUP_MARKER + ' "$@"';

/** Most bytes kept of the marker line before a line break arrives; past it the line is dropped. */
const MARKER_MAX_BYTES = 4096;

/** The reader of the first output line: it takes the marker out and keeps the group id. */
export interface MarkerReader {
  /** The process group id from the marker line, or null until it has arrived. */
  readonly group: number | null;
  /**
   * Takes one chunk of output. Returns the bytes to pass on, or null when there are none. The marker
   * line never comes back out.
   */
  feed(chunk: Buffer): Buffer | null;
}

/** A reader for one program's output. Each program gets its own reader. */
export function createMarkerReader(): MarkerReader {
  let group: number | null = null;
  let head: Buffer = Buffer.alloc(0);
  let marked = false;
  return {
    get group() {
      return group;
    },
    feed(chunk) {
      if (marked) return chunk;
      head = Buffer.concat([head, chunk]);
      const newline = head.indexOf(0x0a);
      if (newline < 0) {
        if (head.length > MARKER_MAX_BYTES) {
          marked = true;
          head = Buffer.alloc(0);
        }
        return null;
      }
      const match = new RegExp(`^${GROUP_MARKER}(\\d+)$`).exec(
        head.subarray(0, newline).toString('utf8'),
      );
      marked = true;
      if (match !== null) group = Number(match[1]);
      const rest = head.subarray(newline + 1);
      head = Buffer.alloc(0);
      return rest.length > 0 ? rest : null;
    },
  };
}
