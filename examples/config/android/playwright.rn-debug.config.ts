import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

/**
 * React Native **debug** build, attached to Metro.
 *
 * This config exists for one capability the release suite structurally cannot
 * cover: `device.network`. React Native's CDP network reporter sits behind a
 * compile-time flag that is off in release builds, so the shipped
 * `assets/astur.demo.android.apk` reports `observe: false` and the network spec
 * skips — correctly, but without ever exercising the backend.
 *
 * Everything else is identical to `playwright.config.ts`; the same shared specs
 * run here, against the same demo app, on the same emulator.
 *
 * Prerequisites, all in the demo-app repo:
 *
 *   1. Metro running:            npx expo start
 *   2. A debug build installed:  npx expo run:android
 *
 * The build must keep React Native's own debug defaults — `useDevSupport =
 * BuildConfig.DEBUG` in MainApplication.kt and `debuggableVariants = ["debug"]`
 * in app/build.gradle. Both are debug-only, so the release artifact every other
 * suite validates against is unaffected.
 *
 * Override the dev server with ASTUR_RN_DEV_SERVER when it is not on :8081.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  // Network observation is the reason this config exists. The rest of the suite
  // is already covered by the release config against the shipped artifact, and
  // running it twice would double the slowest job for no added signal.
  testMatch: ['network-observation.test.ts'],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/android-rn-debug'),
  reporter: [['list']],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'android',
      // A debug build fetches its bundle from Metro on every cold start, which
      // is far slower to first paint than the release build's embedded one.
      timeout: 90_000,
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
      // No `path`: the debug build is installed by `expo run:android`, which
      // also wires the Metro connection. Reinstalling the release APK over it
      // here would take the inspector target away.
      app: {
        packageName: 'com.astur.demo',
        activity: '.MainActivity'
      }
    }
  }
});
