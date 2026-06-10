# Getting Started With Astur

Astur is a device-native mobile automation toolkit that brings the speed and ergonomics of Playwright Test directly to mobile pipelines. It controls Android and iOS through platform-native tooling instead of an Appium server.

The name comes from the astrolabe: a portable instrument that compressed complex observation and calculation into something small enough to hold. It is also inspired by the legacy associated with Mariam al-Asturlabiya. Astur applies the same idea to mobile testing. It keeps the test API compact while the framework handles native agents, device lifecycle, locator ranking, screenshots, traces, and platform-specific details behind the scenes.

This guide is designed to get you from zero setup to a reliable daily workflow.

Install Astur into your project from npm:

```bash
npm install -D @astur-mobile/test astur-mobile
npx astur-mobile doctor
```

Every command in these docs is the published CLI form (`npx astur-mobile …`), so it works the same in any project once the package is installed.

If you are instead developing Astur from source, install workspace dependencies and build first:

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
  ◦ WARN iOS real-device signing
```

Linux and Windows support Android locally. iOS is skipped because local iOS automation requires macOS with Xcode.

If `doctor` shows real iOS signing warnings, simulator automation can still run. Physical iPhone automation needs `ASTUR_IOS_DEVELOPMENT_TEAM` so Xcode can sign the bundled XCUITest runner.

If you are starting on iOS, pick the smallest path that matches your goal:

- Simulator smoke test or Inspector authoring: no Apple team required. Point codegen at a simulator `.app` — `npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp`.
- Simulator testing of your own app: build a simulator `.app` in Xcode first, then set it as `app.path`.
- Real-device testing: use a device-signed `.ipa` and set `ASTUR_IOS_DEVELOPMENT_TEAM`.

> No app handy? The Astur demo app (`Astur.app` / `astur.demo.ios.ipa`, bundle id `com.astur.demo`) is available in the Astur examples repository so you can try codegen before wiring up your own build.

## 2. Pick A Platform

Android, iOS simulator, and USB-connected iOS real-device automation all use Astur's native-agent path by default. ADB and Xcode tools still manage lifecycle and artifacts, while the platform agents handle locator lookup, waits, and actions.

```bash
adb devices -l
npx astur-mobile devices --android
npx astur-mobile devices --ios
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
import { defineConfig } from '@astur-mobile/test';

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

iOS real-device config is the same shape, plus Apple signing setup:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

```ts
astur: {
  platform: 'ios',
  device: {
    kind: 'real',
    id: '00008030-000548220EF0802E'
  },
  app: {
    path: './apps/Demo.ipa',
    bundleId: 'com.example.demo'
  }
}
```

## 5. Inspect And Generate A Test

Astur Inspector is the fastest way to verify device connectivity, inspect native locators, record a short flow, and export a starter test.

```bash
npx astur-mobile codegen
```

Common examples:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <device-udid> --app ./MyApp.ipa --app-id com.example.myapp
```

In the Inspector:

- click the current-device chip in the header to switch devices
- use `Controls` to install an APK/IPA, launch an existing app, grant permissions, rotate, or lock/unlock
- click `Record`, interact with the mirrored screen, then export TypeScript or JavaScript

iOS screenshots can appear even when the UI tree is unavailable. Native iOS inspection requires the XCUITest agent to know the app bundle id. For your own app, pass `--app` and `--app-id` (or set `ASTUR_IOS_BUNDLE_ID`), or use `Controls` to launch and rebind by bundle id. For real devices, also set `ASTUR_IOS_DEVELOPMENT_TEAM`.

See [Inspector And Codegen](../inspector/) for the full workflow.

## 6. Optional Native-Agent Endpoint Mode

Astur starts its bundled native agents by default where supported. Endpoint mode is only needed when you run a platform agent yourself or diagnose transport behavior.

Platform defaults are already set by Astur. Both platforms default to required agent mode (`automation.engine: 'agent'`, `legacyFallback: 'never'`):

- Android uses the bundled UIAutomator agent. Opt into `automation.engine: 'auto'` only if you need legacy ADB/XML fallback during migration.
- iOS uses required XCUITest mode because native UI-tree reads and native actions cannot work reliably without the XCUITest agent; there is no fallback path.

With the default `automation.engine: 'agent'`, native interactions never silently degrade:

- session creation fails if the agent cannot be bootstrapped
- command execution fails fast when agent command calls fail

Example:

```ts
use: {
  astur: {
    platform: 'android',
    automation: {
      engine: 'agent'
    },
    agent: {
      endpoint: 'tcp:127.0.0.1:8787'
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
import { expect, test } from '@astur-mobile/test';

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

Astur does not build your own simulator app for you. If you are testing your own app on simulator, build a simulator `.app` in Xcode first and point Astur at that output with `--app`. To try Astur without building anything, use the demo app from the Astur examples repository: `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo`.

If you skip `--app` and the app is not already installed, codegen fails with `IOS_APP_NOT_INSTALLED`. Include `--app` on first run so Astur can install the app before attaching.

For details, see [iOS Setup](../ios/).
