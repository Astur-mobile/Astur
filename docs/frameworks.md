# Frameworks: Flutter & React Native

Astur drives the **real app on a real device or simulator**, so the UI framework usually does not matter: native (Swift/Kotlin/Java/Obj-C), **React Native**, and **Flutter** apps all run through the same `@astur-mobile/test` API, inspector, and codegen.

The difference is *how* the UI tree is read:

| App type | Android | iOS |
| --- | --- | --- |
| Native SDK | UIAutomator agent | XCUITest agent |
| React Native | UIAutomator agent (native views) | XCUITest agent (native views) |
| Flutter | **Dart VM service** (widget tree) | XCUITest agent (accessibility/semantics) |

## Which frameworks work

The rule is simple: **if the framework renders real native views, Astur drives it** — the tree it reads is the platform's own, so nothing framework-specific is required. Only frameworks that paint their own pixels need a dedicated path.

| Framework | Android | iOS | Notes |
| --- | --- | --- | --- |
| Native SDK (Kotlin/Java, Swift/Obj-C) | Yes | Yes | The baseline everything else is measured against |
| Jetpack Compose | Yes | — | Renders to native accessibility nodes |
| SwiftUI | — | Yes | Maps to standard `XCUIElementType` |
| React Native | Yes | Yes | Real native components; `testID` becomes the native identifier |
| Expo | Yes | Yes | Builds to React Native |
| Flutter | Yes | Yes | Custom-rendered, so it has its own path — Dart VM on Android, semantics tree on iOS |
| .NET MAUI | Yes | Yes | Compiles to native controls on both |
| NativeScript | Yes | Yes | Renders to native views |
| Cordova / Capacitor / Ionic | Yes | Yes | Shell is native; the web content is reached with `device.webContext()` |
| Kotlin Multiplatform (shared UI) | Yes | Not verified | Android side is ordinary Compose; Compose Multiplatform on iOS is untested |
| Unity / game engines | Not supported | Not supported | One drawing surface, no element tree — nothing to locate against |

Only the rows marked otherwise have been exercised against a real app. The rest follow from rendering to native views, which is the thing that actually decides the answer.

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

#### What the app has to provide

A Flutter app is only as testable as the semantics it exposes. In practice a
screen needs all of this, not just the first item:

- **An identifier on every widget a test touches or asserts on.** Wrap it in
  `Semantics(identifier: 'some-id', child: …)`. This maps to `getById()` on
  Android *and* to `accessibilityIdentifier` on iOS, so one id serves both.
- **An identified readout for anything you verify.** Flutter merges nearby text,
  so a label and its value often collapse into one node. If a test needs to
  assert "the counter went up", give the *value* its own id
  (`native-lab-lane-a-count`) rather than parsing a merged string.
- **Identified anchors around anything deliberately id-less.** If a screen ships
  widgets without ids on purpose (to exercise `by.native()`), put id-bearing
  elements immediately before and after them so tests can scroll the group into
  view deterministically.
- **A layout that does not reflow when acted on.** Reserve space for
  counters/readouts up front instead of inserting a row on first interaction —
  a shifting layout invalidates coordinates and can push a widget off screen
  mid-test.
- **`container: true` on wrappers you want as discrete nodes**, otherwise
  Flutter may merge them into a parent and the id disappears from the tree.

```dart
// A readout the test can assert on, with its own id.
Semantics(
  identifier: 'home-tap-single-count',
  container: true,
  child: Text('$_tapCount'),
)
```

### What works (Android, Dart VM service)

- Install/launch, hot-restart reset, orientation, screenshots
- Nested widget-tree inspection in the live inspector and codegen
- `getById` (Semantics identifier), `getByText`, `getByLabel`
- `tap`, `doubleTap`, `longPress`, `fill`, `swipe`
- Text-field value reads (`toHaveValue`)

### Flutter on iOS (XCUITest accessibility tree)

