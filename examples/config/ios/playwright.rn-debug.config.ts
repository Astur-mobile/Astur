import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

/**
 * React Native **debug** build on the iOS simulator, attached to Metro.
 *
 * The iOS counterpart of `config/android/playwright.rn-debug.config.ts`, and
 * for the same reason: React Native's CDP network reporter is compiled out of
 * release builds, so the shipped `assets/Astur.app` reports `observe: false`
 * and the network spec skips without exercising the backend.
 *
 * The reporter lives in `ReactCommon`, so this is the same transport and the
 * same Astur client as Android — only the build command differs.
 *
 * Prerequisites, both in the demo-app repo:
 *
 *   1. Metro running:        npx expo start
 *   2. A debug build:        npx expo run:ios
 *
 * Unlike Android, no app-side change is needed: the stock `AppDelegate` already
 * loads from Metro under `#if DEBUG`.
 *
 * Override the dev server with ASTUR_RN_DEV_SERVER when it is not on :8081, and
 * the simulator with ASTUR_IOS_DEVICE_ID / ASTUR_IOS_DEVICE_NAME.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const iosDeviceId = process.env.ASTUR_IOS_DEVICE_ID;
const iosDeviceName = process.env.ASTUR_IOS_DEVICE_NAME ?? 'iPhone 16';

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  // Network observation is the reason this config exists; the rest of the suite
  // is already covered by the release config against the shipped bundle.
  testMatch: ['network-observation.test.ts'],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/ios-rn-debug'),
  reporter: [['list']],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'ios',
      // A debug build fetches its bundle from Metro on every cold start.
      timeout: 90_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'off'
      },
      device: iosDeviceId
        ? { kind: 'simulator' as const, id: iosDeviceId }
        : { kind: 'simulator' as const, name: iosDeviceName },
      // No `path`: the debug build is installed by `expo run:ios`, which also
      // wires the Metro connection. Reinstalling the release bundle over it
      // here would take the inspector target away.
      app: {
        bundleId: 'com.astur.demo'
      }
    }
  }
});
