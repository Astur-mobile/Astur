<p align="center">
  <a href="https://astur-mobile.github.io/Astur/">
    <img src="https://astur-mobile.github.io/Astur/brand/astur-logo.png" alt="Astur" width="360">
  </a>
</p>

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

## Sponsor

Astur is open source and built in the open. If it saves your team time, consider supporting development:

<p>
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/Ko--fi-Support%20Astur-FF5E5B?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  &nbsp;
  <a href="https://github.com/sponsors/Astur-mobile"><img src="https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
</p>
