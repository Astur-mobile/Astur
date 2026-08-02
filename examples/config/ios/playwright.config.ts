import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';
import { ensureIosApp } from '../../scripts/ensure-ios-app.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const iosDeviceId = process.env.ASTUR_IOS_DEVICE_ID;
const iosDeviceKind = process.env.ASTUR_IOS_DEVICE_KIND === 'real' ? 'real' : 'simulator';
const iosDeviceName = process.env.ASTUR_IOS_DEVICE_NAME ?? 'iPhone 16';
const iosBundleId = process.env.ASTUR_IOS_BUNDLE_ID ?? 'com.astur.demo';

// Resolve the app the same way the Android configs do — from assets/, here in
// the config — so `npm run test:ios*` is a plain `astur-mobile test` call with
// no extraction step bolted onto the npm script.
//
// Only for simulators: a real device needs a signed .ipa, not this bundle, so
// that path still falls back to launching whatever is already installed by
// bundle id.
const iosAppPath = process.env.ASTUR_IOS_APP_PATH
  ? resolve(repoRoot, process.env.ASTUR_IOS_APP_PATH)
  : iosDeviceKind === 'simulator'
    ? ensureIosApp(resolve(repoRoot, 'assets/Astur.app'), resolve(repoRoot, 'assets/astur.demo.ios.simulator.zip'))
    : undefined;
const iosApp = iosAppPath
  ? {
    path: iosAppPath,
    bundleId: iosBundleId
  }
  : {
    bundleId: iosBundleId
  };
const iosDevice = iosDeviceKind === 'real'
  ? {
    kind: 'real' as const,
    ...(iosDeviceId ? { id: iosDeviceId } : {})
  }
  : iosDeviceId
    ? {
      kind: 'simulator' as const,
      id: iosDeviceId
    }
    : {
      kind: 'simulator' as const,
      name: iosDeviceName
    };

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  // Deny-list, not an allow-list. Every spec runs on every platform by default,
  // exactly as the Android configs do; a platform only opts OUT, with a reason.
  // An allow-list silently drops newly added specs — a new spec then appears to
  // pass on iOS when it never ran at all.
  testIgnore: [
    // Native photo picker: system UI outside the app, not automatable here.
    'media-upload.test.ts',
    // WKWebView DOM needs ios-webkit-debug-proxy, which bridges physical
    // devices only — no CDP transport on the simulator yet.
    'webview.test.ts'
  ],
  // Sized for the *first* test of a cold run, which absorbs the one-time
  // XCUITest-agent build (a couple of minutes on a fresh machine). Every run
  // after that is far quicker; this is a ceiling for a hang, not a target.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/ios-native'),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(repoRoot, 'playwright-report/ios-native'), open: 'never' }],
    ['junit', { outputFile: resolve(repoRoot, 'test-results/ios-native/results.xml') }]
  ],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'ios',
      timeout: 15_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      // native-locators.test.ts is intentionally agent-only; fail session
      // setup with the underlying XCUITest error instead of falling back.
      agent: {
        mode: 'required'
      },
      device: iosDevice,
      app: iosApp
    }
  }
});
