import { describe, it, vi } from 'vitest';
import { AsturError } from '@astur-mobile/core';
import {
  MobileLocator,
  by,
  expect as asturExpect,
  type MobileElementSnapshot,
  type PlatformSession
} from '@astur-mobile/test';

const tree: MobileElementSnapshot = {
  type: 'android.root',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 300, height: 600 },
  children: [
    {
      id: 'dev.astur:id/title',
      text: 'Welcome',
      value: 'Welcome',
      type: 'android.widget.TextView',
      enabled: true,
      visible: true,
      bounds: { x: 10, y: 20, width: 200, height: 50 },
      children: []
    },
    {
      label: 'Sign in',
      type: 'android.widget.Button',
      enabled: false,
      visible: true,
      selected: true,
      focused: true,
      bounds: { x: 30, y: 100, width: 150, height: 60 },
      children: []
    },
    {
      label: 'Hidden',
      type: 'android.widget.TextView',
      enabled: true,
      visible: false,
      bounds: { x: 20, y: 220, width: 120, height: 40 },
      children: []
    }
  ]
};

describe('@astur-mobile/test expect matchers', () => {
  it('asserts native locator visibility, existence, text, value, label, type, and bounds', async () => {
    const session = createSession();
    const title = new MobileLocator(session, by.text('Welcome'));
    const hidden = new MobileLocator(session, by.label('Hidden'));
    const button = new MobileLocator(session, by.label('Sign in'));
    const wait = { timeout: 25, interval: 1 };

    await asturExpect(title).toBeVisible(wait);
    await asturExpect(hidden).toBeHidden(wait);
    await asturExpect(title).toExist(wait);
    await asturExpect(title).toBeEnabled(wait);
    await asturExpect(title).toHaveText('Welcome', wait);
    await asturExpect(title).toContainText('Wel', wait);
    await asturExpect(title).toHaveValue(/Wel/, wait);
    await asturExpect(title).toHaveBounds({ x: 10, width: 200 }, wait);
    await asturExpect(button).toBeDisabled(wait);
    await asturExpect(button).toBeSelected(wait);
    await asturExpect(button).toBeFocused(wait);
    await asturExpect(button).toHaveLabel('Sign in', wait);
    await asturExpect(button).toHaveType('android.widget.Button', wait);
    await asturExpect(title).not.toHaveText('Other', wait);
  });

  it('asserts Playwright-style DOM locator text and state without recursing into Astur matchers', async () => {
    const wait = { timeout: 25, interval: 1 };
    const locator = {
      waitFor: vi.fn(async () => undefined),
      textContent: vi.fn(async () => 'Astur Web Lab ready'),
      inputValue: vi.fn(async () => 'qa@astur.dev'),
      getAttribute: vi.fn(async () => 'qa@astur.dev'),
      isEnabled: vi.fn(async () => true),
      isDisabled: vi.fn(async () => false),
      evaluate: vi.fn(async () => true)
    };

    await asturExpect(locator).toBeVisible(wait);
    await asturExpect(locator).toBeEnabled(wait);
    await asturExpect(locator).toBeFocused(wait);
    await asturExpect(locator).toHaveText('Astur Web Lab ready', wait);
    await asturExpect(locator).toContainText(/Web Lab/, wait);
    await asturExpect(locator).toHaveValue('qa@astur.dev', wait);
  });

  it('asserts match counts with toHaveCount', async () => {
    const session = createSession();
    const textViews = new MobileLocator(session, by.type('android.widget.TextView'));
    const missing = new MobileLocator(session, by.text('Nope'));
    const wait = { timeout: 50, interval: 1 };

    await asturExpect(textViews).toHaveCount(2, wait);
    await asturExpect(missing).toHaveCount(0, wait);
    await asturExpect(textViews).not.toHaveCount(5, wait);
  });

  it('reports the last observed count when toHaveCount fails', async () => {
    const session = createSession();
    const textViews = new MobileLocator(session, by.type('android.widget.TextView'));

    let message = '';
    try {
      await asturExpect(textViews).toHaveCount(9, { timeout: 25, interval: 1 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    asturExpect(message).toContain('to have count 9');
    asturExpect(message).toContain('last saw 2');
  });

  it('routes MobileLocator through the mobile path even though it now has waitFor()', async () => {
    const session = createSession();
    const missing = new MobileLocator(session, by.text('Nope'));

    let message = '';
    try {
      await asturExpect(missing).toBeVisible({ timeout: 25 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    asturExpect(message).toContain('to be visible');
    asturExpect(message).not.toContain('Playwright');
  });
});

describe('negated assertions', () => {
  const wait = { timeout: 200, interval: 1 };
  const deviceLost = () => new AsturError('AGENT_TRANSPORT_FAILED', 'device disconnected');
  const withoutTitle: MobileElementSnapshot = {
    ...tree,
    children: tree.children.filter((child) => child.text !== 'Welcome')
  };

  it.each([
    ['toBeVisible', (l: MobileLocator) => asturExpect(l).not.toBeVisible(wait)],
    ['toBeHidden', (l: MobileLocator) => asturExpect(l).not.toBeHidden(wait)],
    ['toExist', (l: MobileLocator) => asturExpect(l).not.toExist(wait)],
    ['toBeEnabled', (l: MobileLocator) => asturExpect(l).not.toBeEnabled(wait)],
    ['toHaveText', (l: MobileLocator) => asturExpect(l).not.toHaveText('Other', wait)],
    ['toHaveCount', (l: MobileLocator) => asturExpect(l).not.toHaveCount(5, wait)]
  ])('.not.%s fails when the device cannot be read', async (_name, assertion) => {
    const session = createSession();
    session.getTree = vi.fn(async () => {
      throw deviceLost();
    });
    const title = new MobileLocator(session, by.text('Welcome'));

    await asturExpect(assertion(title)).rejects.toThrow(/device disconnected/);
  });

  it('.not.toBeVisible waits for a visible element to disappear', async () => {
    const session = createSession();
    session.getTree = vi.fn()
      .mockResolvedValueOnce(tree)
      .mockResolvedValueOnce(tree)
      .mockResolvedValue(withoutTitle);
    const title = new MobileLocator(session, by.text('Welcome'));

    await asturExpect(title).not.toBeVisible(wait);
  });

  it('.not.toBeVisible passes as soon as the element is gone, not after the timeout', async () => {
    const session = createSession(withoutTitle);
    const title = new MobileLocator(session, by.text('Welcome'));
    const startedAt = Date.now();

    await asturExpect(title).not.toBeVisible({ timeout: 2_000, interval: 1 });

    asturExpect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('.not.toBeHidden waits for a hidden element to appear', async () => {
    const session = createSession();
    session.getTree = vi.fn()
      .mockResolvedValueOnce(withoutTitle)
      .mockResolvedValueOnce(withoutTitle)
      .mockResolvedValue(tree);
    const title = new MobileLocator(session, by.text('Welcome'));

    await asturExpect(title).not.toBeHidden(wait);
  });

  it('.not.toHaveText fails for a missing element, as Playwright does', async () => {
    const session = createSession(withoutTitle);
    const title = new MobileLocator(session, by.text('Welcome'));

    await asturExpect(asturExpect(title).not.toHaveText('Other', wait)).rejects.toThrow(/not found/);
  });

  it('.not.toHaveCount waits for the count to change', async () => {
    const session = createSession();
    session.getTree = vi.fn()
      .mockResolvedValueOnce(tree)
      .mockResolvedValueOnce(tree)
      .mockResolvedValue(withoutTitle);
    const textViews = new MobileLocator(session, by.type('android.widget.TextView'));

    await asturExpect(textViews).not.toHaveCount(2, wait);
  });

  it('.not recovers from a transient read error when a clean reading follows', async () => {
    const session = createSession();
    session.getTree = vi.fn()
      .mockRejectedValueOnce(deviceLost())
      .mockResolvedValue(withoutTitle);
    const title = new MobileLocator(session, by.text('Welcome'));

    await asturExpect(title).not.toBeVisible(wait);
  });

  it('.not on a Playwright locator fails when the page cannot be read', async () => {
    const locator = {
      waitFor: vi.fn(async () => {
        throw new Error('Target page, context or browser has been closed');
      }),
      isVisible: vi.fn(async () => {
        throw new Error('Target page, context or browser has been closed');
      })
    };

    await asturExpect(asturExpect(locator).not.toBeVisible(wait)).rejects.toThrow(/has been closed/);
  });

  it('.not on a Playwright locator waits for the element to disappear', async () => {
    const locator = {
      waitFor: vi.fn(async () => undefined),
      isVisible: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false)
    };

    await asturExpect(locator).not.toBeVisible(wait);
  });
});

function createSession(snapshot: MobileElementSnapshot = tree): PlatformSession {
  return {
    capabilities: {
      platform: 'android',
      device: {},
      timeout: 10_000,
      artifactsDir: 'test-results/astur',
      artifacts: {},
      keyboard: {
        dismiss: 'auto'
      },
      automation: {
        engine: 'auto',
        transport: 'auto',
        legacyFallback: 'on-agent-failure',
        commandTimeoutMs: 10_000,
        startupTimeoutMs: 15_000,
        strictLocators: true,
        snapshot: { mode: 'on-failure', cacheTtlMs: 200 },
        timings: { enabled: true, slowCommandThresholdMs: 1_000 }
      },
      agent: {
        mode: 'auto',
        install: true,
        launchTimeout: 15_000,
        commandTimeout: 10_000,
        legacyFallback: 'on-agent-failure',
        transport: 'auto'
      }
    },
    deviceInfo: {
      id: 'emulator-5554',
      name: 'Pixel',
      platform: 'android',
      kind: 'emulator',
      state: 'online'
    },
    close: vi.fn(),
    installApp: vi.fn(),
    uninstallApp: vi.fn(),
    launchApp: vi.fn(),
    terminateApp: vi.fn(),
    clearAppData: vi.fn(),
    clearAppCache: vi.fn(),
    resetApp: vi.fn(),
    lockDevice: vi.fn(),
    unlockDevice: vi.fn(),
    isDeviceLocked: vi.fn(async () => false),
    getTree: vi.fn(async () => snapshot),
    tap: vi.fn(),
    longPress: vi.fn(),
    fill: vi.fn(),
    pressKey: vi.fn(),
    swipe: vi.fn(),
    drag: vi.fn(),
    screenshot: vi.fn(async () => Buffer.from([])),
    openWeb: vi.fn()
  };
}
