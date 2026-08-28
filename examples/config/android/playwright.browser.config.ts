import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

/**
 * Mobile **web** suite: drives a page in the device's browser, rather than an
 * app. See `examples/specs/browser.test.ts`.
 *
 * No `app` is configured, which makes this a browser-only session — Astur skips
 * app install, and treats the native agent as optional rather than required.
 *
 * The page under test is served from this repo so the suite stays offline.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 4319;

export default defineConfig({
  testDir: resolve(repoRoot, 'examples/specs'),
  testMatch: ['browser.test.ts'],
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/android-browser'),
  reporter: [['list']],
  // Serves examples/assets/web on the host. The device reaches it at 10.0.2.2
  // (Android emulator) or 127.0.0.1 (iOS simulator) — see the spec.
  webServer: {
    command: `npx --yes http-server "${resolve(repoRoot, 'examples/assets/web')}" -p ${PORT} -s`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000
  },
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'android',
      timeout: 30_000,
      artifacts: { screenshot: 'only-on-failure', video: 'off' },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: false,
        bootTimeout: 120_000
      },
      browser: { engine: 'chrome' }
    }
  }
});
