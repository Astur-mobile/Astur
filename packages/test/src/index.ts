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
import { dirname, join } from 'node:path';
import { createAndroidDriver } from '@astur-mobile/android';
import {
  by,
  checkedStateOf,
  delay,
  MobileLocator,
  subtreeText,
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
} from '@astur-mobile/core';
import { createIosDriver } from '@astur-mobile/ios';
import { acquireDeviceReservation, pathSafeName } from './reservation.js';
import {
  comparePng,
  describeDifference,
  resolveSnapshotAction,
  type ScreenshotCompareOptions
} from './screenshot.js';

export {
  by,
  centerOf,
  // Re-exported so specs stop hand-rolling a private copy. Prefer an
  // auto-retrying assertion (`expect`/`expect.poll`) over a fixed sleep; reach
  // for this only when the wait is a real precondition, such as outlasting a
  // platform gesture-recognition window before the next gesture.
  delay,
  findElement,
  flattenTree,
  MobileLocator,
  placeholderOf,
  pointInBounds
} from '@astur-mobile/core';
export type * from '@astur-mobile/core';

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
        await reservation.claimDevice(device.deviceInfo.id);
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

    // Start each test with an empty capture buffer. The device is worker-scoped
    // and shared across tests, so without this a test could assert on requests
    // its predecessor made — and the buffer would grow for the whole run.
    // Best-effort: a session with no network backend has nothing to clear.
    await device.network.clear().catch(() => undefined);

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

      // Close the browser tab this test opened, matching how Playwright hands
      // each test its own page. The device is worker-scoped and shared, so
      // without this a tab — and the DOM, history and scroll position on it —
      // would outlive the test that opened it. Best-effort: a session with no
      // browser has nothing to close.
      await device.browser.close().catch(() => undefined);
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
  await wakeAndroidWebViewRenderer(page);
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

/**
 * An Android WebView embedded in a native shell (e.g. a Flutter platform view)
 * renders to an offscreen surface, so its renderer often treats the page as
 * hidden/unfocused and throttles `requestAnimationFrame` — sometimes stalling it
 * entirely. Playwright's actionability checks ("stable") sample layout across
 * animation frames, so a throttled rAF makes otherwise-valid clicks intermittently
 * time out. Mark the page active and focused so rAF runs at full rate. This reduces
 * the throttle but does not fully eliminate it for an offscreen surface, so
 * Playwright actions on `web.page` may still need `{ force: true }`. The
 * engine-agnostic `device.webContext()` avoids the problem entirely by acting
 * in-page rather than through rAF-gated actionability.
 */
