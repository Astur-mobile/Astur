# Android UIAutomator Agent

The Android agent is Astur's device-side automation bridge. It is not an AI
agent and it is not an Appium/WebDriver server. It should be a small Kotlin
instrumentation process that receives Astur protocol commands and executes them
with Android UIAutomator APIs.

The public test API stays simple:

```ts
await device.getById('login-submit-button').tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

The runtime path is:

```text
Astur locator/action API
  -> @astur/core session element methods
  -> @astur/android agent transport
  -> Kotlin UIAutomator agent
  -> UiDevice / By / Until / UiObject2
```

The current npm alpha still has a zero-install fallback:

```text
adb shell uiautomator dump
  -> parse XML on the host
  -> adb shell input tap/text/swipe
```

The agent replaces that fallback for normal interactions by doing wait, lookup,
actionability checks, and the final action atomically on the device.

Buildable package:

```text
packages/android-agent
  Gradle Android application + androidTest APK
  instrumentation runner
  lightweight HTTP command server
```

Host startup now works like this:

```text
@astur/android
  -> use ASTUR_ANDROID_AGENT_ENDPOINT when supplied
  -> otherwise, if built agent APKs exist, install them
  -> adb forward tcp:<hostPort> tcp:<devicePort>
  -> adb shell am instrument -w ...
  -> connect through the native-agent client
  -> fall back only when the configured fallback policy allows it
```

Default local build outputs:

```text
packages/android-agent/build/outputs/apk/debug/android-agent-debug.apk
packages/android-agent/build/outputs/apk/androidTest/debug/android-agent-debug-androidTest.apk
```

Override paths and runtime details with:

```text
ASTUR_ANDROID_AGENT_APK
ASTUR_ANDROID_AGENT_TEST_APK
ASTUR_ANDROID_AGENT_HOST_PORT
ASTUR_ANDROID_AGENT_DEVICE_PORT
ASTUR_ANDROID_AGENT_PACKAGE
ASTUR_ANDROID_AGENT_TEST_PACKAGE
ASTUR_ANDROID_AGENT_RUNNER
```

Current command surface:

- `agent.ping`
- `device.setOrientation`
- `tree.get`
- `element.find`
- `element.wait`
- `element.tap`
- `element.doubleTap`
- `element.longPress`
- `element.fill`
- `element.drag`
- `gesture.tap`
- `gesture.doubleTap`
- `gesture.longPress`
- `gesture.swipe`
- `gesture.drag`
- `keyboard.state`
- `keyboard.dismiss`

Current implementation status:

- baseline command handlers are implemented in `AsturAgent.kt`
- `packages/android-agent` contains the instrumentation runner and HTTP transport server
- `@astur/android` can bootstrap built local agent APKs automatically when no endpoint is configured
- selector strategies supported: `accessibility`, `id`, `text`, `type`, and role mapping
- explicit `NOT_IMPLEMENTED` responses remain for unsupported selector internals such as `xpath`
- host driver keeps capability-aware fallback in `agent.mode: 'auto'`

Implementation rules:

- Prefer on-device polling over host-side polling.
- Return compact JSON snapshots for diagnostics and assertions.
- Keep screenshots and full-tree dumps as diagnostics, not the primary tap path.
- Fail with structured Astur error codes and include matched candidates where useful.
- Preserve the public TypeScript API; complexity belongs in this layer.
