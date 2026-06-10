import {
  defineConfig as definePlaywrightConfig,
  expect as baseExpect,
  chromium,
  _android,
  type AndroidDevice,
  type Locator,
  type Page,
  test as base,
  type TestInfo,
  type WorkerInfo,
  type PlaywrightTestConfig
} from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAndroidDriver } from '@astur/android';
import {
  by,
  MobileLocator,
  waitFor,
  AsturRuntime,
  type AsturConfig,
  type AsturDevice,
  type Bounds,
  type DeviceInfo,
  type DeviceSelector,
  type MobileElementSnapshot,
  type MobileContextInfo,
  type WaitOptions,
  type RecordingStopOptions,
  type WebViewSelector
} from '@astur/core';
import { createIosDriver } from '@astur/ios';

export {
  by,
  centerOf,
  findElement,
  flattenTree,
  MobileLocator,
  pointInBounds
} from '@astur/core';
export type * from '@astur/core';

export interface AsturFixtures {
  device: AsturDevice;
  asturRuntime: AsturRuntime;
  webview: AsturWebViewFactory;
}

export interface AsturOptions {
  astur: AsturConfig;
}

export type AsturProjectConfig = Omit<NonNullable<PlaywrightTestConfig['projects']>[number], 'use'> & {
  use?: PlaywrightTestConfig['use'] & {
    astur?: AsturConfig;
  };
};

export type AsturPlaywrightConfig = Omit<PlaywrightTestConfig, 'use' | 'projects'> & {
  use?: PlaywrightTestConfig['use'] & {
    astur?: AsturConfig;
  };
  projects?: AsturProjectConfig[];
};

export interface AsturWebView {
  context: MobileContextInfo;
  page: Page;
  close(): Promise<void>;
}

export type AsturWebViewFactory = (selector?: WebViewSelector) => Promise<AsturWebView>;

type AsturExpectedText = string | RegExp;

interface AsturTestFixtures {
  device: AsturDevice;
  webview: AsturWebViewFactory;
}

interface AsturWorkerFixtures extends AsturOptions {
  asturRuntime: AsturRuntime;
  _asturWorkerDevice: AsturDevice;
}

interface AsturAssertionOptions extends WaitOptions {
  exact?: boolean;
  ignoreCase?: boolean;
}

type AsturMatcherResult = Promise<{
  pass: boolean;
  message: () => string;
}>;

export function createDefaultRuntime(): AsturRuntime {
  return new AsturRuntime()
    .register(createAndroidDriver())
    .register(createIosDriver());
}

export function defineConfig(config: AsturPlaywrightConfig): PlaywrightTestConfig {
  return definePlaywrightConfig(config as PlaywrightTestConfig);
}

export const test = base.extend<AsturTestFixtures, AsturWorkerFixtures>({
  astur: [
    {
      platform: 'android',
      device: { kind: 'emulator' },
      timeout: 10_000
    },
    { option: true, scope: 'worker' }
  ],

  asturRuntime: [
    async ({}, use) => {
      await use(createDefaultRuntime());
    },
    { scope: 'worker' }
  ],

  _asturWorkerDevice: [
    async ({ astur, asturRuntime }, use, workerInfo) => {
      const reservation = await acquireDeviceReservation(astur, asturRuntime, workerInfo);
      let device: AsturDevice | undefined;

      try {
        device = await asturRuntime.createDevice(withDefaultWorkerArtifactsDir(reservation.config, workerInfo));
        await use(device);
      } finally {
        try {
          await device?.close();
        } finally {
          await reservation.release();
        }
      }
    },
    { scope: 'worker' }
  ],

  device: async ({ astur, _asturWorkerDevice }, use, testInfo) => {
    const device = _asturWorkerDevice;
    const asturConfig = withDefaultArtifactsDir(astur, testInfo);
    const videoMode = asturConfig.artifacts?.video ?? 'off';
    let recordingStarted = false;

    if (videoMode !== 'off') {
      try {
        await device.startRecording();
        recordingStarted = true;
      } catch (error) {
        if (!isRecordingUnsupported(error)) {
          throw error;
        }

        await testInfo.attach('astur-native-video-skipped', {
          body: error instanceof Error ? error.message : String(error),
          contentType: 'text/plain'
        });
      }
    }

    try {
      await use(device);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      const screenshotMode = asturConfig.artifacts?.screenshot ?? 'off';

      if (shouldAttachScreenshot(screenshotMode, failed)) {
        await attachNativeScreenshot(testInfo, device);
      }

      if (recordingStarted) {
        await attachNativeVideo(testInfo, device, shouldAttachVideo(videoMode, failed));
      }
    }
  },

  webview: async ({ device }, use) => {
    const handles: AsturWebView[] = [];

    try {
      await use(async (selector?: WebViewSelector) => {
        const handle = await connectWebView(device, selector);
        handles.push(handle);
        return handle;
      });
    } finally {
      await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
    }
  }
});

