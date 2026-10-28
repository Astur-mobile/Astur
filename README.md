<div align="center">

<a href="https://astur-mobile.github.io/Astur/">
  <img src="https://raw.githubusercontent.com/Astur-mobile/Astur/main/docs-site/public/brand/social@2x.png" alt="Astur: mobile apps, Playwright API. Open-source mobile test automation for Android and iOS, on native agents. No Appium server." width="100%">
</a>

<br>
<br>

[![npm version](https://img.shields.io/npm/v/@astur-mobile/test?style=flat-square&label=npm&color=2BC4B4&labelColor=06101D)](https://www.npmjs.com/package/@astur-mobile/test)
[![npm downloads](https://img.shields.io/npm/dm/@astur-mobile/test?style=flat-square&label=downloads&color=C9A54E&labelColor=06101D)](https://www.npmjs.com/package/@astur-mobile/test)
[![CI](https://img.shields.io/github/actions/workflow/status/Astur-mobile/Astur/ci.yml?branch=main&style=flat-square&label=CI&labelColor=06101D)](https://github.com/Astur-mobile/Astur/actions/workflows/ci.yml)
[![TypeScript types](https://img.shields.io/npm/types/@astur-mobile/test?style=flat-square&color=3A6EA5&labelColor=06101D)](https://www.npmjs.com/package/@astur-mobile/test)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-9AA9C2?style=flat-square&labelColor=06101D)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Astur-mobile/Astur?style=flat-square&color=C9A54E&labelColor=06101D)](https://github.com/Astur-mobile/Astur)

**[Website](https://astur-mobile.github.io/Astur/)** &nbsp;·&nbsp;
**[Get started](https://astur-mobile.github.io/Astur/getting-started/)** &nbsp;·&nbsp;
**[Inspector](https://astur-mobile.github.io/Astur/inspector/)** &nbsp;·&nbsp;
**[Release notes](https://astur-mobile.github.io/Astur/release-notes/)** &nbsp;·&nbsp;
**[Product tour](https://youtu.be/X0PW4jQOj58)**

</div>

# Playwright-style tests for real Android and iOS apps

Astur drives your app through native agents, UIAutomator on Android and XCUITest on iOS, with no
Appium server in between. You write tests with the Playwright Test API you already know, and run
them on emulators, simulators and real devices.

```ts
import { test, expect } from '@astur-mobile/test';

test('sign in', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Sign in' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

It is built **on** Playwright Test, so retries, projects, reporters, the HTML report and the
VS Code play button all work the way they already do.

## Why Astur

- **No server in the middle.** Tests talk to a native agent on the device: UIAutomator on Android,
  XCUITest on iOS. No Appium server, no WebDriver bridge.
- **The API you know.** `getByRole`, `getByLabel`, `expect(...).toBeVisible()`, fixtures, projects,
  retries: Playwright Test, pointed at a phone.
- **Whatever your app is built in.** Native SDKs, React Native and Expo, Flutter, Jetpack Compose,
  SwiftUI, .NET MAUI, plus real DOM control of in-app WebViews and mobile Chrome and Safari.
- **See before you write.** The inspector mirrors the device, shows the live tree, ranks locators,
  and records taps into a spec you keep.
- **Results you can trust.** Assertions wait for the condition and fail when the device cannot be
  read. An action whose response is lost fails instead of running twice.
- **Secure by default.** Every agent and the inspector require a per-session token.

## Quick start

```bash
npm create astur@latest
```

The scaffolder asks what you target and writes a working config and a first test. Then:

```bash
npx astur-mobile doctor    # check your environment
npx astur-mobile test      # run the suite
```

Adding Astur to an existing project instead:

```bash
npm install -D @astur-mobile/test astur-mobile @playwright/test
```

**Requirements:** Node.js 18 or newer. For Android, the SDK platform-tools (`adb`) and an emulator
or a device with USB debugging. For iOS, macOS with Xcode; real devices also need an Apple signing
team for the XCUITest runner. `npx astur-mobile doctor` checks all of it and says what is missing.

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

Scope to a parent, `filter({ hasText, hasNotText, has, hasNot })`, combine with `and()` / `or()`,
and pick with `first()` / `last()` / `nth(i)`. See [Locators](docs/locators.md).

For the rare element none of that can pin down, `by.native({ ios, android })` sends a platform query
straight to the agent: an NSPredicate on iOS, a `BySelector` chain on Android.

### Asserting

Assertions retry until they pass or time out, and every action auto-waits.

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('checkbox')).toBeChecked();
await expect(device.getByRole('menuitem')).toHaveCount(3);
await expect(device.getByTestId('hero')).toHaveScreenshot('hero.png');
```

`toBeVisible`, `toBeHidden`, `toExist`, `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toBeSelected`,
`toBeFocused`, `toBeEmpty`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveLabel`, `toHaveType`,
`toHaveBounds`, `toHaveCount`, `toHaveScreenshot`.

### Gestures, state and the device

```ts
await device.getByTestId('card').dragTo(device.getByTestId('dropzone'));
await device.getByText('Footer link').scrollIntoView();
await device.getByText('Item').longPress();

await device.getByLabel('Email').inputValue();
await device.app.reset({ launch: true });
await device.orientation.landscape();
await device.screenshot({ path: 'test-results/home.png' });
```

## What it can do

| | |
| --- | --- |
| **Any native-rendering framework** | Native SDK, React Native, Expo, Jetpack Compose, SwiftUI, .NET MAUI, NativeScript, Capacitor. [Full table](docs/frameworks.md) |
| **Flutter** | The live widget tree over the Dart VM service on Android; the accessibility tree on iOS |
| **In-app WebViews** | Real DOM automation with `device.webContext()`. [WebViews](docs/frameworks.md#webviews-dom) |
| **Mobile web** | Drive a site in Chrome or Safari on the device itself. [Mobile Web](docs/mobile-web.md) |
| **Network observation** | Assert on the HTTP calls an app makes, not just what it renders. [Network](docs/network.md) |
| **Visual comparison** | `toHaveScreenshot()` with per-device baselines and masking. [Visual Comparison](docs/visual-comparison.md) |
| **Inspector and codegen** | Live element inspection and recorded specs. [Inspector](docs/inspector.md) |

## CLI

```bash
npx astur-mobile doctor        # check the environment
npx astur-mobile devices       # list devices, emulators, simulators
npx astur-mobile init          # scaffold config and a first test
npx astur-mobile codegen       # live inspector and spec recorder (alias: inspect)
npx astur-mobile screenshot    # capture a device screen to a PNG
npx astur-mobile test          # run the suite
```

## Documentation

**[astur-mobile.github.io/Astur](https://astur-mobile.github.io/Astur/)**, also in
[Arabic](https://astur-mobile.github.io/Astur/ar/) and [Spanish](https://astur-mobile.github.io/Astur/es/).

[Getting Started](docs/getting-started.md) · [Configuration](docs/configuration.md) ·
[Locators](docs/locators.md) · [Android](docs/android.md) · [iOS](docs/ios.md) ·
[Platform Limits](docs/platform-limits.md) · [Troubleshooting](docs/troubleshooting.md)

## Examples

Runnable Android and iOS suites live in [`examples/`](examples/), and as a clonable starter in
[astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate). Both run against the Astur
demo app, which ships with them.

## About the name

Astur is named after the astrolabe, the instrument that folded an observatory into something you
could hold: turn the rete, sight a star along the alidade, read the answer off the limb. In
tenth-century Aleppo, [Mariam al-Asturlabiya](https://en.wikipedia.org/wiki/Mariam_al-Asturlabi)
was known for building them. Astur is the same idea for mobile testing: a lean native runtime in
place of a heavy server stack.

Where a platform cannot do something, Astur says so instead of pretending. See
[Platform Limits](docs/platform-limits.md).

## Contributing and security

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). For vulnerabilities, follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.

If Astur is useful to you, a ⭐ on the repository helps other mobile teams find it.

## Sponsors

<!-- sponsors:start -->

Astur is built in the open and has no sponsors yet — [be the first](https://github.com/sponsors/Astur-mobile).

<!-- sponsors:end -->

If Astur saves your team time, consider supporting development:

<p>
  <a href="https://github.com/sponsors/Astur-mobile"><img src="https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?style=flat-square&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
  &nbsp;
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/Ko--fi-Support%20Astur-FF5E5B?style=flat-square&logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
</p>

## License

[Apache 2.0](LICENSE). Copyright 2026 Amr Salem and Astur contributors.

"Astur" is a trademark; see the [trademark policy](TRADEMARK.md).
