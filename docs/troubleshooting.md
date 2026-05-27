# Troubleshooting

Start with:

```bash
npx astur-mobile doctor
```

Use verbose mode when a command fails:

```bash
npx astur-mobile doctor --verbose
```

## ADB Not Found

Symptom:

```text
ADB failed
```

Fix:

- install Android SDK Platform Tools
- add `platform-tools` to `PATH`

```bash
adb version
```

## No Android Devices Detected

Symptom:

```text
Android devices: No Android devices detected.
```

Fix:

- start an emulator
- connect a real device
- enable USB debugging
- approve the USB debugging prompt

Check:

```bash
adb devices -l
```

## Android Device Is Unauthorized

Symptom:

```text
unauthorized
```

Fix:

- unlock the phone
- accept the USB debugging prompt
- reconnect USB
- run `adb kill-server && adb start-server`

## Android Metadata Inference Fails

Symptom:

```text
AAPT_NOT_FOUND
```

Fix:

- make sure Android SDK build tools are installed
- set `ANDROID_HOME` or `ANDROID_SDK_ROOT`
- set `ASTUR_AAPT` to the full path of `aapt`

Or provide metadata manually:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

## Android Launch Requires Package Name

Symptom:

```text
Android launch requires app.packageName.
```

Fix your config by providing `packageName`, or ensure `aapt` is available so Astur can infer it from the APK.

## Xcode Not Found

Symptom:

```text
Xcode failed
```

Fix:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

## No iOS Simulators

Symptom:

```text
iOS simulators: No iOS simulators were found.
```

Fix:

- open Xcode
- install an iOS simulator runtime from Settings > Platforms

Check:

```bash
xcrun simctl list devices available
```

## iOS Native Actions Require XCUITest Agent

Symptom:

```text
XCTEST_AGENT_REQUIRED
```

iOS lifecycle commands and screenshots can work through `simctl`, but native element lookup and gestures require the Swift XCUITest agent.

Fix:

- pass the app bundle id when starting codegen or tests: `--app-id com.example.demo`
- or set `ASTUR_IOS_BUNDLE_ID=com.example.demo`
- in Inspector, use `Controls` > App to launch by bundle id; this rebinds the XCUITest agent to that app
- run `npx astur-mobile doctor --verbose` if the Xcode build or agent registration fails

For the bundled demo app, Astur codegen defaults to `com.astur.demo`.

## Inspector UI Tree Is Empty On iOS

Symptom:

```text
UI tree unavailable
```

The mirrored screenshot is visible, but the UI tree panel is empty.

Fix:

- make sure the simulator is booted and the app is installed
- provide the bundle id with `--app-id`, `ASTUR_IOS_BUNDLE_ID`, or Inspector `Controls`
- keep the `agents/ios-xctest-agent` project available when running from source
- increase `agent.launchTimeout` if Xcode is cold-starting the test runner for the first time

## Android Required Agent Mode Missing Endpoint

Symptom:

```text
ANDROID_AGENT_ENDPOINT_REQUIRED
```

Fix:

- set `use.astur.agent.endpoint`
- or set `ASTUR_ANDROID_AGENT_ENDPOINT`
- or switch to `agent.mode: 'auto'` during migration

## iOS Required Agent Mode Missing Endpoint

Symptom:

```text
IOS_XCTEST_AGENT_ENDPOINT_REQUIRED
```

Fix:

- set `use.astur.agent.endpoint`
- or set `ASTUR_IOS_AGENT_ENDPOINT`
- or switch to `agent.mode: 'auto'` during migration

## Agent Handshake Fails In Required Mode

Symptom:

```text
ANDROID_AGENT_CONNECT_FAILED
```

or

```text
IOS_XCTEST_AGENT_CONNECT_FAILED
```

Fix:

- verify endpoint URL/port
- verify endpoint platform matches current session platform
- verify endpoint accepts HTTP POST command envelopes
- increase `agent.launchTimeout` for slower startup environments

## Agent Command Fails In Required Mode

Symptom:

```text
ANDROID_AGENT_COMMAND_FAILED
```

or

```text
IOS_XCTEST_AGENT_COMMAND_FAILED
```

Fix:

- validate the target command in the device-side agent implementation
- confirm selector/action data matches expected agent schema
- inspect server-side agent logs for command-level failures
- temporarily run in `agent.mode: 'auto'` while diagnosing endpoint command coverage

## Linux/Windows iOS Skip

Symptom:

```text
SKIP iOS platform
```

This is correct. Local iOS automation requires macOS with Xcode.
