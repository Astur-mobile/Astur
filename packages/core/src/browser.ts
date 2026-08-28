import type { BrowserCapabilities, BrowserEngine, PlatformName, WebViewSelector } from '@astur-mobile/protocol';

import { AsturError } from './errors.js';
import { delay } from './wait.js';
import { WebContext, type WebEvaluator } from './webBridge.js';

/**
 * Driving a browser as the target of a session, rather than an installed app.
 *
 * The DOM half of this is already solved: once a page is inspectable, the same
 * injected-JS bridge that drives an in-app WebView drives a browser tab
 * unchanged. What a browser adds is the target — launching it, finding the page
 * it opened, and expressing navigation, which an in-app WebView never needed.
 *
 * Navigation deliberately re-resolves the page rather than reusing the open
 * transport. Chromium keeps one target across a same-tab navigation and WebKit
 * does not always, so holding the old handle works on Android and intermittently
 * fails on iOS — which is the worst of both. Re-resolving costs a round trip and
 * behaves the same everywhere.
 */

/** The stock browser for a platform, when the config does not name one. */
export function defaultBrowserEngine(platform: PlatformName): BrowserEngine {
  return platform === 'ios' ? 'safari' : 'chrome';
}

/** The package/bundle id Astur launches for an engine, absent an override. */
export function defaultBrowserId(engine: BrowserEngine): string {
  return engine === 'safari' ? 'com.apple.mobilesafari' : 'com.android.chrome';
}

export function browserUnsupported(platform: PlatformName, reason: string): BrowserCapabilities {
  return {
    supported: false,
    coverage: `${platform} cannot drive a browser in this session: ${reason}`
  };
}

/** How long to keep looking for the page a freshly launched browser opened. */
export const DEFAULT_PAGE_TIMEOUT_MS = 20_000;

/**
 * How long to look for an already-open tab before launching the browser.
 *
 * Short on purpose: when the browser is not running this is dead time on every
 * `open()`, and when it is running a tab answers almost immediately.
 */
export const REUSE_PROBE_MS = 2_500;

export interface BrowserPageOptions {
  /** Where the page should end up. Used to pick the right tab, not to navigate. */
  url?: string;
  timeoutMs?: number;
}

type EvaluatorFactory = (selector?: WebViewSelector) => Promise<WebEvaluator>;

/**
 * Waits for an inspectable page and returns a context on it.
 *
 * A browser takes a moment to publish its debugging target after launch, and on
 * a cold start rather longer than an already-running app's WebView — so this
 * polls rather than asking once. The URL narrows *which tab*, and is matched on
 * origin + path so a redirect, an added query string, or a trailing slash does
 * not lose the page we just opened.
 */
export async function connectBrowserPage(
  createEvaluator: EvaluatorFactory,
  options: BrowserPageOptions = {}
): Promise<WebContext> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS);
  const selector: WebViewSelector = options.url
    ? { url: pageMatcher(options.url), newest: true, target: 'browser' }
    : { newest: true, target: 'browser' };

  // Hold out for the addressed tab for the whole budget. Falling back to "any
  // inspectable page" early looks harmless and is not: a browser keeps previous
  // tabs open, so the fallback fires on the first tick — before the tab we just
  // navigated is ready — and silently attaches to a stale page. The test then
  // fails on a missing element rather than on the wrong page, which is a much
  // worse thing to debug.
  while (Date.now() < deadline) {
    const attached = await tryAttach(createEvaluator, selector);
    if (attached) {
      return attached;
    }
    await delay(400);
  }

  // Only now, and only once: a redirect can legitimately land on a URL the
  // matcher cannot predict, and the browser under test is still the right one.
  if (selector) {
    const attached = await tryAttach(createEvaluator, { newest: true, target: 'browser' });
    if (attached) {
      return attached;
    }
  }

  throw new AsturError(
    'BROWSER_PAGE_NOT_FOUND',
    `No inspectable browser page appeared${options.url ? ` for ${options.url}` : ''} within `
    + `${options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS}ms. `
    + 'Check that remote debugging is reachable: on Android the device needs USB debugging on, '
    + 'and on a real iOS device Settings > Safari > Advanced > Web Inspector must be enabled.'
  );
}

/**
 * Matches a page by origin and path, ignoring query and fragment.
 *
 * Anything stricter loses the page to a redirect or an appended tracking
 * parameter; anything looser matches an unrelated tab.
 */
/**
 * One attempt at an inspectable, *usable* page.
 *
 * Connecting is not the same as being usable: mid-navigation a browser hands
 * out a target whose document is being torn down, and every locator against it
 * reports "no element matched" — which reads like a broken selector rather than
 * a page that was not ready. Probing the document separates the two.
 */
