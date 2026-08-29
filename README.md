<p align="center">
  <a href="https://astur-mobile.github.io/Astur/">
    <img src="https://astur-mobile.github.io/Astur/brand/astur-logo.png" alt="Astur" width="360">
  </a>
</p>

<p align="center">
  <b>Mobile test automation with Playwright ergonomics — and no Appium server.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/astur-mobile"><img src="https://img.shields.io/npm/v/astur-mobile?logo=npm&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/astur-mobile"><img src="https://img.shields.io/npm/dm/astur-mobile?label=downloads&color=cb3837" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://astur-mobile.github.io/Astur/"><img src="https://img.shields.io/badge/docs-astur--mobile.github.io-informational" alt="Documentation"></a>
</p>

---

Astur drives **real Android and iOS devices, emulators, and simulators** through native platform APIs — UIAutomator on Android, XCUITest on iOS — under the test API you already know from Playwright.

```ts
await device.getByLabel('Email').fill('qa@example.com');
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

No WebDriver layer, no Appium server to run. It is built **on** Playwright Test, so retries, projects, reporters, the HTML report, and the VS Code play button all work exactly as they already do.

## Quick start

```bash
npm create astur@latest
```

The scaffolder asks what you target and writes a working config and first test. Then:

```bash
npx astur-mobile doctor    # check your environment
npx astur-mobile test      # run
```

Adding Astur to an existing project instead:

```bash
npm install -D @astur-mobile/test astur-mobile
```

### Requirements

- **Node.js 18+**
- **Android**: Android SDK platform-tools (`adb`) and an emulator or a device with USB debugging
- **iOS**: macOS with Xcode. Real devices need an Apple signing team for the XCUITest runner

`npx astur-mobile doctor` checks all of it and tells you what is missing.

## Writing a test

```ts
import { expect, test } from '@astur-mobile/test';

test.use({
  astur: {
    platform: 'android',
    device: { kind: 'emulator' },
    app: './apps/demo.apk'
  }
});

test('login', async ({ device }) => {
  await device.app.launch();

  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByLabel('Password').fill('secret');
  await device.getByRole('button', { name: 'Sign in' }).tap();

  await expect(device.getByText('Welcome')).toBeVisible();
});
```

### Finding elements

```ts
device.getByTestId('login-submit');
device.getByLabel('Email');
device.getByText('Welcome');
device.getByRole('button', { name: 'Sign in' });
device.getByPlaceholder('Search…');
device.getByType('android.widget.Button');
```

A screen of repeated rows needs more than one selector, so locators compose:

```ts
const row = device.getByType('Cell').filter({ hasText: 'Rye' });
await row.getByRole('button', { name: 'Add' }).tap();

device.getByRole('listitem').filter({ hasNotText: 'Sold out' }).first();
device.getByText('Retry').or(device.getByText('Try again'));
```

Scope to a parent, `filter({ hasText, hasNotText, has, hasNot })`, combine with `and()` / `or()`, and pick with `first()` / `last()` / `nth(i)`. See [Locators](docs/locators.md).

For the rare element none of that can pin down, `by.native({ ios, android })` sends a platform query straight to the agent — NSPredicate on iOS, a `BySelector` chain on Android.

### Asserting

Assertions retry until they pass or time out, and every action auto-waits.

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('checkbox')).toBeChecked();
await expect(device.getByRole('menuitem')).toHaveCount(3);
await expect(device.getByTestId('hero')).toHaveScreenshot('hero.png');
```

`toBeVisible`, `toBeHidden`, `toExist`, `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toBeSelected`, `toBeFocused`, `toBeEmpty`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveLabel`, `toHaveType`, `toHaveBounds`, `toHaveCount`, `toHaveScreenshot`.

### Gestures, state, and the device

```ts
await device.getByTestId('card').dragTo(device.getByTestId('dropzone'));
await device.getByText('Footer link').scrollIntoView();
await device.getByText('Item').longPress();

await device.getByLabel('Email').textContent();
await device.getByLabel('Email').inputValue();
await device.getByLabel('Email').isEnabled();

await device.app.launch();
await device.app.reset({ launch: true });
await device.orientation.landscape();
await device.screenshot({ path: 'test-results/home.png' });
```

## What it can do

| | |
| --- | --- |
| **Any native-rendering framework** | Native SDK, React Native, Expo, Jetpack Compose, SwiftUI, .NET MAUI, NativeScript, Capacitor — [full table](docs/frameworks.md) |
| **Flutter** | Live widget tree over the Dart VM service on Android; accessibility tree on iOS |
| **In-app WebViews** | Real DOM automation with `device.webContext()` — [WebViews](docs/frameworks.md#webviews-dom) |
| **Mobile web** | Drive a site in Chrome or Safari on the device itself — [Mobile Web](docs/mobile-web.md) |
| **Network observation** | Assert on the HTTP calls an app makes, not just what it renders — [Network](docs/network.md) |
| **Visual comparison** | `toHaveScreenshot()` with per-device baselines and masking — [Visual Comparison](docs/visual-comparison.md) |
| **Inspector & codegen** | Live element inspection and recorded specs — [Inspector](docs/inspector.md) |

## CLI

```bash
npx astur-mobile doctor        # check the environment
npx astur-mobile devices       # list devices, emulators, simulators
npx astur-mobile init          # scaffold config and a first test
npx astur-mobile codegen       # live inspector and spec recorder
npx astur-mobile screenshot    # capture a device screen to a PNG
npx astur-mobile test          # run the suite
```

`inspect` is an alias for `codegen`.

## Documentation

**[astur-mobile.github.io/Astur](https://astur-mobile.github.io/Astur/)** — also available [in Arabic](https://astur-mobile.github.io/Astur/ar/).

[Getting Started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Locators](docs/locators.md) · [Android](docs/android.md) · [iOS](docs/ios.md) · [Platform Limits](docs/platform-limits.md) · [Troubleshooting](docs/troubleshooting.md)

## Examples

Runnable Android and iOS suites live in [`examples/`](examples/), and as a clonable starter in [astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate). Both run against the Astur demo app, which ships with them.

## Design principles

- No Appium server, no WebDriver compatibility layer.
- Native platform primitives under a Playwright-style API.
- Semantic locators before coordinates.
- Failure artifacts by default.
- Honest platform boundaries — where a platform cannot do something, Astur says so instead of pretending. See [Platform Limits](docs/platform-limits.md).

## About the name

Astur is named after the astrolabe, the portable instrument that compressed an observatory's worth of calculation into something you could hold — and after [Mariam al-Asturlabiya](https://en.wikipedia.org/wiki/Mariam_al-Asturlabi), who built them. Same idea here: a lean native runtime in place of a heavy server stack.

## Contributing & security

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). For vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Sponsor

If Astur saves your team time, consider supporting development:

<p>
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/Ko--fi-Support%20Astur-FF5E5B?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  &nbsp;
  <a href="https://github.com/sponsors/Astur-mobile"><img src="https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
</p>

## License

[Apache 2.0](LICENSE). Copyright 2026 Amr Salem and Astur contributors.

"Astur" is a trademark — see the [trademark policy](TRADEMARK.md).
