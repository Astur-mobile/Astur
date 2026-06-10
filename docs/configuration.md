# Configuration

Astur integrates with Playwright Test through `@astur-mobile/test`.

The default setup is intentionally small: choose a platform, a device, and an app. Astur bootstraps the bundled native agents automatically, so npm users should not need to build, install, or start a separate agent process for normal local runs.

## Basic Config

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  outputDir: 'test-results/mobile',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }],
    ['junit', { outputFile: 'test-results/mobile/results.xml' }]
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
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

## Configuration Shape

```ts
type AsturConfig = {
  platform: 'android' | 'ios';
  device?: {
    id?: string;
    name?: string | RegExp;
    kind?: 'emulator' | 'simulator' | 'real';
    avd?: string;
    autoBoot?: boolean;
    headless?: boolean;
    wipeData?: boolean;
    bootTimeout?: number;
    emulatorArgs?: string[];
    cloud?: {
      provider: 'browserstack';
      deviceName?: string;
      osVersion?: string;
      project?: string;
      build?: string;
      appId?: string;
      usernameEnv?: string;
      accessKeyEnv?: string;
    };
  };
  app?: string | {
    path?: string;
    url?: string;
    downloadPath?: string;
    bundleId?: string;
    packageName?: string;
    activity?: string;
  };
  timeout?: number;
  artifactsDir?: string;
  artifacts?: {
    screenshot?: 'off' | 'on' | 'only-on-failure';
    video?: 'off' | 'on' | 'retain-on-failure';
  };
  keyboard?: {
    dismiss?: 'auto' | 'preserve';
  };
  agent?: {
    mode?: 'auto' | 'required' | 'off';
    install?: boolean;
    endpoint?: string;
    launchTimeout?: number;
    commandTimeout?: number;
  };
};
```

## Recommended Workflow

Use this progression for stable adoption:

<ol class="astur-steps">
  <li>Start with no <code>automation</code> or <code>agent</code> section; Astur defaults to the native-agent engine.</li>
  <li>Validate native assertions and action reliability on your real app flows.</li>
  <li>Use <code>automation.engine: 'auto'</code> only while migrating from legacy ADB/XML behavior.</li>
  <li>Use <code>automation.engine: 'legacy-adb'</code> only when intentionally comparing or diagnosing the old path.</li>
</ol>

`device.cloud` is currently a scaffolded placeholder for future cloud execution. Local Android emulators, local Android real devices, local iOS simulators, and USB-connected iOS real devices are runnable today when the required platform tools and signing setup are available.

`timeout` is the default wait budget for Astur locator actions and assertions. Override it only where a specific element needs a different budget:

```ts
await device.getByLabel('Login').tap();
await device.getByLabel('Slow report').tap({ timeout: 60_000 });
```

