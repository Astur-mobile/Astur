import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { PlatformName } from '@astur/protocol';

type PlatformChoice = 'android' | 'ios' | 'both';
type AndroidTarget = 'emulator' | 'real' | 'browserstack';
type IosTarget = 'simulator' | 'real' | 'browserstack';
type AndroidAppSource = 'path' | 'url' | 'installed';
type IosAppSource = 'path' | 'installed';

export interface InitAnswers {
  platforms: PlatformName[];
  timeout: number;
  reports: {
    html: boolean;
    junit: boolean;
  };
  artifacts: {
    screenshot: 'off' | 'on' | 'only-on-failure';
    video: 'off' | 'on' | 'retain-on-failure';
    trace: 'off' | 'on' | 'retain-on-failure';
  };
  android?: AndroidAnswers;
  ios?: IosAnswers;
}

export interface AndroidAnswers {
  target: AndroidTarget;
  avd?: string;
  deviceId?: string;
  browserStackDeviceName?: string;
  browserStackOsVersion?: string;
  app: AndroidAppAnswers;
}

export interface IosAnswers {
  target: IosTarget;
  simulatorName?: string;
  deviceId?: string;
  browserStackDeviceName?: string;
  browserStackOsVersion?: string;
  app: IosAppAnswers;
}

export type AndroidAppAnswers =
  | { source: 'path'; path: string; packageName?: string; activity?: string }
  | { source: 'url'; url: string; downloadPath?: string; packageName?: string; activity?: string }
  | { source: 'installed'; packageName: string; activity?: string };

export type IosAppAnswers =
  | { source: 'path'; path: string; bundleId: string }
  | { source: 'installed'; bundleId: string };

export interface InitFile {
  path: string;
  contents: string;
}

interface Choice<T extends string> {
  label: string;
  value: T;
  description?: string;
}

export function defaultInitAnswers(): InitAnswers {
  return {
    platforms: ['android'],
    timeout: 20_000,
    reports: {
      html: true,
      junit: true
    },
    artifacts: {
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      trace: 'off'
    },
    android: {
      target: 'emulator',
      avd: 'Pixel_9_API_35',
      app: {
        source: 'path',
        path: './apps/demo.apk'
      }
    }
  };
}

export async function promptInitAnswers(): Promise<InitAnswers> {
  const rl = createInterface({ input, output });

  try {
    const platform = await select<PlatformChoice>(rl, 'Which platforms will you test?', [
      { label: 'Android', value: 'android', description: 'Android emulator or real device' },
      { label: 'iOS', value: 'ios', description: 'iOS simulator or real device' },
      { label: 'Both', value: 'both', description: 'Generate Playwright projects for Android and iOS' }
    ]);
    const platforms = platform === 'both' ? ['android', 'ios'] as PlatformName[] : [platform];

    const answers: InitAnswers = {
      platforms,
      timeout: Number(await ask(rl, 'Default mobile element timeout in ms', '20000')),
      reports: {
        html: await yesNo(rl, 'Generate Playwright HTML report?', true),
        junit: await yesNo(rl, 'Generate JUnit XML report?', true)
      },
      artifacts: {
        screenshot: await select(rl, 'Native screenshot capture?', [
          { label: 'Only on failure', value: 'only-on-failure' },
          { label: 'Always', value: 'on' },
          { label: 'Off', value: 'off' }
        ]),
        video: await select(rl, 'Native video capture?', [
          { label: 'Retain on failure', value: 'retain-on-failure' },
          { label: 'Always', value: 'on' },
          { label: 'Off', value: 'off' }
        ]),
        trace: await select(rl, 'Playwright trace capture?', [
          { label: 'Off', value: 'off' },
          { label: 'Retain on failure', value: 'retain-on-failure' },
          { label: 'Always', value: 'on' }
        ])
      }
    };

    if (platforms.includes('android')) {
      answers.android = await promptAndroid(rl);
    }

    if (platforms.includes('ios')) {
      answers.ios = await promptIos(rl);
    }

    return answers;
  } finally {
    rl.close();
  }
}

export function buildInitFiles(answers: InitAnswers): InitFile[] {
  return [
    {
      path: 'playwright.config.ts',
      contents: buildPlaywrightConfig(answers)
    },
    {
      path: 'tests/example.test.ts',
      contents: buildExampleTest()
    },
    {
      path: '.gitignore',
      contents: buildGitignore()
    },
    {
      path: 'ASTUR_SETUP.md',
      contents: buildSetupReadme(answers)
    }
  ];
}

