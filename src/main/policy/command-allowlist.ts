// The command check built from a project's detected test and build commands (D31). Pure: no
// Electron or file-system imports. It decides in a fixed order and returns fixed reasons that
// never echo the program or its arguments.

import type { CommandForm, DetectedCommands } from '../commands/detect';
import type { CommandCall, CommandCheck } from './context';

export const NOT_A_COMMAND_JOB = 'this job may not run commands';
export const NOT_FROM_ROOT = 'commands run only from the project root';
export const NOT_LISTED = "this command is not on the project's allowlist";
export const REVIEWER_TESTS_ONLY = 'the reviewer may run tests only';

/** Extensions dropped from the program's base name before it is compared. */
const WINDOWS_EXTENSION = /\.(exe|cmd|bat)$/;

/**
 * The program as the allowlist compares it: lower-cased, with a trailing .exe, .cmd or .bat
 * dropped. Only the base name counts, so a program with a separator never matches.
 */
function normalizedProgram(program: string): string {
  return program.toLowerCase().replace(WINDOWS_EXTENSION, '');
}

function matches(forms: readonly CommandForm[], program: string, args: readonly string[]): boolean {
  return forms.some(
    (form) =>
      form.program === program &&
      form.args.length === args.length &&
      form.args.every((arg, index) => arg === args[index]),
  );
}

/**
 * Builds the check for one project. A call is allowed only when the job is the writer or the
 * reviewer, the cwd is absent or `.`, the program is a bare name, and the program and arguments
 * equal a detected form exactly. The writer may run test and build forms; the reviewer, test
 * forms only.
 */
export function makeCommandCheck(detected: DetectedCommands): CommandCheck {
  return (call: CommandCall) => {
    if (call.job !== 'writer' && call.job !== 'reviewer') {
      return { allow: false, reason: NOT_A_COMMAND_JOB };
    }
    if (call.cwd !== undefined && call.cwd !== '.') {
      return { allow: false, reason: NOT_FROM_ROOT };
    }
    if (call.program.length === 0 || /[\\/]/.test(call.program)) {
      return { allow: false, reason: NOT_LISTED };
    }
    const program = normalizedProgram(call.program);
    if (matches(detected.test, program, call.args)) {
      return { allow: true };
    }
    if (matches(detected.build, program, call.args)) {
      return call.job === 'writer'
        ? { allow: true }
        : { allow: false, reason: REVIEWER_TESTS_ONLY };
    }
    return { allow: false, reason: NOT_LISTED };
  };
}
