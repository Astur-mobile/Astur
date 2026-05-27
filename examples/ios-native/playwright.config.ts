import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const iosDeviceId = process.env.ASTUR_IOS_DEVICE_ID;

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/android-native'),
  testMatch: [
    'login.test.ts',
    'forms.test.ts',
    'forms-slider.test.ts',
    'orientation-menu.test.ts',
    'swipe.test.ts',
    'drag-and-drop.test.ts',
    'tap-laboratory.test.ts'
  ],
  timeout: 240_000,
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
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      device: {
        kind: 'simulator',
        ...(iosDeviceId
          ? { id: iosDeviceId }
          : { name: process.env.ASTUR_IOS_DEVICE_NAME ?? 'iPhone 16' })
      },
      app: {
        bundleId: process.env.ASTUR_IOS_BUNDLE_ID ?? 'com.astur.demo'
      }
    }
  }
});
