// Extra headers for the adapters (D27, p1-openai-compatible). Headers come from the spike's
// HARNESS_SPIKE_HEADERS text as `Name: value` lines, or from a caller as a record. A name must be
// an HTTP token, a value must have no CR, LF or NUL, and the names that carry the key or fix the
// request shape are refused, so no key can arrive through a header (D25). Header values are
// configuration, not secrets. A refusal reason names the line or the header name and the rule
// broken; it never contains a header value.

export type HeaderResult =
  { ok: true; headers: Record<string, string> } | { ok: false; reason: string };

/** An HTTP token: the only legal header name characters (RFC 9110). */
const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Characters that would split a header line or end a C string: no value may hold them. */
const FORBIDDEN_VALUE = /[\r\n\0]/;

/** Header names the adapters set themselves, or that carry the key (compared lower-case). */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'anthropic-version',
  'content-type',
  'content-length',
  'host',
]);

/**
 * The rule a name breaks, or null when it is usable. The reason never echoes an invalid name,
 * because the text before a colon could be a pasted value.
 */
function nameProblem(name: string): string | null {
  if (!HTTP_TOKEN.test(name)) {
    return 'the header name is not a valid HTTP token';
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return `the header "${name}" is reserved (the adapter sets it or it carries the key)`;
  }
  return null;
}

/** The rule a value breaks, or null when it is usable. */
function valueProblem(value: string): string | null {
  if (FORBIDDEN_VALUE.test(value)) {
    return 'the value contains a CR, LF or NUL character';
  }
  return null;
}

/**
 * Parses header text: one `Name: value` per line, split on \n or \r\n. Blank lines are ignored,
 * and each line splits at its first colon. Names and values are trimmed. Refuses a line with no
 * colon, an empty name, a repeated name (ignoring case), and anything `validateHeaders` refuses.
 * Empty text gives no headers.
 */
export function parseHeaderLines(text: string): HeaderResult {
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      continue;
    }
    const number = index + 1;
    const colon = line.indexOf(':');
    if (colon === -1) {
      return { ok: false, reason: `line ${number} has no ":" between the name and the value` };
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name === '') {
      return { ok: false, reason: `line ${number} has an empty header name` };
    }
    const nameRule = nameProblem(name);
    if (nameRule !== null) {
      return { ok: false, reason: `line ${number}: ${nameRule}` };
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) {
      return {
        ok: false,
        reason: `line ${number} repeats the header "${name}" (names ignore case)`,
      };
    }
    const valueRule = valueProblem(value);
    if (valueRule !== null) {
      return { ok: false, reason: `line ${number}: header "${name}": ${valueRule}` };
    }
    seen.add(folded);
    entries.push([name, value]);
  }
  // fromEntries defines each key as data, so a name such as __proto__ stays an ordinary header.
  return { ok: true, headers: Object.fromEntries(entries) };
}

/**
 * Checks a header record: each name is an HTTP token and not reserved, no two names are the same
 * ignoring case, and each value is a string with no CR, LF or NUL. Returns a copy when it passes.
 */
export function validateHeaders(headers: Record<string, string>): HeaderResult {
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameRule = nameProblem(name);
    if (nameRule !== null) {
      return { ok: false, reason: nameRule };
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) {
      return { ok: false, reason: `the header "${name}" repeats another name (names ignore case)` };
    }
    seen.add(folded);
    if (typeof value !== 'string') {
      return { ok: false, reason: `the value of header "${name}" is not a string` };
    }
    const valueRule = valueProblem(value);
    if (valueRule !== null) {
      return { ok: false, reason: `header "${name}": ${valueRule}` };
    }
    entries.push([name, value]);
  }
  return { ok: true, headers: Object.fromEntries(entries) };
}