export async function connectWebView(
  device: AsturDevice,
  selector?: WebViewSelector
): Promise<AsturWebView> {
  if (device.deviceInfo.platform === 'android') {
    return connectAndroidWebView(device, selector);
  }

  const endpoint = await device.webViewEndpoint(selector);
  const browser = await chromium.connectOverCDP(endpoint.cdpUrl);
  const browserContext = browser.contexts()[0] ?? await browser.newContext();
  const page = await selectPage(browserContext.pages(), endpoint.context, selector)
    ?? await browserContext.waitForEvent('page', { timeout: selector?.timeout ?? device.capabilities.timeout });

  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);

  return {
    context: endpoint.context,
    page,
    close: async () => {
      await browser.close();
    }
  };
}

async function connectAndroidWebView(
  device: AsturDevice,
  selector?: WebViewSelector
): Promise<AsturWebView> {
  const endpoint = await device.webViewEndpoint(selector);
  const androidDevice = await findPlaywrightAndroidDevice(device);
  androidDevice.setDefaultTimeout(selector?.timeout ?? device.capabilities.timeout);

  const webView = await androidDevice.webView(
    {
      pkg: selector?.packageName ?? endpoint.context.packageName ?? device.capabilities.app?.packageName,
      socketName: endpoint.context.socket
    },
    { timeout: selector?.timeout ?? device.capabilities.timeout }
  );
  const page = await webView.page();
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);

  return {
    context: {
      ...endpoint.context,
      packageName: endpoint.context.packageName ?? webView.pkg()
    },
    page,
    close: async () => {
      await androidDevice.close();
    }
  };
}

async function findPlaywrightAndroidDevice(device: AsturDevice): Promise<AndroidDevice> {
  const devices = await _android.devices();
  const selected = devices.find((candidate) => candidate.serial() === device.deviceInfo.id);

  await Promise.all(
    devices
      .filter((candidate) => candidate !== selected)
      .map((candidate) => candidate.close().catch(() => undefined))
  );

  if (!selected) {
    throw new Error(`Playwright could not attach to Android device ${device.deviceInfo.id}.`);
  }

  return selected;
}

async function selectPage(
  pages: Page[],
  context: MobileContextInfo,
  selector?: WebViewSelector
): Promise<Page | undefined> {
  for (const page of pages) {
    if (selector?.url && matchesText(page.url(), selector.url)) {
      return page;
    }

    if (context.url && page.url() === context.url) {
      return page;
    }

    if (selector?.title && matchesText(await page.title().catch(() => ''), selector.title)) {
      return page;
    }
  }

  return pages[0];
}

function matchesText(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual.includes(expected);
}

