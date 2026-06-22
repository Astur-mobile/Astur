# Release Notes

What's new in each Astur release.

## 0.4.0-beta.0

### Improved

- **Faster iOS input fills.** Short and secure values stay on the reliable typed path, long non-secure replacement fills can use paste, and iOS field state is verified after fill.
- **Better keyboard handling on iOS.** Taps are bounded, keyboard obstruction checks are frame-based, and multi-field flows avoid unnecessary dismiss/reopen cycles.
- **WebView fills stay in web context.** Inspector/codegen now remaps overlapping native WebView fields back to their DOM node, so the second fill does not accidentally route through the native iOS agent.
- **Drag-and-drop in codegen.** Inspector has a Drag mode and records drag actions into generated test code.
- **Cleaner iOS WebView proxy lifecycle.** Stale `ios-webkit-debug-proxy` processes are cleared before a new session binds to the same port.

### Release

- Bumped public packages to `0.4.0-beta.0`.
- Regenerated `package-lock.json` after dependency and package version updates.

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