Orientation control is platform-neutral when the selected driver supports it:

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();
```

Use per-test app terminate/launch for normal isolation. Keep native-agent install/start at the worker-session level unless you are deliberately testing agent installation or app data migration behavior.

iOS real devices need one extra environment variable because Apple requires the XCUITest runner to be signed:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

When running from source, Astur can infer the team from the signed `agents/ios-xctest-agent` Xcode project. Published npm usage and CI should set `ASTUR_IOS_DEVELOPMENT_TEAM` explicitly.

Astur prefers the Xcode/CoreDevice USB tunnel for the real-device agent bridge. Set `ASTUR_IOS_AGENT_HOST` to a Mac network address only when your environment cannot use that tunnel.

## Runtime Capability Reference

Astur capabilities live under Playwright's `use.astur`. Playwright-owned settings such as `testDir`, `timeout`, `workers`, `reporter`, `outputDir`, `screenshot`, `video`, and `trace` still behave exactly like Playwright Test settings. Astur-owned settings describe the mobile platform, selected device, app under test, and native artifacts.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `platform` | Yes | none | Target platform: `'android'` or `'ios'`. |
| `device` | No | `{}` | Selects an emulator, simulator, or real device. If omitted, Astur selects the first compatible online device. |
| `app` | No | `undefined` | App under test. Can be a local path string, app object, download URL object, or installed app metadata. |
| `timeout` | No | `10_000` | Default wait budget for Astur locator actions and native assertions. |
| `artifactsDir` | No | Playwright output folder scoped to the Astur worker session | Advanced override for native Astur artifacts, downloaded apps, and temporary native outputs. Most projects should omit it. Per-test screenshots and videos are still attached through Playwright test output. |
| `artifacts.screenshot` | No | `off` | Native screenshot attachment mode: `off`, `on`, or `only-on-failure`. |
| `artifacts.video` | No | `off` | Native screen recording mode: `off`, `on`, or `retain-on-failure`. Android and iOS simulator runs can attach video. iOS real-device runs skip video capture and continue. |
| `keyboard.dismiss` | No | `auto` | Soft keyboard strategy. `auto` dismisses only when the keyboard blocks a pointer target; `preserve` leaves it open. |
| `automation.engine` | No | `agent` (Android and iOS) | Automation engine. `agent` uses the native-agent path, `auto` permits legacy fallback during migration (Android only), and `legacy-adb` forces the old Android shell/XML path. |
| `automation.legacyFallback` | No | `never` (set to `on-agent-failure` automatically when `engine: 'auto'`) | Controls whether Astur may fall back from the agent to legacy platform tooling. |
| `agent.mode` | No | derived from `automation.engine` | Compatibility alias. `required` is equivalent to `automation.engine: 'agent'`, `auto` permits fallback, and `off` forces legacy tooling. |
| `agent.install` | No | `true` | Lets the platform driver install/start its native agent when supported. The fixture starts one Astur session per Playwright worker, not once per spec. Use app terminate/launch for normal per-spec isolation, and reserve app-data reset/reinstall for tests that need it. |
| `agent.endpoint` | No | `undefined` | Optional native-agent endpoint. Accepts `http://`, `https://`, `tcp:host:port`, or bare `host:port` formats. |
| `agent.launchTimeout` | No | Android: `30_000`; iOS: `60_000` | Timeout budget for native-agent handshake at session start. |
| `agent.commandTimeout` | No | Android: `20_000`; iOS: `15_000` | Timeout budget for each native-agent command. |

Astur defaults to the native agent on both platforms (`engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`), so native interactions never silently degrade. On Android you can opt into `automation.engine: 'auto'` to keep migration safety — it falls back to legacy ADB/XML tooling only when the bundled native agent cannot start. On iOS the XCUITest agent is mandatory for UI-tree reads and native actions, so there is no fallback path; Astur fails fast instead of running a partial session.

These timeout values affect reliability more than action speed. Normal element actions still complete as soon as the native agent returns; the timeout is the maximum budget for cold agent startup, slow simulator bootstrapping, app hydration, or a stuck command.

## Native Agent Endpoint Overrides

Astur keeps the test API simple and pushes complexity into the runtime layer. Most projects should omit `automation` and `agent` entirely. If you run a platform agent yourself, point Astur at it with either `use.astur.agent.endpoint` or a platform env var:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

```ts
use: {
  astur: {
    platform: 'android',
    agent: {
      mode: 'auto',
      endpoint: 'tcp:127.0.0.1:8787'
    }
  }
}
```

Use explicit `automation.engine: 'agent'` in Android CI when native interactions must not silently fall back. iOS already uses required XCUITest mode by default.

## iOS Environment Variables

