// Redaction for every line main writes (D25). A redactor remembers the secret values the
// store has handed out and replaces them, and anything shaped like a credential, with
// `[redacted]`. Pure: no Electron imports, so the store, the logger and tests can share it.

export const REDACTED = '[redacted]';

/** Replaces known secret values and credential-shaped text in a string. */
export interface Redactor {
  /** Remembers a value so that every later `redact` call removes it. Blank values are ignored. */
  register(value: string): void;
  /** Returns the text with every known value and credential shape replaced. */
  redact(text: string): string;
}

/** A Bearer token: the word, its spaces, then the token. The word itself is kept. */
const BEARER_PATTERN = /(\bBearer[ \t]+)[^\s"'`,;<>]+/gi;
/** A JSON header pair: `"authorization":"value"` or `"x-api-key": "value"`. */
const JSON_HEADER_PATTERN = /"(authorization|x-api-key)"(\s*:\s*)"[^"]*"/gi;
/** A plain header line: `Authorization: value` or `x-api-key: value`, to the end of the line. */
const PLAIN_HEADER_PATTERN = /\b(authorization|x-api-key)(\s*:\s*)[^\r\n]+/gi;
/** Key-shaped tokens: `sk-` or `sk-ant-` followed by at least 20 key characters. */
const KEY_SHAPE_PATTERN = /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g;

export function createRedactor(): Redactor {
  const known = new Set<string>();

  function replaceKnown(text: string): string {
    // Longest first, so a value that contains a shorter registered value is removed whole.
    const values = [...known].sort((a, b) => b.length - a.length);
    let result = text;
    for (const value of values) {
      result = result.split(value).join(REDACTED);
    }
    return result;
  }

  return {
    register(value: string): void {
      if (value.trim() === '') {
        return;
      }
      known.add(value);
    },
    redact(text: string): string {
      let result = replaceKnown(text);
      result = result.replace(BEARER_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);
      result = result.replace(
        JSON_HEADER_PATTERN,
        (_match, name: string, separator: string) => `"${name}"${separator}"${REDACTED}"`,
      );
      result = result.replace(
        PLAIN_HEADER_PATTERN,
        (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
      );
      result = result.replace(KEY_SHAPE_PATTERN, REDACTED);
      return result;
    },
  };
}

/** The process-wide redactor, shared by the secret store and the logger. */
export const redactor: Redactor = createRedactor();
