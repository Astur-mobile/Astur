# Platform Limits

Astur removes Appium from the setup, but it cannot remove platform rules.

## Host Operating Systems

| Host OS | Android | iOS |
| --- | --- | --- |
| macOS | Supported | Supported for simulators and USB real devices through Xcode tooling and the XCUITest agent |
| Linux | Supported | Skipped locally |
| Windows | Supported | Skipped locally |

## Android

Android exposes enough public tooling to support useful native automation without an app-side SDK:

- ADB can install, launch, stop, capture screenshots, and inject input.
- UIAutomator can expose an accessibility-backed UI tree.
- Chrome DevTools Protocol can automate Chrome and debuggable WebViews.

Astur now includes a Kotlin UIAutomator agent baseline under `agents/android-uiautomator` for the default native Android interaction path.

Current state:

- host-side Android driver supports native-agent bootstrap and endpoint transport wiring
- fallback ADB/UIAutomator XML path remains available
- Kotlin agent supports baseline `tree.get`, element wait/find/actions, gesture commands, and keyboard state/dismiss
- richer diagnostics and deeper selector parity are still in progress

## Flutter

Astur can automate Flutter apps as native mobile apps without Appium or a Flutter-specific third-party driver, as long as the app exposes usable native accessibility/semantics data.

What works today:

- launch/install the Flutter app like any APK or `.app`
- locate visible text/semantics labels exposed to UIAutomator or XCUITest
- tap, fill, swipe, drag, long-press, and press system keys at the native layer
- use screenshots and native video artifacts

What is not implemented today:

- direct Flutter widget tree inspection
- Dart VM service integration
- lookup by Flutter `ValueKey` unless that key is surfaced as native accessibility data
- Flutter driver protocol support

For reliable Flutter automation, add stable semantics labels/accessibility identifiers to widgets that tests need to find.

## iOS

iOS does not expose a public equivalent to ADB for arbitrary native UI control.

For native apps, the reliable path is XCTest/XCUITest. Astur keeps this direct and minimal:

- no Appium server
- no WebDriver translation layer
- a Swift XCUITest agent owned by the project

Current state:

- iOS driver supports bundled agent bootstrap and endpoint transport wiring
- simulator lifecycle and screenshot flows work through `simctl`
- real-device install, launch, terminate, uninstall, process lookup, and discovery work through `devicectl`
- simulator and real-device native element lookup, waits, tap, double tap, long press, fill, drag, swipe, orientation, screenshots, and keyboard commands work through the Swift XCUITest agent

Real-device iOS usage requires Apple signing, trusted devices, Xcode, and provisioning. Astur handles the automation lifecycle, but it cannot invent a signing identity for the bundled XCTest runner.

Technical limits:

- Real iOS device execution requires a configured Apple development team and an app signed for the target device. Use `ASTUR_IOS_DEVELOPMENT_TEAM` for npm and CI runs, or select a team in the source Xcode project for local repository development.
- System alerts are limited by XCTest visibility. If XCTest cannot query a system sheet reliably, Astur cannot promise a stable cross-version automation surface for it.
- Direct per-app data/cache clearing is not exposed by public iOS tooling; the reliable reset path is uninstall and reinstall from an app path.
- Real-device lock/unlock, permission mutation, and video recording are not exposed reliably through Apple's public local tooling. Real-device tests can still attach screenshots through the XCUITest agent.
- WebView (WKWebView) DOM automation is not supported yet. WebView screens and their controls work through XCUITest as native UI, but Astur cannot attach to the in-app web DOM on iOS, so `webview()` returns `WEBVIEW_NOT_SUPPORTED`. (Android in-app WebView DOM works through Chrome DevTools Protocol when the app enables WebView debugging.)

The source in `agents/ios-xctest-agent/` is the bundled Swift XCUITest agent. It binds to the target bundle id, reads the accessibility tree, performs native gestures and element actions, and returns compact JSON to the Node.js runtime. It solves iOS UI-tree and action execution; it does not bypass Apple's signing, provisioning, or system UI restrictions.
