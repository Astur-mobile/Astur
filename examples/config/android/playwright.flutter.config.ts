import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

// Flutter validation config: same Android demo-app test suite, pointed at the
// Flutter build of the demo app (assets/astur.demo.android_flutter.apk) instead
// of the React Native build. Used to validate native Flutter automation support.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const flutterAppPath = process.env.ASTUR_ANDROID_APP_PATH
  ? resolve(repoRoot, process.env.ASTUR_ANDROID_APP_PATH)
  : resolve(repoRoot, 'assets/astur.demo.android_flutter.apk');

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  // Deny-list, not an allow-list — a platform opts out, with a reason, so a
  // newly added spec runs here by default instead of silently never running.
  testIgnore: [
    // A Flutter session reads its tree from the Dart VM, which only ever
    // contains the app's own widgets. The system photo picker is a different
    // app's UI, so it is structurally invisible here — no locator can reach it,
    // and the same exclusion already applies on Flutter iOS.
    'media-upload.test.ts'
  ],
  // Roughly 2.5x the slowest observed test. A generous per-test timeout does not
  // make a slow suite pass — it only delays how long a genuine hang takes to
  // surface, and every driver call is individually bounded anyway.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/android-flutter'),
  reporter: [['list']],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'off'
      },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: false,
        bootTimeout: 120_000
      },
      app: {
        path: flutterAppPath
      },
      ...(process.env.ASTUR_ANDROID_AGENT_MODE
        ? { agent: { mode: process.env.ASTUR_ANDROID_AGENT_MODE as 'auto' | 'required' | 'off' } }
        : {})
    }
  }
});
