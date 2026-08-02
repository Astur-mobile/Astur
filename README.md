<p align="center">
  <a href="https://astur-mobile.github.io/Astur/">
    <img src="https://astur-mobile.github.io/Astur/brand/astur-logo.png" alt="Astur" width="360">
  </a>
</p>

# Astur

[![npm: astur-mobile](https://img.shields.io/npm/v/astur-mobile/next?logo=npm&label=astur-mobile&color=cb3837)](https://www.npmjs.com/package/astur-mobile)
[![npm: @astur-mobile/test](https://img.shields.io/npm/v/@astur-mobile/test/next?logo=npm&label=%40astur-mobile%2Ftest&color=cb3837)](https://www.npmjs.com/package/@astur-mobile/test)
[![latest release](https://img.shields.io/github/v/release/Astur-mobile/Astur?include_prereleases&sort=semver&logo=github&label=release)](https://github.com/Astur-mobile/Astur/releases/latest)
[![downloads](https://img.shields.io/npm/dm/astur-mobile?logo=npm&label=downloads&color=cb3837)](https://www.npmjs.com/package/astur-mobile)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Android](https://img.shields.io/badge/Android-supported-3DDC84?logo=android&logoColor=white)](docs/android.md)
[![iOS](https://img.shields.io/badge/iOS-supported-black?logo=apple&logoColor=white)](docs/ios.md)

> The npm badges track the **`next`** dist-tag, so betas must be published with
> `npm publish --tag next` for them to move. The release badge follows the
> latest GitHub release, pre-releases included.

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

**Flutter** apps run through the same API: on Android via the Dart VM service (live widget tree), and on iOS via the XCUITest accessibility tree. **In-app WebViews** are automated at the DOM level with `device.webContext()` — engine-agnostic across Flutter and React Native — on Android (Chrome DevTools Protocol) and iOS simulators and real devices (`ios-webkit-debug-proxy`). See [Frameworks](docs/frameworks.md) and the [Changelog](CHANGELOG.md).

Locators also expose Playwright-style state readers (`textContent()`, `inputValue()`, `count()`, `bounds()`, enabled/selected/focused checks, `clear()`, `waitFor({ state })`) plus a polling `toHaveCount` matcher, and multi-match queries on Android resolve natively on-device through the UiAutomator agent instead of full UI-tree dumps. For the elements none of that can express, `by.native({ ios, android })` is a raw escape hatch straight to the agents.

## What Is Still Missing

- Fluent relative/filter locator chaining (`.nth`/`.first`/`.last`, `.filter`, `.locator(child)`) — multi-match reads exist; index-addressed native actions do not yet.
- Pinch/zoom gestures and a dedicated native clear-text command in the agent protocol.
- Deeper strict-locator diagnostics (ranked candidate lists for every selector strategy).
- Hosted-CI enforcement of `agent.mode: 'required'` — today this runs as a manual smoke workflow on self-hosted runners (Android, iOS simulator, and signed real iOS hardware), since hosted CI cannot drive real mobile hardware.
- Cloud/device-farm execution beyond the BrowserStack scaffold.

## Next Best Steps

1. Fluent locator chaining on `MobileLocator`, building on the shipped native multi-match commands.
2. Expand Android and iOS agent diagnostics and selector parity, with cross-platform contract tests.
3. Extend the required-agent smoke workflow from manual runs toward scheduled/hosted enforcement.
4. Add pinch/zoom and native clear to the shared agent protocol.

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

Full documentation site: **https://astur-mobile.github.io/Astur/**

The source guides live in [`docs/`](docs/) and are published to the site above
via the [`Docs`](.github/workflows/docs.yml) workflow.

## Example Test

```ts
import { expect, test } from '@astur-mobile/test';

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

For the rare element none of those can pin down — a screen with no
accessibility metadata, where the only reliable match is by structure —
`by.native({ ios, android })` is a raw escape hatch straight to the agents:
NSPredicate on iOS, a structured `By`/`BySelector` chain on Android. See
[docs/android.md](docs/android.md#native-selector-escape-hatch-bynative) and
[docs/ios.md](docs/ios.md#native-selector-escape-hatch-bynative).

## Native Assertions

`expect` from `@astur-mobile/test` extends Playwright assertions for native `MobileLocator` objects. These assertions use `use.astur.timeout` by default and still allow local overrides:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect(device.getByRole('menuitem')).toHaveCount(3);
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

Supported native matchers include `toBeVisible`, `toBeHidden`, `toExist`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeFocused`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveLabel`, `toHaveType`, `toHaveBounds`, and `toHaveCount`.

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

## Reading Element State

`MobileLocator` also exposes Playwright-style state readers, so tests can branch
on native UI state without dropping down to raw snapshots:

```ts
const email = device.getByLabel('Email');

await email.textContent();   // rendered text
await email.inputValue();    // current input value
await email.bounds();        // { x, y, width, height }
await email.count();         // number of current matches (returns immediately)
await email.isEnabled();     // also: isDisabled(), isSelected(), isFocused()

await email.clear();         // empty the field (same engine path as fill)
await email.waitFor({ state: 'visible' }); // 'visible' | 'hidden' | 'attached'
```

Readers auto-wait for the element with the same rules as actions; `count()` is
the exception and reports the current match total without waiting.

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

## Sponsor

Astur is open source and built in the open. If it saves your team time, consider supporting development:

<p>
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/Ko--fi-Support%20Astur-FF5E5B?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  &nbsp;
  <a href="https://github.com/sponsors/Astur-mobile"><img src="https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
</p>

## License

Astur is open source under the [Apache License 2.0](LICENSE).

Copyright 2026 Amr Salem and Astur contributors.
