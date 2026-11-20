// Dev-only resolve hook for the probe recorder (p1-model-probes). The repo's TypeScript imports omit
// the file extension, as Vite and tsc expect, but native Node resolves only exact paths. This hook
// tries the .ts file for an extensionless relative import, and otherwise resolves as Node does.
// It is registered by scripts/register-ts-resolve.mjs and is never used by the app or the tests.

/**
 * @param {string} specifier
 * @param {{ parentURL?: string, conditions?: string[], importAttributes?: object }} context
 * @param {(specifier: string, context: object) => Promise<{ url: string }>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[cm]?[jt]sx?$|\.json$/.test(specifier);
  if (relative && !hasExtension) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Not a .ts file: let Node report the error for the original specifier.
    }
  }
  return nextResolve(specifier, context);
}
