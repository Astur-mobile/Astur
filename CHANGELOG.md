# Changelog

All notable changes to Astur are documented here. Versions follow the
`@astur-mobile/*` + `astur-mobile` workspace release line.

## Unreleased

### Added

- **Composable locators.** A screen of repeated rows has no single selector that
  distinguishes one row from another, so locators can now be built up instead.

  ```ts
  const row = device.getByType('Cell').filter({ hasText: 'Rye' });
  await row.getByRole('button', { name: 'Add' }).tap();
  ```

  - **Scoping** — every `getBy*` factory exists on a locator as well as on the
    device, and searches that locator's descendants. A parent never matches
    itself.
  - **`filter({ hasText, hasNotText, has, hasNot })`** — text predicates read the
    element and everything beneath it, so a row matches on its children's text.
    Filters stack.
  - **`and()` / `or()`** — set intersection and union, the union in document
    order and without repeating an element both sides matched.
  - **`first()` / `last()` / `nth(i)`**, negative indices counting from the end.
    Position applies last, so `filter(...).first()` means the first of the
    filtered set.

  Composition resolves against a single tree snapshot rather than being pushed
  into the drivers, which keeps the selector the drivers receive exactly what it
  was before — a plain locator still takes the driver fast path untouched. Where
  a composed locator resolves to an element that is uniquely nameable, Astur
  hands the driver that plain selector so behaviour stays identical.

- **`getByPlaceholder()`** for the placeholder or hint of an empty input. Read
  from driver raw attributes where they carry it, falling back to the value or
  label of an empty field. A field with content deliberately stops matching its
  own placeholder.

- **`toBeChecked()` and `isChecked()`** for checkboxes, switches, radios, and
  toggles. Reports *unknown* rather than `false` for an element that has no
  checked state, and `isChecked()` throws on one — "not a checkable control" and
  "unchecked" are different facts.

- **`toBeEmpty()` and `isEmpty()`** — true when an element and its subtree carry
  no text.

- **`device.app.list()` and `device.app.foreground()`.** Third-party apps only by
  default, because a system listing buries the app under test. Foreground
  reporting is Android-only; iOS exposes it to neither `simctl` nor `devicectl`.

- **`device.orientation.get()`** (also `device.getOrientation()`). Android reads
  the rotation setting while rotation is locked and falls back to viewport
  geometry; iOS derives it from the viewport, which cannot disagree with what is
  on screen but does not distinguish the two landscape directions.

- **`astur screenshot`** captures a device screen to a PNG without writing a
  test. Takes the same device-selection flags as `codegen`, and neither installs
  nor launches anything — capturing a screen should not change it.