iOS has no Dart VM service, so Astur reads a Flutter app through the **XCUITest accessibility tree** — the same agent used for native/RN iOS. The shared demo suite runs on the iOS simulator with **all 11 enabled specs green** (login, forms, slider, orientation/menu, swipe, tap-laboratory, and the five `by.native()` specs). Two things make this work:

- **Add `Semantics(identifier:)`** to widgets your tests need. Astur reads ids, and reads counter values / slider position by id where Flutter merges the surrounding text.
- Flutter **merges descendant text into a container's accessibility label** on iOS, so a `Text('Credentials')` is not a discrete element. Astur's iOS agent compensates with a substring fallback over merged labels, so `getByText('Credentials')` still resolves — but prefer ids for anything you assert on.

Excluded on iOS (documented limits, not bugs):

- **drag-and-drop** — only the *first* synthetic XCUITest drag in a sequence registers with Flutter's pan recognizer, so a multi-piece drag puzzle can't be solved. (It passes on the Android Dart VM driver, which injects real motion events.)
- **media-upload** and **webview** — match the React Native iOS exclusions (native picker; no WKWebView CDP — see [WebViews](#webviews-dom)).

### Writing reliable Flutter tests

Everything below is measured against the demo suite on a Pixel 9 emulator. These
are the failure modes that actually bite, in rough order of how much time they
cost to diagnose.

#### Scroll with a drag, never a fling

**This is the single biggest source of flaky Flutter tests.** Flutter's scroll
physics react to *release velocity*, not gesture distance. The same swipe over
an 873 px span behaves completely differently depending on `durationMs`:

| `durationMs` | Result on a full-height page |
| --- | --- |
| `300` | Flings to the **very end** of the content |
| `600` | Overshoots well past the target |
| `1200`–`1400` | Drags a predictable ~1.3× the gesture distance and stops |

A search loop built on fast swipes cannot converge — it flings to the bottom,
detects it went too far, flings back to the top, and repeats until it runs out
of attempts. On screen this looks like the app scrolling up and down forever.
Use a slow drag (`durationMs: 1_200`) for any swipe whose distance you need to
reason about. Fast swipes are fine only when you genuinely want a fling.

#### Only on-screen widgets exist

The widget tree contains what is laid out **right now**. "Off screen" is not
`visible: false` — the node is *absent*, and a locator for it simply never
resolves. Consequences:

- **Reveal before reading**, always. Assert nothing about an element you have
  not scrolled to.
- **`scrollIntoView()` is a weaker guarantee than it looks**: it stops as soon
  as the node enters the tree, which routinely leaves it clipped by a floating
  bottom bar — present, but not usable.
- **Anchor on what you need, not on the container.** A card's bounds can sit
  inside the viewport while a child of it is still absent. Name the elements the
  test actually touches.
- **Bracket id-less targets.** To guarantee an element with no id is on screen,
  require the id-bearing elements immediately above *and* below it.
- **Derive insets from the UI, not from pixel constants.** Read the bottom bar's
  own bounds instead of reserving a magic number; a tuned constant silently
  mis-scrolls on any other density.

#### Never background or force-stop the app mid-session

The driver holds a `flutter run` attached to the app's Dart VM, and app launch
between tests is a **hot restart** over that connection. So:

- Killing the process first destroys the VM the restart targets — reattach then
  hangs until `getVM` times out.
- Pressing HOME can bring the engine back with a zero-size surface
  (`Width is zero. 0,0`), which tears the service connection down the same way.

Reset a Flutter session with a hot restart alone. It is both the supported path
and the faster one. (Astur recovers by restarting the whole `flutter run`
session if rebinding fails, but it costs seconds you don't need to spend.)

#### Layout must be stable across an interaction

If acting on a widget changes the layout, a coordinate captured beforehand is
stale by the time you use it — and an element pushed off screen leaves the tree
entirely. Prefer driving a **locator** (`locator.tap()`), which re-resolves
immediately before acting, over capturing `bounds()` once and reusing the point.

#### `by.native()` on Flutter

`by.native()` deliberately bypasses the widget tree and resolves through the
UiAutomator agent, which Astur connects alongside the VM service. Two things
follow:

- **Flutter merges a container's child labels into one `content-desc`.** A row
  reports `"Beta record\nChoose"`, so match it directly with
  `descriptionContains`. Do **not** reach for `hasDescendant`: UiAutomator
  re-walks the whole subtree per candidate, which against a Flutter tree is slow
  enough to time the command out — and has been observed taking the Dart VM
  connection down with it.
- **Resolution and action are separate.** Astur resolves through the agent but
  acts through the shell, because a Flutter `Semantics` wrapper is usually not
  clickable in its own right — the actionable node is merged beneath it, so an
  agent-side tap either errors or is swallowed by a container.

#### Keep the emulator healthy

Long-running emulators degrade in ways that look exactly like product bugs:
`getVM` timeouts, `device offline`, and `Width is zero. 0,0`. If several
unrelated specs start failing at once, restart the emulator before debugging the
code — in this suite that alone turned a reproducible 12/14 back into 14/14.

Also: **never run `adb shell uiautomator dump` while a suite is running.** It
opens its own `UiAutomation` session and disconnects the Astur agent mid-test.
`adb devices` and `logcat` are safe; the dump is not.

### Observing network traffic

`device.network` reports the app's HTTP traffic — useful for debugging what a
screen actually called, and for asserting that it called the right thing.

**Read the coverage boundary first.** Astur reports **instrumented application
traffic**, never "all device traffic". What is instrumented depends entirely on
the backend, so ask instead of assuming:

```ts
const capabilities = await device.network.capabilities();
// { observe, intercept, transports, responseBodies, coverage, adapterRequired }

test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.networkLab.getProfile();

const [request] = await device.network.requests({ url: '/api/profile' });
expect(request).toMatchObject({ method: 'GET', status: 200 });
```

| | Observe | Intercept |
| --- | --- | --- |
| Flutter Android | **Yes** — Dart VM HTTP profiler | needs the in-app adapter |
| Flutter iOS (simulator) | **Yes** — Dart VM HTTP profiler | needs the in-app adapter |
| Flutter iOS (real device) | No — VM service not reachable from the host | needs the in-app adapter |
| React Native (Android + iOS) | **Yes** — CDP `Network` domain, debug build attached to Metro | needs the in-app adapter |
| Native Android / iOS | No — no equivalent hook | needs the in-app adapter |

Flutter observation reads the Dart VM service, so it needs a **debug or profile
build** — a release (AOT) build does not publish one, on either platform. On the iOS simulator that is the
only requirement: Astur finds the service the app already advertises and
attaches, without changing how the app is installed, launched, or driven.

React Native observation reads the same CDP `Network` domain React Native
DevTools uses. The reporter lives in `ReactCommon`, the shared C++ layer, so one
client covers Android and iOS identically — but it is compiled out of release
builds, so this needs a **debug build running against Metro**. Coverage is
`XMLHttpRequest` traffic; notably **Expo's native `fetch` is invisible**. See
[Network Observation](../network/#react-native-needs-a-debug-build-on-metro) for
the setup and the full boundary.

The example suite runs the same shared spec on both, so the only difference is
which build it points at:

```bash
npm run test:android:flutter    # Flutter debug/profile build
npm run test:ios:flutter
npm run test:android:rn-debug   # React Native debug build attached to Metro
npm run test:ios:rn-debug
```

On Flutter the source is the Dart VM's `dart:io` HTTP profiler — the
same one Flutter DevTools' Network view uses. That covers `dart:io`'s
`HttpClient`, and therefore `package:http` and Dio, because both are built on
it. It does **not** cover a WebView's own requests, native SDK calls, or
platform-channel traffic. Support is detected at runtime by checking the
isolate's registered extensions, not inferred from "this is a Flutter app".

Three deliberate design choices worth knowing:

- **`requests()` throws rather than returning `[]`** when a session cannot
  observe (`NETWORK_OBSERVATION_UNSUPPORTED`). An empty array has to mean "no
  traffic happened", or an assertion over it would pass for the wrong reason.
- **Credential headers are redacted by default** — `authorization`, `cookie`,
  `set-cookie`, `x-api-key` become `<redacted>` before a record is ever
  returned, so secrets do not reach a CI log or an HTML report.
- **Response bodies are capped** (64 KiB by default) and dropped with
  `bodyOmittedReason: 'too-large'`. The profiler retains everything it captures
  for the life of the isolate, so an uncapped run would grow without bound.
  Astur enables profiling lazily on first use and the test fixture clears the
  buffer between tests, so one test can never assert on another's traffic.

Both defaults are adjustable per call:

```ts
await device.network.requests({ url: '/api' }, { maxBodyBytes: 4096, redactHeaders: ['x-tenant'] });
```

**Interception is not available yet.** `capabilities().intercept` is `false`
everywhere, and `adapterRequired` says why: stubbing or failing a request means
holding it open, which the profiler cannot do — it reports what already
happened. That needs a small opt-in in-app adapter, which is the next phase.
Astur deliberately does not ship a MITM proxy for this: Android 7+ ignores
user-installed CAs unless the app opts in via `network_security_config`, and
Dart's `HttpClient` ignores the system proxy entirely unless the app sets
`findProxy` — so a proxy needs app changes *anyway*, while adding certificate
and TLS failures as new ways for unrelated tests to break.

### Limitations to plan around

- **The Dart VM-service driver is Android-only.** On **iOS**, Flutter is read through the XCUITest accessibility tree — see [Flutter on iOS](#flutter-on-ios-xcuitest-accessibility-tree) above for what runs today and what's excluded.
- **Debug/profile build required** (no VM service in release builds).
- **`ASTUR_FLUTTER_PROJECT` is required** — Astur needs the Flutter source to attach the expression compiler; pointing at only the APK is not enough.
- **On-screen elements only.** Like the iOS accessibility tree, the widget tree exposes what is currently laid out on screen — scroll a target into view before reading or asserting on it.
- **Native UI outside Flutter is not visible to the VM service.** System permission dialogs, the native photo/file picker, and share sheets are separate from the Flutter view, so `getBy*` against the Flutter tree will not find them. Interact with those by coordinate, or drive them through the native agent path.
- **Synthetic gestures into custom pan widgets can be imprecise.** Fine-grained drag-and-drop on a custom `GestureDetector`/`Listener` may not land exactly; prefer stable taps/fills and keep draggable targets out of competing scroll views.
- **Debug Flutter APKs are large.** A debug build carries the JIT kernel
  (`kernel_blob.bin`), the debug engine, and a Vulkan validation layer, so it
  will not be small — but the ABI set still roughly doubles it. Measured on the
  demo app: **154 MB** for all ABIs versus **86 MB** for
  `--target-platform android-arm64`. Note the flag is **ignored on an
  incremental build** — run `flutter clean` first or Gradle reuses the previous
  fat APK and the flag appears to do nothing.
- **Emulator storage is a separate pool from your host disk.** An
  `INSTALL_FAILED_INSUFFICIENT_STORAGE` usually means the AVD's data partition
  is full, not that the APK is too big. Wipe the emulator's data (which also
  reclaims host space, since the qcow2 shrinks) before shaving the artifact.

## WebViews (DOM)

> Testing a **website** in the device's own browser rather than a WebView inside
> your app? That is `device.browser` — see [Mobile Web](../mobile-web/). Below
> the page the two are the same machinery; the browser adds the target and
> navigation.

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

See [Platform Limits](../platform-limits/) for the full Android/iOS boundary reference, and [Inspector And Codegen](../inspector/) for the live authoring loop.