export const expect = baseExpect.extend({
  async toBeVisible(actual: unknown, options?: { timeout?: number }) {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightAssertion(
        'Expected Playwright locator to be visible.',
        () => actual.waitFor({ state: 'visible', timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return {
        pass: false,
        message: () => 'Expected a Playwright Locator or Astur MobileLocator.'
      };
    }

    const pass = await actual.isVisible({ timeout: options?.timeout });

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${actual.toString()} not to be visible.`
          : `Expected ${actual.toString()} to be visible.`
    };
  },

  async toBeHidden(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightAssertion(
        'Expected Playwright locator to be hidden.',
        () => actual.waitFor({ state: 'hidden', timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeHidden');
    }

    return runMobileAssertion(
      actual,
      () => actual.waitForHidden(options),
      `Expected ${actual.toString()} to be hidden.`,
      `Expected ${actual.toString()} not to be hidden.`
    );
  },

  async toExist(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightAssertion(
        'Expected Playwright locator to be attached.',
        () => actual.waitFor({ state: 'attached', timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toExist');
    }

    return runMobileSnapshotAssertion(
      actual,
      () => true,
      options,
      `Expected ${actual.toString()} to exist.`,
      `Expected ${actual.toString()} not to exist.`
    );
  },

  async toBeEnabled(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightPredicateAssertion(
        () => actual.isEnabled({ timeout: 1_000 }),
        options,
        'Expected Playwright locator to be enabled.',
        'Expected Playwright locator not to be enabled.'
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeEnabled');
    }

    return runMobileSnapshotAssertion(
      actual,
      (snapshot) => snapshot.enabled,
      options,
      `Expected ${actual.toString()} to be enabled.`,
      `Expected ${actual.toString()} not to be enabled.`
    );
  },

  async toBeDisabled(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightPredicateAssertion(
        () => actual.isDisabled({ timeout: 1_000 }),
        options,
        'Expected Playwright locator to be disabled.',
        'Expected Playwright locator not to be disabled.'
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeDisabled');
    }

    return runMobileSnapshotAssertion(
      actual,
      (snapshot) => !snapshot.enabled,
      options,
      `Expected ${actual.toString()} to be disabled.`,
      `Expected ${actual.toString()} not to be disabled.`
    );
  },

  async toBeSelected(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeSelected');
    }

    return runMobileSnapshotAssertion(
      actual,
      (snapshot) => snapshot.selected === true,
      options,
      `Expected ${actual.toString()} to be selected.`,
      `Expected ${actual.toString()} not to be selected.`
    );
  },

  async toBeFocused(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightPredicateAssertion(
        () => actual.evaluate((element) => element === element.ownerDocument.activeElement, { timeout: 1_000 }),
        options,
        'Expected Playwright locator to be focused.',
        'Expected Playwright locator not to be focused.'
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeFocused');
    }

    return runMobileSnapshotAssertion(
      actual,
      (snapshot) => snapshot.focused === true,
      options,
      `Expected ${actual.toString()} to be focused.`,
      `Expected ${actual.toString()} not to be focused.`
    );
  },

  async toHaveText(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightValueAssertion(
        actual,
        'text',
        expected,
        { ...options, exact: options?.exact ?? true },
        `Expected Playwright locator to have text ${formatExpected(expected)}.`,
        `Expected Playwright locator not to have text ${formatExpected(expected)}.`
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveText');
    }

    return runMobileValueAssertion(
      actual,
      'text',
      expected,
      { ...options, exact: options?.exact ?? true },
      `Expected ${actual.toString()} to have text ${formatExpected(expected)}.`,
      `Expected ${actual.toString()} not to have text ${formatExpected(expected)}.`
    );
  },

  async toContainText(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightValueAssertion(
        actual,
        'text',
        expected,
        { ...options, exact: false },
        `Expected Playwright locator to contain text ${formatExpected(expected)}.`,
        `Expected Playwright locator not to contain text ${formatExpected(expected)}.`
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toContainText');
    }

    return runMobileValueAssertion(
      actual,
      'text',
      expected,
      { ...options, exact: false },
      `Expected ${actual.toString()} to contain text ${formatExpected(expected)}.`,
      `Expected ${actual.toString()} not to contain text ${formatExpected(expected)}.`
    );
  },

  async toHaveValue(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightValueAssertion(
        actual,
        'value',
        expected,
        { ...options, exact: options?.exact ?? true },
        `Expected Playwright locator to have value ${formatExpected(expected)}.`,
        `Expected Playwright locator not to have value ${formatExpected(expected)}.`
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveValue');
    }

    return runMobileValueAssertion(
      actual,
      'value',
      expected,
      { ...options, exact: options?.exact ?? true },
      `Expected ${actual.toString()} to have value ${formatExpected(expected)}.`,
      `Expected ${actual.toString()} not to have value ${formatExpected(expected)}.`
    );
  },

  async toHaveLabel(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveLabel');
    }

    return runMobileValueAssertion(
      actual,
      'label',
      expected,
      { ...options, exact: options?.exact ?? true },
      `Expected ${actual.toString()} to have label ${formatExpected(expected)}.`,
      `Expected ${actual.toString()} not to have label ${formatExpected(expected)}.`
    );
  },

  async toHaveType(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveType');
    }

    return runMobileValueAssertion(
      actual,
      'type',
      expected,
      { ...options, exact: options?.exact ?? true },
      `Expected ${actual.toString()} to have type ${formatExpected(expected)}.`,
      `Expected ${actual.toString()} not to have type ${formatExpected(expected)}.`
    );
  },

  async toHaveBounds(
    actual: unknown,
    expected: Partial<Bounds>,
    options?: WaitOptions
  ): AsturMatcherResult {
    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveBounds');
    }

    return runMobileSnapshotAssertion(
      actual,
      (snapshot) => matchesBounds(snapshot.bounds, expected),
      options,
      `Expected ${actual.toString()} to have bounds ${JSON.stringify(expected)}.`,
      `Expected ${actual.toString()} not to have bounds ${JSON.stringify(expected)}.`
    );
  }
});

function isPlaywrightLocator(actual: unknown): actual is Locator {
  return typeof actual === 'object'
    && actual !== null
    && 'waitFor' in actual
    && typeof (actual as { waitFor?: unknown }).waitFor === 'function';
}

async function runPlaywrightAssertion(
  failureMessage: string,
  assertion: () => Promise<unknown>,
  negatedMessage = failureMessage.replace(' to ', ' not to ')
): AsturMatcherResult {
  try {
    await assertion();
    return {
      pass: true,
      message: () => negatedMessage
    };
  } catch (error) {
    return {
      pass: false,
      message: () => formatAssertionFailure(error, failureMessage)
    };
  }
}

async function runPlaywrightPredicateAssertion(
  predicate: () => Promise<boolean>,
  options: WaitOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  return runPlaywrightAssertion(
    failureMessage,
    () => waitFor(
      async () => await predicate(),
      {
        timeout: options?.timeout,
        interval: options?.interval,
        message: failureMessage
      }
    ),
    negatedMessage
  );
}

async function runPlaywrightValueAssertion(
  locator: Locator,
  field: 'text' | 'value',
  expected: AsturExpectedText,
  options: AsturAssertionOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  return runPlaywrightAssertion(
    failureMessage,
    () => waitFor(
      async () => {
        const actual = field === 'value'
          ? await readPlaywrightValue(locator)
          : await locator.textContent({ timeout: 1_000 });

        return matchesExpectedText(actual ?? undefined, expected, options);
      },
      {
        timeout: options?.timeout,
        interval: options?.interval,
        message: failureMessage
      }
    ),
    negatedMessage
  );
}

async function readPlaywrightValue(locator: Locator): Promise<string | null> {
  return locator.inputValue({ timeout: 1_000 })
    .catch(() => locator.getAttribute('value', { timeout: 1_000 }));
}

async function runMobileAssertion(
  _locator: MobileLocator,
  assertion: () => Promise<unknown>,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  try {
    await assertion();
    return {
      pass: true,
      message: () => negatedMessage
    };
  } catch (error) {
    return {
      pass: false,
      message: () => formatAssertionFailure(error, failureMessage)
    };
  }
}

async function runMobileSnapshotAssertion(
  locator: MobileLocator,
  predicate: (snapshot: MobileElementSnapshot) => boolean,
  options: WaitOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  return runMobileAssertion(
    locator,
    () => locator.waitForSnapshot(predicate, options),
    failureMessage,
    negatedMessage
  );
}

async function runMobileValueAssertion(
  locator: MobileLocator,
  field: 'label' | 'text' | 'type' | 'value',
  expected: AsturExpectedText,
  options: AsturAssertionOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  return runMobileSnapshotAssertion(
    locator,
    (snapshot) => matchesExpectedText(snapshot[field], expected, options),
    options,
    failureMessage,
    negatedMessage
  );
}

function unsupportedActual(matcherName: string): { pass: false; message: () => string } {
  return {
    pass: false,
    message: () => `Expected a Playwright Locator or Astur MobileLocator for ${matcherName}.`
  };
}

function matchesExpectedText(
  actual: string | undefined,
  expected: AsturExpectedText,
  options: AsturAssertionOptions | undefined
): boolean {
  if (actual === undefined) {
    return false;
  }

  const normalizedActual = options?.ignoreCase ? actual.toLowerCase() : actual;

  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    const pass = expected.test(actual);
    expected.lastIndex = 0;
    return pass;
  }

  const normalizedExpected = options?.ignoreCase ? expected.toLowerCase() : expected;
  return options?.exact === false
    ? normalizedActual.includes(normalizedExpected)
    : normalizedActual === normalizedExpected;
}

function matchesBounds(actual: Bounds, expected: Partial<Bounds>): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key as keyof Bounds] === value);
}

function formatExpected(expected: AsturExpectedText): string {
  return expected instanceof RegExp ? expected.toString() : JSON.stringify(expected);
}

function formatAssertionFailure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isRecordingUnsupported(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (
      (error as { code?: string }).code === 'IOS_REAL_DEVICE_RECORDING_NOT_SUPPORTED'
      || (error as { code?: string }).code === 'RECORDING_NOT_SUPPORTED'
    )
  );
}

function shouldAttachScreenshot(mode: NonNullable<AsturConfig['artifacts']>['screenshot'], failed: boolean): boolean {
  return mode === 'on' || (mode === 'only-on-failure' && failed);
}

function withDefaultArtifactsDir(astur: AsturConfig, testInfo: TestInfo): AsturConfig {
  if (astur.artifactsDir) {
    return astur;
  }

  return {
    ...astur,
    artifactsDir: testInfo.outputPath('astur')
  };
}

function withDefaultWorkerArtifactsDir(astur: AsturConfig, workerInfo: WorkerInfo): AsturConfig {
  if (astur.artifactsDir) {
    return astur;
  }

  return {
    ...astur,
    artifactsDir: join(
      workerInfo.project.outputDir,
      `.astur-worker-${pathSafeName(workerInfo.project.name || 'default')}-${workerInfo.workerIndex}`
    )
  };
}

function pathSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

interface DeviceReservation {
  config: AsturConfig;
  release(): Promise<void>;
}

async function acquireDeviceReservation(
  astur: AsturConfig,
  asturRuntime: AsturRuntime,
  workerInfo: WorkerInfo
): Promise<DeviceReservation> {
  const candidates = await deviceReservationCandidates(astur, asturRuntime, workerInfo);
  const blockedKeys: string[] = [];

  for (const candidate of candidates) {
    const release = await tryAcquireDeviceReservation(candidate, workerInfo);
    if (release) {
      return {
        config: candidate,
        release
      };
    }

    blockedKeys.push(deviceReservationKey(candidate));
  }

  const keyList = blockedKeys.length > 0 ? blockedKeys.join(', ') : deviceReservationKey(astur);
  throw new Error(
    [
      `Astur could not reserve an available mobile device for ${astur.platform}.`,
      `Checked: ${keyList}.`,
      'Native mobile devices can run only one active app automation session at a time.',
      'Use one Playwright project per physical device, or leave device.id unset so Astur can choose a free matching device from the pool.',
      `Current project: ${workerInfo.project.name || 'default'}, worker: ${workerInfo.workerIndex}.`
    ].join(' ')
  );
}

async function tryAcquireDeviceReservation(astur: AsturConfig, workerInfo: WorkerInfo): Promise<(() => Promise<void>) | undefined> {
  const key = deviceReservationKey(astur);
  const root = join(tmpdir(), 'astur-device-locks');
  const lockDir = join(root, pathSafeName(key));
  const ownerPath = join(lockDir, 'owner.json');

  await mkdir(root, { recursive: true });

  try {
    await mkdir(lockDir);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const owner = await readReservationOwner(ownerPath);
    if (owner?.pid && !isProcessAlive(owner.pid)) {
      await rm(lockDir, { recursive: true, force: true });
      await mkdir(lockDir);
    } else {
      return undefined;
    }
  }

  await writeFile(ownerPath, JSON.stringify({
    key,
    pid: process.pid,
    projectName: workerInfo.project.name || 'default',
    workerIndex: workerInfo.workerIndex,
    createdAt: new Date().toISOString()
  }, null, 2));

  return async () => {
    await rm(lockDir, { recursive: true, force: true });
  };
}

async function deviceReservationCandidates(
  astur: AsturConfig,
  asturRuntime: AsturRuntime,
  workerInfo: WorkerInfo
): Promise<AsturConfig[]> {
  if (!usesLooseDeviceSelector(astur.device)) {
    return [astur];
  }

  const devices = (await asturRuntime.listDevices(astur.platform))
    .filter((device) => matchesDeviceSelector(device, astur.device))
    .filter(isReservableDevice)
    .sort(compareDeviceInfo);

  if (devices.length === 0) {
    return [astur];
  }

  const start = workerInfo.workerIndex % devices.length;
  const ordered = [...devices.slice(start), ...devices.slice(0, start)];

  return ordered.map((device) => ({
    ...astur,
    device: {
      ...astur.device,
      id: device.id,
      kind: device.kind
    }
  }));
}

function usesLooseDeviceSelector(selector: DeviceSelector | undefined): boolean {
  return !selector?.id && !selector?.name && !selector?.avd && !selector?.cloud;
}

function matchesDeviceSelector(device: DeviceInfo, selector: DeviceSelector | undefined): boolean {
  if (selector?.kind && device.kind !== selector.kind) {
    return false;
  }

  return true;
}

function isReservableDevice(device: DeviceInfo): boolean {
  return device.state === 'online' || device.state === 'booted';
}

function compareDeviceInfo(left: DeviceInfo, right: DeviceInfo): number {
  return `${left.platform}:${left.kind}:${left.name}:${left.id}`
    .localeCompare(`${right.platform}:${right.kind}:${right.name}:${right.id}`);
}

function deviceReservationKey(astur: AsturConfig): string {
  const device = astur.device ?? {};
  const selector = device.id
    ? `id=${device.id}`
    : device.avd
      ? `avd=${device.avd}`
      : device.name
        ? `name=${String(device.name)}`
        : device.kind
          ? `kind=${device.kind}`
          : 'auto';

  return `${astur.platform}:${selector}`;
}

async function readReservationOwner(path: string): Promise<{
  pid?: number;
  projectName?: string;
  workerIndex?: number;
} | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as {
      pid?: number;
      projectName?: string;
      workerIndex?: number;
    };
  } catch {
    return undefined;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shouldAttachVideo(mode: NonNullable<AsturConfig['artifacts']>['video'], failed: boolean): boolean {
  return mode === 'on' || (mode === 'retain-on-failure' && failed);
}

async function attachNativeScreenshot(
  testInfo: TestInfo,
  device: AsturDevice
): Promise<void> {
  try {
    await testInfo.attach('astur-native-screenshot', {
      body: await device.screenshot(),
      contentType: 'image/png'
    });
  } catch {
    // Artifact capture must not hide the original test result.
  }
}

async function attachNativeVideo(
  testInfo: TestInfo,
  device: AsturDevice,
  attach: boolean
): Promise<void> {
  try {
    const video = await device.stopRecording({ discard: !attach } satisfies RecordingStopOptions);
    if (attach && video?.length) {
      await testInfo.attach('astur-native-video', {
        body: video,
        contentType: 'video/mp4'
      });
    }
  } catch {
    // Artifact capture must not hide the original test result.
  }
}