Astur works out of the box on a simulator with no environment variables. The ones below cover real-device signing, advanced agent control, and debugging. Most projects only ever set `ASTUR_IOS_DEVELOPMENT_TEAM` (for real devices).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASTUR_IOS_DEVELOPMENT_TEAM` | inferred from agent project when running from source | Apple Team ID used to sign the bundled XCUITest agent. **Required for real devices.** |
| `ASTUR_IOS_CODE_SIGN_IDENTITY` | automatic | Force a specific code-sign identity for the agent build. |
| `ASTUR_IOS_ALLOW_PROVISIONING_UPDATES` | enabled | Set to `0` to drop `-allowProvisioningUpdates` when your CI manages profiles itself. |
| `ASTUR_IOS_AGENT_HOST` | CoreDevice USB tunnel, then a reachable LAN address | Mac address the on-device agent connects back to. Set only when the auto-detected bridge is unreachable. |
| `ASTUR_IOS_AGENT_BIND_HOST` | `127.0.0.1` (sim) / `0.0.0.0` or `::` (real) | Interface the host bridge binds to. |
| `ASTUR_IOS_AGENT_PORT` | random free port | Fixed host port for the agent bridge. |
| `ASTUR_IOS_AGENT_ENDPOINT` | unset | Attach to an externally started iOS agent instead of bootstrapping one. |
| `ASTUR_IOS_AGENT_PROJECT` | bundled `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` | Path to a custom XCUITest agent Xcode project. |
| `ASTUR_IOS_AGENT_SCHEME` | `AsturIOSAgent` | Scheme used to build the agent. |
| `ASTUR_IOS_AGENT_DERIVED_DATA` | a temp path keyed by device + agent source | Override the agent build cache location. |
| `ASTUR_IOS_AGENT_START_ATTEMPTS` | `2` (sim) / `1` (real) | How many times to retry agent startup before failing. |
| `ASTUR_IOS_AGENT_REAP` | enabled | Set to `0` to stop Astur from killing leftover agent sessions for the same device before a new run. |
| `ASTUR_IOS_AGENT_TRACE` | off | Set to `1` to log every bridge command (queue/deliver/response/timeout) — the first tool to reach for when a session hangs. |
| `ASTUR_IOS_APP_FORCE_INSTALL` | off | Set to `1` to reinstall the app from `--app`/`app.path` even when it is already installed. |
| `ASTUR_XCRUN` / `ASTUR_XCODEBUILD` | `xcrun` / `xcodebuild` on `PATH` | Absolute paths to the Apple tools, for non-standard Xcode installs. |

The example configs additionally read `ASTUR_IOS_DEVICE_KIND`, `ASTUR_IOS_DEVICE_ID`, `ASTUR_IOS_DEVICE_NAME`, `ASTUR_IOS_BUNDLE_ID`, and `ASTUR_IOS_APP_PATH` to select a device and app without editing the file.

## Device Selection

Use `npx astur-mobile devices` to see device IDs and names. Prefer `device.id` for deterministic CI and parallel runs. Use `device.name` when the exact simulator/emulator name is stable and only one matching device is expected.

`platform` selects the driver. `device.kind` does not choose Android vs iOS; it only narrows device selection when `id` is not specific enough or when you intentionally want a loose selector such as "any emulator". If `device.id` is set, keep `kind` when you want an extra validation filter or when you want Astur to avoid unrelated discovery work, for example `kind: 'real'` for a physical iPhone.

| Field | Android emulator | Android real device | iOS simulator | iOS real device |
| --- | --- | --- | --- | --- |
| `id` | ADB serial, for example `emulator-5554` | ADB serial, for example `R5CT...` | Simulator UDID from `simctl` | Device UDID from `devicectl`, for example `00008030...` |
| `name` | ADB model name from `adb devices -l` | ADB model name from `adb devices -l` | Simulator name, for example `iPhone 16 Pro` | Device name from `devicectl` |
| `kind` | Optional filter: `emulator` | Optional filter: `real` | Optional filter: `simulator` | Optional filter: `real` |
| `avd` | Android Virtual Device name, for example `Pixel_9_API_35` | Not used | Not used | Not used |
| `autoBoot` | Boots the configured `avd` when no matching emulator is online | Not used | Not used | Not used |
| `headless` | Adds `-no-window` when Astur boots the emulator unless set to `false` | Not used | Not used | Not used |
| `wipeData` | Adds `-wipe-data` when Astur boots the emulator | Not used | Not used | Not used |
| `bootTimeout` | Max time to wait for emulator boot completion | Not used | Not used | Not used |
| `emulatorArgs` | Extra Android emulator CLI args | Not used | Not used | Not used |
| `cloud` | BrowserStack placeholder only | BrowserStack placeholder only | BrowserStack placeholder only | BrowserStack placeholder only |

Android device IDs come from:

```bash
adb devices -l
npx astur-mobile devices --android
```

iOS simulator and real-device IDs come from:

```bash
xcrun simctl list devices available
xcrun devicectl list devices
npx astur-mobile devices --ios
```

For real iOS, set `ASTUR_IOS_DEVELOPMENT_TEAM` and use an app signed for the connected device. The bundled XCUITest agent is built and launched automatically by Astur.

If a real iPhone is connected over USB, Astur advertises a CoreDevice tunnel endpoint to the XCUITest runner. Avoid hard-coding `ASTUR_IOS_AGENT_HOST` unless your device intentionally reaches the Mac over the local network.

## Device Config Recipes

Android emulator by AVD name, with auto-boot:

```ts
astur: {
  platform: 'android',
  device: {
    kind: 'emulator',
    avd: 'Pixel_9_API_35',
    autoBoot: true,
    headless: true,
    bootTimeout: 120_000
  }
}
```

Android emulator by live ADB serial:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'emulator-5554'
  }
}
```

