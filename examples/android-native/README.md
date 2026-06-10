# Android Native Example

This example expects:

- an Android emulator or real device visible in `adb devices`
- the Astur Android demo APK at `assets/astur.demo.android.apk`
- an AVD named `Pixel_9_API_35`, or an updated `device.avd` in `playwright.config.ts`
- the Astur Android agent APK/test APK built by the repository build

Astur defaults Android to the v2 native-agent engine in migration-safe `auto` mode, installs and starts the Android agent automatically, and keeps the low-level automation settings out of the example config. Set an explicit endpoint only when you are attaching to an already-running agent:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
```

Advanced projects can still override the engine in `use.astur.automation`, for example `engine: 'agent'` to fail fast in CI or `engine: 'legacy-adb'` when intentionally comparing against the old shell/XML path.

Run the full feature suite from this repository root after building:

```bash
npm run build
npx astur-mobile test --config examples/android-native/playwright.config.ts
```

Astur now keeps one native agent session per Playwright worker instead of recreating it for every spec. The demo `app` fixture terminates and relaunches the app before each test, so tests remain isolated without reinstalling the native agent or clearing app data on every spec. Android also skips redundant agent APK installs when the agent packages are already present on the device; set `ASTUR_ANDROID_AGENT_FORCE_INSTALL=1` only when you intentionally want to refresh the installed agent APKs.

Astur skips redundant app installs when the configured app is already installed on the target device. The first run installs normally; later sessions reuse the installed package unless you uninstall it.

The suite is split by user-facing functionality:

- `login.test.ts` covers credentials and login feedback.
- `forms.test.ts` covers text input, switch, checkbox, and form button state.
- `forms-slider.test.ts` covers the form slider bar and value updates.
- `media-upload.test.ts` covers selecting a media file from the form screen.
- `tap-laboratory.test.ts` covers single tap, double tap, and long press on Android. The current iOS demo IPA exposes the same counters, but XCTest double taps are reported by the app as two single taps on real hardware, so the iOS assertion records that platform behavior until the demo app gesture handler is updated.
- `orientation-menu.test.ts` covers portrait/landscape rotation and the responsive menu state.
- `swipe.test.ts` covers carousel and vertical swipe behavior.
- `drag-and-drop.test.ts` covers the drag puzzle.
- `webview.test.ts` covers native WebView navigation plus DOM interaction.

Run one focused feature:

```bash
npx astur-mobile test --config examples/android-native/playwright.config.ts examples/android-native/tap-laboratory.test.ts
```

All Android native specs use the same page object model:

- `fixtures.ts` turns Astur's built-in `device` fixture into an `app` fixture.
- `pages/astur-demo-app.page.ts` contains the single page-object file for the demo app.
- Test files stay focused on expected behavior and call page methods such as `app.login.enterCredentials()` and `app.forms.chooseFirstVisibleMedia()`.
- The `app` fixture performs the per-spec app restart, so individual specs do not need repeated `app.reset()` boilerplate.

Run the WebView feature:

```bash
npx astur-mobile test --config examples/android-native/playwright.config.ts examples/android-native/webview.test.ts
```

Run the cross-platform suite against one Android device and one iOS simulator in parallel:

```bash
adb devices -l
xcrun simctl list devices booted
npx astur-mobile test --config examples/android-native/playwright.parallel.config.ts examples/android-native/login.test.ts
```

To filter both by file and project, place the file path before `--project` because Playwright's `--project` option accepts multiple values:

```bash
npm run test:parallel:spec -- android-native/login.test.ts --project ios-simulator
```

The parallel config maps projects to separate platforms:

- `android-device` -> `ASTUR_ANDROID_DEVICE_ID` or `emulator-5554`
- `ios-simulator` -> `ASTUR_IOS_DEVICE_ID` or `ASTUR_IOS_DEVICE_NAME` or `iPhone 16`

Keep these ids aligned with `adb devices -l` and `xcrun simctl list devices`. Each parallel project must select a different device. Astur reserves the selected device per Playwright worker and fails fast if another worker tries to control the same device at the same time.

Each project gets an isolated Astur session and its own native artifact directory. The two device workers run at the same time; when one device finishes, its session closes without waiting for the other device's test steps. The Playwright command itself still exits only after all project results are collected so it can produce one combined report.

Keep device-level parallel runs project-based. Do not point two projects at the same emulator id, and do not enable unrestricted file-level parallelism for multiple specs targeting the same physical device. In the parallel config, each mobile project sets `workers: 1` while the top-level config uses `workers: 2`; that allows Android and iOS to run at the same time without allowing two Android specs or two iOS specs to fight over the same device.

The example package intentionally exposes only `npm run test:parallel` for the mixed-platform run. Running one selected Android or iOS project from the parallel config is just a serial single-device run, so use `npm run test:android` or `npm run test:ios` for that case.

The default single-device config uses `workers: 1` for this reason. Use `playwright.parallel.config.ts` when each worker targets a different Android or iOS device.

The example config writes:

- HTML report: `playwright-report/android-native`
- JUnit XML: `test-results/android-native/results.xml`
- native screenshots/videos: attached to the Playwright report from `use.astur.artifacts`

Playwright tracing is off in this native-only example because the Playwright trace viewer records browser/page snapshots, which appear as `about:blank` for native mobile screens. Keep native screenshots, videos, timing diagnostics, and error context as the default debugging surface; enable Playwright traces only for specs that use WebView DOM automation.

Element waits come from `use.astur.timeout`; add `{ timeout: ... }` to an individual locator only when that element needs a different budget.

Soft-keyboard handling comes from `use.astur.keyboard.dismiss`. The examples use `auto`, so locator and coordinate actions dismiss the keyboard only when it blocks the target point. Use `{ keyboard: 'preserve' }` on an individual action when you intentionally need to interact with the keyboard.

For WebView screens, keep native and DOM automation separate. Use native Astur locators to navigate to the Web tab, then request a Playwright-backed WebView page:

```ts
test('webview DOM', async ({ app, webview }) => {
  await app.nav.open('web');

  const web = await webview({ timeout: 30_000 });
  await expect(web.page.locator('body')).toContainText(/Astur Web Lab/);
});
```

Android WebView DOM control requires WebView debugging to be enabled by the app. Native interactions still use `device.find(...)`; WebView DOM interactions use `web.page`.
