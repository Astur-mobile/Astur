# Release Notes

What's new in each Astur release.

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
- Flutter: Android needs a **debug** APK + the `flutter` CLI + `ASTUR_FLUTTER_PROJECT`; iOS exposes widgets through accessibility (add `Semantics(identifier:)`). See [Prerequisites](./prerequisites/) and [Platform Limits](./platform-limits/).

> Beta line: APIs may still change between beta releases.