iOS real device by UDID:

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

Real Android device by ADB serial:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'R5CT123456A'
  }
}
```

iOS simulator by name:

```ts
astur: {
  platform: 'ios',
  device: {
    name: 'iPhone 16 Pro'
  }
}
```

iOS simulator by UDID:

```ts
astur: {
  platform: 'ios',
  device: {
    id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC'
  }
}
```

Loose Android selector examples:

```ts
// Any online Android emulator.
device: { kind: 'emulator' }

// Any online Android real device.
device: { kind: 'real' }
```

Parallel device runs should use Playwright projects with unique `device.id` values:

```ts
projects: [
  {
    name: 'android-phone',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5554' } } }
  },
  {
    name: 'android-tablet',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5556' } } }
  }
]
```

Do not let two projects select the same device. Also cap every physical-device project with `workers: 1`. Playwright's top-level `workers` controls the global worker pool, but without a per-project cap it can still schedule two spec files from the same mobile project at the same time. Astur also creates a host-side device reservation for each worker session and fails fast if a second worker tries to reserve the same configured device.

## App Capability Reference

| Field | Android | iOS simulator | Description |
| --- | --- | --- | --- |
| `app: './apps/demo.apk'` | Yes | No | Shorthand for a local app path. On Android this points to an APK. |
| `path` | APK path | `.app` bundle path or simulator-compatible `.ipa` | Local app to install before the session starts. |
| `url` | APK download URL | Planned | Downloads the app during capability materialization, then installs from `downloadPath`. |
| `downloadPath` | Optional | Optional | Where Astur saves an app downloaded from `url`. Defaults under Astur's derived native artifact folder. |
| `packageName` | Android package, for example `com.example` | Accepted as fallback only | Required for launching already-installed Android apps, uninstall, clear data/cache, and explicit lifecycle calls. Inferred from APK when `aapt` is available. |
| `activity` | Android launch activity, for example `.MainActivity` | Not used | Optional. If omitted, Astur uses Android's launcher intent through `monkey`. |
| `bundleId` | Accepted as fallback only | iOS bundle id, for example `com.example.demo` | Required for iOS launch, terminate, uninstall, and reset. |
 
Common app configurations:

```ts
// Android: install local APK.
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: download APK during the run.
app: {
  url: 'https://example.com/apps/demo.apk',
  downloadPath: 'test-results/downloads/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: app already installed on device.
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}

// iOS simulator: install local .app bundle.
app: {
  path: './apps/Demo.app',
  bundleId: 'com.example.demo'
}

