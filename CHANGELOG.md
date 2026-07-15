# Changelog

All notable changes to Astur are documented here. Versions follow the
`@astur-mobile/*` + `astur-mobile` workspace release line.

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
