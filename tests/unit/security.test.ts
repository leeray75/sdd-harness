import { describe, expect, it } from 'vitest';
import {
  applyNavigationGuards,
  isAllowedAppUrl,
  isTrustedSender,
  type GuardableContents,
} from '../../src/main/security';

const APP_URL = 'file:///C:/app/out/renderer/index.html';

type NavigationListener = (event: { preventDefault: () => void }, url: string) => void;

/** A fake WebContents that records the guards and can replay navigation events. */
function fakeContents() {
  let openHandler: (() => { action: 'deny' }) | undefined;
  const listeners = new Map<string, NavigationListener[]>();
  const contents: GuardableContents = {
    setWindowOpenHandler: (handler) => {
      openHandler = handler;
      return undefined;
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return undefined;
    },
  };
  /** Fires a navigation event and reports whether the guard prevented it. */
  const fire = (event: 'will-navigate' | 'will-redirect', url: string): boolean => {
    let prevented = false;
    const details = {
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const listener of listeners.get(event) ?? []) {
      listener(details, url);
    }
    return prevented;
  };
  return {
    contents,
    fire,
    openWindow: () => openHandler?.(),
    listenerCount: (event: string) => listeners.get(event)?.length ?? 0,
  };
}

describe('applyNavigationGuards', () => {
  it('denies every window-open request', () => {
    const fake = fakeContents();
    applyNavigationGuards(fake.contents, APP_URL);
    expect(fake.openWindow()).toEqual({ action: 'deny' });
  });

  it('prevents a foreign will-navigate and allows the app URL', () => {
    const fake = fakeContents();
    applyNavigationGuards(fake.contents, APP_URL);
    expect(fake.fire('will-navigate', 'https://example.com')).toBe(true);
    expect(fake.fire('will-navigate', 'file:///C:/app/out/renderer/other.html')).toBe(true);
    expect(fake.fire('will-navigate', APP_URL)).toBe(false);
    expect(fake.fire('will-navigate', `${APP_URL}#top`)).toBe(false);
  });

  it('prevents a foreign will-redirect and allows the app URL', () => {
    const fake = fakeContents();
    applyNavigationGuards(fake.contents, APP_URL);
    expect(fake.fire('will-redirect', 'https://example.com')).toBe(true);
    expect(fake.fire('will-redirect', APP_URL)).toBe(false);
  });

  it('registers exactly one navigation listener per event', () => {
    const fake = fakeContents();
    applyNavigationGuards(fake.contents, APP_URL);
    expect(fake.listenerCount('will-navigate')).toBe(1);
    expect(fake.listenerCount('will-redirect')).toBe(1);
  });
});

describe('isAllowedAppUrl', () => {
  it('allows the app page itself, including query and fragment', () => {
    expect(isAllowedAppUrl(APP_URL, APP_URL)).toBe(true);
    expect(isAllowedAppUrl(`${APP_URL}?x=1#top`, APP_URL)).toBe(true);
  });

  it('blocks other pages on the same origin and other schemes', () => {
    expect(isAllowedAppUrl('file:///C:/app/out/renderer/other.html', APP_URL)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', APP_URL)).toBe(false);
    expect(isAllowedAppUrl('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5173/x', 'http://localhost:5173/')).toBe(false);
  });

  it('rejects URLs that do not parse', () => {
    expect(isAllowedAppUrl('not a url', APP_URL)).toBe(false);
    expect(isAllowedAppUrl(APP_URL, 'not a url')).toBe(false);
  });
});

describe('isTrustedSender', () => {
  const base = { senderId: 7, expectedId: 7, frameUrl: APP_URL, appUrl: APP_URL };

  it('trusts the app window showing the app page', () => {
    expect(isTrustedSender(base)).toBe(true);
  });

  it('rejects a different WebContents', () => {
    expect(isTrustedSender({ ...base, senderId: 8 })).toBe(false);
    expect(isTrustedSender({ ...base, expectedId: undefined })).toBe(false);
  });

  it('rejects a frame that is not the app page', () => {
    expect(isTrustedSender({ ...base, frameUrl: 'https://example.com/' })).toBe(false);
    expect(isTrustedSender({ ...base, frameUrl: undefined })).toBe(false);
  });
});
