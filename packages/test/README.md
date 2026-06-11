<p align="center">
  <a href="https://astur-mobile.github.io/Astur/">
    <img src="https://astur-mobile.github.io/Astur/brand/astur-logo.png" alt="Astur" width="360">
  </a>
</p>

<h3 align="center">Device-native mobile automation for Android &amp; iOS — Playwright ergonomics, no Appium server.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@astur-mobile/test"><img src="https://img.shields.io/npm/v/@astur-mobile/test.svg?color=0A1730&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@astur-mobile/test"><img src="https://img.shields.io/npm/dm/@astur-mobile/test.svg?color=24C6B7&label=downloads" alt="npm downloads"></a>
  <a href="https://github.com/Astur-mobile/Astur/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@astur-mobile/test.svg?color=0A1730" alt="license"></a>
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/sponsor-Ko--fi-FF5E5B?logo=kofi&logoColor=white" alt="Sponsor on Ko-fi"></a>
</p>

<p align="center">
  <a href="https://astur-mobile.github.io/Astur/">Documentation</a> &nbsp;•&nbsp;
  <a href="https://astur-mobile.github.io/Astur/getting-started/">Getting Started</a> &nbsp;•&nbsp;
  <a href="https://astur-mobile.github.io/Astur/demo-app/">Demo App</a> &nbsp;•&nbsp;
  <a href="https://astur-mobile.github.io/Astur/inspector/">Inspector &amp; Codegen</a>
</p>

---

**Astur** drives real Android and iOS apps through the platforms' own automation engines — Android UIAutomator (Kotlin) and Apple XCUITest (Swift) — exposed through a Playwright-style API. No Appium server, no WebDriver bridge. `@astur-mobile/test` is the **Playwright Test integration**: the `device` fixture, `expect`, locators, auto-waiting, projects, retries, and reporters you already know.

```bash
npm install -D @astur-mobile/test astur-mobile @playwright/test
```

> `@playwright/test` is a peer dependency — Astur extends the Playwright Test runner, so your project provides it.

```ts
import { test, expect } from '@astur-mobile/test';

test('login', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Login' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Because Astur is built on Playwright Test, you can run specs with the CLI **or** straight from the **VS Code Playwright extension** (the green ▶ run button) — fixtures, projects, `expect`, retries, and reporters all work.

## Runs where your app runs

| Platform | Simulator / Emulator | Real device |
| --- | :---: | :---: |
| **Android** | ✅ | ✅ |
| **iOS** | ✅ | ✅ |

Native locators (`getByRole`, `getByLabel`, `getByText`, `getByTestId`), gestures (tap, double-tap, long-press, swipe, drag, scroll-into-view), forms, file upload, permissions, rotation, and hybrid **WebView** DOM control — all through one API.

## Try it in 30 seconds

A ready-to-run **[demo app](https://astur-mobile.github.io/Astur/demo-app/)** ships with the framework; each screen exercises one capability (tap, scroll, swipe, drag, forms, upload, WebView). Drive it through the Inspector without writing a test:

```bash
# Android emulator
npx astur-mobile codegen --android --device emulator-5554 \
  --app ./assets/astur.demo.android.apk --app-id com.astur.demo

# iOS simulator
npx astur-mobile codegen --ios --simulator \
  --app ./assets/Astur.app --app-id com.astur.demo
```

Or clone the **[astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate)** starter for full Android and iOS suites.

## Resources

- 📖 **[Documentation](https://astur-mobile.github.io/Astur/)** — guides, configuration, and platform notes
- 🚀 **[Getting Started](https://astur-mobile.github.io/Astur/getting-started/)** — install and run your first test
- 🔎 **[Inspector & Codegen](https://astur-mobile.github.io/Astur/inspector/)** — stream a device, inspect locators, record flows, export specs
- 📱 **[Demo App](https://astur-mobile.github.io/Astur/demo-app/)** — a tour of every automation capability
- 🧩 **[astur-boilerplate](https://github.com/Astur-mobile/astur-boilerplate)** — clone-and-run example suites

## Sponsor

Astur is open source and built in the open. If it saves your team time, consider supporting development:

<p>
  <a href="https://ko-fi.com/asturmobile"><img src="https://img.shields.io/badge/Ko--fi-Support%20Astur-FF5E5B?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
  &nbsp;
  <a href="https://github.com/sponsors/Astur-mobile"><img src="https://img.shields.io/badge/GitHub-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
</p>

## License

Apache-2.0 © Amr Salem. "Astur" is a trademark — see the [main repository](https://github.com/Astur-mobile/Astur).
