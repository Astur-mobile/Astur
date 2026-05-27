# Astur

Astur is a device-native mobile automation toolkit that brings the speed and ergonomics of Playwright Test directly to mobile pipelines.

Astur is named after the astrolabe: an ancient portable instrument used to calculate position, direction, and paths with precision. The name is also inspired by the legacy associated with Mariam al-Asturlabiya, whose work represents compact, practical computation long before modern devices.

Before the astrolabe, calculating celestial events required large, stationary observatory equipment. The astrolabe compressed that power into a brass instrument you could hold and carry. Astur follows the same idea for handheld devices: it distills complex mobile automation into a lean native runtime instead of routing every action through a heavy Appium server stack.

Astur is an npm-first open source project. It uses native platform control paths instead of WebDriver:

- Android: Kotlin UIAutomator native-agent command path by default, with ADB reserved for lifecycle, artifacts, and explicit legacy fallback.
- iOS: `simctl`, `devicectl`, and a Swift XCUITest agent boundary. Native iOS element control requires XCTest.
- Test runner: Playwright Test fixtures, assertions, retries, reports, and native artifacts.

## Current Status

This repository is the first implementation scaffold. The Android driver can discover devices, boot configured emulators, download or install APKs, launch already-installed apps, capture screenshots, record native video, and open mobile web URLs. The default interaction path is the Kotlin UIAutomator native agent, with the old ADB/XML path retained as an explicit fallback mode.

The iOS driver can run diagnostics, list simulators, install and launch simulator apps, terminate apps, capture screenshots, and bootstrap the bundled Swift XCUITest agent for native element lookup, waits, actions, gestures, and keyboard commands.

Both platform drivers support endpoint-based native agent transport wiring (`use.astur.agent.endpoint` or `ASTUR_ANDROID_AGENT_ENDPOINT` / `ASTUR_IOS_AGENT_ENDPOINT`). Astur defaults to the native-agent engine and starts one Astur session per Playwright worker. The example fixture isolates specs with a lightweight terminate + launch cycle instead of reinstalling the native agent or clearing app data every spec. `automation.engine: 'auto'` is available as a migration setting when legacy fallback is still needed.

## What Is Still Missing

- Rich on-device actionability diagnostics in agent responses (multiple-match details, candidate snapshots, and structured failure context), especially for Android strict-locator failures.
- End-to-end CI jobs that enforce `agent.mode: 'required'` for both Android and iOS paths.
- Real-device iOS signing and transport validation.
- Automatic device reservation across parallel workers.

## Next Best Steps

1. Expand Android and iOS agent diagnostics and selector parity.
2. Add device reservation so parallel workers cannot target the same device.
3. Add cross-platform contract tests that validate protocol parity across Android and iOS agents.
4. Add smoke E2E tests that run with `agent.mode: 'required'` in CI.
5. Validate real-device iOS execution behind signing-aware configuration.

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

Start here:

- [Getting Started](docs/getting-started.md)
- [Documentation Index](docs/README.md)
- [Prerequisites](docs/prerequisites.md)
- [Inspector And Codegen](docs/inspector.md)
- [Android Setup](docs/android.md)
- [iOS Setup](docs/ios.md)
- [Configuration](docs/configuration.md)
- [CLI Reference](docs/cli.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Platform Limits](docs/platform-limits.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)

The public documentation site is built with Astro Starlight from `docs-site/` and deployed to GitHub Pages. Run it locally with:

```bash
npm run docs:dev
```

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

## Package Layout

```text
packages/
  protocol/       Shared protocol and public data types
  core/           Sessions, locators, auto-waiting, runtime
  android/        ADB and Android UIAutomator driver
  ios/            simctl/devicectl and XCUITest driver boundary
  test/           Playwright Test integration
  cli/            doctor, devices, init, codegen, inspector, test
  astur-mobile/  Public CLI package with the `astur` executable
```

## Design Principles

- No Appium server.
- No WebDriver compatibility layer.
- Native platform primitives under a Playwright-style test API.
- Semantic locators before coordinates.
- Failure artifacts by default.
- Honest platform boundaries, especially on iOS.

## License

Astur is open source under the [Apache License 2.0](LICENSE).

Copyright 2026 Amr Salem and Astur contributors.
