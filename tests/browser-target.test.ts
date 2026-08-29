import { describe, expect, it } from 'vitest';
import {
  browserUnsupported,
  defaultBrowserEngine,
  defaultBrowserId,
  isBrowserOnlySession,
  pageMatcher
} from '../packages/core/src/browser.js';
import { isBrowserSocket, orderSocketsForTarget } from '../packages/android/src/index.js';

describe('browser target defaults', () => {
  it('uses each platform stock browser', () => {
    expect(defaultBrowserEngine('android')).toBe('chrome');
    expect(defaultBrowserEngine('ios')).toBe('safari');
  });

  it('maps an engine to the id Astur launches', () => {
    expect(defaultBrowserId('chrome')).toBe('com.android.chrome');
    expect(defaultBrowserId('safari')).toBe('com.apple.mobilesafari');
  });

  it('reports unsupported with a reason a spec can skip on', () => {
    const capabilities = browserUnsupported('android', 'Chrome is not installed');
    expect(capabilities.supported).toBe(false);
    expect(capabilities.coverage).toContain('Chrome is not installed');
  });
});

describe('browser-only sessions', () => {
  // A browser session has no app to install and no native tree worth
  // bootstrapping an agent for — on iOS that is the difference between
  // "open a web page" needing Xcode signing and not.
  it('is browser-only when a browser is configured and no app is', () => {
    expect(isBrowserOnlySession({ browser: { engine: 'chrome' } })).toBe(true);
  });

  it('is not browser-only when an app is also configured', () => {
    // A suite doing both in turn keeps the full native setup.
    expect(isBrowserOnlySession({ browser: { engine: 'chrome' }, app: { path: 'a.apk' } })).toBe(false);
  });

  it('is not browser-only for an ordinary app session', () => {
    expect(isBrowserOnlySession({ app: { path: 'a.apk' } })).toBe(false);
    expect(isBrowserOnlySession({})).toBe(false);
  });
});

describe('page matching', () => {
  // Matching has to survive the ways a real navigation rewrites a URL, without
  // becoming loose enough to grab an unrelated tab.
  it('matches the page it was given', () => {
    expect(pageMatcher('https://example.com/pricing').test('https://example.com/pricing')).toBe(true);
  });

  it('tolerates a trailing slash', () => {
    expect(pageMatcher('https://example.com/pricing').test('https://example.com/pricing/')).toBe(true);
    expect(pageMatcher('https://example.com/').test('https://example.com')).toBe(true);
  });

  it('tolerates an appended query or fragment', () => {
    const match = pageMatcher('https://example.com/pricing');
    expect(match.test('https://example.com/pricing?utm_source=x')).toBe(true);
    expect(match.test('https://example.com/pricing#plans')).toBe(true);
  });

  it('does not match a different path on the same origin', () => {
    expect(pageMatcher('https://example.com/pricing').test('https://example.com/docs')).toBe(false);
  });

  it('does not match a different origin', () => {
    expect(pageMatcher('https://example.com/pricing').test('https://evil.com/pricing')).toBe(false);
  });

  it('does not treat a path as a regular expression', () => {
    // A dot in a hostname must not become "any character", or example.com
    // would match exampleXcom.
    expect(pageMatcher('https://example.com/a').test('https://exampleXcom/a')).toBe(false);
  });

  it('falls back to a substring match for a non-URL', () => {
    expect(pageMatcher('localhost:4319').test('http://localhost:4319/index.html')).toBe(true);
  });
});

describe('debugging socket preference', () => {
  // Android exposes both kinds at once and they sort alphabetically, so
  // `chrome_devtools_remote` naturally wins — which silently pointed an app's
  // WebView automation at the browser whenever Chrome happened to be open.
  const sockets = ['chrome_devtools_remote', 'webview_devtools_remote_1234'];

  it('recognises the browser socket', () => {
    expect(isBrowserSocket('chrome_devtools_remote')).toBe(true);
    expect(isBrowserSocket('webview_devtools_remote_1234')).toBe(false);
  });

  it('puts the app WebView first by default', () => {
    expect(orderSocketsForTarget(sockets, 'webview')[0]).toBe('webview_devtools_remote_1234');
  });

  it('puts the browser first when a browser is the target', () => {
    expect(orderSocketsForTarget(sockets, 'browser')[0]).toBe('chrome_devtools_remote');
  });

  it('keeps every socket, only reordering them', () => {
    // A device may name its WebView socket in a way this cannot predict, so
    // filtering would lose a working target; only the order is opinionated.
    expect(orderSocketsForTarget(sockets, 'browser')).toHaveLength(2);
    expect([...orderSocketsForTarget(sockets, 'webview')].sort()).toEqual([...sockets].sort());
  });

  it('is stable when nothing matches the preference', () => {
    const only = ['webview_devtools_remote_1', 'webview_devtools_remote_2'];
    expect(orderSocketsForTarget(only, 'browser')).toEqual(only);
  });
});
