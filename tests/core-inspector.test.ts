import { describe, expect, it, vi } from 'vitest';
import {
  by,
  createInspectorSession,
  type MobileElementSnapshot,
  type PlatformSession
} from '@astur-mobile/core';

const tree: MobileElementSnapshot = {
  type: 'root',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 300, height: 600 },
  children: [
    {
      id: 'continue-button',
      text: 'Continue',
      label: 'Continue',
      type: 'android.widget.Button',
      enabled: true,
      visible: true,
      bounds: { x: 20, y: 200, width: 180, height: 56 },
      children: [
        {
          text: 'Continue',
          type: 'android.widget.TextView',
          enabled: true,
          visible: true,
          bounds: { x: 60, y: 215, width: 90, height: 24 },
          children: []
        }
      ]
    }
  ]
};

describe('inspector runtime helpers', () => {
  it('ranks stable id-based locators ahead of text-only suggestions', async () => {
    const inspector = createInspectorSession(createSession(tree));

    const suggestions = await inspector.generateLocator(by.text('Continue'));

    expect(suggestions[0]).toMatchObject({
      code: "device.getByTestId('continue-button')",
      selector: {
        strategy: 'id',
        value: 'continue-button'
      }
    });
    expect(suggestions.find((candidate) => candidate.code.includes("getByRole('button'"))).toBeDefined();
  });

  it('returns the deepest matching node for host-side hit testing', async () => {
    const inspector = createInspectorSession(createSession(tree));

    const target = await inspector.hitTest({ x: 80, y: 220 });

    expect(target?.type).toBe('android.widget.TextView');
  });

  it('executes semantic actions through the shared runtime locator path', async () => {
    const session = createSession(tree);
    session.tapElement = vi.fn();
    const inspector = createInspectorSession(session);

    await inspector.executeAction({
      kind: 'tap',
      selector: by.id('continue-button')
    });

    expect(session.tapElement).toHaveBeenCalledWith(by.id('continue-button'), { keyboard: 'auto' });
  });

  it('executes fill actions through the shared runtime locator path', async () => {
    const session = createSession(tree);
    session.fill = vi.fn();
    const inspector = createInspectorSession(session);

    await inspector.executeAction({
      kind: 'fill',
      selector: by.id('continue-button'),
      value: 'amr'
    });

    expect(session.fill).toHaveBeenCalledWith(by.id('continue-button'), 'amr');
  });

  it('provides a polling fallback tree stream when native subscriptions are unavailable', async () => {
    const inspector = createInspectorSession(createSession(tree), { pollIntervalMs: 50 });
    const updates = [] as Array<{ reason: string; revision: number }>;

    for await (const update of inspector.subscribeTree({ maxUpdates: 2 })) {
      updates.push({ reason: update.reason, revision: update.revision });
    }

    expect(updates).toEqual([
      { reason: 'initial', revision: 1 },
      { reason: 'poll', revision: 2 }
    ]);
  });
});

function createSession(snapshot: MobileElementSnapshot): PlatformSession {
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
      agent: {
        mode: 'auto',
        install: true,
        launchTimeout: 15_000,
        commandTimeout: 10_000
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
    unlockDevice: vi.fn(async () => undefined),
    isDeviceLocked: vi.fn(async () => false),
    getTree: vi.fn(async () => snapshot),
    tap: vi.fn(),
    doubleTap: vi.fn(),
    longPress: vi.fn(),
    fill: vi.fn(),
    pressKey: vi.fn(),
    swipe: vi.fn(),
    drag: vi.fn(),
    screenshot: vi.fn(async () => Buffer.from([])),
    openWeb: vi.fn()
  };
}