async function tryAttach(
  createEvaluator: EvaluatorFactory,
  selector: WebViewSelector | undefined
): Promise<WebContext | undefined> {
  let context: WebContext | undefined;
  try {
    context = new WebContext(await createEvaluator(selector));
    if (await context.evaluate('document.readyState').catch(() => undefined)) {
      return context;
    }
  } catch {
    // Fall through: the caller keeps polling until its deadline.
  }

  await context?.close().catch(() => undefined);
  return undefined;
}

export function pageMatcher(url: string): RegExp {
  const parsed = tryParseHttpUrl(url);
  if (!parsed) {
    // Not an absolute http(s) URL — a bare `host:port`, or a fragment of one.
    // Match it as a substring rather than anchoring on an origin we do not have.
    return new RegExp(escapeRegExp(url));
  }

  const path = parsed.pathname.replace(/\/$/, '');
  return new RegExp(`^${escapeRegExp(parsed.origin)}${escapeRegExp(path)}/?(?:[?#].*)?$`);
}

/**
 * `new URL()` accepts far more than a web address — `localhost:4319` parses as
 * scheme `localhost:` with a null origin, which would build a matcher that can
 * never match. Only an http(s) URL gives an origin worth anchoring on.
 */
function tryParseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs a navigation and waits for the page to settle.
 *
 * The evaluate is expected to fail sometimes and that is not an error: the
 * expression tears down the very JS context that would return its result, so a
 * transport reporting "context destroyed" means the navigation started, not
 * that it failed.
 */
export async function runNavigation(page: WebContext, expression: string): Promise<void> {
  await page.evaluate(expression).catch(() => undefined);
}

/** Polls until the document has finished loading, or the budget runs out. */
export async function waitForLoad(page: WebContext, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await page.evaluate('document.readyState').catch(() => undefined);
    if (state === 'complete') {
      return;
    }
    await delay(150);
  }
}

/**
 * A session configured to drive a browser and nothing else.
 *
 * The distinction matters because such a session has no app to install and no
 * native tree worth bootstrapping an agent for. A config that sets *both* is a
 * suite doing each in turn, and keeps the full native setup.
 */
export function isBrowserOnlySession(capabilities: { app?: unknown; browser?: unknown }): boolean {
  return Boolean(capabilities.browser) && !capabilities.app;
}

/** The attached page's current URL, or undefined when the transport is gone. */
export async function currentUrl(page: WebContext): Promise<string | undefined> {
  const href = await page.evaluate('location.href').catch(() => undefined);
  return typeof href === 'string' ? href : undefined;
}

export interface SettleOptions {
  /** Token planted before navigating; its absence proves the document changed. */
  token?: string;
  /** Wait until the URL matches this. */
  expectUrl?: string;
}

/**
 * Plants a token on the current document.
 *
 * Comparing URLs cannot tell a finished reload from one that has not started —
 * the URL is identical either way, so a settle keyed on it returns immediately
 * and hands back the *old* page. A token lives on `window`, so it disappears
 * exactly when the document is replaced, which is the thing being waited for.
 */
export async function markNavigation(page: WebContext): Promise<string> {
  const token = `astur-nav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.evaluate(`window.__asturNavToken = ${JSON.stringify(token)}`).catch(() => undefined);
  return token;
}

/**
 * Waits for a navigation on the *same* tab to finish.
 *
 * Returns false rather than throwing when the page never settles, so the caller
 * can fall back to re-resolving instead of failing the test outright — WebKit
 * does sometimes replace the inspector page across a navigation, where Chromium
 * keeps it.
 */
export async function settlePage(
  page: WebContext,
  timeoutMs: number,
  options: SettleOptions = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const expected = options.expectUrl ? pageMatcher(options.expectUrl) : undefined;
  let unreachable = 0;

  while (Date.now() < deadline) {
    const href = await currentUrl(page);

    if (href === undefined) {
      // WebKit replaces the inspector page across a navigation where Chromium
      // keeps it, so on iOS this transport is simply gone. Waiting out the full
      // budget on a dead socket turns a fast reconnect into a 20-second stall,
      // so give up early and let the caller re-resolve.
      if (++unreachable >= TRANSPORT_LOST_POLLS) {
        return false;
      }
    } else {
      unreachable = 0;
      const stillOldDocument = options.token !== undefined
        && await page.evaluate('window.__asturNavToken').catch(() => undefined) === options.token;

      if (!stillOldDocument
        && (!expected || expected.test(href))
        && await page.evaluate('document.readyState').catch(() => undefined) === 'complete') {
        return true;
      }
    }

    await delay(200);
  }

  return false;
}

/**
 * Consecutive failed probes (~3s) before a transport counts as gone.
 *
 * Tuned between two real behaviours rather than picked round: Chromium drops the
 * JS context only while a document is swapping, for well under a second, and
 * bailing on that blip sends a healthy navigation down the re-resolve path where
 * it can attach to a stale tab. WebKit's loss is permanent, so anything past a
 * few seconds is not coming back.
 */
const TRANSPORT_LOST_POLLS = 15;
