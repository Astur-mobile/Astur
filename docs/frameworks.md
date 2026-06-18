# Frameworks: Flutter & React Native

Astur drives the **real app on a real device or simulator**, so the UI framework usually does not matter: native (Swift/Kotlin/Java/Obj-C), **React Native**, and **Flutter** apps all run through the same `@astur-mobile/test` API, inspector, and codegen.

The difference is *how* the UI tree is read:

| App type | Android | iOS |
| --- | --- | --- |
| Native SDK | UIAutomator agent | XCUITest agent |
| React Native | UIAutomator agent (native views) | XCUITest agent (native views) |
| Flutter | **Dart VM service** (widget tree) | XCUITest agent (accessibility/semantics) |

## React Native

React Native renders **native views**, so Astur automates it exactly like a native app — no extra setup, no special driver, on both Android and iOS.

- Add a `testID` prop to elements your tests need. React Native maps `testID` to the native accessibility identifier (`resource-id` on Android, `accessibilityIdentifier` on iOS), which `getById()` matches.
- `getByText()` / `getByLabel()` match visible text and accessibility labels.
- In-app **WebView DOM** automation works through `device.webContext()` — see [WebViews (DOM)](#webviews-dom) below — on Android and on iOS (simulator and real devices) via `ios-webkit-debug-proxy`.

```tsx
// React Native — expose stable ids for tests
<TextInput testID="login-email-input" ... />
<Pressable testID="login-submit-button" ... />
```

## Flutter

Flutter paints its own pixels instead of using native widgets, so on **Android** Astur attaches to the **Dart VM service** and reads the live **widget tree** — element identifiers, text, labels, values, and bounds — instead of relying only on the accessibility layer. This gives real widget-level inspection in the inspector and codegen.

### How it works (Android)

1. Astur auto-detects a Flutter APK (it scans for `libflutter.so` / `flutter_assets`).
2. It launches the app with `flutter run --use-application-binary=<apk>`, which attaches the Dart expression compiler.
3. It reads the widget tree on-device through the VM service and maps it to Astur locators; taps, fills, and gestures are injected through ADB.
4. Between tests the app is hot-restarted (and re-foregrounded) for a clean state.

### Requirements (Android)

- **A debug (or profile) build.** The Dart VM service only exists in debug/profile builds — a `--release` APK cannot be driven this way.
- **`ASTUR_FLUTTER_PROJECT`** — path to the Flutter app's **source** directory (the folder with `pubspec.yaml`). It is used as the working directory for `flutter run` so the expression compiler is available.
- **The `flutter` CLI** on `PATH`, or **`ASTUR_FLUTTER_PATH`** pointing at the `flutter` binary. Astur also probes common install locations (`~/development/flutter/bin`, `~/fvm/default/bin`, Homebrew, …).
- Optional: **`ASTUR_FLUTTER=1`** forces the Flutter path, `ASTUR_FLUTTER=0` disables it (otherwise detection is automatic).

```bash
# Run a Flutter suite (Android)
ASTUR_FLUTTER_PROJECT=/path/to/flutter-app \
  npx astur-mobile test --config ./config/android/playwright.flutter.config.ts

# Open the inspector / codegen against a Flutter APK
ASTUR_FLUTTER_PROJECT=/path/to/flutter-app \
  npx astur-mobile codegen --android --device emulator-5554 \
  --app ./assets/app-debug.apk --app-id com.example.app
```

### Making widgets findable

Give the widgets your tests need a stable **Semantics identifier**. `getById()` matches that identifier; `getByText()` / `getByLabel()` match `Text` content and semantic labels.

```dart
// Flutter — expose a stable id for tests
Semantics(
  identifier: 'login-email-input',
  child: TextField(controller: _email, decoration: const InputDecoration(hintText: 'pilot@astur.dev')),
)
```

Text fields report a value: the current `controller.text`, or the placeholder/`hintText` when empty — so `toHaveValue()` works the same as on native.

### What works (Android, Dart VM service)

- Install/launch, hot-restart reset, orientation, screenshots
- Nested widget-tree inspection in the live inspector and codegen
- `getById` (Semantics identifier), `getByText`, `getByLabel`
- `tap`, `doubleTap`, `longPress`, `fill`, `swipe`
- Text-field value reads (`toHaveValue`)

### Flutter on iOS (XCUITest accessibility tree)

iOS has no Dart VM service, so Astur reads a Flutter app through the **XCUITest accessibility tree** — the same agent used for native/RN iOS. The shared demo suite runs on the iOS simulator with **6 of the 9 specs green** (login, forms, slider, orientation/menu, swipe, tap-laboratory). Two things make this work:

- **Add `Semantics(identifier:)`** to widgets your tests need. Astur reads ids, and reads counter values / slider position by id where Flutter merges the surrounding text.
- Flutter **merges descendant text into a container's accessibility label** on iOS, so a `Text('Credentials')` is not a discrete element. Astur's iOS agent compensates with a substring fallback over merged labels, so `getByText('Credentials')` still resolves — but prefer ids for anything you assert on.

Excluded on iOS (documented limits, not bugs):

- **drag-and-drop** — only the *first* synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer, so a multi-piece drag puzzle can't be solved. (It passes on the Android Dart VM driver, which injects real motion events.)
- **media-upload** and **webview** — match the React Native iOS exclusions (native picker; no WKWebView CDP — see [WebViews](#webviews-dom)).

### Limitations to plan around

- **The Dart VM-service driver is Android-only.** On **iOS**, Flutter is read through the XCUITest accessibility tree — see [Flutter on iOS](#flutter-on-ios-xcuitest-accessibility-tree) above for what runs today and what's excluded.
- **Debug/profile build required** (no VM service in release builds).
- **`ASTUR_FLUTTER_PROJECT` is required** — Astur needs the Flutter source to attach the expression compiler; pointing at only the APK is not enough.
- **On-screen elements only.** Like the iOS accessibility tree, the widget tree exposes what is currently laid out on screen — scroll a target into view before reading or asserting on it.
- **Native UI outside Flutter is not visible to the VM service.** System permission dialogs, the native photo/file picker, and share sheets are separate from the Flutter view, so `getBy*` against the Flutter tree will not find them. Interact with those by coordinate, or drive them through the native agent path.
- **Synthetic gestures into custom pan widgets can be imprecise.** Fine-grained drag-and-drop on a custom `GestureDetector`/`Listener` may not land exactly; prefer stable taps/fills and keep draggable targets out of competing scroll views.
- **Debug Flutter APKs are large** (a fat APK bundles every ABI). Build for the ABIs you test (e.g. `--target-platform android-arm64,android-x64`) so installs fit emulator storage.

## WebViews (DOM)

Hybrid apps embed a WebView whose DOM is invisible to the native accessibility tree. `device.webContext()` opens that DOM and drives it with **stable web locators** — the same ergonomics as the native API:

```ts
const web = await device.webContext();
await web.getByTestId('astur-submit').tap();
await web.getById('astur-email').fill('qa@astur.dev');
const status = await web.getById('astur-result').textContent();
const tree = await web.snapshot(); // full DOM tree with best-locators + bounds
```

It is **engine-agnostic by design**: all querying, locator generation, and interaction run *inside the page* via an injected bridge over a single `evaluate(js) → JSON` transport, so the behaviour is identical for **Flutter and React Native**. Best locators rank `getByTestId` › `getById` › `getByRole` › `getByText` › CSS. The **inspector** surfaces the same DOM tree spliced under the WebView's native host node, with fill/tap on web elements.

Transport per platform:

| Platform | Transport | Status |
| --- | --- | --- |
| Android (Flutter + RN) | Chromium WebView · Chrome DevTools Protocol | **Works** — enable `setWebContentsDebuggingEnabled(true)` (Android `WebView.enableDebugging` / RN debug builds) |
| iOS real device | WKWebView · WebKit RWI via `ios-webkit-debug-proxy` | **Works** — `WKWebView.isInspectable = true` (iOS 16.4+) + Settings ▸ Safari ▸ Advanced ▸ Web Inspector, and `brew install ios-webkit-debug-proxy` |
| iOS simulator | WKWebView · `webinspectord_sim` | **Not yet** — `ios-webkit-debug-proxy` bridges physical devices only; a direct simulator client is on the roadmap |

See [Platform Limits](./platform-limits/) for the full Android/iOS boundary reference, and [Inspector And Codegen](./inspector/) for the live authoring loop.