function buildPlaywrightConfig(answers: InitAnswers): string {
  const projects = answers.platforms.map((platform) => {
    const config = platform === 'android'
      ? buildAndroidAsturConfig(answers)
      : buildIosAsturConfig(answers);
    return `    {
      name: ${quote(projectName(platform, answers))},
      use: {
        astur: ${indent(config, 8)}
      }
    }`;
  }).join(',\n');
  const reporters = [
    `['list']`,
    ...(answers.reports.html ? [`['html', { outputFolder: 'playwright-report/mobile', open: 'never' }]`] : []),
    ...(answers.reports.junit ? [`['junit', { outputFile: 'test-results/mobile/results.xml' }]`] : [])
  ];

  return `import { defineConfig } from '@astur/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  outputDir: 'test-results/mobile',
  reporter: [
    ${reporters.join(',\n    ')}
  ],
  use: {
    screenshot: 'off',
    video: 'off',
    trace: ${quote(answers.artifacts.trace)}
  },
  projects: [
${projects}
  ]
});
`;
}

function buildAndroidAsturConfig(answers: InitAnswers): string {
  const android = requireAnswer(answers.android, 'Android');
  const device = buildAndroidDevice(android);
  const app = buildAndroidApp(android.app);

  return `{
  platform: 'android',
  timeout: ${answers.timeout},
  artifacts: {
    screenshot: ${quote(answers.artifacts.screenshot)},
    video: ${quote(answers.artifacts.video)}
  },
  device: ${device},
  app: ${app}
}`;
}

function buildIosAsturConfig(answers: InitAnswers): string {
  const ios = requireAnswer(answers.ios, 'iOS');
  const device = buildIosDevice(ios);
  const app = buildIosApp(ios.app);

  return `{
  platform: 'ios',
  timeout: ${answers.timeout},
  artifacts: {
    screenshot: ${quote(answers.artifacts.screenshot)},
    video: ${quote(answers.artifacts.video)}
  },
  device: ${device},
  app: ${app}
}`;
}

function buildAndroidDevice(android: AndroidAnswers): string {
  if (android.target === 'browserstack') {
    return `{
    cloud: {
      provider: 'browserstack',
      usernameEnv: 'BROWSERSTACK_USERNAME',
      accessKeyEnv: 'BROWSERSTACK_ACCESS_KEY',
      deviceName: ${quote(android.browserStackDeviceName ?? 'Google Pixel 8')},
      osVersion: ${quote(android.browserStackOsVersion ?? '14.0')},
      project: 'Astur',
      build: 'local'
    }
  }`;
  }

  if (android.target === 'real') {
    return android.deviceId
      ? `{ id: ${quote(android.deviceId)} }`
      : `{ kind: 'real' }`;
  }

  return `{
    kind: 'emulator',
    avd: ${quote(android.avd ?? 'Pixel_9_API_35')},
    autoBoot: true,
    headless: false,
    bootTimeout: 120_000
  }`;
}

function buildIosDevice(ios: IosAnswers): string {
  if (ios.target === 'browserstack') {
    return `{
    cloud: {
      provider: 'browserstack',
      usernameEnv: 'BROWSERSTACK_USERNAME',
      accessKeyEnv: 'BROWSERSTACK_ACCESS_KEY',
      deviceName: ${quote(ios.browserStackDeviceName ?? 'iPhone 15')},
      osVersion: ${quote(ios.browserStackOsVersion ?? '17')},
      project: 'Astur',
      build: 'local'
    }
  }`;
  }

  if (ios.target === 'real') {
    return ios.deviceId
      ? `{ id: ${quote(ios.deviceId)} }`
      : `{ kind: 'real' }`;
  }

  return `{
    name: ${quote(ios.simulatorName ?? 'iPhone 16 Pro')}
  }`;
}

function buildAndroidApp(app: AndroidAppAnswers): string {
  if (app.source === 'installed') {
    return objectLiteral({
      packageName: app.packageName,
      activity: app.activity
    });
  }

  if (app.source === 'url') {
    return objectLiteral({
      url: app.url,
      downloadPath: app.downloadPath,
      packageName: app.packageName,
      activity: app.activity
    });
  }

  return objectLiteral({
    path: app.path,
    packageName: app.packageName,
    activity: app.activity
  });
}

