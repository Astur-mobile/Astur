# Changelog

All notable changes to Astur are documented here. Versions follow the
`@astur-mobile/*` + `astur-mobile` workspace release line.

## 0.2.0-beta.0 (upcoming)

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
  - Real iOS device (WKWebView · WebKit RWI via `ios-webkit-debug-proxy`) —
    supported (`WKWebView.isInspectable = true`, iOS 16.4+).
- **Inspector WebView view.** When the device has an inspectable WebView, its DOM
  is spliced into the UI tree under the native host node, each element shown with
  its real locator and fillable/tappable from the panel.
- `test:ios:flutter:spec` example/boilerplate script and an `ios-native`
  Flutter Playwright config; the boilerplate gains Android + iOS Flutter suites.

### Fixed

- **Flutter Android login** — the soft keyboard is dismissed by clearing the Dart
  primary focus over the VM service (no Back press that could pop the route /
  background the app), and the first field no longer drops its leading character
  (the IME input connection is awaited before `input text`).
- **Flutter Android drag-and-drop** — keyed Stack children so a mid-gesture
  reorder no longer reassigns pan recognizers to the wrong tile.
- **WebView click stability** — Android WebViews are marked active/focused on
  connect so throttled `requestAnimationFrame` no longer stalls actionability.
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
