# Android Setup

Astur's Android driver uses public Android tools for lifecycle and artifacts:

- `adb devices -l` for discovery
- `adb install -r` for installation
- `monkey` or `am start` for launch
- `uiautomator dump` for legacy UI snapshots and diagnostics
- `input tap`, `input text`, `input swipe`, and `input keyevent` only for the legacy fallback path
- `screencap` for screenshots
- `aapt dump badging` for APK package/activity inference when available

No Appium server is required.

Astur defaults to the Kotlin UIAutomator native-agent path for element lookup, waits, actions, and gestures. The published Android package includes the agent APKs, so normal npm installs do not require a separate agent build step. Use `automation.engine: 'auto'` only while migrating if you need fallback to the old ADB/XML path.

## Install Android SDK

Install Android Studio or the command line Android SDK. Ensure platform tools are available:

```bash
adb version
```

If `adb` is not found, add platform tools to `PATH`.

macOS example:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## Start An Emulator

Use Android Studio Device Manager or the command line:

```bash
emulator -list-avds
emulator -avd Pixel_8_API_35
```

Then verify:

```bash
adb devices -l
npx astur-mobile devices --android
```

## Real Android Device

On the device:

- enable Developer Options
- enable USB debugging
- connect over USB
- approve the debugging prompt

Verify:

```bash
adb devices -l
```

The state must be `device`. If it is `unauthorized`, unlock the device and approve the prompt.

## Android Configuration

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'android',
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true,
        bootTimeout: 120_000
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

### Optional Native-Agent Endpoint

```ts
agent: {
  mode: 'auto',
  endpoint: 'tcp:127.0.0.1:8787',
  launchTimeout: 15_000,
  commandTimeout: 10_000
}
```

Environment override:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
```

Use `agent.mode: 'required'` in CI once the Android native-agent command set is stable for your test suite.

By default, Astur starts one Android native-agent session per Playwright worker. It does not reinstall the agent before every spec; the bundled agent APKs are installed only when the agent app or test package is missing. Set `ASTUR_ANDROID_AGENT_FORCE_INSTALL=1` when developing the agent and you intentionally need to refresh the APKs on the device.

With `device.avd`, Astur starts the emulator when no matching online emulator is found. With `app.path`, Astur installs the APK before the test starts. When `aapt` is available from the Android SDK, Astur also infers `packageName` and launch `activity`.

You can still make everything explicit:

```ts
device: {
  id: 'emulator-5554'
},
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

Use a specific `device.id` for parallel runs. Loose selectors like `{ kind: 'emulator' }` are convenient locally but are not safe for parallel device allocation yet.

## Android Device Options

```ts
device: {
  kind: 'emulator',
  avd: 'Pixel_9_API_35',
  autoBoot: true,
  headless: true,
  wipeData: false,
  bootTimeout: 120_000,
  emulatorArgs: ['-no-snapshot-save']
}
```

Fields:

- `avd`: Android Virtual Device name from `emulator -list-avds`
- `autoBoot`: starts the AVD when no matching online emulator is found; defaults to true when `avd` is set
- `headless`: adds `-no-window`; defaults to true
- `wipeData`: adds `-wipe-data`; useful for clean CI runs, destructive to emulator state
- `bootTimeout`: max wait time for `sys.boot_completed`
- `emulatorArgs`: extra emulator arguments

## APK Metadata Inference

If the config only provides:

```ts
app: {
  path: './apps/demo.apk'
}
```

Astur tries:

```bash
aapt dump badging ./apps/demo.apk
```

It fills:

- `app.packageName`
- `app.activity`

If `aapt` is not available, set `ASTUR_AAPT` or provide package metadata manually.

Astur supports three Android app modes:

```ts
// Install a local APK.
app: { path: './apps/demo.apk' }

// Download the APK during the run, then install it.
app: { url: 'https://example.com/apps/demo.apk' }

// Launch an app that is already installed on the device.
app: { packageName: 'com.example', activity: '.MainActivity' }
```

`use.astur.timeout` defines the default timeout for element actions and mobile assertions. Per-action overrides still work when needed.

## Supported Android Actions

