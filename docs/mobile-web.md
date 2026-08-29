# Mobile Web

Drive a **web page in the device's browser** — Chrome on Android, Safari on iOS — on the same emulator, simulator, or real device the native suite runs on.

```ts
const page = await device.browser.open('https://example.com/pricing');

await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
await page.getByTestId('plan-pro').tap();
```

## When this is the right tool

Astur has two web surfaces, and they answer different questions:

| You are testing | Use |
| --- | --- |
| A WebView screen **inside** your app | [`device.webContext()`](../frameworks/#webviews-dom) |
| A **website** in the device's browser | `device.browser` |

Below the page they are the same machinery — once a tab is inspectable, the same injected-JS bridge drives it. What a browser adds is the target and navigation.

**Playwright already tests mobile web well** through device emulation, and it is faster and easier to run in CI. Reach for `device.browser` when emulation is not the thing you need: a real Android or iOS browser, on the same device pool, in the same run and the same report as your native suite.

## Setup

Set `browser` instead of `app`:

```ts
export default defineConfig({
  use: {
    astur: {
      platform: 'android',
      device: { kind: 'emulator', avd: 'Pixel_9_API_35' },
      browser: { engine: 'chrome' }   // 'safari' on iOS
    }
  }
});
```

A config with `browser` and no `app` is a **browser-only session**: Astur skips app install, and treats the native agent as optional rather than required. On iOS that is the difference between opening a web page and needing an Xcode signing identity first.

Set both `app` and `browser` when one suite does each in turn; the native setup then stays exactly as it was.

`engine` and `id` are both optional — `engine` defaults to the platform's stock browser, and `id` overrides the package or bundle id for a Chrome channel such as `com.chrome.beta`.

## The API

```ts
// What can this session do with a browser?
const capabilities = await device.browser.capabilities();
// { supported, engine, identifier, coverage }

const page = await device.browser.open('https://example.com');   // WebContext
const next = await device.browser.navigate('https://example.com/pricing');
const again = await device.browser.reload();
const back = await device.browser.back();
await device.browser.forward();

await device.browser.url();     // current URL
await device.browser.close();   // closes the transport, leaves the browser running
```

Each navigation returns the live page — use the returned handle from that point on.

## Tab lifecycle

Close to Playwright's, within what each platform allows:

- **`open()` gives the test a fresh tab.** On Android, Astur creates one over the debugging socket, the way Playwright opens a new page.
- **The tab is closed when the test ends.** The Astur fixture does this for you, so tabs never accumulate and no test inherits the previous one's DOM, history, or scroll position.
- **`open()` always loads**, even when the tab already shows that URL, so a reused tab cannot hand one test's filled form to the next.

**iOS is weaker here, and it is a platform limit rather than a choice.** WebKit's remote inspector exposes no way to create or close a Safari tab, so an iOS session reuses one tab and reloads it. State that lives in the document is still reset by the reload; tab history is not.

**Neither platform isolates storage.** A tab is not a Playwright browser *context* — cookies, `localStorage`, and permissions belong to the browser profile and are shared across tabs. If a test depends on starting signed-out, clear that state explicitly:

```ts
await page.evaluate('localStorage.clear(); sessionStorage.clear()');
```

Everything the page returns is a `WebContext`, the same object `device.webContext()` gives you — `getByTestId`, `getById`, `getByRole`, `getByText`, `locator(css)`, `fill`, `tap`, `textContent`, `evaluate`.

## Ask before you assert

`capabilities()` answers on every platform, so a spec stays portable:

```ts
const capabilities = await device.browser.capabilities();
test.skip(!capabilities.supported, capabilities.coverage);
```

## What it covers, and what it does not

The **page** is fully driveable. The browser's own UI is not part of it: the address bar, tab switcher, and permission sheets are native views, so they need native locators and an agent — and there are no page objects for them yet.

One tab is used per session. Tab switching, multiple windows, and profile/cookie management are not exposed.

## Prerequisites

**Android** needs Chrome installed, USB debugging enabled (which is how `chrome_devtools_remote` becomes reachable), and Chrome past its **first-run screen**. Until that welcome flow is completed, Chrome opens no tab and publishes no debugging socket — Astur detects this and fails with `BROWSER_FIRST_RUN_PENDING` rather than timing out on a page that will never appear. Completing it once per emulator image is enough.

**iOS** needs `ios-webkit-debug-proxy` (v1.9+):

```bash
brew install ios-webkit-debug-proxy
```

On a **real device**, also enable Settings ▸ Safari ▸ Advanced ▸ Web Inspector. The simulator needs nothing extra — Astur bridges its per-simulator inspector socket automatically.

`npx astur-mobile doctor` reports both.

## Try it

The example suite serves its own page from the repo, so it runs offline and deterministically:

```bash
cd examples
npm run test:android:browser
npm run test:ios:browser
```

See [Flutter & React Native](../frameworks/) for in-app WebViews, and [Platform Limits](../platform-limits/) for the full boundary reference.