// iOS simulator: app already installed.
app: {
  bundleId: 'com.example.demo'
}
```

## Reports And Native Artifacts

Playwright reporters and artifacts:

| Playwright field | Purpose |
| --- | --- |
| `reporter` | Configures HTML, list, JUnit, JSON, or other Playwright reporters. |
| `outputDir` | Stores Playwright traces, screenshots, videos, and test output. |
| `use.screenshot` | Playwright/browser screenshot policy. |
| `use.video` | Playwright/browser video policy. |
| `use.trace` | Playwright trace policy. |

Astur native artifacts:

| Astur field | Purpose |
| --- | --- |
| `use.astur.artifactsDir` | Advanced override for native artifact storage. Omit this in normal Playwright runs; Astur derives a worker-scoped native artifact folder while attaching screenshots and videos per test. |
| `use.astur.artifacts.screenshot` | Captures native device screenshots through ADB/simctl and attaches them to the Playwright report. |
| `use.astur.artifacts.video` | Records the native device screen through ADB/simctl and attaches or retains according to the configured mode. |

Use both layers when a test mixes native mobile automation and WebView/browser automation.

`use.astur.artifacts` controls native capture policy. It is intentionally separate from Playwright's `use.screenshot`, `use.video`, and `use.trace`, because those Playwright settings apply to browser/page artifacts. Do not set `use.astur.artifactsDir` unless you need a custom storage root; normal test runs inherit Playwright's per-test output structure automatically.

## Native Assertions

`expect` from `@astur-mobile/test` works with native Astur locators and Playwright DOM locators. Native locator assertions auto-wait with `use.astur.timeout` unless a matcher-level timeout is provided:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

Native `MobileLocator` matchers:

- `toBeVisible`, `toBeHidden`, `toExist`
- `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeFocused`
- `toHaveText`, `toContainText`, `toHaveValue`
- `toHaveLabel`, `toHaveType`, `toHaveBounds`

## Soft Keyboard Handling

By default, Astur treats the mobile soft keyboard as a device overlay. Locator and coordinate pointer actions check whether the keyboard is visible and whether it blocks the target point. If it does, Astur dismisses the keyboard, waits briefly for the layout to settle, then resolves the locator again before tapping or long-pressing.

```ts
use: {
  astur: {
    keyboard: {
      dismiss: 'auto'
    }
  }
}
```

Use `preserve` when a test intentionally interacts with keyboard UI:

```ts
await device.getByLabel('Search').tap({ keyboard: 'preserve' });
```

For explicit control, use the device keyboard helper instead of sending a blind Back key:

```ts
await device.getByLabel('Password').fill('secret');
await device.keyboard.dismiss();
await device.keyboard.hide(); // alias for dismiss()
await device.keyboard.show(device.getByLabel('Password'));
await device.getByRole('button', { name: 'Sign in' }).tap();
```

iOS fill defaults to paste-backed input to avoid XCTest `typeText` autocorrection. Use key-by-key input only when the keyboard behavior itself is under test:

```ts
await device.getByLabel('Name').fill('Amr', { textInputMode: 'type' });
```

## Native And WebView Contexts

Native screens use Astur locators backed by platform UI trees:

```ts
await device.getByLabel('Login').tap();
await expect(device.getByText('Credentials')).toBeVisible();
```

WebView screens should use the browser DOM. In `@astur-mobile/test`, request a WebView handle after navigating the native app to a WebView screen:

```ts
import { expect, test } from '@astur-mobile/test';

test('webview content', async ({ device, webview }) => {
  await device.app.launch();
  await device.getById('tab-web').tap();

  const web = await webview({ timeout: 30_000 });
  await expect(web.page.locator('body')).toContainText(/Astur Web Lab/);
  await web.page.getByRole('button', { name: /Submit web form/i }).click();

  await device.getById('tab-login').tap();
});
```

`device.contexts()` lists native and WebView contexts. Android WebView DOM control uses Chrome DevTools Protocol, so the app must enable WebView debugging. Native mode remains available for navigation bars, system buttons, permissions, and other OS or app chrome outside the WebView.

## App And Device Management

Astur exposes app lifecycle, permissions, orientation, and device-state commands through the same fixture.

| API | Android | iOS simulator | Notes |
| --- | --- | --- | --- |
| `await device.app.install()` | Yes | Yes | Installs the configured `use.astur.app.path`. Android expects APK. iOS expects `.app` or simulator-compatible IPA. |
| `await device.app.launch()` | Yes | Yes | Launches the configured package name or bundle id. |
| `await device.app.terminate()` | Yes | Yes | Stops the configured app without uninstalling it. |
| `await device.app.reset({ reinstall: true, launch: true })` | Yes | Yes | Reinstalls from `app.path`, then optionally launches. Use this for clean iOS simulator app data. |
| `await device.app.clearData()` | Yes | No | Android package-data clear. iOS uses reset-by-reinstall instead. |
| `await device.app.clearCache()` | Yes | No | Android package-cache clear. iOS does not expose a direct equivalent. |
| `await device.app.uninstall()` | Yes | Yes | Removes the configured app. |
| `await device.permissions.grant('camera')` | Yes | Yes | Android uses package-manager permissions. iOS simulator uses `simctl privacy`. |
| `await device.permissions.revoke('camera')` | Yes | Yes | Same platform mapping as grant. |
| `await device.setOrientation('landscape')` | Yes | Yes | Sets orientation through the selected platform driver. |
| `await device.orientation.portrait()` | Yes | Yes | Convenience helper for portrait orientation. |
| `await device.lock()` | Yes | Yes | Locks the device or simulator where supported. |
| `await device.unlock()` | Yes | Yes | Wakes/unlocks the target when supported. |
| `await device.isLocked()` | Yes | Yes | Returns the observed lock state when the platform exposes it. |

All app commands default to `use.astur.app`. Pass a package name or bundle id when managing a different installed app:

```ts
await device.app.clearData('com.example.other');
await device.app.uninstall('com.example.other');
await device.permissions.grant('photos', 'com.example.other');
```

Android implements app data/cache and permission management through ADB package manager commands. iOS simulator supports install, uninstall, launch, terminate, reset-by-reinstall, and `simctl privacy` permission grant/revoke; direct per-app data/cache clearing is not exposed by `simctl`.

## Reusable Runtime Helpers

Astur exports small helpers for common page-object math and snapshot traversal so app page objects do not need to duplicate them.

| Helper | Use |
| --- | --- |
| `centerOf(bounds)` | Returns the center coordinate of an element or screen bounds. |
| `pointInBounds(bounds, xRatio, yRatio)` | Returns a coordinate inside bounds, for example `pointInBounds(screen.bounds, 0.5, 0.82)`. |
| `flattenTree(snapshot)` | Flattens a native UI tree into a searchable list of element snapshots. |
| `findElement(snapshot, selector)` | Applies Astur selector matching to a snapshot. Useful for diagnostics and app-specific page-object reads. |

Keep app-specific knowledge, such as "read the Tap Laboratory counter", inside your page object. Keep generic geometry, tree traversal, and locator matching in the Astur helpers.

## Screenshots And Device Files

Capture a native screenshot as a `Buffer`, or save it directly:

```ts
const image = await device.screenshot();
await device.screenshot({ path: 'test-results/screens/home.png' });
```

Use `device.files` for test setup and diagnostics. On Android this uses ADB file transfer:

```ts
await device.files.push('./fixtures/avatar.png', '/sdcard/Download/avatar.png');

