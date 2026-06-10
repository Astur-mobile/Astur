# Prerequisites

Astur intentionally avoids the Appium server, but it still relies on the native platform tools that Android and iOS expose.

## Host Support

| Host OS | Android emulator/device | iOS simulator | iOS real device |
| --- | --- | --- | --- |
| macOS | Yes | Yes | Yes |
| Linux | Yes | No | No local support |
| Windows | Yes | No | No local support |

Local iOS automation requires macOS because Apple's simulator, Xcode, `xcrun`, `simctl`, `xcodebuild`, and XCTest are macOS-only.

## Required For All Users

- Node.js 18 or newer
- npm 9 or newer
- Playwright Test, installed through `@astur/test`
- A terminal with access to the platform tools on `PATH`

Check:

```bash
node --version
npm --version
npx astur-mobile doctor
```

## Required For Android

- Android SDK
- Android SDK Platform Tools
- `adb` on `PATH`
- At least one Android emulator or USB-connected Android device
- USB debugging enabled for real devices

Recommended environment variables:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

Linux/Windows users should adjust the paths to their Android SDK location.

Verify:

```bash
adb version
adb devices -l
npx astur-mobile devices --android
```

## Required For iOS

iOS is macOS-only. Pick the column that matches your target — the simulator path needs **no Apple signing**, the real-device path does.

| Requirement | iOS Simulator | Real iPhone / iPad |
| --- | :---: | :---: |
| macOS + Xcode (opened once, license accepted) | Required | Required |
| Xcode command line tools (`xcrun`, `simctl`, `xcodebuild`) | Required | Required |
| iOS **simulator runtime** installed from Xcode | Required | — |
| `devicectl` (ships with Xcode) | — | Required |
| App artifact | Simulator-built **`.app`** | Device-signed **`.ipa`** |
| Apple **signing team** (`ASTUR_IOS_DEVELOPMENT_TEAM`) | Not needed | **Required** |
| Device trusted + **Developer Mode** enabled | — | Required |
| Bundled XCUITest agent | Auto-built & started by Astur | Auto-built, **auto-signed** & started by Astur |

> The agent is never installed by hand. Astur builds and launches the bundled Swift XCUITest runner through Xcode on every session. On real devices it also signs that runner with your team — the one piece of setup simulators skip.

Verify the toolchain:

```bash
xcodebuild -version
xcrun simctl list devices available   # simulators
xcrun devicectl list devices          # real devices
npx astur-mobile devices --ios
npx astur-mobile doctor --verbose
```

Choose the iOS path you actually need before doing extra setup:

| Goal | Need to build your app first? | Artifact Astur expects | Apple signing needed? | Current repo example |
| --- | --- | --- | --- | --- |
| Bring up Inspector/codegen on a simulator and validate the iOS toolchain | No (download the demo `.app`) | `Astur.app` | No | `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo` |
| Run your own app on a simulator | Yes | Simulator-built `.app` | No | Set `app.path` in your config, then `npx astur-mobile test` |
| Run on a real iPhone or iPad | Yes | Device-signed `.ipa` | Yes. Set `ASTUR_IOS_DEVELOPMENT_TEAM` and use an app signed for the device. | `npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp` |

> The demo app referenced above (`Astur.app` / `astur.demo.ios.ipa`, bundle id `com.astur.demo`) lives in the Astur examples repository — handy for a first run before you wire up your own build.

The important artifact difference is simple: iOS simulator uses `.app`, real iOS devices use `.ipa`.

You do not need a separate Appium server, WebDriver extension, or a manually installed XCTest runner. Astur ships the Swift XCUITest agent and starts it through Xcode when needed.

If you run with only `--app-id` and the app is missing, Astur fails fast with `IOS_APP_NOT_INSTALLED`. For first run, pass `--app /path/to/Your.app` on simulator or `--app /path/to/Your.ipa` on real device so Astur can install it before attaching.

You do not install the Astur iOS agent manually. Astur bootstraps the bundled XCUITest agent automatically on both simulator and real-device sessions.

For real iOS devices, also configure:

- an Apple Developer account in Xcode
- a trusted USB-connected iPhone or iPad
- Developer Mode enabled on the device
- the app signed for that physical device
- `ASTUR_IOS_DEVELOPMENT_TEAM` set to your Apple team id

Recommended real-device environment:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
# Optional: set this only when the phone cannot reach Astur's auto-detected bridge.
export ASTUR_IOS_AGENT_HOST=192.168.0.14
```

Simulators do not need `ASTUR_IOS_DEVELOPMENT_TEAM` or an Apple Development certificate.

Astur signs and starts the bundled XCUITest runner automatically, but Apple requires the signing team to come from your machine or CI secret. When running from the source repository, Astur can infer the team from `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` if the project is already signed in Xcode. For npm installs and CI, set `ASTUR_IOS_DEVELOPMENT_TEAM`.

USB-connected real devices normally communicate through Xcode's CoreDevice tunnel. Keep `ASTUR_IOS_AGENT_HOST` unset unless you intentionally need the phone to connect to a specific Mac network address.

## Current Alpha Limits

- Android native automation defaults to the bundled Kotlin UIAutomator agent for locator lookup, waits, actions, gestures, keyboard control, and UI-tree inspection.
- Android still uses ADB for lifecycle tasks such as discovery, install, launch, log capture, screenshots, video, and port forwarding.
- Android legacy ADB/UIAutomator XML fallback remains available during migration, but it is not the preferred hot path.
- Android Chrome/WebView automation is planned.
- iOS simulator and real-device native element automation work through the bundled Swift XCUITest agent.
- iOS simulators use `simctl` for lifecycle helpers; real devices use `devicectl`.
- Real iOS devices require signing the XCUITest runner with `ASTUR_IOS_DEVELOPMENT_TEAM`.
- Real iOS permissions, direct cache/data clearing, lock/unlock, and video recording remain limited by Apple's public tooling. Use reinstall reset and screenshots where those APIs are unavailable. If native video is enabled for a real iOS run, Astur records a skipped-video attachment instead of failing the test.

## Optional Native-Agent Endpoint Prerequisites

Astur starts its bundled native agents automatically for normal local runs. You only need an explicit endpoint when you are attaching to a separately started platform agent or diagnosing transport behavior.

- reachable agent endpoint for your target platform
- matching platform agent at that endpoint (`android` endpoint for Android sessions, `ios` endpoint for iOS sessions)
- command timeout values appropriate for your environment, if you override the defaults

Typical environment variables:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

Default platform policy is agent-first on both platforms:

- Android: `automation.engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`, `startupTimeoutMs: 30_000`, `commandTimeoutMs: 20_000`.
- iOS: `automation.engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`, `startupTimeoutMs: 60_000`, `commandTimeoutMs: 15_000`.

Opt back into the legacy ADB/UIAutomator path on Android with `automation.engine: 'auto'` (which sets `legacyFallback: 'on-agent-failure'`). You can still override these values in `use.astur.automation` or `use.astur.agent`, but most projects should omit them.
