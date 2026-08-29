# Release Notes

What's new in each Astur release.

## 0.6.0-beta

**Test a website in the device's own browser.** `device.browser` drives Chrome on Android and Safari on iOS, on the same emulator, simulator or real device the native suite already runs on — so a responsive site and a native app can be covered in one run and one report.

```ts
const page = await device.browser.open('https://example.com/pricing');
await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
await page.getByTestId('plan-pro').tap();
```

`open`, `navigate`, `reload`, `back`, `forward`, `url`, and `capabilities` — the last answering on every platform, so a spec can `test.skip()` with a reason the way `device.network` already allows. Each navigation returns the live `WebContext`, the same object `device.webContext()` yields, so every locator and action works unchanged.

Set `browser` instead of `app` and the session becomes **browser-only**: no app install, and the native agent turns optional rather than required. On iOS that is the difference between opening a page and needing a signing identity first.

Playwright already tests mobile web well through device emulation, and it is faster in CI. This is for when emulation is not the thing you need: a real mobile browser, on the same device pool, in the same report as the native suite.

Three problems this had to solve beyond the existing DOM transport:

- **A tab per test, closed when it ends**, the way Playwright hands each test its own page. Android creates and closes tabs over the debugging socket. WebKit exposes no tab lifecycle, so iOS reuses one tab and reloads it — and `open()` always loads even when the tab already shows that URL, because a reused tab still carries the previous test's DOM.
- **Settling on the document, not the URL.** A reload leaves the URL identical, so a URL-based wait returns instantly and hands back the *old* page. Astur plants a token on `window` and waits for it to disappear, which is exactly when the document is replaced.
- **First-run detection.** Chrome publishes no debugging socket until its welcome flow is finished, so a fresh emulator would wait forever for a page that never appears. Reported as `BROWSER_FIRST_RUN_PENDING` instead of a timeout.

Worth knowing before building a suite on it: a tab is **not** a Playwright browser *context* — cookies and `localStorage` belong to the browser profile and are shared. The browser's own UI is native, not page content. Real iOS devices are written but not yet verified on hardware. The [Mobile Web](https://astur-mobile.github.io/Astur/mobile-web/) page lists the full set.

