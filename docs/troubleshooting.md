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

## iOS XCUITest Agent Fails To Start

Symptom:

```text
IOS_XCTEST_AGENT_START_FAILED
```

Astur starts the bundled XCUITest runner for simulator automation and waits for it to register with the host bridge. The driver retries startup by default and includes the recent `xcodebuild` output in the error metadata when registration still fails.

Fix:

- confirm the selected simulator is booted: `xcrun simctl list devices booted`
- confirm the app bundle id is installed or provide `app.path` with `app.bundleId`
- run the same command once more after a cold Xcode start; the reused DerivedData path makes the second startup faster
- increase `agent.launchTimeout` only when the host is legitimately slow
- set `ASTUR_IOS_AGENT_START_ATTEMPTS=3` in unstable CI if simulator services occasionally fail to launch XCTest on the first attempt

## iOS Real Device Needs Signing Team

Symptom:

```text
IOS_DEVELOPMENT_TEAM_REQUIRED
```

Astur found the physical iPhone and attempted to start the bundled XCUITest runner, but Xcode could not sign the runner.

Fix:

- add your Apple Developer account in Xcode
- unlock and trust the connected iPhone
- enable Developer Mode on the device
- set `ASTUR_IOS_DEVELOPMENT_TEAM=<team id>`
- make sure the app IPA is also signed for this device

When running from the source repository, selecting a team in `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` is enough for local runs because Astur can infer that team. Published npm installs and CI should set `ASTUR_IOS_DEVELOPMENT_TEAM` explicitly.

The error details include the recent `xcodebuild` output so CI logs show the exact target that failed signing.

## iOS App Signature Is Not Trusted

Symptom:

```text
IOS_APP_SIGNATURE_NOT_TRUSTED
```

or:

```text
IOS_APP_INSTALL_SIGNATURE_INVALID
```

or the iPhone shows:

```text
Astur is no longer available
```

The Astur XCUITest runner started, but iOS refused to launch the app under test. Or, when `--app` / `app.path` is provided, iOS refused to install the IPA before the runner started. This is an app signing/provisioning/trust problem, not an Inspector rendering problem.

Fix:

- install an IPA signed for the connected device UDID
- rebuild or re-sign the IPA if the install output says the provisioning profile has expired
- trust the developer profile on the iPhone when iOS asks for it
- keep the app bundle id aligned with `--app-id` / `app.bundleId`
- pass `--app <path-to-device-signed.ipa>` to codegen so Astur refreshes the installed app before attaching
- if the app was signed with a different team/profile, uninstall the old app from the device and run codegen again

For codegen, Astur force-installs the provided iOS app path once before starting the XCUITest runner. Normal test runs keep the faster default and skip reinstall when the bundle id is already installed.

## iOS Real Device Keychain Is Locked

Symptom:

```text
IOS_SIGNING_KEYCHAIN_LOCKED
```

or the terminal repeatedly prints:

```text
Password:
```

Xcode is trying to access the Apple Development signing certificate for the bundled XCUITest runner, but macOS is asking for keychain permission.

Fix:

- unlock the login keychain before starting Astur
- in Keychain Access, allow codesign/Xcode access to the Apple Development certificate when prompted
- avoid running Inspector in a terminal that is waiting on an interactive signing prompt
- for CI, import the signing certificate into an unlocked temporary keychain before running Astur

Astur starts the real-device agent in an isolated process group so signing prompts do not keep owning the Inspector terminal. If signing still cannot proceed, Astur reports `IOS_SIGNING_KEYCHAIN_LOCKED` with the recent `xcodebuild` output.

## iOS Real Device Bridge Cannot Register

Symptom:

```text
IOS_XCTEST_AGENT_START_FAILED
```

with output showing the XCUITest runner launched but did not register with the Astur bridge.

Fix:

- keep the phone unlocked during startup
- allow incoming connections if macOS Firewall prompts for Node.js
- keep the device connected by USB so Astur can use the Xcode/CoreDevice tunnel
- unset `ASTUR_IOS_AGENT_HOST` if it forces the phone onto a blocked local-network route
- set `ASTUR_IOS_AGENT_HOST` to a Mac IP address only when that address is reachable by the phone
- avoid VPN/network isolation between the Mac and the device when using a LAN bridge
- increase `agent.launchTimeout` only after confirming the bridge host is reachable

If `xcodebuild` output includes `NSURLErrorDomain Code=-1009` or `Local network prohibited`, the agent launched but iOS blocked the network route. USB/CoreDevice transport is the preferred fix; forcing a Wi-Fi address can require local-network permission and firewall changes.

## Inspector Never Becomes Ready

Symptom:

```text
Inspector is not ready yet   (spinner never clears; badge stays "Connecting…")
```

The browser tab opens but the device mirror never appears and the UI tree stays empty.

Check in order:

- **Wrong/stale tab.** Each `codegen` run prints a fresh `ui  live  http://localhost:<port>` line and opens a new tab. A tab left open from a previous run points at a dead port and shows "Connecting…" forever. Close old tabs and open the URL from the **current** run.
- **A previous run is still holding the device.** Astur automatically reaps leftover agent sessions for the same device before starting a new one. If you disabled that with `ASTUR_IOS_AGENT_REAP=0`, kill stragglers manually:

  ```bash
  pkill -f "xcodebuild.*AsturIOSAgent"
  ```

- **Confirm the agent is serving commands.** Re-run with bridge tracing; you should see `response-ok tree.get` and `response-ok device.screenshot` lines:

  ```bash
  ASTUR_IOS_AGENT_TRACE=1 npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
  ```

  If commands are delivered but never get a response, the app under test is likely stuck non-idle (a looping animation/video) — see [iOS Performance And Stability](../ios/).
- **Still nothing?** Make sure you are on the current build (`npm run build` when running from source), then hard-refresh the browser tab.

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
