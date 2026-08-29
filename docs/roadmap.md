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

### Test authoring

- **Composable locators** (unreleased): scope a lookup to a parent, `filter({ hasText, hasNotText, has, hasNot })`, combine with `and()` / `or()`, and pick with `first()` / `last()` / `nth(i)`. Composition resolves against a single tree snapshot on the host rather than being pushed into the agents, which keeps the selector a driver receives unchanged and needs no agent-protocol change on either platform. Where a composed locator lands on a uniquely nameable element, its plain selector goes to the driver so behaviour matches a plain locator instead of degrading to coordinates.
- **Locator state readers and conveniences** (0.5.0-beta): `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()` / `isDisabled()` / `isSelected()` / `isFocused()`, `clear()`, and Playwright-style `waitFor({ state })`.
- **`getByPlaceholder()`, `isChecked()`, and `isEmpty()`** (unreleased), with `toBeChecked` and `toBeEmpty` matchers. Checked state is tri-state: an element that reports none is *unknown* rather than `false`.
- **`by.native({ ios, android })` — the raw native selector escape hatch** (0.5.0-beta), for the rare element `by.label`/`by.id`/`by.text`/`by.role`/`by.type` cannot express. `ios` is a raw XCUITest `NSPredicate` format string — Apple's own declarative query grammar, not executable code. `android` is a structured chain (`className`, `textContains`, `resourceId`, `hasChild`, `hasDescendant`, …) built entirely from androidx.test.uiautomator's `By`/`BySelector` fluent API — deliberately not an arbitrary expression language; no eval, no custom parser, no bytecode compiler. An optional `instance` picks the nth match on either platform. Requires a connected native agent. The reserved `xpath` strategy stays unimplemented; its error points here instead.
- **Native multi-match lookup on Android** (0.5.0-beta): the UiAutomator agent serves `element.findAll` / `element.findMany`, so `queryAll()`, `count()`, `device.findAll()`, and `device.findMany()` resolve on-device in a single round trip instead of pulling a full UI-tree dump. Older installed agents fall back automatically; the iOS agent already served both.

### What can be tested

- **Flutter** on both platforms: the Dart VM service (live widget tree) on Android, and the XCUITest accessibility tree on iOS with an agent-side substring fallback over Flutter's merged labels.
- **In-app WebView DOM control** via `device.webContext()` — an engine-agnostic inject-JS bridge driving Flutter and React Native WebViews. Android (Chromium/CDP) and iOS **simulator + real devices** (WKWebView via `ios-webkit-debug-proxy`; the simulator is bridged automatically through its per-simulator `webinspectord_sim` socket). The inspector splices the WebView DOM into the UI tree with real locators plus fill/tap.
- **Mobile web** (0.6.0-beta): `device.browser` drives a page in the device's own browser — Chrome on Android, Safari on iOS. A config with `browser` and no `app` is a browser-only session that installs nothing and treats the native agent as optional. Android gets a tab per test; iOS reuses one and reloads it, because WebKit exposes no tab lifecycle.
- **Network observation** (0.5.0-beta.5): `device.network` reports an app's HTTP traffic — the CDP `Network` domain for React Native on both platforms, and the Dart VM HTTP profiler for Flutter. Coverage is reported through `capabilities()` so a spec skips with a reason rather than failing where observation is unavailable.
- **Visual comparison** (0.5.0-beta.5): `toHaveScreenshot()` against per-device baselines, with masking, tolerances, and image diffs in the HTML report. Baselines are keyed by platform, renderer, and screen size.

### Device and tooling

