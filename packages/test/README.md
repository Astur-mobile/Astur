<div align="center">

<a href="https://astur-mobile.github.io/Astur/">
  <img src="https://raw.githubusercontent.com/Astur-mobile/Astur/main/docs-site/public/brand/social@2x.png" alt="Astur: mobile apps, Playwright API. Open-source mobile test automation for Android and iOS, on native agents. No Appium server." width="100%">
</a>

<br>
<br>

[![npm version](https://img.shields.io/npm/v/@astur-mobile/test?style=flat-square&label=npm&color=2BC4B4&labelColor=06101D)](https://www.npmjs.com/package/@astur-mobile/test)
[![npm downloads](https://img.shields.io/npm/dm/@astur-mobile/test?style=flat-square&label=downloads&color=C9A54E&labelColor=06101D)](https://www.npmjs.com/package/@astur-mobile/test)
[![CI](https://img.shields.io/github/actions/workflow/status/Astur-mobile/Astur/ci.yml?branch=main&style=flat-square&label=CI&labelColor=06101D)](https://github.com/Astur-mobile/Astur/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-9AA9C2?style=flat-square&labelColor=06101D)](https://github.com/Astur-mobile/Astur/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Astur-mobile/Astur?style=flat-square&color=C9A54E&labelColor=06101D)](https://github.com/Astur-mobile/Astur)

**[Website](https://astur-mobile.github.io/Astur/)** &nbsp;·&nbsp;
**[Get started](https://astur-mobile.github.io/Astur/getting-started/)** &nbsp;·&nbsp;
**[GitHub](https://github.com/Astur-mobile/Astur)** &nbsp;·&nbsp;
**[Release notes](https://astur-mobile.github.io/Astur/release-notes/)**

</div>

# @astur-mobile/test

Playwright-style tests for real Android and iOS apps. This package is the Playwright Test
integration of [Astur](https://github.com/Astur-mobile/Astur): the `device` fixture, `expect`,
locators, auto-waiting, projects, retries and reporters you already know, driving your app through
native agents (UIAutomator on Android, XCUITest on iOS) with no Appium server in between.

```bash
npm create astur@latest
```

or add it to an existing project:

```bash
npm install -D @astur-mobile/test astur-mobile @playwright/test
```

`@playwright/test` is a peer dependency: Astur extends the Playwright Test runner, so your project
provides it.

```ts
import { test, expect } from '@astur-mobile/test';

test('sign in', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Sign in' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Run it with `npx astur-mobile test`, or from the green play button of the VS Code Playwright
extension.

## Why Astur

- **No server in the middle.** Native agents on the device; no Appium server, no WebDriver bridge.
- **The API you know.** `getByRole`, `getByLabel`, `filter`, `and` / `or`, `nth`, and retrying
  `expect` assertions.
- **Whatever your app is built in.** Native, React Native and Expo, Flutter, Compose, SwiftUI,
  .NET MAUI, in-app WebViews, and mobile Chrome and Safari.
- **Inspector and codegen.** Mirror the device, browse the live tree, record taps into a spec.
- **Results you can trust.** Assertions fail when the device cannot be read; a lost action is never
  repeated.
- **Secure by default.** Every agent requires a per-session token.

| Platform | Emulator / simulator | Real device |
| --- | :---: | :---: |
| **Android** | ✅ | ✅ |
| **iOS** | ✅ | ✅ |

## Learn more

- [Getting started](https://astur-mobile.github.io/Astur/getting-started/): install and run a first test
- [Locators](https://astur-mobile.github.io/Astur/locators/): finding and composing elements
- [Inspector and codegen](https://astur-mobile.github.io/Astur/inspector/): stream a device and record flows
- [Demo app](https://astur-mobile.github.io/Astur/demo-app/): a tour of every capability
- [astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate): clone-and-run Android and iOS suites

If Astur is useful to you, a ⭐ on [GitHub](https://github.com/Astur-mobile/Astur) helps other
mobile teams find it. To support development: [GitHub Sponsors](https://github.com/sponsors/Astur-mobile)
or [Ko-fi](https://ko-fi.com/asturmobile).

## License

Apache-2.0 © Amr Salem. "Astur" is a trademark; see the [main repository](https://github.com/Astur-mobile/Astur).
