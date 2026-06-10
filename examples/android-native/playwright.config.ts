import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@astur-mobile/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const androidAgentMode = readAndroidAgentMode();

function readAndroidAgentMode(): 'auto' | 'required' | 'off' | undefined {
  const raw = process.env.ASTUR_ANDROID_AGENT_MODE;
  if (raw === 'auto' || raw === 'required' || raw === 'off') {
    return raw;
  }
  return undefined;
}

export default defineConfig({
  testDir: '.',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(repoRoot, 'test-results/android-native'),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(repoRoot, 'playwright-report/android-native'), open: 'never' }],
    ['junit', { outputFile: resolve(repoRoot, 'test-results/android-native/results.xml') }]
  ],
  use: {
    trace: 'off',
    video: 'off',
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: false,
        bootTimeout: 120_000
      },
      // device: {
      //   kind: 'real',
      //   id: 'R5CY14CMXNJ',
      //   autoBoot: true,
      //   headless: false,
      //   bootTimeout: 120_000
      // },
      app: {
        path: resolve(repoRoot, 'assets/astur.demo.android.apk'),
        // packageName: 'com.astur.demo',
        // activity: '.MainActivity'
      },
      ...(androidAgentMode
        ? {
          agent: {
            mode: androidAgentMode,
            legacyFallback: process.env.ASTUR_ANDROID_LEGACY_FALLBACK === 'never' ? 'never' : undefined
          }
        }
        : {})
    }
  }
});