const logs = await device.files.pull('/sdcard/Download/app.log');
await device.files.save('/sdcard/Download/app.log', 'test-results/device/app.log');

const downloads = await device.files.list('/sdcard/Download');
await device.files.remove('/sdcard/Download/avatar.png');
```

This is useful for preparing upload-picker scenarios, collecting generated files, and saving app logs or exports after a test. iOS file transfer is intentionally not exposed yet because it needs app-container-aware handling.

## Cross-Platform Projects

Use Playwright projects:

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  projects: [
    {
      name: 'android-pixel',
      use: {
        astur: {
          platform: 'android',
          device: { id: 'emulator-5554' },
          app: {
            path: './apps/demo.apk',
            packageName: 'com.example'
          }
        }
      }
    },
    {
      name: 'ios-sim',
      use: {
        astur: {
          platform: 'ios',
          device: { name: 'iPhone 16 Pro' },
          app: {
            path: './apps/Demo.app',
            bundleId: 'com.example.demo'
          }
        }
      }
    }
  ]
});
```

For parallel runs, specify unique device selectors per project:

- Android emulator + Android emulator: use different `device.id` values such as `emulator-5554` and `emulator-5556`.
- Android emulator + real Android device: prefer exact IDs such as `{ id: 'emulator-5554' }` and `{ id: 'R5CT123456A' }`.
- Android + iOS: use separate platform projects with separate physical or virtual devices.
- iOS simulator + real iPhone: use separate `device.id` values and make sure the real-device app and XCUITest runner are signed.

The example `examples/android-native/playwright.parallel.config.ts` runs one Android project and one iOS simulator project in parallel. It uses `ASTUR_ANDROID_DEVICE_ID`, `ASTUR_IOS_DEVICE_ID`, `ASTUR_IOS_DEVICE_NAME`, and `ASTUR_IOS_BUNDLE_ID` as optional overrides.

Astur reserves each configured device per worker session. If two workers select the same physical device, the second worker fails with a reservation error instead of silently fighting over the app. Set the top-level `workers` value to the number of available devices, keep project selectors unique, and set `workers: 1` inside each project that maps to one physical device.

A single phone or simulator cannot run two native app sessions at the same time. Parallelism comes from multiple devices: two devices for two workers, three devices for three workers, and so on. This applies equally to Android emulators, Android real devices, iOS simulators, and iOS real devices.

When filtering a parallel run to one file and one project, pass the file before `--project`:

```bash
npm run test:parallel:spec -- android-native/login.test.ts --project ios-simulator
```

`--project` is variadic in Playwright, so anything after it can be read as another project name.
