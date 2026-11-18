// Pure helpers for the main process. No Electron imports, so they can be unit tested.

/**
 * True when `url` points at the app's own page: same scheme, host and path as
 * the app URL. Query strings and fragments are ignored. Anything that does not
 * parse is rejected.
 */
export function isAllowedAppUrl(url: string, appUrl: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  return (
    target.protocol === app.protocol && target.host === app.host && target.pathname === app.pathname
  );
}

/** The part of a WebContents the guards use. Electron's WebContents satisfies it. */
export interface GuardableContents {
  setWindowOpenHandler(handler: () => { action: 'deny' }): unknown;
  on(
    event: 'will-navigate' | 'will-redirect',
    listener: (event: { preventDefault: () => void }, url: string) => void,
  ): unknown;
}

/**
 * Applies the window guards to a window's web contents: every window-open
 * request is denied, and navigation or redirects to any URL other than the
 * app's own page are prevented.
 */
export function applyNavigationGuards(contents: GuardableContents, appUrl: string): void {
  // No new windows, popups or webviews.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Only the app's own page may be navigated to.
  const blockForeignNavigation = (event: { preventDefault: () => void }, url: string) => {
    if (!isAllowedAppUrl(url, appUrl)) {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', blockForeignNavigation);
  contents.on('will-redirect', blockForeignNavigation);
}

/**
 * True when an IPC call came from the app's own window and its top-level page.
 * `senderId` and `expectedId` are WebContents ids; `frameUrl` is the URL of the
 * frame that sent the call.
 */
export function isTrustedSender(options: {
  senderId: number;
  expectedId: number | undefined;
  frameUrl: string | undefined;
  appUrl: string;
}): boolean {
  const { senderId, expectedId, frameUrl, appUrl } = options;
  if (expectedId === undefined || senderId !== expectedId) {
    return false;
  }
  return frameUrl !== undefined && isAllowedAppUrl(frameUrl, appUrl);
}
