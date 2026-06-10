import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appPath = resolve(repoRoot, 'assets/astur.demo.android.apk');
const androidDeviceId = process.env.ASTUR_ANDROID_DEVICE_ID ?? 'emulator-5554';
const androidAvd = process.env.ASTUR_ANDROID_AVD ?? 'Pixel_9_API_35';
const iosDeviceId = process.env.ASTUR_IOS_DEVICE_ID;
const configuredWorkers = resolveWorkersFromCli();

function resolveWorkersFromCli(): number {
  const requestedProjects = getRequestedProjects(process.argv);

  // If no project is specified, run one worker per configured platform project.
  if (requestedProjects.size === 0) {
    return 2;
  }

  // One selected project means one physical device target: keep execution serial.
  if (requestedProjects.size === 1) {
    return 1;
  }

  return 2;
}

function getRequestedProjects(argv: readonly string[]): Set<string> {
  const projects = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--project') {
      const next = argv[index + 1];
      if (next) {
        for (const name of next.split(',').map((value) => value.trim()).filter(Boolean)) {
          projects.add(name);
        }
      }
      continue;
    }

    if (token.startsWith('--project=')) {
      const raw = token.slice('--project='.length);
      for (const name of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
        projects.add(name);
      }
    }
  }

  return projects;
}

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
  // Parallelism here is device-level, not spec-file-level.
  // Playwright can schedule multiple files from the same project at once unless the
  // project itself is capped. Keep each mobile project at one worker so no two
  // workers ever control the same emulator/simulator at the same time.
  // - both projects selected: Android and iOS can run concurrently (2 total workers)
  // - single project selected: serial execution against that one physical device
  workers: configuredWorkers,
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
      name: 'android-device',
      workers: 1,
      use: {
        astur: {
          platform: 'android',
          timeout: 20_000,
          artifacts: {
            screenshot: 'only-on-failure',
            video: 'off'
          },
          device: {
            // Pin the device id so each parallel worker controls a known
            // emulator, but also provide the AVD so Astur can boot it when it is
            // offline instead of failing fast with DEVICE_NOT_FOUND.
            kind: 'emulator',
            id: androidDeviceId,
            avd: androidAvd,
            autoBoot: true,
            bootTimeout: 120_000
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
      workers: 1,
      use: {
        astur: {
          platform: 'ios',
          // iOS simulator boot + app shell hydration can be slower under mixed-platform parallel load.
          timeout: 35_000,
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
