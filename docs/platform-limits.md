# Platform Limits

Astur removes Appium from the setup, but it cannot remove platform rules.

## Host Operating Systems

| Host OS | Android | iOS |
| --- | --- | --- |
| macOS | Supported | Supported for simulator lifecycle and native actions through the XCUITest agent |
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

- iOS driver supports bundled simulator agent bootstrap and endpoint transport wiring
- simulator lifecycle and screenshot flows work through `simctl`
- simulator native element lookup, waits, tap, double tap, long press, fill, drag, swipe, and keyboard commands work through the Swift XCUITest agent

Real-device iOS usage still requires Apple signing, trusted devices, Xcode, and provisioning.

Technical limits:

- Real iOS device execution needs signing-aware runner installation, provisioning profile handling, device trust/developer-mode validation, and a real-device-safe transport bridge.
- System alerts are limited by XCTest visibility. If XCTest cannot query a system sheet reliably, Astur cannot promise a stable cross-version automation surface for it.
- Direct per-app data/cache clearing is not exposed by `simctl`; the reliable simulator reset is uninstall and reinstall from an app path.

The source in `agents/ios-xctest-agent/` is the bundled Swift XCUITest agent. It binds to the target bundle id, reads the accessibility tree, performs native gestures and element actions, and returns compact JSON to the Node.js runtime. It solves simulator UI-tree and action execution; it does not bypass Apple's signing, transport, or system UI restrictions.
