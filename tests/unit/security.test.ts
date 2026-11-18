import { describe, expect, it } from 'vitest';
import { isAllowedAppUrl, isTrustedSender } from '../../src/main/security';

const APP_URL = 'file:///C:/app/out/renderer/index.html';

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
