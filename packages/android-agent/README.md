# @astur-mobile/android-agent

Android instrumentation agent for Astur v2.

Build locally with:

```sh
gradle assembleDebug assembleAndroidTest
```

This package builds two APKs:

```text
build/outputs/apk/debug/android-agent-debug.apk
build/outputs/apk/androidTest/debug/android-agent-debug-androidTest.apk
```

The host Android driver installs both APKs, starts:

```text
adb shell am instrument -w -e asturPort 8729 dev.astur.agent.test/dev.astur.agent.AsturInstrumentationRunner
```

and connects through an adb-forwarded HTTP endpoint.

The command server accepts the shared Astur native-agent envelope:

```json
{
  "id": "cmd-1",
  "protocolVersion": "1.0",
  "command": "element.tap",
  "deadlineMs": 123456789,
  "payload": {
    "selector": {
      "strategy": "accessibility",
      "value": "Login"
    }
  }
}
```

It also accepts the compatibility `method`/`params` fields while the host and
agent are migrating together.
