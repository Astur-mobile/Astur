import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

// Flutter validation config for iOS simulator: points the probe/suite at the
// genuine Flutter build of the demo app (Runner.app from the asturapp flutter
// branch). Used to validate native Flutter automation support on iOS.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appPath =
  process.env.ASTUR_IOS_APP_PATH ??
  '/Users/amr.salem/Desktop/asturapp/build/ios/iphonesimulator/Runner.app';
const deviceName = process.env.ASTUR_IOS_DEVICE_NAME ?? 'iPhone 16';

export default defineConfig({
  testDir: '.',
  testMatch: ['flutter-probe.test.ts'],
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
      device: { kind: 'simulator', name: deviceName },
      app: { path: appPath, bundleId: 'com.astur.demo' }
    }
  }
});
