// The project checks of the add-project wizard and the projects screen (p4-project-checks, D45). Pure: no
// Node, Electron or DOM import, so both sides may use it. The runner that computes the checks is
// src/main/projects/checks.ts. parseOrigin keeps a credential out of every value it returns: it gives
// the host name only. codeHostOf names the host, and inferTracker guesses a tracker from the ticket ids
// and the host; nothing here connects to anything.

/** The five checks, in the order the wizard and the projects screen show them. */
export const CHECK_IDS = ['git', 'code-host', 'tracker', 'test-command', 'earlier-specs'] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** The five statuses: ok, a warning, information, a failure, and a check that did not run. */
export const CHECK_STATUSES = ['ok', 'warn', 'info', 'fail', 'not-checked'] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** One check's result. `fix` is the plain-language step to take, when there is one. */
export type ProjectCheck = {
  id: CheckId;
  status: CheckStatus;
  title: string;
  detail: string;
  fix?: string;
};

/** All five checks, always, in CHECK_IDS order. */
export type ProjectChecks = { checks: ProjectCheck[] };

/** The host of a remote URL, lower-cased, with no user, password, token, port or path. */
export type OriginHost = { host: string };

/** The URL schemes whose remote is named by a host (and read with its user or token removed). */
const REMOTE_SCHEMES = new Set(['https', 'http', 'ssh', 'git']);

/** Any `scheme://` prefix, so a scheme this module does not read (file:// and the rest) is refused. */
const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/** A Windows drive path such as `C:\repo` or `C:/repo`, which the scp-like form would misread. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** The scp-like form `[user@]host:path`, with no scheme. The user and the path are not kept. */
const SCP_LIKE = /^(?:[^@/\\:\s]+@)?([^@/\\:\s]+):(.+)$/;

/** A host name: letters, digits, dots and hyphens only. */
const HOST_NAME = /^[A-Za-z0-9.-]+$/;

/** True for a line break, a tab or any other control character (the C0 range and DEL). */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** The host of a `scheme://[user[:pass]@]host[:port]/path` URL, or null. */
function hostOfUrl(scheme: string, rest: string): string | null {
  if (!REMOTE_SCHEMES.has(scheme)) return null;
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  // The user information ends at the last `@`, so a `@` inside a password does not reach the host.
  const at = authority.lastIndexOf('@');
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  const colon = hostPort.lastIndexOf(':');
  const host = colon === -1 ? hostPort : hostPort.slice(0, colon);
  const port = colon === -1 ? '' : hostPort.slice(colon + 1);
  if (port !== '' && !/^[0-9]+$/.test(port)) return null;
  return host;
}

/**
 * The host name of a remote URL, or null. It accepts https, http, ssh and git URLs and the scp-like
 * `[user@]host:path` form. A local path, a file:// URL, an empty text, a text with a control character
 * and a host that is not letters, digits, dots and hyphens give null. It never throws, and its result
 * never holds the user, the password, the token, the port or the path.
 */
export function parseOrigin(url: string): OriginHost | null {
  try {
    if (typeof url !== 'string' || url === '') return null;
    if (hasControlCharacter(url)) return null;
    const scheme = SCHEME_PREFIX.exec(url);
    let host: string | null;
    if (scheme) {
      host = hostOfUrl(scheme[1]?.toLowerCase() ?? '', url.slice(scheme[0].length));
    } else if (DRIVE_PATH.test(url)) {
      return null;
    } else {
      const scp = SCP_LIKE.exec(url);
      host = scp ? (scp[1] ?? null) : null;
    }
    if (host === null || !HOST_NAME.test(host)) return null;
    return { host: host.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * The code host's name for a host: GitHub, GitLab, Bitbucket, Azure DevOps for dev.azure.com and
 * *.visualstudio.com, and `Other: <host>` for anything else.
 */
export function codeHostOf(host: string): string {
  const name = host.toLowerCase();
  if (name === 'github.com') return 'GitHub';
  if (name === 'gitlab.com') return 'GitLab';
  if (name === 'bitbucket.org') return 'Bitbucket';
  if (name === 'dev.azure.com' || name.endsWith('.visualstudio.com')) return 'Azure DevOps';
  return `Other: ${host}`;
}

/** A Jira ticket id: an upper-case project key, a hyphen and a number. */
const JIRA_ID = /^[A-Z][A-Z0-9]+-[0-9]+$/;

/**
 * The tracker a project is likely to use, inferred and never connected (D8): Jira when a ticket id
 * has the Jira form; otherwise the code host's issues (GitHub Issues or GitLab Issues); otherwise null.
 */
export function inferTracker(
  ticketIds: readonly string[],
  codeHost: string | null,
): 'Jira' | 'GitHub Issues' | 'GitLab Issues' | null {
  if (ticketIds.some((id) => JIRA_ID.test(id))) return 'Jira';
  if (codeHost === 'GitHub') return 'GitHub Issues';
  if (codeHost === 'GitLab') return 'GitLab Issues';
  return null;
}