- **Documentation**: a [Locators](https://astur-mobile.github.io/Astur/locators/)
  guide, and a framework support table covering .NET MAUI, NativeScript,
  Cordova/Capacitor, Kotlin Multiplatform, and why game engines cannot work.
  Both in English and Arabic.

## 0.6.0-beta

### Added

- **`device.browser` — drive a web page in the device's browser**
  ([#25](https://github.com/Astur-mobile/Astur/issues/25)). Chrome on Android and
  Safari on iOS, on the same emulator, simulator or real device the native suite
  runs on.

  ```ts
  const page = await device.browser.open('https://example.com/pricing');
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
  ```

  `open`, `navigate`, `reload`, `back`, `forward`, `url`, and `capabilities` —
  the last answering on every platform so a spec can `test.skip()` with a reason
  the way `device.network` already allows. Each navigation returns the live
  `WebContext`, the same object `device.webContext()` yields, so every locator
  and action works unchanged.

  Set `browser` instead of `app` and the session becomes **browser-only**: no app
  install, and the native agent becomes optional rather than required — on iOS
  that is the difference between opening a web page and needing a signing
  identity first.

  Three things this needed beyond the existing DOM transport:

  - **A tab per test, closed when it ends**, the way Playwright hands each test
    its own page. Android creates and closes tabs over the debugging socket; the
    fixture closes them, so they cannot accumulate. WebKit exposes no tab
    lifecycle, so iOS reuses one tab and reloads it. `open()` always loads even
    when the tab already shows that URL — a reused tab still carries the
    previous test's DOM. Note that a tab is not a Playwright browser *context*:
    cookies and `localStorage` belong to the browser profile and are shared.
  - **Settling on the document, not the URL.** A reload leaves the URL identical,
    so a URL-based wait returns instantly and hands back the *old* page. Astur
    plants a token on `window` and waits for it to disappear, which is exactly
    when the document is replaced.
  - **First-run detection.** Chrome publishes no debugging socket until its
    welcome flow is done, so a fresh emulator would wait for a page that never
    appears. Reported as `BROWSER_FIRST_RUN_PENDING` instead.

  `doctor` reports browser readiness on both platforms. See
  [Mobile Web](https://astur-mobile.github.io/Astur/mobile-web/).

### Fixed

- **An app's WebView could be driven through the browser instead.** Android names
  the sockets `webview_devtools_remote_<pid>` and `chrome_devtools_remote`, and
  they sort alphabetically — so with Chrome running, `device.webContext()`
  attached to the browser rather than the app under test. Sockets are now ordered
  by what the caller asked for.

## 0.5.0-beta.5

### Added

- **`toHaveScreenshot()` — compare the screen against a stored baseline**
  ([#17](https://github.com/Astur-mobile/Astur/issues/17)). Playwright's own
  `toHaveScreenshot` needs a `Page`, which a native session does not have, so
  this is the native equivalent — same behaviour on React Native and Flutter,
  Android and iOS.

  ```ts
  await expect(app.home.heroCard).toHaveScreenshot('home-hero-card.png');
  ```

  - **Element or full screen.** An element crops out of a full-screen capture,
    scaling bounds into screenshot pixels — which is not a no-op everywhere:
    Android reports physical pixels, iOS reports points against a 3x image, and
    a crop flush against the right edge has to be clamped because 393 points at
    3x asks for pixel 1179 of a 1178-wide screenshot.
  - **`mask`** paints regions magenta before comparing, for content that is
    legitimately different every run. A mask locator that matches nothing is
    skipped rather than throwing.
  - **Baselines are keyed by platform, renderer, and screen size.** Resolution
    alone is not enough: a React Native and a Flutter build of the same screen
    do not render identically on the same emulator. A size mismatch reports
    itself as a probable wrong-device baseline instead of a pixel count. On iOS
    the renderer is read from the installed `.app` bundle, because XCUITest
    serves the same native tree for both and offers no runtime signal.
  - **`threshold`, `maxDiffPixels`, `maxDiffPixelRatio`.** Setting both budgets
    means both must hold, so raising one cannot silently widen the other.
  - **First run writes the baseline and fails.** A run that quietly creates one
    has asserted nothing, and on CI that turns a missing baseline into a green
    test that never compared anything.
  - Captures until two consecutive captures are identical, so an animation still
    settling is not recorded as the baseline.
  - **Failures render as an image diff in the Playwright HTML report**, with the
    Diff / Actual / Expected / Side by side / Slider tabs. The report keys that
    off the `-expected` / `-actual` / `-diff` attachment suffixes, so the three
    images are named to match rather than showing up as unrelated attachments
    you open one at a time.

  Also adds `locator.screenshot()` and `device.screenshot({ mask })`. See
  [Visual Comparison](https://astur-mobile.github.io/Astur/visual-comparison/),
  and `examples/specs/visual-comparison.test.ts` for a worked example that runs
  on all four builds.

- **Network observation on React Native (Android and iOS).** `device.network`
  now works against a React Native **debug build attached to Metro**, reading the
  CDP `Network` domain that React Native DevTools uses. The reporter lives in
  `ReactCommon`, the shared C++ layer, so one client covers both platforms and
  the same records, redaction, body caps and `clear()` semantics apply as on
  Flutter.

  Astur connects as an ordinary CDP client. It does **not** stand in for Metro,
  and needs no proxy, no certificate, and no change to how the app is launched or
  driven. The dev server defaults to `http://127.0.0.1:8081`; override with
  `ASTUR_RN_DEV_SERVER`.

  Two boundaries, both measured against a live build rather than inferred:

  - **Debug builds only.** The reporter sits behind a compile-time
    `REACT_NATIVE_DEBUGGER_ENABLED` flag and is absent from release builds — the
    same situation as Flutter's release AOT builds, and not fixable from outside
    the app. `capabilities().observe` reports `false` with the reason, so a spec
    that asks first skips instead of failing.
  - **`XMLHttpRequest` traffic only** — which is React Native's own `fetch`
    polyfill and `axios`, since both bottom out there. **Expo's native `fetch`**
    (the global from SDK 52 on) is implemented natively, never touches React
    Native's networking module, and emits no CDP events at all.

  Targets are matched by application id, so a dev server left running for a
  different project can never be mistaken for the app under test. Discovery is
  cached per session, and a session that never had a target never re-probes, so
  native and Flutter runs pay nothing.

  The shared `network-observation.test.ts` now runs **unchanged** on React
  Native, because the demo app's Network lab answers on the same three routes
  with the same statuses as the Flutter build. Run it with the new
  `npm run test:android:rn-debug` / `npm run test:ios:rn-debug` (examples and
  boilerplate both) — 5/5 on each.

  iOS needs no app-side change at all: the stock `AppDelegate` already loads
  from Metro under `#if DEBUG`. The two Android settings above are only needed
  when a project has deliberately turned debug dev-support off.

- **Network observation on Flutter iOS (simulator).** `device.network` now works
  for a debug Flutter build on the iOS simulator, with the same coverage,
  redaction and body limits as Flutter Android.

  Nothing changes about how the app is installed, launched, or driven — it is
  still XCUITest end to end. A debug Flutter build starts its own Dart VM service
  and logs the URL, and on the simulator that URL is already on the host's
  loopback, so observation attaches to what the app already advertises.

  Three things this needed:

  - A **network-only attach** for the VM client. `connect()` binds an isolate by
    evaluating a Dart expression, which needs the compiler `flutter run`
    attaches; an app launched by `simctl` has a working profiler but no
    compiler. `connectForNetwork()` binds on the capability actually required —
    an isolate that registered the `dart:io` profiler extensions.
  - **Discovery by polling, not by time window.** `log show` does not surface the
    last few seconds dependably, so a window narrow enough to exclude a previous
    run's URL also loses the one just logged. Astur now tries every logged URL
    newest-first and lets connection decide which is live — a terminated app's
    service is gone — retrying until a deadline.
  - **Profiling is enabled at attach**, not only in `clear()`. The setting is
    scoped to the isolate, and the fixture's `clear()` runs before the relaunch
    that replaces it, so a test that read traffic without clearing first saw
    nothing.

  `clear()` deliberately does not start discovery, so the per-test fixture clear
  does not charge every test a log query it has no use for.

  The Dart VM client and network mapping moved from `@astur-mobile/android` into
  `@astur-mobile/core` so both drivers share one implementation. Neither was
  publicly exported, so this is not a breaking change.

**Still unsupported, and why** — Flutter on a real iOS device keeps its VM
service behind a usbmuxd tunnel Astur does not open yet, and a plain native app
exposes no equivalent hook at all. Both report `observe: false` with the reason
in `coverage`. See the
[Network Observation](https://astur-mobile.github.io/Astur/network/) guide.

### Fixed

- **`--update-snapshots` only worked as `--update-snapshots=all`.** A bare
  `-u` presets to `changed`, so the documented way to accept an intended
  screenshot change did nothing: the baseline stayed put and the test kept
  failing, while the failure message told you to run that exact flag. All four
  modes now behave as Playwright defines them, and `none` no longer records a
  missing baseline — the mode meant to catch drift on CI was creating it.

- **iOS Flutter and iOS React Native shared one screenshot baseline.** The key
  used `uiEngine`, which is always `'native'` on iOS because XCUITest serves the
  same tree for both, so a Flutter build compared against the React Native
  baseline. The renderer is now read from the installed `.app` bundle, giving
  `ios-flutter-…` its own directory. Android keys are unchanged.

  The `ios-native-393x852` baselines shipped in 0.5.0-beta.4 were recorded from
  the Flutter build by mistake — iOS skips installing when the bundle id is
  already present, and both demo builds are `com.astur.demo`. They have been
  re-recorded from the React Native build, and iOS Flutter baselines added.
  Record iOS baselines with `ASTUR_IOS_APP_FORCE_INSTALL=1`.

## 0.5.0-beta.4

### Added

- **`device.keyboard.type(text)` — type into whatever holds keyboard focus.**
  For controls with no element to fill: a multi-box OTP field, where the visible
  boxes are plain views and the real input is never exposed to the accessibility
  tree, so `getByType('textField')` finds nothing and `fill()` has no target
  ([#15](https://github.com/Astur-mobile/Astur/issues/15)).

  ```ts
  await device.getByTestId('otp-input').tap();
  await device.keyboard.type('123456');
  ```

  Works the same on both platforms — XCUITest types into the focused responder,
  Android sends to the focused view — so one spec covers both.

  Prefer `fill()` wherever the field is addressable: it resolves the element,
  clears it, and verifies the value landed, none of which is possible when
  targeting focus. With no keyboard on screen the iOS agent fails with
  `KEYBOARD_NOT_VISIBLE` rather than silently doing nothing.

  Showcased in `examples/specs/keyboard-focus.test.ts`, which runs unchanged on
  both platforms.

### Fixed

- **`pressKey()` with a single character typed the wrong thing on Android — and
  could leave the screen.** The character fell through to
  `input keyevent <char>`, where Android reads it as a *keycode number*: keycode
  4 is `BACK`, so `pressKey('4')` navigated back instead of typing a 4. Digits
  are `KEYCODE_0 = 7` through `KEYCODE_9 = 16`, so every bare digit fired
  something unrelated — `'1'` sent `SOFT_LEFT`, `'6'` sent `CALL`.

  A single printable character now types that character on both platforms, which
  is what a digit-by-digit OTP loop needs:

  ```ts
  for (const digit of '123456') {
    await device.pressKey(digit);
  }
  ```

  Named keys (`'BACK'`, `'ENTER'`) and raw numeric keycodes (`'66'`) are
  unaffected — the rule only applies to input exactly one character long.
  `pressKey(' ')` now also types a space on iOS, which previously threw.

- **A phantom Android keyboard was pressing Back and navigating the app
  mid-test.** Keyboard state was read from two unreliable signals in
  `dumpsys window`:

  - `mImeShowing=true`, matched anywhere in the dump. It lingers after the
    keyboard is gone, so a focused field with no soft keyboard on screen
    reported one as visible.
  - the first `mBounds=Rect(...)` in the dump, which belongs to the *display*
    config — reporting the keyboard as covering the entire screen, so every
    element looked obstructed.

  Together those made `fill()` and `tap()` treat a plainly visible field as
  covered, dismiss the "keyboard" — which presses Back — and navigate off the
  screen. The next locator then failed on a screen that was no longer there.

  Both the host parser and the UIAutomator agent now read the IME's own insets
  source and nothing else, and treat a collapsed frame (`[0,2424][1080,2424]`,
  zero height at the bottom edge) as hidden. Measured on the same device at the
  same instant, the agent went from `0,0 1080×2424` to `0,1541 1080×883`,
  matching the host parser exactly. Fixes `login` and `forms` on React Native
  Android, and unblocks the native photo picker.

  **The bundled agent APK is rebuilt**, so this needs the shipped
  `@astur-mobile/android` rather than only a source update.

### Changed

- The media-upload example dismisses the system picker's "Choose Google Photos
  account" prompt, which opens over the grid and blocks every tap, and says so
  explicitly when the device gallery is empty instead of timing out on a
  locator that was never going to match. It also stops re-tapping after the
  picker has closed, which failed the test *after* the selection had already
  worked.
- The example suite resets the keyboard between tests. A test that typed left
  the IME up over the bottom tab bar, so the next test's first navigation
  tapped the keyboard instead of a tab.
- media-upload is excluded on Flutter Android, matching Flutter iOS. A Flutter
  session reads its tree from the Dart VM, which only contains the app's own
  widgets — the system photo picker is another app's UI and no locator can
  reach it.

## 0.5.0-beta.3

### Added

- **`device.network` — observe the app's HTTP traffic.** Read back what a
  screen actually called, and assert on it:

  ```ts
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, capabilities.coverage);

  await device.network.clear();
  await app.networkLab.getProfile();

  const [request] = await device.network.requests({ url: '/api/profile' });
  expect(request).toMatchObject({ method: 'GET', status: 200 });
  ```

  Coverage is **instrumented application traffic**, never "all device
  traffic". Available today on **Flutter Android**, via the Dart VM's
  `dart:io` HTTP profiler — the same source Flutter DevTools' Network view
  uses. That covers `dart:io`'s `HttpClient`, and therefore `package:http`
  and Dio; it does not cover WebView requests, native SDK calls, or
  platform-channel traffic. Support is detected at runtime from the isolate's
  registered extensions rather than inferred from "this is Flutter".

  - `capabilities()` reports `observe`, `intercept`, `transports`,
    `responseBodies`, `coverage`, and `adapterRequired`, so a test can ask
    what is covered instead of assuming.
  - `requests(filter, options)` **throws** `NETWORK_OBSERVATION_UNSUPPORTED`
    rather than returning `[]` where observation is unavailable — an empty
    array has to mean "no traffic happened", or an assertion over it passes
    for the wrong reason.
  - Credential headers (`authorization`, `cookie`, `set-cookie`, `x-api-key`)
    are redacted by default, so secrets never reach a CI log or an HTML
    report. Response bodies are capped at 64 KiB and dropped with
    `bodyOmittedReason`. Both are adjustable per call.
  - The test fixture clears the buffer between tests, so one test can never
    assert on another's traffic and a long run cannot accumulate payloads.

  **Interception is not available yet** — `capabilities().intercept` is
  `false` everywhere and `adapterRequired` says why. Stubbing a request means
  holding it open, which a profiler cannot do. Astur deliberately does not
  ship a MITM proxy for this: Android 7+ ignores user-installed CAs unless
  the app opts in via `network_security_config`, and Dart's `HttpClient`
  ignores the system proxy unless the app sets `findProxy` — so a proxy needs
  app changes anyway while adding TLS and certificate failures as new ways
  for unrelated tests to break.

### Fixed

- **Element actions no longer fail when UiAutomator refuses to act on a
  resolvable node.** An agent `element.tap`/`fill`/`drag` failure now falls
  back to resolving the element and acting on its coordinates, instead of
  aborting the test. UiObject2 routinely declines to click a node that is
  present and correct — a `Text` inside a `Pressable`, or a Flutter
  `Semantics` wrapper whose actionable child is merged beneath it — and a
  coordinate tap performs the identical action. Reads still surface their
  errors, because a failed read has no equivalent. This fixes the native
  media picker on React Native Android.

- **Flutter network observation survives a hot restart.** The Dart HTTP
  profiler setting is scoped to the isolate, and every test reset
  hot-restarts into a new one, so observation silently stopped after the
  first test. The session now re-applies it after each restart.

## 0.5.0-beta.2

### Added

- **`by.native({ ios, android })` — raw native selector escape hatch.** For
  the rare element `by.label`/`by.id`/`by.text`/`by.role`/`by.type` cannot
  express (most often a screen with no accessibility metadata, where the
  only reliable match is by structure or by combining several conditions at
  once):
  - `ios` is a raw XCUITest `NSPredicate` format string, applied via
    `app.descendants(matching: .any).matching(NSPredicate(format:))` — the
    same declarative predicate grammar Apple's own APIs and Appium's `-ios
    predicate string` strategy use. Data for a restricted query language,
    never executed as code.
  - `android` is a structured `AndroidNativeSelector` chain
    (`className`, `text(Contains|Matches)`, `description(Contains|Matches)`,
    `resourceId(Matches)`, `packageName`, `hasChild`, `hasDescendant`) built
    entirely from androidx.test.uiautomator's own `By`/`BySelector` fluent
    API — deliberately not an arbitrary expression language (no `eval`, no
    custom parser, no runtime bytecode compilation, unlike Appium's
    `-android uiautomator` strategy).
  - An optional `instance` picks the nth match (after `hasChild`/
    `hasDescendant` constraints) on either platform.
  - Requires a connected native agent: legacy/no-agent sessions throw
    `NATIVE_SELECTOR_REQUIRES_AGENT` instead of silently matching nothing.
    A selector missing the current platform's payload throws immediately at
    the agent with a clear message, instead of returning empty results.
  - The reserved `xpath` strategy remains unimplemented; its error message
    now points here instead.

### Fixed

- **`astur test` could throw `spawn EINVAL` on Node 22/24** (worked on
  Node 20). The CLI ran Playwright by spawning `npx` (`npx.cmd` on Windows)
  — both `npx` and Playwright's own `node_modules/.bin/playwright` are
  `#!/usr/bin/env node` shebang scripts, so this chained two separate
  shebang/shell-driven re-execs to reach Playwright's real entry point. That
  class of nested indirection is a documented source of spawn regressions
  across recent Node versions. `astur test` now resolves
  `@playwright/test`'s CLI module directly from the project (via the
  package's own `./cli` export) and spawns it under `process.execPath` — one
  exec, no shell, no `npx`, no `.cmd`, no PATH lookup at all.
- **Android inspector/codegen: "UI tree unavailable … uiautomator dump failed"
  flapping.** A previous session that died without cleanup (crashed or killed
  CLI) left its instrumentation alive on-device, holding Android's single
  UiAutomation slot — the fresh agent then crashed with "already registered",
  and the legacy `uiautomator dump` fallback was blocked by the same zombie.
  Session bootstrap now force-stops stale agent instrumentation and removes
  leaked agent port-forwards before starting, and session close stops the
  instrumentation (test) package explicitly, so a crashed run can no longer
  poison the next one. Verified live against a device in the broken state:
  native tree in <1s in `required` mode, zero leaked processes/forwards after
  close.
- Inspector: unreadable JavaScript/TypeScript toggle text on hover.

## 0.5.0-beta.1

### Added

- **Inspector assertion composer covers the 0.5.0 matcher set.** New assertion
  kinds `enabled`, `disabled`, `selected`, `focused`, and `match count equals`
  (emits `toHaveCount(n)`); boolean assertions send no value, and count input
  is validated as a whole number before the step is accepted.

### Fixed

- **Windows: `codegen`/`inspect` no longer crash right after startup.** (#10)
  The CLI auto-opened the browser by spawning `start`, which is a cmd.exe
  built-in, not an executable — the resulting async ENOENT had no `error`
  listener and took the whole process (including the live inspector server)
  down. Browser
  launching is now a single shared `openExternal()` helper that runs
  `cmd /c start "" <url>` on Windows, attaches an `error` handler so a failed
  open can never crash the CLI on any platform, and is covered by regression
  tests for the exact reported failure.
- **Inspector codegen can no longer emit broken steps.** Locator-less `fill` /
  `expect` steps are rejected at recording time with a clear status message,
  and the code generator's empty-locator guard now runs before the fill/expect
  emitters (previously it could produce `device..fill(...)`). The generator is
  now covered by direct unit tests.

## 0.5.0-beta.0

### Added

- **Locator state readers and conveniences.** `MobileLocator` gains
  `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()`,
  `isDisabled()`, `isSelected()`, `isFocused()`, `clear()`, and a
  Playwright-style `waitFor({ state })` (`visible` / `hidden` / `attached`).
  All are cross-platform and ride the existing snapshot/auto-wait pipeline.
- **`toHaveCount` matcher.** `expect(locator).toHaveCount(n)` polls until the
  number of matches equals `n` — for native `MobileLocator`s and Playwright web
  locators alike — and reports the last observed count on failure.
- **Native multi-match lookup on Android.** The UIAutomator agent now serves
  `element.findAll` / `element.findMany`, so `queryAll()`, `count()`,
  `device.findAll()`, and `device.findMany()` resolve on-device in a single
  round trip instead of pulling and parsing a full UI-tree dump. Older
  installed agent builds keep working: the host detects missing support and
  falls back to the previous tree-snapshot path, including in `required` mode.

### Fixed

- **Locator routing in matchers.** Custom matchers now identify Playwright
  locators without misclassifying `MobileLocator` (which also exposes a
  `waitFor()` method as of this release).

## 0.3.0-beta.0

### Added

- **Flutter on Android (Dart VM service driver).** Auto-detects a debug/profile
  Flutter APK, drives it through the live widget tree (Semantics id, text, label,
  value, bounds), hot-restarts between tests, and injects taps/fills/gestures.
  The full shared demo suite runs **9/9** on the Android emulator.
- **Flutter on iOS (XCUITest accessibility tree).** The shared demo suite runs
  **6/9** on the iOS simulator (login, forms, slider, orientation/menu, swipe,
  tap-laboratory). The iOS agent adds a substring fallback over Flutter's merged
  accessibility labels so `getByText` resolves; counters/slider are read by id.
- **WebView DOM control — `device.webContext()`.** An engine-agnostic API that
  inspects a native WebView's DOM and drives it with stable web locators
  (`getByTestId` › `getById` › `getByRole` › `getByText` › CSS), plus `fill`,
  `tap`, `snapshot`, and `elementAt`. All querying/interaction runs in-page via an
  injected bridge over a single `evaluate(js) → JSON` transport, so it behaves
  identically for **Flutter and React Native**.
  - Android (Chromium WebView · Chrome DevTools Protocol) — supported.
  - iOS **Simulator and real device** (WKWebView · WebKit RWI via
    `ios-webkit-debug-proxy` v1.9+) — supported (`WKWebView.isInspectable = true`,
    iOS 16.4+). The simulator is bridged automatically through its per-simulator
    `com.apple.webinspectord_sim` socket (iwdp `-s`), and modern WebKit's `Target`
    multiplexing is wrapped/unwrapped transparently — so a WebView DOM fill on the
    simulator round-trips in single-digit milliseconds instead of ~16s through the
    native keyboard.
- **Inspector WebView view.** When the device has an inspectable WebView, its DOM
  is spliced into the UI tree under the native host node, each element shown with
  its real locator and fillable/tappable from the panel.
- `test:ios:flutter:spec` example/boilerplate script and an `ios-native`
  Flutter Playwright config; the boilerplate gains Android + iOS Flutter suites.

### Changed

- **iOS fill is field-aware and faster.** `fill` now skips the clear+type entirely
  when the field already holds the target value, **types** secure and short fields
  (paste into secure fields is unreliable, and the long-press paste menu costs more
  than typing a few characters), and **pastes** longer plain values. The locale-
  sensitive long-press Select-All/Paste menu is now a fallback, not the default.
- **iOS keyboard policy: `fill` keeps the soft keyboard up.** Instead of dismissing
  after every fill, the *next* pointer action dismisses the keyboard only if it
  actually covers the target — detected by keyboard/element **frame overlap** (not
  `isHittable`, which reports true for partially-covered controls). Multi-field
  forms no longer pay a dismiss per field; the full iOS demo suites run faster
  (Flutter 6/6 in ~2.1m, RN 7/7) with no regressions. (Android keyboard policy is
  unchanged for now — parity is a separate, separately-verified change.)

### Fixed

- **Inspector/codegen: device actions are serialized ahead of background polling.**
  While a fill/tap/etc. runs, the screenshot, UI-tree, and WebView-DOM probes pause,
  then refresh once after a short settle. This removes a class of races: background
  reads re-focusing a field mid-type (the "autofill suggestion keeps reappearing"
  retry feel) and the WebView DOM context being disposed *between* two fills (which
  dropped a web node's `.web` flag and routed the second fill to the native agent,
  surfacing as `element.fill failed`).
- **iOS element tap can no longer hang for the full command timeout.** A tap on a
  control left covered by the soft keyboard used to spin inside XCUITest's implicit
  hittability wait (~30s) and time out. Taps now dismiss an obstructing keyboard,
  re-resolve, and fall back to a bounded coordinate tap that cannot spin.
- **Flutter Android hot-restart reset (the big one).** `flutter run`'s hot restart
  matched a *stale* `Restarted application` line in the never-cleared stdout buffer,
  so every restart after the first resolved immediately — Astur re-bound the dying
  pre-restart isolate and read an empty widget tree, making resets fail with
  `Timed out waiting … for the Astur demo app shell` on a recurring (≈ every third
  reset) cadence. Hot restart now only matches output produced *after* the restart
  command. The readiness wait also reports surfaceless engines instead of silently
  timing out, and the reset re-foregrounds + retries if the view comes back 0×0.
  The full Android Flutter suite is now **9/9, stable across repeated runs** (and
  ~40% faster — no more wasted reset timeouts).
- **Flutter iOS execution speed & consistency (major).** The iOS XCUITest suite was
  fast on an idle host but degraded catastrophically under host CPU load — Flutter
  iOS dropped to minutes-per-test and intermittent timeouts while React Native stayed
  fast. Root cause: the agent's "disable wait-for-quiescence" patch targeted the
  selector `waitForQuiescenceIncludingAnimationsIdle:` which current Xcode **renamed**
  (now `…:isPreEvent:` / `…:usingActivity:isPreEvent:`, and the accessibility client's
  `waitForQuiescenceOnAllForegroundApplicationsAsPreEvent:`), so it silently no-opped
  and quiescence stayed fully active. A Flutter screen mid-transition never reports
  idle, so each read blocked on XCUITest's ~60s idle timeout — invisible on an idle
  host (the app idles in ms) but ruinous under load (the render thread is starved).
  React Native never showed it because UIKit goes idle promptly. Fixes:
  - The quiescence patch now targets the selectors that exist (on `XCUIApplicationProcess`
    and `XCAXClient_iOS`). **Reads** (`isPreEvent == false`) skip the idle wait entirely;
    **events** (`isPreEvent == true`) use a *bounded* wait for real idle (`isQuiescent`
    polled, returns the instant the app settles, capped — default 1s, `ASTUR_IOS_EVENT_SETTLE_CAP_MS`)
    instead of the original unbounded wait, so taps/typing still settle but a never-idle
    Flutter screen can't stall the single-threaded agent.
  - `findElementObject` resolves text via a single `label/value/placeholderValue
    CONTAINS[cd]` predicate `firstMatch` (one snapshot) and never enumerates
    `descendants(.any)` element-by-element — a miss no longer walks hundreds of
    per-element snapshots.
  - `keyboard.dismiss` bounds the dismissal key's hittability wait (falling back to a
    coordinate tap) so `XCUIElement.tap()`'s implicit hittable-wait can't spin for the
    whole command timeout when the keyboard is slow to settle.
  - iOS agent `commandTimeout` default 15s → 30s: a focused Flutter field never idles
    (blinking cursor) so XCUITest types character-by-character and a multi-char fill
    legitimately runs ~15-20s; 15s clipped it.
  Result under sustained host load: the 6-test iOS Flutter suite went from **3/6 in
  ~15m** to **6/6 in ~2.8m**, and is now load-robust. React Native / native iOS reach
  idle promptly, so the bounded waits return immediately and behaviour is unchanged.
- **Flutter Android login** — the soft keyboard is dismissed by clearing the Dart
  primary focus over the VM service (no Back press that could pop the route /
  background the app), and the first field no longer drops its leading character
  (the IME input connection is awaited before `input text`).
- **Flutter Android drag-and-drop** — keyed Stack children so a mid-gesture
  reorder no longer reassigns pan recognizers to the wrong tile.
- **Media-upload picker** — the inline picker option is re-scrolled on-screen and
  re-tapped until the selection confirms, so a tap dropped mid-expansion no longer
  fails the spec.
- **WebView interaction reliability** — the webview example/boilerplate spec now
  drives the DOM through `device.webContext()` (in-page over the debugging
  transport) instead of Playwright `web.page` actionability, which intermittently
  stalls against an offscreen WebView's throttled `requestAnimationFrame`. The
  `web.page` path still gets an active/focused wake on connect, but rAF-sensitive
  Playwright actions on offscreen WebViews should pass `{ force: true }` or prefer
  `device.webContext()`.
- `scrollIntoView` settles after momentum so taps use final, not in-flight,
  bounds.

### Known limitations

- **iOS Simulator WebView DOM** is not yet supported — `ios-webkit-debug-proxy`
  bridges physical devices only (the simulator's `webinspectord_sim` needs a
  direct client; `device.webContext()` reports `IOS_WEBVIEW_PROXY_NO_DEVICES`).
- **Flutter iOS drag-and-drop** — only the first synthetic XCUITest drag in a
  sequence registers with Flutter's pan recognizer; `media-upload` and `webview`
  are excluded on iOS Flutter (matching React Native iOS).
- The Flutter **Dart VM service driver is Android-only**; iOS Flutter is read
  through the XCUITest accessibility tree.

## 0.1.0-beta.4

- Native Android (UIAutomator) and iOS (XCUITest) agents, inspector, codegen, and
  the Playwright-style `@astur-mobile/test` API. See the git history for detail.
