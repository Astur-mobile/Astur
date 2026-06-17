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

Astur automates Flutter apps without Appium or a Flutter-specific third-party driver. See [Frameworks: Flutter & React Native](./frameworks/) for the full setup guide; the boundaries are summarized here.

On **Android**, Astur attaches to the **Dart VM service** and reads the live Flutter **widget tree** (Semantics identifier, text, label, value, bounds) — not just the accessibility layer.

What works today (Android, Dart VM service):

- auto-detect a Flutter APK, launch it, and hot-restart between tests
- inspect the nested widget tree in the live inspector and codegen
- `getById` (Semantics identifier), `getByText`, `getByLabel`
- tap, double tap, long press, fill (with `toHaveValue`), swipe
- orientation, screenshots, native video artifacts

Requirements and limits:

- requires a **debug/profile** APK (the VM service is absent in release builds)
- requires **`ASTUR_FLUTTER_PROJECT`** (the Flutter app source dir) and the `flutter` CLI on `PATH` (or `ASTUR_FLUTTER_PATH`)
- only **on-screen** widgets appear in the tree — scroll a target into view first
- **native UI outside Flutter** (system permission dialogs, the native photo/file picker, share sheets) is not visible to the Dart VM service
- fine-grained drag onto custom pan widgets via synthetic input can be imprecise

On **iOS**, there is no Dart VM service: Flutter apps are read through the XCUITest accessibility tree. The shared demo suite runs **6 of 9 specs** on the iOS simulator (login, forms, slider, orientation/menu, swipe, tap-laboratory). Add stable `Semantics(identifier:)` to widgets tests need; Astur's iOS agent adds a substring fallback over Flutter's merged accessibility labels so `getByText` still resolves. Excluded on iOS Flutter: **drag-and-drop** (only the first synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer), plus **media-upload** and **webview** (same exclusions as React Native iOS). See [Frameworks: Flutter on iOS](./frameworks/#flutter-on-ios-xcuitest-accessibility-tree).

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
- WebView (WKWebView) DOM automation works on **real iOS devices** through `device.webContext()`, via `ios-webkit-debug-proxy` bridging the WebKit Remote Web Inspector. It requires `WKWebView.isInspectable = true` (iOS 16.4+), Settings ▸ Safari ▸ Advanced ▸ Web Inspector = ON, and `brew install ios-webkit-debug-proxy`. The **iOS Simulator** is not yet supported for web DOM: its WKWebView is exposed through `webinspectord_sim`, which `ios-webkit-debug-proxy` does not bridge (Astur reports `IOS_WEBVIEW_PROXY_NO_DEVICES`) — a direct simulator client is on the roadmap. WebView screens still work as native UI through XCUITest regardless. (Android in-app WebView DOM works through Chrome DevTools Protocol when the app enables WebView debugging — see [WebViews (DOM)](./frameworks/#webviews-dom).)

The source in `agents/ios-xctest-agent/` is the bundled Swift XCUITest agent. It binds to the target bundle id, reads the accessibility tree, performs native gestures and element actions, and returns compact JSON to the Node.js runtime. It solves iOS UI-tree and action execution; it does not bypass Apple's signing, provisioning, or system UI restrictions.
