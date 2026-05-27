# Prerequisites

Astur intentionally avoids the Appium server, but it still relies on the native platform tools that Android and iOS expose.

## Host Support

| Host OS | Android emulator/device | iOS simulator | iOS real device |
| --- | --- | --- | --- |
| macOS | Yes | Yes | Planned |
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

Only on macOS:

- Xcode
- Xcode command line tools
- iOS simulator runtime installed from Xcode
- `xcrun` and `xcodebuild` on `PATH`

Verify:

```bash
xcodebuild -version
xcrun simctl list devices available
npx astur-mobile devices --ios
```

For real iOS devices, future Astur versions will also need:

- Apple Developer account or signing team
- provisioning profile
- trusted USB device
- XCUITest agent signing configuration

## Current Alpha Limits

- Android native automation works through ADB and UIAutomator XML.
- Android native-agent endpoint transport is available when configured, with baseline Kotlin command support for tree/element/gesture/keyboard flows.
- Android Chrome/WebView automation is planned.
- iOS simulator lifecycle works.
- iOS native-agent endpoint transport is available when configured, but native element lookup and gestures still require Swift XCUITest agent command implementation.
- Real iOS device automation is planned.

## Optional Native-Agent Endpoint Prerequisites

If you are testing native-agent mode (`agent.mode: 'auto'` or `agent.mode: 'required'`), you also need:

- reachable agent endpoint for your target platform
- matching platform agent at that endpoint (`android` endpoint for Android sessions, `ios` endpoint for iOS sessions)
- command timeout values appropriate for your environment

Typical environment variables:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

Use `agent.mode: 'required'` only after validating endpoint stability in `auto` mode.
