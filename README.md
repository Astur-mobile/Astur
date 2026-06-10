# Astur

[![npm: astur-mobile](https://img.shields.io/npm/v/astur-mobile?logo=npm&label=astur-mobile&color=cb3837)](https://www.npmjs.com/package/astur-mobile)
[![npm: @astur/test](https://img.shields.io/npm/v/@astur/test?logo=npm&label=%40astur%2Ftest&color=cb3837)](https://www.npmjs.com/package/@astur/test)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Android](https://img.shields.io/badge/Android-supported-3DDC84?logo=android&logoColor=white)](docs/android.md)
[![iOS](https://img.shields.io/badge/iOS-supported-black?logo=apple&logoColor=white)](docs/ios.md)

Astur is a device-native mobile automation toolkit that brings the speed and ergonomics of Playwright Test directly to mobile pipelines.

Astur is named after the astrolabe: an ancient portable instrument used to calculate position, direction, and paths with precision. The name is also inspired by the legacy associated with Mariam al-Asturlabiya, whose work represents compact, practical computation long before modern devices.

Before the astrolabe, calculating celestial events required large, stationary observatory equipment. The astrolabe compressed that power into a brass instrument you could hold and carry. Astur follows the same idea for handheld devices: it distills complex mobile automation into a lean native runtime instead of routing every action through a heavy Appium server stack.

Astur is an npm-first open source project. It uses native platform control paths instead of WebDriver:

- Android: Kotlin UIAutomator native-agent command path by default, with ADB reserved for lifecycle, artifacts, and explicit legacy fallback.
- iOS: `simctl`, `devicectl`, and a Swift XCUITest agent boundary. Native iOS element control requires XCTest.
- Test runner: Playwright Test fixtures, assertions, retries, reports, and native artifacts.

## Current Status

This repository is the first implementation scaffold. The Android driver can discover devices, boot configured emulators, download or install APKs, launch already-installed apps, capture screenshots, record native video, and open mobile web URLs. The default interaction path is the Kotlin UIAutomator native agent, with the old ADB/XML path retained as an explicit fallback mode.

The iOS driver can run diagnostics, list simulators and USB-connected real devices, install and launch apps through `simctl` or `devicectl`, terminate apps, capture screenshots, and bootstrap the bundled Swift XCUITest agent for native element lookup, waits, actions, gestures, orientation, and keyboard commands. Real iOS devices require an Apple signing team for the XCUITest runner and an app signed for the device.

Both platform drivers support endpoint-based native agent transport wiring (`use.astur.agent.endpoint` or `ASTUR_ANDROID_AGENT_ENDPOINT` / `ASTUR_IOS_AGENT_ENDPOINT`). Astur defaults to the native-agent engine and starts one Astur session per Playwright worker. The example fixture isolates specs with a lightweight terminate + launch cycle instead of reinstalling the native agent or clearing app data every spec. `automation.engine: 'auto'` is available as a migration setting when legacy fallback is still needed.

## What Is Still Missing

- Rich on-device actionability diagnostics in agent responses (multiple-match details, candidate snapshots, and structured failure context), especially for Android strict-locator failures.
- End-to-end CI jobs that enforce `agent.mode: 'required'` for both Android and iOS paths.
- Cloud/device-farm execution beyond the BrowserStack scaffold.
- CI jobs that exercise signed real iOS devices in addition to simulator coverage.

## Next Best Steps

1. Expand Android and iOS agent diagnostics and selector parity.
2. Add cross-platform contract tests that validate protocol parity across Android and iOS agents.
3. Add smoke E2E tests that run with `agent.mode: 'required'` in CI.
4. Add signing-aware real-device jobs where CI hardware is available.

See [Roadmap](docs/roadmap.md) for a structured implementation sequence.

## Install

```bash
npm install
npm run build
npx astur-mobile doctor
```

## CLI

```bash
npx astur-mobile doctor
npx astur-mobile devices
npx astur-mobile init
npx astur-mobile codegen
npx astur-mobile test
```

`npx astur-mobile inspect` is an alias for `npx astur-mobile codegen`.

`npx astur-mobile init` runs a setup wizard that asks whether the project targets Android, iOS, or both; emulator/simulator/real device/BrowserStack placeholder; app path, app URL, or installed package/bundle; timeout; reports; screenshots; and video.

## Documentation

User guides live in [`docs/`](docs/) and are published as a documentation site
from the [astur-docs](https://github.com/Astur-mobile/astur-docs) repository.

## Example Test

```ts
import { expect, test } from '@astur/test';

test.use({
  astur: {
    platform: 'android',
    timeout: 20_000,
    artifacts: {
      screenshot: 'only-on-failure',
      video: 'retain-on-failure'
    },
    keyboard: {
      dismiss: 'auto'
    },
    device: { kind: 'emulator' },
    app: './apps/demo.apk'
  }
});

test('login', async ({ device }) => {
  await device.app.launch();
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByLabel('Password').fill('secret');
  await device.keyboard.dismiss();
  await device.getByRole('button', { name: 'Sign in' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Astur keeps the low-level selector engine available through `device.locator(by.id(...))` or `device.find(by.id(...))`, but the recommended test API is Playwright-style:

```ts
device.getByText('Welcome');
device.getByLabel('Email');
device.getByTestId('login-submit');
device.getByRole('button', { name: 'Sign in' });
```

## Native Assertions

`expect` from `@astur/test` extends Playwright assertions for native `MobileLocator` objects. These assertions use `use.astur.timeout` by default and still allow local overrides:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

Supported native matchers include `toBeVisible`, `toBeHidden`, `toExist`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeFocused`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveLabel`, `toHaveType`, and `toHaveBounds`.

Native screenshots and Android file transfer are available on the same device fixture:

```ts
await device.screenshot({ path: 'test-results/screens/home.png' });
await device.files.push('./fixtures/avatar.png', '/sdcard/Download/avatar.png');
await device.files.save('/sdcard/Download/app.log', 'test-results/device/app.log');
```

App and device management APIs cover the common Appium-style lifecycle gaps:

```ts
await device.app.install();
await device.app.launch();
await device.app.terminate();
await device.app.clearData();
await device.app.clearCache();
await device.app.reset({ launch: true });
await device.app.uninstall();

await device.lock();
await device.unlock();
await device.isLocked();
```

## Gestures And Scrolling

`MobileLocator` exposes native gestures and a cross-platform scroll-to, so tests
do not hand-roll coordinate math:

```ts
await device.getByRole('button', { name: 'Like' }).tap();
await device.getByText('Counter').doubleTap();
await device.getByText('Item').longPress();
await device.getByTestId('card').dragTo(device.getByTestId('dropzone'));
await device.getByText('Footer link').scrollIntoView();
```

`scrollIntoView()` swipes the nearest scrollable region (falling back to the
viewport) until the target is on screen, then waits for it. Pass `direction`,
`maxScrolls`, or a `container` locator to scope the search. Double-tap uses the
platform's native double-tap gesture so the recognition window is honored.

## Examples

Runnable Android and iOS suites live in [`examples/`](examples/) and, as a
standalone starter you can clone, in
[astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate). They run
against the Astur demo app; the iOS simulator build ships zipped at
`assets/astur.demo.ios.simulator.zip` (unzip to `assets/Astur.app`).

## Package Layout

```text
packages/
  protocol/       Shared protocol and public data types
  core/           Sessions, locators, auto-waiting, runtime
  android/        ADB and Android UIAutomator driver
  ios/            simctl/devicectl and XCUITest driver boundary
  test/           Playwright Test integration
  cli/            doctor, devices, init, codegen, inspector, test
  astur-mobile/   Public CLI package exposing the `astur-mobile` executable
  create-astur/   Project scaffolder (`npm create astur`)
  android-agent/  Kotlin UIAutomator agent sources (internal, not published)
```

## Design Principles

- No Appium server.
- No WebDriver compatibility layer.
- Native platform primitives under a Playwright-style test API.
- Semantic locators before coordinates.
- Failure artifacts by default.
- Honest platform boundaries, especially on iOS.

## Contributing & Security

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). To report a
vulnerability, follow [SECURITY.md](SECURITY.md) (please don't open a public
issue for security problems).

## License

Astur is open source under the [Apache License 2.0](LICENSE).

Copyright 2026 Amr Salem and Astur contributors.