| Area | API | Notes |
| --- | --- | --- |
| App lifecycle | `device.app.install()`, `launch()`, `terminate()`, `reset()`, `uninstall()` | Uses the configured APK/package by default. |
| App storage | `device.app.clearData()`, `device.app.clearCache()` | Uses Android package-manager commands. |
| Permissions | `device.permissions.grant('camera')`, `revoke('camera')` | Accepts Android permission names or Astur shorthand where available. |
| Orientation | `device.setOrientation('landscape')`, `device.orientation.portrait()` | Uses Android display/orientation control. |
| Lock state | `device.lock()`, `device.unlock()`, `device.isLocked()` | Uses Android shell/device state APIs. |
| Native locators | `getByText()`, `getByLabel()`, `getByTestId()`, `getByRole()` | Runs through the UIAutomator native-agent path by default. Multi-match queries (`locator.count()`, `queryAll()`, `device.findAll()`, `device.findMany()`) also resolve on-device via `element.findAll` / `element.findMany`; agent builds without those commands fall back to the tree-snapshot path automatically. |
| Coordinates | `device.tap()`, `device.longPress()`, `device.swipe()`, `device.drag()` | Useful for gesture surfaces and inspector-generated fallback steps. |
| Scroll into view | `locator.scrollIntoView({ direction, maxScrolls })` | Cross-platform. Swipes the surrounding scroll view until the element is visible, then resolves with its snapshot. Replaces hand-written "swipe in a loop until visible" page-object helpers. |

Element and gesture examples:

```ts
await device.getByText('Continue').tap();
await device.getByLabel('Email').fill('qa@example.com');
await device.getByRole('button', { name: 'Submit' }).longPress({ durationMs: 800 });

// Scroll a long form until the target is on screen, then act on it.
await device.getByText('Submit').scrollIntoView();
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up', maxScrolls: 6 });

await device.tap({ x: 120, y: 780 });
await device.longPress({ x: 360, y: 900 }, { durationMs: 900 });
await device.swipe({
  start: { x: 500, y: 1200 },
  end: { x: 500, y: 300 },
  durationMs: 300
});
await device.drag({
  start: { x: 120, y: 1100 },
  end: { x: 360, y: 420 },
  durationMs: 800
});
```

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();

await device.back();
await device.home();
await device.recentApps();
await device.pressKey('ENTER');
await device.lock();
await device.unlock();
await device.system.isLocked();

await device.screenshot();
```

### Typing into a control the tree cannot describe

`device.keyboard.type()` sends characters to whatever view holds focus, with no element to target. Use it for controls that expose no fillable field — a multi-box OTP input, where the boxes are plain views and the real input is hidden:

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

The same call works on iOS, so one spec covers both. Prefer `fill()` whenever the field is addressable: it resolves the element, clears it, and verifies the value landed, none of which is possible when targeting focus.

`pressKey()` follows the same rule for a single printable character — it types that character rather than sending a keycode, so a digit-by-digit OTP loop is portable:

```ts
for (const digit of '123456') {
  await device.pressKey(digit);
}
```

Anything longer than one character is still a key: named keys (`'BACK'`, `'ENTER'`, `'VOLUME_UP'`) and raw Android keycode numbers (`'66'`) behave exactly as before.

When native-agent endpoint mode is enabled and healthy, element/gesture commands can run through the device-side Kotlin agent transport. If endpoint mode is unavailable in `auto`, Astur falls back to current ADB/UIAutomator behavior.

`device.gestures` also exposes `tap`, `longPress`, `pressAndHold`, `swipe`, and `drag` as a grouped API. `device.navigation` exposes `back`, `home`, and `recentApps`.

### Scrolling To Off-Screen Elements

`locator.scrollIntoView()` is the built-in way to bring an element that is below or above the fold into view before acting on it. It is cross-platform (Android and iOS) and lives on every locator, so you no longer need to hand-write "swipe in a loop until visible" helpers in page objects. If the element is already visible it returns immediately without scrolling.

```ts
// Default: scroll down within the viewport, up to 10 swipes.
await device.getByText('Save changes').scrollIntoView();

// Reveal something above the current position.
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up' });

