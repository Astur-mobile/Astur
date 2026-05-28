# Getting Started With Astur

Astur is a device-native mobile automation toolkit that brings the speed and ergonomics of Playwright Test directly to mobile pipelines. It controls Android and iOS through platform-native tooling instead of an Appium server.

The name comes from the astrolabe: a portable instrument that compressed complex observation and calculation into something small enough to hold. It is also inspired by the legacy associated with Mariam al-Asturlabiya. Astur applies the same idea to mobile testing. It keeps the test API compact while the framework handles native agents, device lifecycle, locator ranking, screenshots, traces, and platform-specific details behind the scenes.

This guide is designed to get you from zero setup to a reliable daily workflow.

This guide assumes you are working from this repository. Published package usage will be:

```bash
npm install -D @astur/test astur-mobile
```

For source development, use:

```bash
npm install
npm run build
npx astur-mobile doctor
```

## What You Will Achieve

By the end of this guide, you will:

- run diagnostics and validate your host environment
- detect and select target devices
- inspect a running app and generate starter test code
- configure and run your first native test
- understand fallback mode versus native-agent mode
- know where to go next for platform-specific mastery

## 1. Check Your Host

Run:

```bash
npx astur-mobile doctor
```

Expected macOS output shape:

```text
Astur › doctor
Environment diagnostics

◦ Android
  ✓ PASS ADB
  ✓ PASS Android SDK

◦ iOS
  ✓ PASS Xcode
  ✓ PASS iOS simulators
```

Linux and Windows support Android locally. iOS is skipped because local iOS automation requires macOS with Xcode.

If `doctor` shows warnings, keep going for Android as long as ADB and at least one Android device/emulator are available.

## 2. Pick A Platform

For the current alpha, Android and iOS simulator automation both use Astur's native-agent path by default. ADB and Xcode tools still manage lifecycle and artifacts, while the platform agents handle locator lookup, waits, and actions.

```bash
adb devices -l
npx astur-mobile devices --android
```

If you see multiple devices, prefer exact IDs in config for deterministic runs.

For cross-platform parallel runs, treat each phone, emulator, or simulator as a single-worker resource. Use one Playwright project per device, set `workers: 1` inside each project, then set the top-level `workers` value to the number of devices you want to run at the same time.

## 3. Initialize Project Files

The setup wizard creates starter config, sample tests, and a setup note:

```bash
npx astur-mobile init
```

For non-interactive defaults:

```bash
npx astur-mobile init --yes
```

Generated files include:

- `playwright.config.ts`
- `tests/example.test.ts`
- `ASTUR_SETUP.md`
- `.gitignore` entries for artifacts

## 4. Configure A Test Runtime

Create `playwright.config.ts`. Astur can start the emulator and infer Android package metadata from the APK:

```ts
import { defineConfig } from '@astur/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }]
  ],
  use: {
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

`use.astur.timeout` is the default timeout for mobile element actions and assertions. You only need per-element overrides for unusual cases:

```ts
await device.getByText('Login').tap();
await device.getByText('Slow report').tap({ timeout: 60_000 });
```

If APK metadata inference is not available in your environment, provide `packageName`. Activity is optional:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

You can also download the app at runtime:

```ts
app: {
  url: 'https://example.com/apps/demo.apk'
}
```

Or target an app already installed on the device:

```ts
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

## 5. Inspect And Generate A Test

Astur Inspector is the fastest way to verify device connectivity, inspect native locators, record a short flow, and export a starter test.

```bash
npx astur-mobile codegen
```

Common examples:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./apps/demo.apk --app-id com.example.demo
npx astur-mobile codegen --ios --device <simulator-udid> --app ./apps/Demo.app --app-id com.example.demo
```

In the Inspector:

- click the current-device chip in the header to switch devices
- use `Controls` to install an APK/IPA, launch an existing app, grant permissions, rotate, or lock/unlock
- click `Record`, interact with the mirrored screen, then export TypeScript or JavaScript

iOS screenshots can appear even when the UI tree is unavailable. Native iOS inspection requires the XCUITest agent to know the app bundle id. For your own app, pass `--app-id`, set `ASTUR_IOS_BUNDLE_ID`, or use `Controls` to launch and rebind by bundle id.

See [Inspector And Codegen](../inspector/) for the full workflow.

## 6. Optional Native-Agent Endpoint Mode

Astur starts its bundled native agents by default where supported. Endpoint mode is only needed when you run a platform agent yourself or diagnose transport behavior.

Use `automation.engine: 'auto'` during migration:

- Astur uses the native-agent endpoint when available.
- Astur falls back when safe.

Use the default `automation.engine: 'agent'` in CI once agent coverage is stable:

- session creation fails if endpoint/handshake is unavailable
- command execution fails fast when agent command calls fail

Example:

```ts
use: {
  astur: {
    platform: 'android',
    automation: {
      engine: 'auto'
    },
    agent: {
      endpoint: 'tcp:127.0.0.1:8787',
      launchTimeout: 15_000,
      commandTimeout: 10_000
    }
  }
}
```

Environment-variable endpoints are also supported:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

## 7. Write A Test

Create `tests/login.test.ts`:

```ts
import { expect, test } from '@astur/test';

test('login screen is visible', async ({ device }) => {
  await device.app.launch();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Native assertions are Playwright-style and auto-wait with `use.astur.timeout`:

```ts
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

## 8. Run

```bash
npx astur-mobile test
```

To run only one file:

```bash
npx astur-mobile test tests/login.test.ts
```

## 9. Next Steps & Practices

:::tip[Reliability Baseline Checklist]

Use this checklist before scaling test count:

1. Prefer semantic locators (`getByLabel`, `getByRole`, `getByTestId`) over coordinates.
2. Use exact `device.id` in CI.
3. Keep `use.astur.timeout` realistic for your app load profile.
4. Enable native artifacts for failures (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`).
5. Stabilize keyboard behavior with `keyboard.dismiss: 'auto'` unless keyboard UI is under test.
6. Move from `agent.mode: 'auto'` to `agent.mode: 'required'` once native-agent path is validated.
:::

## 10. Where To Go Next

- Android-specific depth: [Android Setup](../android/)
- iOS-specific depth: [iOS Setup](../ios/)
- Full capability matrix: [Configuration](../configuration/)
- Common failures and fixes: [Troubleshooting](../troubleshooting/)
- High-level runtime model: [Architecture](../architecture/)

## iOS Simulator

The iOS package currently supports simulator lifecycle:

- list simulators
- install `.app`
- launch by bundle id
- terminate by bundle id
- screenshot
- open URLs

Native element locators require the Swift XCUITest agent.

For details, see [iOS Setup](../ios/).
