# Astur Inspector And Codegen

Astur Inspector is the visual authoring surface for mobile tests. It streams the device screen, reads the semantic UI tree through the same runtime used by tests, ranks locators, records actions, and exports `@astur/test` code.

Unlike generic WebDriver/Appium inspectors, Astur Inspector is built around Astur's own runtime. That gives it three practical advantages:

- generated locators use the same selector engine that will run in your tests
- taps, scrolls, fills, app launch, permissions, rotation, and screenshots go through the same native Android/iOS session used by `@astur/test`
- the inspector can rank semantic locators locally from the cached tree instead of waiting for a full remote round trip after every selection

The result is a more dynamic authoring loop: inspect, interact, record, edit the generated step, switch device, launch another installed app, and continue without changing tools.

Start it with:

```bash
npx astur-mobile codegen
```

Platform-specific examples:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./apps/demo.apk --app-id com.example.demo
npx astur-mobile codegen --ios --device <simulator-udid> --app ./apps/Demo.app --app-id com.example.demo
```

For the bundled Astur demo app, iOS codegen defaults to `com.astur.demo` when no app id is provided. For your own iOS app, pass `--app-id`, set `ASTUR_IOS_BUNDLE_ID`, or launch the app from the Inspector controls.

## Header Controls

The current-device chip in the header shows the selected device. Click it to switch to another online Android device or booted iOS simulator without restarting the Inspector.

The `Controls` button contains device and app actions:

- install uploaded APK or simulator-compatible IPA
- launch an installed app by package name or bundle id
- grant or revoke permissions
- clear app data/cache where supported
- rotate, refresh, lock/unlock, dismiss keyboard, and Android navigation actions

iOS app launch from `Controls` also rebinds the XCUITest agent to the entered bundle id, so the UI tree and native interactions start working for that app.

## Recording

Click `Record`, then interact with the mirrored screen.

- clicks execute a native coordinate tap first, then record the best semantic locator when one is available
- if no stable locator exists, Astur records `device.tap({ x, y })`
- mouse-wheel scrolling or dragging over the mirror performs a native swipe
- scrolling is available while inspecting and is recorded only when `Record` is active
- `+ Fill` and `+ Expect` use inline editors, not browser prompts
- assertions support visible, exact text, contained text, value, label, and type checks

Exported code is intentionally plain:

```ts
import { test, expect } from '@astur/test';

test('recorded flow', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Login' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

## iOS Tree Requirements

iOS screenshots can stream through `simctl`, but UI tree inspection and native interaction require the Swift XCUITest agent. If the right panel says the UI tree is unavailable:

<ol class="astur-steps">
  <li>Confirm the app is installed on the simulator.</li>
  <li>Launch or rebind from <code>Controls</code> with the app bundle id.</li>
  <li>Or restart codegen with <code>--ios --app-id &lt;bundle-id&gt;</code>.</li>
  <li>Check <code>npx astur-mobile doctor --verbose</code> if Xcode or the agent build fails.</li>
</ol>

:::note[Apple XCTest]
This is an Apple XCTest requirement. It is not an Appium or WebDriver dependency.
:::

:::tip[Refresh Delayed]
If the tree is visible but the header briefly says `UI tree refresh delayed`, Astur is keeping the last good tree while the next XCUITest snapshot is still running. The mirror remains usable; the warning should clear after the next successful tree refresh.
:::

## Platform Limits

Real iOS device execution is not official yet because it needs signing-aware XCUITest runner installation, a real-device transport bridge, provisioning profile management, and validation across locked, trusted, and developer-mode device states.

System alert handling is limited by what XCTest exposes. Astur can query and interact with alerts XCTest can see, but iOS does not expose every system sheet or permission panel through normal app queries in a stable cross-version way.

iOS simulator app data/cache clearing is intentionally reset-by-reinstall. `simctl` supports install, uninstall, launch, terminate, and privacy controls, but it does not expose the same direct per-app data/cache clearing API that Android provides through package-manager commands.

The source in `agents/ios-xctest-agent/` is the bundled Swift XCUITest agent. It is the native iOS side of Astur: it binds to the app bundle id, reads the accessibility tree, performs native taps/fills/swipes, and returns compact JSON results to the Node.js runtime. It solves locator/action execution on iOS simulators; it does not remove Apple's signing, transport, and system-UI restrictions for real devices.

## Performance Notes

Inspector selection uses the cached semantic tree for locator ranking, so clicking elements should not trigger a full tree read on every selection. Recording actions execute through native coordinate gestures first to avoid slow locator retries while the user is interacting with the mirror.

Scroll gestures are rate-limited on both the browser and server side. A fast trackpad scroll is collapsed into bounded native swipes so the device cannot receive an unbounded backlog of gestures.