**The documentation is now available in Arabic**, at [/ar/](https://astur-mobile.github.io/Astur/ar/) — every page, with English API and protocol names kept as they are.

### Fixed

- **An app's WebView could be driven through the browser instead.** Android names the sockets `webview_devtools_remote_<pid>` and `chrome_devtools_remote`, and they sort alphabetically — so with Chrome running, `device.webContext()` attached to the browser rather than the app under test. Sockets are now ordered by what the caller asked for.

Full detail in the [changelog](https://github.com/Astur-mobile/Astur/blob/main/CHANGELOG.md).

## 0.5.0-beta.5

**Compare screenshots.** `toHaveScreenshot()` checks an element or the whole screen against a stored baseline, so a visual change fails a test instead of slipping through. Playwright's own matcher needs a `Page`; this is the native equivalent.

```ts
await expect(app.home.heroCard).toHaveScreenshot('hero-card.png');
await expect(device).toHaveScreenshot('home.png', { mask: [device.getById('clock')] });
```

Baselines are kept per platform, renderer, and screen size. `mask` paints over anything allowed to change. `threshold`, `maxDiffPixels`, and `maxDiffPixelRatio` set the tolerance. A failure renders as a proper image diff in the HTML report, with the Diff / Actual / Expected / Slider tabs.

**Network observation on React Native**, Android and iOS. `device.network` now reads the CDP `Network` domain that React Native DevTools uses. The reporter lives in `ReactCommon`, so one implementation covers both platforms.

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);
```

Two boundaries, both measured rather than assumed: it needs a **debug build attached to Metro** (the reporter is compiled out of release builds), and it sees **`XMLHttpRequest` traffic** — React Native's own `fetch` polyfill and axios included, but *not* Expo's native `fetch`, which bypasses React Native's networking layer entirely.

**Network observation on Flutter iOS simulators**, with the same coverage and redaction as Flutter Android. Nothing changes about how the app is installed or driven.

### Fixed

- **`--update-snapshots` only worked as `--update-snapshots=all`.** A bare `-u` means `changed`, so the documented way to accept an intended change did nothing — while the failure message told you to run exactly that flag.
- **iOS Flutter and iOS React Native shared one screenshot baseline**, so a Flutter build compared against React Native pixels. iOS now identifies the renderer from the app bundle. The iOS baselines shipped in beta.4 were recorded from the wrong build and have been re-recorded.

Full detail in the [changelog](https://github.com/Astur-mobile/Astur/blob/main/CHANGELOG.md).

## 0.5.0-beta.4

**Type into a field you can't select.** Some inputs have nothing to target — a multi-box OTP field draws six plain views and keeps the real input off the accessibility tree entirely, so `getByType('textField')` finds nothing and `fill()` has no element to fill. `device.keyboard.type()` sends text to whatever holds keyboard focus instead.

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

- Same call on **iOS and Android**, so one spec covers both — XCUITest types into the focused responder, Android delivers to the focused view.
- `pressKey()` now types a single printable character on **both** platforms, so a digit-by-digit loop needs no platform branch. This also fixes a sharp edge on Android: a bare character used to be read as a *keycode number*, and keycode 4 is `BACK` — `pressKey('4')` navigated away instead of typing a 4. Named keys and raw keycode numbers are unchanged.
- With no keyboard on screen, iOS fails with `KEYBOARD_NOT_VISIBLE` instead of quietly doing nothing — the failure points at the cause, not three assertions later.

**A phantom keyboard was navigating your app mid-test.** On Android, keyboard state came from two signals that lie: a `mImeShowing=true` flag that lingers after the keyboard is gone, and a bounds rectangle that actually belonged to the display — reporting a full-screen keyboard. Every element then looked covered, so Astur dismissed the "keyboard" by pressing Back and left the screen. Both the host and the on-device agent now read the IME's own insets source and treat a zero-height frame as hidden. This needs the rebuilt agent that ships with `@astur-mobile/android`.

Reach for `fill()` whenever the field is addressable: it resolves the element, clears it, and confirms the value landed. None of that is possible when you're aiming at focus. See [Keyboard and fill](../ios/#keyboard-and-fill).

## 0.5.0-beta.3

**See what your app talks to.** New `device.network` reports the HTTP traffic an app makes while a test drives it, so you can assert on the call rather than just the pixels — and debug a failure without reproducing it by hand.

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.login.signIn('qa@astur.dev', 'Astur12345');

const [request] = await device.network.requests({ url: '/api/session' });
expect(request).toMatchObject({ method: 'POST', status: 201 });
```

- Available on **Flutter Android** today, via the Dart VM HTTP profiler. Covers `dart:io` `HttpClient` traffic — `package:http` and Dio included.
- Ask `capabilities()` rather than assuming: it reports coverage per session, so one spec runs everywhere and skips with a reason where observation is unavailable.
- Credential headers redacted and bodies capped by default; the buffer clears between tests.
- Interception (stub/delay/fail) is **not** in this release — it needs an in-app adapter. `capabilities().intercept` says so rather than failing mysteriously.

See [Network Observation](../network/) for the full picture.

**Fixes that were costing whole runs.**

- The UiAutomator agent had silently taken over keyboard, gestures, and element actions on Flutter sessions. Its `keyboard.dismiss` presses Back — which backgrounds the Flutter app and kills the Dart VM — and its `gesture.tap` never reaches the Flutter view at all.
- An agent element-action failure now falls back to a coordinate tap instead of aborting the test. Fixes the native media picker on React Native Android.
- Scroll reveals were flings, not drags: the same gesture at 300 ms flung to the end of the content, at 1200 ms it moves predictably. Search loops no longer bounce between the extremes.
- A Flutter VM read could block for ~7 minutes; retries are now bounded by wall clock, with the deadline threaded into each request.

## 0.5.0-beta.2

### New

- **`by.native({ ios, android })` — a raw escape hatch for the elements no other locator can pin down.** `ios` takes an XCUITest predicate string; `android` takes a structured selector (class, text, resource id, parent/child relationships). Useful for screens with little or no accessibility metadata. See the [Android](../android/#native-selector-escape-hatch-bynative) and [iOS](../ios/#native-selector-escape-hatch-bynative) guides.

### Fixed

- **`astur test` could crash with `spawn EINVAL` on Node 22/24** (worked fine on Node 20). It now runs Playwright directly instead of going through `npx`, removing the double process-indirection that triggered it.
- **Android inspector no longer flaps "UI tree unavailable".** If an earlier run crashed or was killed, its on-device agent kept holding Android's automation slot and silently broke the next session's UI tree. Astur now clears stale agent instrumentation and leaked port-forwards when a session starts, and tears its own down fully on close — a bad exit can't poison the next run.
- Small Inspector contrast fix on the code-language toggle.

## 0.5.0-beta.1

### New

- **Record the new assertions from the Inspector.** The assertion composer now offers enabled/disabled/selected/focused and "match count equals" (generates `toHaveCount(n)`), alongside the existing text/value/label/type checks.

### Fixed

- **Windows crash on `codegen`/`inspect`** ([#10](https://github.com/Astur-mobile/Astur/issues/10)). The inspector no longer dies with `Error: spawn start ENOENT` right after printing its URL — browser auto-open now goes through `cmd /c start` on Windows, and a failed auto-open can never take the inspector down on any platform (worst case: open the printed URL yourself).
- **Codegen safety.** The Inspector refuses to record a fill/expect step for a target without a stable locator (clear message instead of silently broken generated code), and count values are validated before a step is added.

## 0.5.0-beta.0

### New

- **Read element state straight from locators.** `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()`, `isDisabled()`, `isSelected()`, `isFocused()`, plus `clear()` and a Playwright-style `waitFor({ state })`.
- **`toHaveCount` assertion.** `await expect(device.getByRole('menuitem')).toHaveCount(3)` — polls and retries like every other Astur matcher.

### Improved

- **Faster multi-match queries on Android.** `queryAll()`, `count()`, and `device.findMany()` now resolve natively on-device through the UIAutomator agent instead of dumping the whole UI tree. Older installed agent builds keep working through the previous path.

## 0.4.0-beta.0

### Improved

- **Faster iOS input fills.** Short and secure values stay on the reliable typed path, long non-secure replacement fills can use paste, and iOS field state is verified after fill.
- **Better keyboard handling on iOS.** Taps are bounded, keyboard obstruction checks are frame-based, and multi-field flows avoid unnecessary dismiss/reopen cycles.
- **WebView fills stay in web context.** Inspector/codegen now remaps overlapping native WebView fields back to their DOM node, so the second fill does not accidentally route through the native iOS agent.
- **Drag-and-drop in codegen.** Inspector has a Drag mode and records drag actions into generated test code.
- **Cleaner iOS WebView proxy lifecycle.** Stale `ios-webkit-debug-proxy` processes are cleared before a new session binds to the same port.

### Release

- Bumped public packages to `0.4.0-beta.0`.
- Regenerated `package-lock.json` after dependency and package version updates.

## 0.3.0-beta.0

### New

- **iOS Simulator WebView DOM.** `device.webContext()` now drives WebView (WKWebView) DOM on the **iOS Simulator** as well as real devices — the same engine-agnostic API used on Android. Needs `ios-webkit-debug-proxy` (v1.9+) and the app setting `WKWebView.isInspectable = true`; Astur bridges the simulator automatically.
- **Flutter on iOS.** The shared demo suite runs on the iOS Simulator against the Flutter build, read through the XCUITest accessibility tree.

### Improved

- **Faster, more reliable iOS fills.** Skips re-typing when a field already holds the value, types into secure/short fields (and pastes longer text), and keeps the keyboard up across multi-field forms — dismissing it only when it blocks the next tap.
- **Smoother codegen / Inspector.** Device actions now pause the background screenshot/tree/WebView polling, removing the mid-fill "retrying" flicker and a WebView context drop that could happen between two fills.
- **No more stuck taps.** A tap on a control covered by the soft keyboard no longer hangs.

### Examples & boilerplate

- Reorganized examples: shared tests live in `specs/`, platform configs in `config/android/` and `config/ios/`. `create-astur` scaffolds to `specs/` to match.

### Notes & limits

- WebView DOM on iOS needs `brew install ios-webkit-debug-proxy`. The Playwright `web.page` (`webview()`) fixture stays Android-only — use `device.webContext()` on iOS.
- Flutter: Android needs a **debug** APK + the `flutter` CLI + `ASTUR_FLUTTER_PROJECT`; iOS exposes widgets through accessibility (add `Semantics(identifier:)`). See [Prerequisites](../prerequisites/) and [Platform Limits](../platform-limits/).

> Beta line: APIs may still change between beta releases.
