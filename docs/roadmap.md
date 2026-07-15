# Roadmap

This page tracks what is still missing to reach the native-agent architecture goal:

```text
Simple Playwright-style test API
  -> Astur core
  -> Astur platform driver
  -> persistent native platform agent
  -> UiAutomator / XCUITest
```

## Implemented

- **Locator state readers and conveniences** (0.5.0-beta): `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()` / `isDisabled()` / `isSelected()` / `isFocused()`, `clear()`, and Playwright-style `waitFor({ state })`, plus a polling `toHaveCount(n)` matcher. Tests read element state directly instead of digging through raw snapshots.
- **Native multi-match lookup on Android** (0.5.0-beta): the UiAutomator agent serves `element.findAll` / `element.findMany`, so `queryAll()`, `count()`, `device.findAll()`, and `device.findMany()` resolve on-device in a single round trip instead of pulling and parsing a full UI-tree dump. Older installed agents fall back to the previous tree-snapshot path automatically (the iOS agent already served both commands).
- **Flutter on iOS** through the XCUITest accessibility tree (shared demo suite: 6/9 specs on the simulator), with an agent-side substring fallback over Flutter's merged accessibility labels.
- **WebView DOM control** via `device.webContext()` — an engine-agnostic, inject-JS-over-`evaluate` bridge driving Flutter and React Native WebViews. Android (Chromium/CDP) and iOS **simulator + real devices** (WKWebView via `ios-webkit-debug-proxy`; the simulator is bridged automatically through its per-simulator `webinspectord_sim` socket) are supported; the inspector splices the WebView DOM into the UI tree with real locators + fill/tap.
- **Inspector/codegen hardening** (0.5.0-beta): the assertion composer records the full matcher set (visibility, text, value, label, type, enabled/disabled/selected/focused, match count), drag gestures are recorded into generated code, locator-less fill/expect steps are rejected instead of emitting broken code, exports come out as TypeScript or JavaScript, and browser auto-open no longer crashes the CLI on Windows (#10).
- **`by.native({ ios, android })` — the raw native selector escape hatch** (0.5.0-beta), for the rare element `by.label`/`by.id`/`by.text`/`by.role`/`by.type` cannot express — most often a screen with no accessibility metadata, where the only reliable match is by structure or by combining several native conditions at once. `ios` is a raw XCUITest `NSPredicate` format string (`app.descendants(matching: .any).matching(NSPredicate(format:))`) — Apple's own declarative query grammar, not executable code. `android` is a structured chain (`className`, `textContains`, `resourceId`, `hasChild`, `hasDescendant`, …) built entirely from androidx.test.uiautomator's `By`/`BySelector` fluent API — deliberately not an arbitrary expression language; no eval, no custom parser, no bytecode compiler (unlike Appium's `-android uiautomator` strategy, which needs one). An optional `instance` picks the nth match on either platform. Requires a connected native agent — legacy/no-agent sessions throw `NATIVE_SELECTOR_REQUIRES_AGENT` rather than silently matching nothing. The reserved `xpath` strategy stays unimplemented; its error message now points here instead.
- Android and iOS agents return structured timing and failure diagnostics through the shared protocol.
- Actionability failures include selector, candidate snapshot, and visible/enabled/hittable/stability state where the platform exposes it.
- Host-side `AsturError` keeps native-agent timing and diagnostics instead of dropping them at the transport boundary.
- A manual self-hosted native smoke workflow enforces required-agent paths for Android, iOS simulator, and signed real iOS hardware.

## Still Missing

- **Fluent relative/filter locators** (`.filter({ hasText, has })`, `.nth`/`.first`/`.last`, `.locator(child)`) are not implemented yet. Multi-match *reads* exist today (`count()`, `queryAll()`, `findAll()`), but index-addressed chaining needs the agents to accept an element index so `.nth(2).tap()` stays on the native path. Anchored matching today is written manually via `device.tree()` + `flattenTree` + bounds geometry.
- **Gesture and input coverage**: no pinch/zoom gestures yet, and `clear()` currently routes through `fill('')` — a dedicated native clear-text command would be more faithful on both platforms.
- **Flutter iOS drag-and-drop**: only the first synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer; a multi-step drag injector (real motion events) is needed for parity with the Android Dart VM driver.
- Default hosted CI cannot run real mobile hardware. Signed iOS and physical Android smoke jobs require self-hosted runners with the matching device labels.
- Deeper strict-locator reporting, including ranked candidate lists for every selector strategy, is still being expanded.
- Richer device-pool scheduling for cloud/device-farm targets is still planned.
- Real iOS Inspector/codegen needs a compact native-tree stream so broad XCTest snapshots do not block the live tree on larger screens.
- `by.native()`'s Android `instance` selects the nth match after all `hasChild`/`hasDescendant` constraints are applied, but there is no equivalent for nesting "the nth child of a specific parent" *inside* a `hasChild`/`hasDescendant` clause itself — only at the root of the chain.

## Next Best Steps (In Order)

1. Agent diagnostics and parity
- Keep Android/iOS protocol result shapes aligned and contract-tested.
- Expand candidate diagnostics for complex selectors without making normal actions pay for full-tree dumps.

2. Atomic interaction path polish
- Keep find + wait + action in one native command path on both platforms.
- Expand role and control coverage for widgets such as sliders, media pickers, and alerts.
- Add pinch/zoom gestures and a dedicated native clear-text command to the agent protocol.

3. Parallel execution
- Continue expanding device pools so loose selectors can distribute workers across local and remote devices automatically.
- Keep cross-platform projects isolated by device id and artifact directory.

4. Reliability and telemetry
- Surface command timing and trace metadata consistently in reports so flaky runs identify whether delay was host transport, native lookup, app rendering, or action execution.
- Add Inspector-specific timing for screenshot refresh, tree refresh, hit testing, and recording actions.

5. CI enforcement and migration
- Keep the required-agent smoke workflow green on self-hosted Android/iOS runners.
- Keep fallback paths for local development until agent suites are stable enough to make the agent path mandatory everywhere.

6. Locator ergonomics
- Add a fluent relative API on `MobileLocator` (`.filter({ hasText, has })`, `.nth`/`.first`/`.last`, `.locator(child)`). Reads can build on the shipped multi-match commands (`element.findAll`/`findMany`); index-addressed *actions* additionally need an element-index parameter in the agent protocol so `.nth(n).tap()` stays on the native path. `by.native()`'s `instance` field (shipped 0.5.0-beta) solves the same problem today for the escape-hatch case specifically.

## End-User Experience Goal

The test API should stay simple:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

All transport, waiting, actionability, and platform complexity should remain in the runtime and native-agent layers.
