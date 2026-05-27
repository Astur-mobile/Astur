# iOS Setup

iOS has stricter platform rules than Android. There is no public ADB-like interface for arbitrary native UI control.

Astur's iOS path is:

- `xcrun simctl` for simulator lifecycle
- `xcodebuild` for XCTest builds
- Swift XCUITest agent for native element lookup and gestures

Astur supports endpoint-based iOS native-agent transport wiring and can bootstrap the bundled simulator XCUITest agent automatically. Published npm users should not need to build or install that agent manually for normal simulator runs. Native lookup, waits, tap, double tap, long press, fill, drag, swipe, and keyboard commands route through the Swift agent.

## Host Requirement

iOS automation requires macOS with Xcode.

Linux and Windows users can run Android automation locally, but iOS checks are skipped:

```text
• SKIP iOS platform    Local iOS automation requires macOS with Xcode.
```

## Install Xcode

Install Xcode from the App Store or Apple Developer downloads.

Then run:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

Open Xcode once to accept licenses and install additional components if prompted.

## Install Simulator Runtime

In Xcode:

```text
Settings > Platforms
```

Install an iOS simulator runtime.

Verify:

```bash
xcrun simctl list devices available
npx astur-mobile devices --ios
```

## iOS Simulator Configuration

```ts
import { defineConfig } from '@astur/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'ios',
      device: { name: 'iPhone 16 Pro' },
      app: {
        path: './apps/Demo.app',
        bundleId: 'com.example.demo'
      }
    }
  }
});
```

Optional native-agent mode:

```ts
agent: {
  mode: 'auto',
  endpoint: 'http://127.0.0.1:8788',
  launchTimeout: 15_000,
  commandTimeout: 10_000
}
```

Environment override:

```bash
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

Mode behavior:

- `auto`: use endpoint when reachable, otherwise keep lifecycle/screenshot flows and native-element commands continue to require XCTest.
- `required`: fail session creation or command execution if agent endpoint or command calls fail.
- `off`: disable endpoint usage entirely.

For simulator runs without a custom endpoint, Astur bootstraps the bundled XCUITest agent once per Playwright worker session. Xcode DerivedData is reused per simulator id so repeated runs do not build into a fresh temporary directory every time.

## Inspector On iOS

Start codegen with a bundle id when inspecting your own app:

```bash
npx astur-mobile codegen --ios --app-id com.example.demo
```

The bundled demo app uses `com.astur.demo`, and codegen defaults to that id when no iOS app id is provided. If the screenshot is visible but the UI tree is empty, use Inspector `Controls` to launch/rebind by bundle id or restart codegen with `--app-id`.

## Shared Demo Suite

`examples/ios-native/playwright.config.ts` points at the same page-object-driven tests used by the Android demo suite. The current simulator suite includes `drag-and-drop.test.ts`, `forms-slider.test.ts`, `forms.test.ts`, `login.test.ts`, `orientation-menu.test.ts`, `swipe.test.ts`, and `tap-laboratory.test.ts`.

The shared `app` fixture keeps one XCUITest agent alive for the Playwright worker, but terminates and relaunches the app under test before each spec. This gives each test a clean in-memory app state without rebuilding or reinstalling the native agent.

## Currently Supported iOS Operations

- list simulators
- install `.app` bundles
- install simulator-compatible `.ipa` files by extracting their `Payload/*.app`
- uninstall apps by bundle id
- launch by bundle id
- terminate by bundle id
- set simulator orientation through `device.setOrientation()` / `device.orientation.*`
- reset by uninstalling and reinstalling from `app.path`
- simulator screen power lock/unlock
- screenshot
- open URL
- native UI tree snapshots through the XCUITest agent
- `getByText()`, `getByLabel()`, `getByTestId()`, `getByRole()`, and lower-level `by.*` resolution
- tap, double tap, long press, fill, swipe, and drag against native elements
- keyboard visibility and dismiss commands through the XCUITest agent

| API | Support | Notes |
| --- | --- | --- |
| `await device.app.install()` | Yes | Installs the configured `.app` bundle or simulator-compatible IPA. |
| `await device.app.launch()` | Yes | Launches by configured bundle id. |
| `await device.app.terminate()` | Yes | Terminates the configured app. |
| `await device.app.reset({ reinstall: true, launch: true })` | Yes | Uninstalls/reinstalls from `app.path`, then optionally launches. |
| `await device.app.uninstall()` | Yes | Removes the configured bundle id. |
| `await device.permissions.grant('camera')` | Yes | Uses `simctl privacy` on simulators. |
| `await device.permissions.revoke('camera')` | Yes | Uses `simctl privacy` on simulators. |
| `await device.setOrientation('landscape')` | Yes | Rotates the simulator through `simctl`. |
| `await device.orientation.portrait()` | Yes | Convenience helper for portrait orientation. |
| `await device.lock()` | Yes | Simulates screen lock/power where supported. |
| `await device.unlock()` | Yes | Wakes/unlocks the simulator where supported. |

`device.permissions.grant()` and `device.permissions.revoke()` use `simctl privacy` on simulators. `device.app.clearData()` and `device.app.clearCache()` intentionally throw on iOS because `simctl` does not expose direct per-app data/cache clearing. Use `device.app.reset({ reinstall: true })` with `app.path` when a clean app container is required.

## Not Yet Supported

- real iOS device execution
- system alert handling beyond what XCTest exposes through normal app queries
- direct per-app data/cache clearing without reinstalling

Real-device execution needs more than the simulator path: Astur must manage signing-aware XCUITest runner installation, provisioning profiles, trusted/developer-mode device states, and a reliable real-device transport bridge.

System alerts are limited by XCTest visibility. Astur can automate alerts that XCTest exposes, but iOS does not make every system sheet or permission panel available through normal app queries in a stable way.

Direct per-app data/cache clearing is not exposed by `simctl`. The reliable simulator reset path is uninstall and reinstall with an app path.

The agent source lives in:

```text
agents/ios-xctest-agent/
```

That directory contains the bundled Swift XCUITest agent. It binds to the app bundle id, reads the accessibility tree, performs native actions, and bridges results back to the Node.js runtime. It is required for iOS UI-tree inspection and native interactions.
