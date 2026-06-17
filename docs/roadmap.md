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

- **Flutter on iOS** through the XCUITest accessibility tree (shared demo suite: 6/9 specs on the simulator), with an agent-side substring fallback over Flutter's merged accessibility labels.
- **WebView DOM control** via `device.webContext()` — an engine-agnostic, inject-JS-over-`evaluate` bridge driving Flutter and React Native WebViews. Android (Chromium/CDP) and real iOS devices (WKWebView via `ios-webkit-debug-proxy`) are supported; the inspector splices the WebView DOM into the UI tree with real locators + fill/tap.
- Android and iOS agents return structured timing and failure diagnostics through the shared protocol.
- Actionability failures include selector, candidate snapshot, and visible/enabled/hittable/stability state where the platform exposes it.
- Host-side `AsturError` keeps native-agent timing and diagnostics instead of dropping them at the transport boundary.
- A manual self-hosted native smoke workflow enforces required-agent paths for Android, iOS simulator, and signed real iOS hardware.

## Still Missing

- **iOS Simulator WebView DOM** needs a direct `webinspectord_sim` client — `ios-webkit-debug-proxy` bridges physical devices only, so `device.webContext()` on a simulator currently reports `IOS_WEBVIEW_PROXY_NO_DEVICES`.
- **Flutter iOS drag-and-drop**: only the first synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer; a multi-step drag injector (real motion events) is needed for parity with the Android Dart VM driver.
- Default hosted CI cannot run real mobile hardware. Signed iOS and physical Android smoke jobs require self-hosted runners with the matching device labels.
- Deeper strict-locator reporting, including ranked candidate lists for every selector strategy, is still being expanded.
- Richer device-pool scheduling for cloud/device-farm targets is still planned.
- Real iOS Inspector/codegen needs a compact native-tree stream so broad XCTest snapshots do not block the live tree on larger screens.
- Fluent relative/filter locators (`.filter({ hasText, has })`, `.nth`/`.first`/`.last`, `.locator(child)`) are not implemented yet. Anchored matching today is written manually via `device.tree()` + `flattenTree` + bounds geometry.
- No raw native selector escape hatch for cases the semantic-tree match cannot express (iOS NSPredicate / class chain, Android UiSelector child/descendant chains). The `xpath` strategy is currently reserved and throws on both platforms, so it is not a usable fallback today.

## Next Best Steps (In Order)

1. Agent diagnostics and parity
- Keep Android/iOS protocol result shapes aligned and contract-tested.
- Expand candidate diagnostics for complex selectors without making normal actions pay for full-tree dumps.

2. Atomic interaction path polish
- Keep find + wait + action in one native command path on both platforms.
- Expand role and control coverage for widgets such as sliders, media pickers, and alerts.

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
- Add a fluent relative API on `MobileLocator` (`.filter({ hasText, has })`, `.nth`/`.first`/`.last`, `.locator(child)`) implemented against the cached semantic tree, so anchored locators no longer need manual `flattenTree` + geometry. Higher leverage, no native change required.
- Add an opt-in raw escape hatch (`by.native({ ios, android })`) routed straight to the agents — NSPredicate / class chain on iOS, UiSelector on Android — for the rare case the tree match cannot express. Decide whether to finish or formally drop the reserved `xpath` strategy as part of this.

## End-User Experience Goal

The test API should stay simple:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

All transport, waiting, actionability, and platform complexity should remain in the runtime and native-agent layers.