// Scroll inside a specific scrollable container instead of the whole screen.
await device.getById('product-42').scrollIntoView({
  container: device.getById('catalog-list'),
  maxScrolls: 15
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `direction` | `'down'` | Direction to scroll the content toward the target: `'down'`, `'up'`, `'left'`, or `'right'`. |
| `maxScrolls` | `10` | Maximum number of scroll gestures before giving up. |
| `durationMs` | `400` | Duration of each scroll gesture. |
| `container` | viewport | Scrollable element to swipe within. Defaults to the device viewport, which Astur resolves per platform (iOS viewport vs Android tree bounds). |
| `timeout` / `interval` | session defaults | Forwarded to the final visibility wait. |

If the element never appears, `scrollIntoView()` throws a timeout error naming the selector and the scroll direction it tried.

App management maps to ADB package manager commands:

- `device.app.install(path?)` -> `adb install -r`
- `device.app.uninstall(packageName?)` -> `adb uninstall`
- `device.app.clearData(packageName?)` -> `pm clear`
- `device.app.clearCache(packageName?)` -> `pm clear --cache-only`
- `device.app.reset({ reinstall, launch })` -> force-stop plus either `pm clear` or uninstall/install
- `device.permissions.grant(permission, packageName?)` -> `pm grant`
- `device.permissions.revoke(permission, packageName?)` -> `pm revoke`

Short permission names such as `camera` are normalized to Android permission constants like `android.permission.CAMERA`; pass the full permission string when you need exact control.

Device state helpers map to Android keyguard and power commands:

- `device.lock()` / `device.system.lock()` -> `KEYCODE_SLEEP`
- `device.unlock()` / `device.system.unlock()` -> `KEYCODE_WAKEUP` plus `wm dismiss-keyguard`
- `device.isLocked()` / `device.system.isLocked()` -> parsed `dumpsys window` state

Android system keys accept friendly names such as `BACK`, `HOME`, `ENTER`, `MENU`, `APP_SWITCH`, `RECENTS`, `VOLUME_UP`, and `VOLUME_DOWN`. Raw Android key codes such as `KEYCODE_BACK` or numeric values still work.

The Android example suite is split by functionality under `examples/specs`: `login.test.ts`, `forms.test.ts`, `forms-slider.test.ts`, `media-upload.test.ts`, `tap-laboratory.test.ts`, `swipe.test.ts`, `drag-and-drop.test.ts`, and `webview.test.ts`. They share the `fixtures.ts` app fixture and the single page-object file at `pages/astur-demo-app.page.ts`.

## Locator Mapping

| Astur locator | Android source |
| --- | --- |
| `getByLabel()` / `by.label()` | `content-desc` or resource id |
| `getByTestId()` / `getById()` / `by.id()` | `resource-id` |
| `getByText()` / `by.text()` | `text` or `content-desc` |
| `getByRole()` / `by.role()` | normalized Android widget class plus accessible name |
| `getByType()` / `by.type()` | Android class |

Prefer accessibility labels and stable resource ids.

## Native Selector Escape Hatch (`by.native`)

For the rare element none of the strategies above can pin down — most often
a screen with no accessibility metadata, where the only reliable match is by
structure or by combining several conditions at once — `by.native()` builds
an Android query straight from androidx.test.uiautomator's own `By`/
`BySelector` fields, the same API the bundled UiAutomator agent already uses
for every other strategy:

```ts
await device.find(by.native({
  android: {
    className: 'android.widget.Button',
    textContains: 'Save',
    // "the Save button inside this specific card" instead of "the 3rd Save
    // button on the whole screen":
    hasChild: { resourceId: 'com.example:id/card_title' }
  }
})).tap();

// Disambiguate identical siblings by position (0-based, after any
// hasChild/hasDescendant constraints are applied):
await device.find(by.native({
  android: { className: 'android.widget.TextView', text: 'Delete' },
  instance: 2
})).tap();
```

| `AndroidNativeSelector` field | Maps to |
| --- | --- |
| `className` / `classNameMatches` | `BySelector.clazz(String \| Pattern)` |
| `text` / `textContains` / `textMatches` | `BySelector.text()` / `.textContains()` / `.textMatches()` |
| `description` / `descriptionContains` / `descriptionMatches` | `BySelector.desc()` / `.descContains()` / `.descMatches()` |
| `resourceId` / `resourceIdMatches` | `BySelector.res(String \| Pattern)` |
| `packageName` | `BySelector.pkg()` |
| `hasChild` / `hasDescendant` | `BySelector.hasChild()` / `.hasDescendant()`, nesting another `AndroidNativeSelector` |

Every present field further constrains the same query (logical AND). This is
deliberately **not** an arbitrary expression language — no `eval`, no custom
parser, no runtime bytecode compilation (unlike Appium's `-android
uiautomator` strategy, which needs one to run literal Java/Kotlin source).
Everything maps 1:1 to a real, type-checked `BySelector` method.

`by.native()` requires a connected native agent — it cannot be resolved
against a cached UI-tree snapshot, so a legacy/no-agent session throws
`NATIVE_SELECTOR_REQUIRES_AGENT` rather than silently matching nothing. To
target iOS with the same locator, add an `ios` predicate string alongside
`android` — see [iOS: Native Selector Escape Hatch](./ios/#native-selector-escape-hatch-bynative).
