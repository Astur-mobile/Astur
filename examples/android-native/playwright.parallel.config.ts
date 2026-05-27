import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appPath = resolve(repoRoot, 'assets/astur.demo.android.apk');
const androidDeviceId = process.env.ASTUR_ANDROID_DEVICE_ID ?? 'emulator-5554';
const iosDeviceId = process.env.ASTUR_IOS_DEVICE_ID;

export default defineConfig({
  testDir: '.',
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
  // Parallelism here is device-level: one worker for Android and one for iOS.
  // Do not point two projects at the same physical device.
  workers: 2,
  outputDir: resolve(repoRoot, 'test-results/mobile-parallel'),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(repoRoot, 'playwright-report/mobile-parallel'), open: 'never' }],
    ['junit', { outputFile: resolve(repoRoot, 'test-results/mobile-parallel/results.xml') }]
  ],
  use: {
    trace: 'off',
    video: 'off'
  },
  projects: [
    {
      name: 'android-emulator',
      use: {
        astur: {
          platform: 'android',
          timeout: 20_000,
          artifacts: {
            screenshot: 'only-on-failure',
            video: 'off'
          },
          device: {
            kind: 'emulator',
            id: androidDeviceId
          },
          app: {
            path: appPath,
            packageName: 'com.astur.demo',
            activity: '.MainActivity'
          }
        }
      }
    },
    {
      name: 'ios-simulator',
      use: {
        astur: {
          platform: 'ios',
          timeout: 20_000,
          artifacts: {
            screenshot: 'only-on-failure',
            video: 'off'
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
    }
  ]
});
