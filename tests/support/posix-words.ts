// Splits a command line into its words, for the SSH fake and the quoting tests (p4-env-ssh, AC3). It reads
// only the forms the SSH backend writes: unquoted words, single-quoted strings (with `'\''` for a quote),
// and a backslash that takes the next character. Any other shell syntax throws, so the fake that uses it
// never runs a shell and never guesses at one.

/** Characters that mean something to a shell outside quotes. The backend never leaves one unquoted. */
const SHELL_ONLY = new Set([
  '"',
  '$',
  '`',
  ';',
  '|',
  '<',
  '>',
  '(',
  ')',
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '!',
  '#',
  '~',
]);

/** The words of one command line, in order. Throws on shell syntax the backend does not write. */
export function splitWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let at = 0;
  while (at < line.length) {
    const ch = line.charAt(at);
    if (ch === ' ') {
      if (word !== null) words.push(word);
      word = null;
      at += 1;
      continue;
    }
    word ??= '';
    if (ch === "'") {
      const end = line.indexOf("'", at + 1);
      if (end < 0) throw new Error('unterminated single quote');
      word += line.slice(at + 1, end);
      at = end + 1;
      continue;
    }
    if (ch === '\\') {
      if (at + 1 >= line.length) throw new Error('a backslash ends the line');
      word += line.charAt(at + 1);
      at += 2;
      continue;
    }
    if (SHELL_ONLY.has(ch) || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\0') {
      throw new Error(`shell syntax outside quotes is not supported: ${JSON.stringify(ch)}`);
    }
    word += ch;
    at += 1;
  }
  if (word !== null) words.push(word);
  return words;
}
