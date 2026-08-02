import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';
import { ensureIosApp } from '../../scripts/ensure-ios-app.mjs';

// Flutter validation config for the iOS simulator: runs the same shared demo-app
// suite as the React Native iOS config (examples/specs/*.test.ts),
// pointed at the Flutter build of the demo app instead. iOS reads the Flutter app
// through the XCUITest accessibility tree, so no `flutter run` / Dart VM service
// is needed — only the built simulator app.
//
// Defaults to the local committed asset (assets/Runner.app, extracted from
// astur.demo.ios.simulator_flutter.zip), mirroring how the RN config defaults to
// assets/Astur.app. Override with ASTUR_IOS_APP_PATH to point at a fresh build.
//
// Excluded specs (iOS-specific limitations, not framework bugs):
//  - webview.test.ts: Playwright drives WebViews over CDP, which iOS WKWebView
//    does not expose (the RN iOS config excludes it for the same reason).
//  - media-upload.test.ts: matches the RN iOS config's exclusion.
//  - drag-and-drop.test.ts: the demo's custom multi-piece pan puzzle. On the iOS
//    simulator only the first synthetic XCUITest drag in a sequence registers
//    with Flutter's pan recognizer (verified: piece 1 places, pieces 2-4 receive
//    the drag but do not move), so the four-piece solve cannot complete. The same
//    suite passes on the Flutter Android driver, which injects real motion events.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Extract the committed artifact here in the config (consistent with the RN iOS
// config and with how the Android configs resolve their APK), so the npm script
// is a plain `astur-mobile test` call. An ASTUR_IOS_APP_PATH override is
// resolved against the repo root; an absolute path is honored as-is.
const appPath = process.env.ASTUR_IOS_APP_PATH
  ? resolve(repoRoot, process.env.ASTUR_IOS_APP_PATH)
  : ensureIosApp(resolve(repoRoot, 'assets/Runner.app'), resolve(repoRoot, 'assets/astur.demo.ios.simulator_flutter.zip'));
const bundleId = process.env.ASTUR_IOS_BUNDLE_ID ?? 'com.astur.demo';
const deviceId = process.env.ASTUR_IOS_DEVICE_ID;
const deviceName = process.env.ASTUR_IOS_DEVICE_NAME ?? 'iPhone 16';
const device = deviceId
  ? { kind: 'simulator' as const, id: deviceId }
  : { kind: 'simulator' as const, name: deviceName };

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  // Deny-list, not an allow-list — see the RN iOS config for why. Reasons for
  // each exclusion are documented in the header comment above.
  testIgnore: [
    'media-upload.test.ts',
    'webview.test.ts',
    'drag-and-drop.test.ts'
  ],
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/ios-flutter'),
  reporter: [['list']],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'ios',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'off'
      },
      // native-locators.test.ts is intentionally agent-only; fail session
      // setup with the underlying XCUITest error instead of falling back.
      agent: {
        mode: 'required'
      },
      device,
      app: { path: appPath, bundleId }
    }
  }
});