- **App and device introspection** (unreleased): `device.app.list()`, `device.app.foreground()`, and `device.orientation.get()`.
- **`astur screenshot`** (unreleased) captures a device screen to a PNG without writing a test.
- **Inspector/codegen hardening** (0.5.0-beta): the assertion composer records the full matcher set, drag gestures are recorded into generated code, locator-less fill/expect steps are rejected instead of emitting broken code, exports come out as TypeScript or JavaScript, and browser auto-open no longer crashes the CLI on Windows (#10).
- Android and iOS agents return structured timing and failure diagnostics through the shared protocol; actionability failures include selector, candidate snapshot, and visible/enabled/hittable/stability state where the platform exposes it. Host-side `AsturError` keeps that detail instead of dropping it at the transport boundary.
- A manual self-hosted native smoke workflow enforces required-agent paths for Android, iOS simulator, and signed real iOS hardware.
- **Documentation in Arabic** (0.6.0-beta): every page, at `/ar/`.

## Still Missing

- **Index-addressed actions on the native path**: `nth(n).tap()` resolves the index on the host, so an action on a composed locator that cannot be named uniquely falls back to coordinates. An element-index parameter in the agent protocol would keep it native end to end. `by.native()`'s `instance` field solves this today for the escape-hatch case.
- **`fill()` on a composed locator that resolves to an unnameable element** taps to focus and types, which cannot clear the field first. Reported as `COMPOSED_LOCATOR_FILL_UNSUPPORTED` where even that is unavailable.
- **Gesture and input coverage**: no pinch/zoom gestures yet, and `clear()` still routes through `fill('')` — a dedicated native clear-text command would be more faithful on both platforms.
- **Foreground app on iOS**: neither `simctl` nor `devicectl` reports it, and the XCTest runner is scoped to the app it launched. Android reads it from `dumpsys`.
- **Orientation direction on iOS** is derived from viewport geometry, so the two landscape directions are not distinguished.
- **Flutter iOS drag-and-drop**: only the first synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer; a multi-step drag injector (real motion events) is needed for parity with the Android Dart VM driver.
- **Real iOS devices for the browser target**: the code path exists (`devicectl` → Safari) but has not been run against physical hardware.
- **Browser storage isolation**: a tab is not a Playwright browser *context*, and neither platform offers a per-tab profile — cookies and `localStorage` are shared. This is a platform boundary, not a backlog item.
- Default hosted CI cannot run real mobile hardware. Signed iOS and physical Android smoke jobs require self-hosted runners with the matching device labels.
- Deeper strict-locator reporting, including ranked candidate lists for every selector strategy, is still being expanded.
- Richer device-pool scheduling for cloud/device-farm targets is still planned; the current cloud configuration is a scaffold, not an execution path.
- Real iOS Inspector/codegen needs a compact native-tree stream so broad XCTest snapshots do not block the live tree on larger screens.
- `by.native()`'s Android `instance` selects the nth match after all `hasChild`/`hasDescendant` constraints are applied, but there is no equivalent for nesting "the nth child of a specific parent" *inside* a clause itself — only at the root of the chain.

## Next Best Steps (In Order)

1. Native-path parity for composed locators
- Add an element-index parameter to the agent protocol so `nth(n).tap()` and a composed `fill()` stay native instead of resolving to coordinates.
- Add a dedicated native clear-text command, which the same work unblocks.

2. Agent diagnostics and parity
- Keep Android/iOS protocol result shapes aligned and contract-tested.
- Expand candidate diagnostics for complex selectors without making normal actions pay for full-tree dumps.

3. Atomic interaction path polish
- Keep find + wait + action in one native command path on both platforms.
- Expand role and control coverage for widgets such as sliders, media pickers, and alerts.
- Add pinch/zoom gestures.

4. Parallel execution
- Continue expanding device pools so loose selectors can distribute workers across local and remote devices automatically.
- Keep cross-platform projects isolated by device id and artifact directory.

5. Reliability and telemetry
- Surface command timing and trace metadata consistently in reports so a flaky run identifies whether the delay was host transport, native lookup, app rendering, or action execution.
- Add Inspector-specific timing for screenshot refresh, tree refresh, hit testing, and recording actions.

6. CI enforcement and migration
- Keep the required-agent smoke workflow green on self-hosted Android/iOS runners.
- Keep fallback paths for local development until agent suites are stable enough to make the agent path mandatory everywhere.

## End-User Experience Goal

The test API should stay simple:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

All transport, waiting, actionability, and platform complexity should remain in the runtime and native-agent layers.