function buildIosApp(app: IosAppAnswers): string {
  if (app.source === 'installed') {
    return objectLiteral({ bundleId: app.bundleId });
  }

  return objectLiteral({
    path: app.path,
    bundleId: app.bundleId
  });
}

function buildExampleTest(): string {
  return `import { expect, test } from '@astur/test';

test('app launches', async ({ device }) => {
  await device.app.launch();
  await expect(device.getByText('Welcome')).toBeVisible();
});
`;
}

function buildGitignore(): string {
  return `node_modules/
playwright-report/
test-results/
.env
.env.*
`;
}

function buildSetupReadme(answers: InitAnswers): string {
  const browserStack = [answers.android?.target, answers.ios?.target].includes('browserstack');
  return `# Astur Setup

Generated by \`astur init\`.

## Next Commands

\`\`\`bash
npx astur-mobile doctor
npx astur-mobile test
\`\`\`

## What Was Generated

- \`playwright.config.ts\`: Playwright projects and Astur device/app config.
- \`tests/example.test.ts\`: starter mobile test.
- \`.gitignore\`: default ignored output folders, if one did not already exist.

## Selected Platforms

${answers.platforms.map((platform) => `- ${platform}`).join('\n')}

## Parallel Testing

Astur uses Playwright projects for parallel mobile runs. Each project creates one Astur device session. Parallel execution is supported when every project points at a distinct device, emulator, or simulator.

Examples:

- Android emulator + Android real device: create two projects with different \`device.id\` values.
- Multiple Android emulators: boot each AVD and give each project a unique \`device.id\`, such as \`emulator-5554\` and \`emulator-5556\`.
- Android + iOS: this wizard already generates separate projects when both platforms are selected.

Astur reserves each configured device per Playwright worker and fails fast if another worker tries to control the same target. Keep \`workers\` aligned with the number of available devices, and set \`workers: 1\` inside every project that maps to one physical device.

## Flutter Apps

Astur can test Flutter apps as a black-box native mobile app without using Appium or a Flutter-specific third-party driver. On Android it reads the UI through UIAutomator/accessibility, and on iOS native element support goes through the XCUITest agent boundary.

For reliable Flutter tests, expose stable semantics labels, text, and accessibility identifiers in the app. Astur does not currently inspect the Flutter widget tree, Dart VM service, \`ValueKey\`, or Flutter driver protocol directly.

${browserStack ? `## BrowserStack Note

BrowserStack config was scaffolded, including \`BROWSERSTACK_USERNAME\` and \`BROWSERSTACK_ACCESS_KEY\` environment variable names. Cloud execution is not implemented in the current Astur alpha yet, so this config is a forward-compatible placeholder. Use a local emulator, simulator, or real device for runnable tests today.
` : ''}
`;
}

async function promptAndroid(rl: Interface): Promise<AndroidAnswers> {
  const target = await select<AndroidTarget>(rl, 'Android target?', [
    { label: 'Emulator', value: 'emulator', description: 'Local Android Studio AVD' },
    { label: 'Real device', value: 'real', description: 'USB-connected device with debugging enabled' },
    { label: 'BrowserStack', value: 'browserstack', description: 'Cloud config placeholder' }
  ]);
  const app = await promptAndroidApp(rl);

  if (target === 'emulator') {
    return {
      target,
      avd: await ask(rl, 'Android AVD name', 'Pixel_9_API_35'),
      app
    };
  }

  if (target === 'real') {
    return {
      target,
      deviceId: emptyToUndefined(await ask(rl, 'Android device id from adb devices -l (optional)', '')),
      app
    };
  }

  return {
    target,
    browserStackDeviceName: await ask(rl, 'BrowserStack Android device name', 'Google Pixel 8'),
    browserStackOsVersion: await ask(rl, 'BrowserStack Android OS version', '14.0'),
    app
  };
}

async function promptIos(rl: Interface): Promise<IosAnswers> {
  const target = await select<IosTarget>(rl, 'iOS target?', [
    { label: 'Simulator', value: 'simulator', description: 'Local Xcode simulator' },
    { label: 'Real device', value: 'real', description: 'Apple device connected to macOS' },
    { label: 'BrowserStack', value: 'browserstack', description: 'Cloud config placeholder' }
  ]);
  const app = await promptIosApp(rl);

  if (target === 'simulator') {
    return {
      target,
      simulatorName: await ask(rl, 'iOS simulator name', 'iPhone 16 Pro'),
      app
    };
  }

  if (target === 'real') {
    return {
      target,
      deviceId: emptyToUndefined(await ask(rl, 'iOS device id/UDID (optional)', '')),
      app
    };
  }

  return {
    target,
    browserStackDeviceName: await ask(rl, 'BrowserStack iOS device name', 'iPhone 15'),
    browserStackOsVersion: await ask(rl, 'BrowserStack iOS version', '17'),
    app
  };
}

async function promptAndroidApp(rl: Interface): Promise<AndroidAppAnswers> {
  const source = await select<AndroidAppSource>(rl, 'Android app source?', [
    { label: 'Local APK path', value: 'path' },
    { label: 'Download APK URL at runtime', value: 'url' },
    { label: 'Already installed package/activity', value: 'installed' }
  ]);

  if (source === 'installed') {
    return {
      source,
      packageName: await askRequired(rl, 'Android package name'),
      activity: emptyToUndefined(await ask(rl, 'Android launch activity (optional)', ''))
    };
  }

  const packageName = emptyToUndefined(await ask(rl, 'Android package name (optional; inferred from APK when aapt is available)', ''));
  const activity = emptyToUndefined(await ask(rl, 'Android launch activity (optional)', ''));

  if (source === 'url') {
    return {
      source,
      url: await askRequired(rl, 'APK download URL'),
      downloadPath: emptyToUndefined(await ask(rl, 'APK download path (optional)', '')),
      packageName,
      activity
    };
  }

  return {
    source,
    path: await ask(rl, 'Local APK path', './apps/demo.apk'),
    packageName,
    activity
  };
}

async function promptIosApp(rl: Interface): Promise<IosAppAnswers> {
  const source = await select<IosAppSource>(rl, 'iOS app source?', [
    { label: 'Local .app path', value: 'path' },
    { label: 'Already installed bundle id', value: 'installed' }
  ]);
  const bundleId = await askRequired(rl, 'iOS bundle id');

  if (source === 'installed') {
    return { source, bundleId };
  }

  return {
    source,
    path: await ask(rl, 'Local .app path', './apps/Demo.app'),
    bundleId
  };
}

async function select<T extends string>(rl: Interface, question: string, choices: Array<Choice<T>>): Promise<T> {
  output.write(`\n${question}\n`);
  for (const [index, choice] of choices.entries()) {
    const suffix = choice.description ? ` - ${choice.description}` : '';
    output.write(`  ${index + 1}. ${choice.label}${suffix}\n`);
  }

  while (true) {
    const answer = (await rl.question(`Choose 1-${choices.length} [1]: `)).trim();
    const index = answer ? Number(answer) - 1 : 0;
    if (Number.isInteger(index) && choices[index]) {
      return choices[index].value;
    }

    output.write(`Please choose a number between 1 and ${choices.length}.\n`);
  }
}

async function yesNo(rl: Interface, question: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}]: `)).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }

  return ['y', 'yes'].includes(answer);
}

async function ask(rl: Interface, question: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `);
  return answer.trim() || defaultValue;
}

async function askRequired(rl: Interface, question: string): Promise<string> {
  while (true) {
    const answer = (await rl.question(`${question}: `)).trim();
    if (answer) {
      return answer;
    }

    output.write('This value is required.\n');
  }
}

function projectName(platform: PlatformName, answers: InitAnswers): string {
  if (platform === 'android') {
    return `android-${answers.android?.target ?? 'local'}`;
  }

  return `ios-${answers.ios?.target ?? 'local'}`;
}

function objectLiteral(values: Record<string, string | undefined>): string {
  const entries = Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!entries.length) {
    return '{}';
  }

  return `{\n${entries.map(([key, value]) => `    ${key}: ${quote(value)}`).join(',\n')}\n  }`;
}

function indent(value: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return value.split('\n').map((line, index) => index === 0 ? line : `${padding}${line}`).join('\n');
}

function quote(value: string): string {
  return JSON.stringify(value).replaceAll('"', "'");
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() ? value.trim() : undefined;
}

function requireAnswer<T>(answer: T | undefined, label: string): T {
  if (!answer) {
    throw new Error(`${label} answers were not provided.`);
  }

  return answer;
}