async function wakeAndroidWebViewRenderer(page: Page): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  const session = await page.context().newCDPSession(page).catch(() => undefined);
  if (!session) {
    return;
  }

  await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  await session.detach().catch(() => undefined);
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
  async toBeVisible(actual: unknown, options?: WaitOptions) {
    if (isPlaywrightLocator(actual)) {
      if (this.isNot) {
        return runNegatedAssertion(
          () => actual.isVisible(),
          options,
          PLAYWRIGHT_ASSERTION_TIMEOUT,
          'Expected Playwright locator not to be visible.'
        );
      }

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

    if (this.isNot) {
      return runNegatedAssertion(
        async () => (await actual.query())?.visible === true,
        options,
        actual.defaultTimeout,
        `Expected ${actual.toString()} not to be visible.`
      );
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
      if (this.isNot) {
        return runNegatedAssertion(
          () => actual.isHidden(),
          options,
          PLAYWRIGHT_ASSERTION_TIMEOUT,
          'Expected Playwright locator not to be hidden.'
        );
      }

      return runPlaywrightAssertion(
        'Expected Playwright locator to be hidden.',
        () => actual.waitFor({ state: 'hidden', timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeHidden');
    }

    if (this.isNot) {
      return runNegatedAssertion(
        async () => {
          const match = await actual.query();
          return !match || !match.visible;
        },
        options,
        actual.defaultTimeout,
        `Expected ${actual.toString()} not to be hidden.`
      );
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
      if (this.isNot) {
        return runNegatedAssertion(
          async () => (await actual.count()) > 0,
          options,
          PLAYWRIGHT_ASSERTION_TIMEOUT,
          'Expected Playwright locator not to be attached.'
        );
      }

      return runPlaywrightAssertion(
        'Expected Playwright locator to be attached.',
        () => actual.waitFor({ state: 'attached', timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toExist');
    }

    if (this.isNot) {
      return runNegatedAssertion(
        async () => (await actual.query()) !== undefined,
        options,
        actual.defaultTimeout,
        `Expected ${actual.toString()} not to exist.`
      );
    }

    return runMobileSnapshotAssertion(
      this.isNot,
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
        this.isNot,
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
      this.isNot,
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
        this.isNot,
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
      this.isNot,
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
      this.isNot,
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
        this.isNot,
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
      this.isNot,
      actual,
      (snapshot) => snapshot.focused === true,
      options,
      `Expected ${actual.toString()} to be focused.`,
      `Expected ${actual.toString()} not to be focused.`
    );
  },

  async toBeChecked(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightPredicateAssertion(
        this.isNot,
        () => actual.isChecked({ timeout: 1_000 }),
        options,
        'Expected Playwright locator to be checked.',
        'Expected Playwright locator not to be checked.'
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeChecked');
    }

    return runMobileSnapshotAssertion(
      this.isNot,
      actual,
      (snapshot) => checkedStateOf(snapshot) === true,
      options,
      `Expected ${actual.toString()} to be checked.`,
      `Expected ${actual.toString()} not to be checked.`
    );
  },

  async toBeEmpty(actual: unknown, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightPredicateAssertion(
        this.isNot,
        async () => ((await actual.textContent({ timeout: 1_000 })) ?? '').trim().length === 0,
        options,
        'Expected Playwright locator to be empty.',
        'Expected Playwright locator not to be empty.'
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toBeEmpty');
    }

    return runMobileSnapshotAssertion(
      this.isNot,
      actual,
      (snapshot) => subtreeText(snapshot).trim().length === 0,
      options,
      `Expected ${actual.toString()} to be empty.`,
      `Expected ${actual.toString()} not to be empty.`
    );
  },

  async toHaveText(
    actual: unknown,
    expected: AsturExpectedText,
    options?: AsturAssertionOptions
  ): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      return runPlaywrightValueAssertion(
        this.isNot,
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
      this.isNot,
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
        this.isNot,
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
      this.isNot,
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
        this.isNot,
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
      this.isNot,
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
      this.isNot,
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
      this.isNot,
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
      this.isNot,
      actual,
      (snapshot) => matchesBounds(snapshot.bounds, expected),
      options,
      `Expected ${actual.toString()} to have bounds ${JSON.stringify(expected)}.`,
      `Expected ${actual.toString()} not to have bounds ${JSON.stringify(expected)}.`
    );
  },

  async toHaveCount(actual: unknown, expected: number, options?: WaitOptions): AsturMatcherResult {
    if (isPlaywrightLocator(actual)) {
      if (this.isNot) {
        return runNegatedAssertion(
          async () => (await actual.count()) === expected,
          options,
          PLAYWRIGHT_ASSERTION_TIMEOUT,
          `Expected Playwright locator not to have count ${expected}.`
        );
      }

      return runPlaywrightAssertion(
        `Expected Playwright locator to have count ${expected}.`,
        () => baseExpect(actual).toHaveCount(expected, { timeout: options?.timeout })
      );
    }

    if (!(actual instanceof MobileLocator)) {
      return unsupportedActual('toHaveCount');
    }

    if (this.isNot) {
      return runNegatedAssertion(
        async () => (await actual.count()) === expected,
        options,
        actual.defaultTimeout,
        `Expected ${actual.toString()} not to have count ${expected}.`
      );
    }

    let lastCount: number | undefined;

    try {
      await waitFor(
        async () => {
          lastCount = await actual.count();
          return lastCount === expected ? true : undefined;
        },
        {
          ...options,
          message: options?.message ?? `Timed out waiting for ${actual.toString()} to have count ${expected}`
        }
      );
      return {
        pass: true,
        message: () => `Expected ${actual.toString()} not to have count ${expected}.`
      };
    } catch {
      return {
        pass: false,
        message: () =>
          `Expected ${actual.toString()} to have count ${expected}, but last saw ${lastCount ?? 0}.`
      };
    }
  },

  /**
   * Compares the screen, or one element, against a stored baseline image.
   *
   * Playwright's own `toHaveScreenshot` needs a `Page`, which a native session
   * does not have. This is the native equivalent: it captures through Astur,
   * masks what is allowed to change, and keeps one baseline per device.
   */
  async toHaveScreenshot(
    actual: unknown,
    name: string,
    options: ScreenshotAssertionOptions = {}
  ): AsturMatcherResult {
    if (!isScreenshotTarget(actual)) {
      return unsupportedActual('toHaveScreenshot');
    }

    if (!name?.endsWith('.png')) {
      return {
        pass: false,
        message: () => 'toHaveScreenshot() needs a baseline file name ending in .png, e.g. "home.png".'
      };
    }

    const info = testInfo();
    const image = await captureStableScreenshot(actual, options);
    const baseline = join(
      info.snapshotDir,
      await actual.screenshotKey(),
      name
    );

    const existing = await readFile(baseline).catch(() => undefined);
    const updateMode = info.config.updateSnapshots;
    const writeBaseline = async () => {
      await mkdir(dirname(baseline), { recursive: true });
      await writeFile(baseline, image);
    };

    if (!existing) {
      if (resolveSnapshotAction(false, updateMode, false) === 'fail-missing') {
        return {
          pass: false,
          message: () =>
            `No baseline at ${baseline}, and --update-snapshots=none forbids writing one.\n`
            + 'Re-run without that flag to record it.'
        };
      }

      await writeBaseline();

      // Writing a first baseline is not a passing assertion. A run that silently
      // creates one has asserted nothing, and on CI that turns a missing
      // baseline into a green test that never compared anything.
      return {
        pass: false,
        message: () =>
          `No baseline yet, so this run wrote one: ${baseline}\n`
          + 'Check the image looks right, commit it, and re-run.'
      };
    }

    const result = comparePng(existing, image, options);

    // Rewriting is a pass: the run was explicitly told the change is intended.
    if (resolveSnapshotAction(true, updateMode, result.pass) === 'rewrite') {
      await writeBaseline();
      return { pass: true, message: () => `Baseline updated: ${baseline}` };
    }

    if (!result.pass) {
      // These exact suffixes are what the HTML report keys off to render its
      // image-diff viewer — the expected/actual/diff toggle with a slider.
      // Name them anything else and the same three images show up as unrelated
      // attachments you have to open one at a time.
      const base = name.replace(/\.png$/, '');
      await info.attach(`${base}-expected.png`, { body: existing, contentType: 'image/png' });
      await info.attach(`${base}-actual.png`, { body: image, contentType: 'image/png' });
      if (result.diff) {
        await info.attach(`${base}-diff.png`, { body: result.diff, contentType: 'image/png' });
      }
    }

    return {
      pass: result.pass,
      message: () =>
        result.pass
          ? `Expected ${name} not to match its baseline, but ${describeDifference(result)}.`
          : `Screenshot ${name} does not match its baseline: ${describeDifference(result)}.\n`
            + `Baseline: ${baseline}\n`
            + 'Re-run with --update-snapshots once you have confirmed the change is intended.'
    };
  }
});

export interface ScreenshotAssertionOptions extends ScreenshotCompareOptions {
  /** Regions allowed to differ — a clock, a live counter, an avatar. */
  mask?: MobileLocator[];
  /**
   * How long to wait for the screen to stop changing before comparing.
   * Defaults to 1500ms; set 0 to capture immediately.
   */
  stabilizeTimeout?: number;
}

interface ScreenshotTarget {
  screenshot(options?: { mask?: MobileLocator[] }): Promise<Buffer>;
  screenshotKey(): Promise<string>;
}

function isScreenshotTarget(actual: unknown): actual is ScreenshotTarget {
  return typeof actual === 'object'
    && actual !== null
    && typeof (actual as ScreenshotTarget).screenshot === 'function'
    && typeof (actual as ScreenshotTarget).screenshotKey === 'function';
}

/**
 * Captures until two consecutive captures are identical, so an animation still
 * settling cannot be recorded as the baseline or compared against one.
 *
 * Without this, visual tests on mobile fail intermittently for reasons that have
 * nothing to do with the change under test — a ripple, a fade, a spinner.
 */
async function captureStableScreenshot(
  target: ScreenshotTarget,
  options: ScreenshotAssertionOptions
): Promise<Buffer> {
  const budget = options.stabilizeTimeout ?? 1_500;
  let previous = await target.screenshot({ mask: options.mask });

  if (budget <= 0) {
    return previous;
  }

  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    await delay(250);
    const current = await target.screenshot({ mask: options.mask });
    if (current.equals(previous)) {
      return current;
    }

    previous = current;
  }

  return previous;
}

function testInfo(): TestInfo {
  const info = base.info();
  if (!info) {
    throw new Error('toHaveScreenshot() can only be used inside a test.');
  }

  return info;
}

function isPlaywrightLocator(actual: unknown): actual is Locator {
  return typeof actual === 'object'
    && actual !== null
    && !(actual instanceof MobileLocator)
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
  isNot: boolean,
  predicate: () => Promise<boolean>,
  options: WaitOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  if (isNot) {
    return runNegatedAssertion(predicate, options, PLAYWRIGHT_ASSERTION_TIMEOUT, negatedMessage);
  }

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
  isNot: boolean,
  locator: Locator,
  field: 'text' | 'value',
  expected: AsturExpectedText,
  options: AsturAssertionOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  const read = async () => field === 'value'
    ? await readPlaywrightValue(locator)
    : await locator.textContent({ timeout: 1_000 });

  if (isNot) {
    return runNegatedAssertion(
      async () => matchesExpectedText((await read()) ?? undefined, expected, options),
      options,
      PLAYWRIGHT_ASSERTION_TIMEOUT,
      negatedMessage
    );
  }

  return runPlaywrightAssertion(
    failureMessage,
    () => waitFor(
      async () => matchesExpectedText((await read()) ?? undefined, expected, options),
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
  isNot: boolean,
  locator: MobileLocator,
  predicate: (snapshot: MobileElementSnapshot) => boolean,
  options: WaitOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  if (isNot) {
    return runNegatedAssertion(
      async () => {
        const match = await locator.query();
        return match ? predicate(match) : ABSENT;
      },
      options,
      locator.defaultTimeout,
      negatedMessage
    );
  }

  return runMobileAssertion(
    locator,
    () => locator.waitForSnapshot(predicate, options),
    failureMessage,
    negatedMessage
  );
}

async function runMobileValueAssertion(
  isNot: boolean,
  locator: MobileLocator,
  field: 'label' | 'text' | 'type' | 'value',
  expected: AsturExpectedText,
  options: AsturAssertionOptions | undefined,
  failureMessage: string,
  negatedMessage: string
): AsturMatcherResult {
  return runMobileSnapshotAssertion(
    isNot,
    locator,
    (snapshot) => matchesExpectedText(snapshot[field], expected, options),
    options,
    failureMessage,
    negatedMessage
  );
}

/** A reading taken while the element was not on screen at all. */
const ABSENT = Symbol('absent');

/** Default for `.not` on a Playwright locator, matching the positive predicate path. */
const PLAYWRIGHT_ASSERTION_TIMEOUT = 10_000;

type NegatedReading = { value: boolean | typeof ABSENT } | { error: unknown };

/**
 * The `.not` side of a retrying assertion.
 *
 * Negation has to change what is polled for, "until the condition is false",
 * not invert the outcome of waiting for it to become true. Inverting reads a
 * timeout as success: `.not.toBeVisible()` would fail at once for an element
 * that was about to disappear, pass only after the full timeout, and pass
 * outright when the device had stopped answering.
 *
 * Only a clean reading can pass. A probe that throws (the device or page could
 * not be read) is retried, and if the deadline arrives on an error the
 * assertion fails whichever way it was written. An absent element satisfies
 * neither side of an attribute assertion, as in Playwright; matchers where
 * absence has a meaning (visible, hidden, exist) answer the probe themselves.
 *
 * Returns the result Playwright expects under `.not`: `pass: false` succeeds.
 */
async function runNegatedAssertion(
  probe: () => Promise<boolean | typeof ABSENT>,
  options: WaitOptions | undefined,
  defaultTimeout: number,
  negatedMessage: string
): AsturMatcherResult {
  const timeout = options?.timeout ?? defaultTimeout;
  const interval = options?.interval ?? 250;
  const startedAt = Date.now();
  let last: NegatedReading | undefined;

  while (Date.now() - startedAt <= timeout) {
    try {
      const value = await probe();
      if (value === false) {
        return { pass: false, message: () => negatedMessage };
      }
      last = { value };
    } catch (error) {
      last = { error };
    }

    await delay(interval);
  }

  return { pass: true, message: () => describeNegatedFailure(negatedMessage, last) };
}

function describeNegatedFailure(negatedMessage: string, last: NegatedReading | undefined): string {
  if (last && 'error' in last) {
    return `${negatedMessage} The last read failed: ${formatAssertionFailure(last.error, 'unknown error')}`;
  }

  if (last?.value === ABSENT) {
    return `${negatedMessage} The element was not found.`;
  }

  return negatedMessage;
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
  } catch (error) {
    // Artifact capture must never mask the original test result — but failing
    // silently leaves a failed test with no screenshot and no way to tell
    // whether capture was disabled, unsupported, or broken. Record the reason.
    await testInfo.attach('astur-native-screenshot-error', {
      body: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      contentType: 'text/plain'
    }).catch(() => undefined);
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
