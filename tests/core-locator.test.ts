import { describe, expect, it, vi } from 'vitest';
import {
  AsturError,
  MobileLocator,
  by,
  centerOf,
  findElement,
  findElements,
  flattenTree,
  formatSelector,
  matches,
  type MobileElementSnapshot,
  type PlatformSession
} from '@astur/core';

const tree: MobileElementSnapshot = {
  type: 'root',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 300, height: 600 },
  children: [
    {
      id: 'dev.astur:id/title',
      text: 'Welcome',
      type: 'android.widget.TextView',
      enabled: true,
      visible: true,
      bounds: { x: 10, y: 20, width: 200, height: 50 },
      children: []
    },
    {
      label: 'Sign in',
      type: 'android.widget.Button',
      enabled: true,
      visible: true,
      bounds: { x: 30, y: 100, width: 150, height: 60 },
      children: [
        {
          text: 'Nested action',
          type: 'android.widget.TextView',
          enabled: true,
          visible: true,
          bounds: { x: 50, y: 120, width: 90, height: 20 },
          children: []
        }
      ]
    }
  ]
};

describe('locator primitives', () => {
  it('builds semantic selectors', () => {
    expect(by.label('Login')).toEqual({ strategy: 'accessibility', value: 'Login', exact: true });
    expect(by.text('Welcome', { exact: false })).toEqual({ strategy: 'text', value: 'Welcome', exact: false });
    expect(by.id('submit')).toEqual({ strategy: 'id', value: 'submit', exact: true });
    expect(by.testId('submit')).toEqual({ strategy: 'id', value: 'submit', exact: true });
    expect(by.role('button', { name: 'Login' })).toEqual({
      strategy: 'role',
      value: 'button',
      exact: true,
      name: 'Login'
    });
    expect(by.coordinates(10, 20)).toEqual({ x: 10, y: 20 });
  });

  it('finds elements recursively by text, label, id, type, and role', () => {
    expect(findElement(tree, by.text('Nested action'))?.text).toBe('Nested action');
    expect(findElement(tree, by.label('Sign in'))?.label).toBe('Sign in');
    expect(findElement(tree, by.id('dev.astur:id/title'))?.text).toBe('Welcome');
    expect(findElement(tree, by.type('android.widget.Button'))?.label).toBe('Sign in');
    expect(findElement(tree, by.role('button', { name: 'Sign in' }))?.label).toBe('Sign in');
    expect(findElement(tree, by.role('button', { name: 'Sign', exact: false }))?.label).toBe('Sign in');
    expect(findElement(tree, by.role('text', { name: /Wel/ }))?.text).toBe('Welcome');
  });

  it('finds all recursive matches by selector', () => {
    expect(findElements(tree, by.role('text')).map((node) => node.text)).toEqual([
      'Welcome',
      'Nested action'
    ]);
  });

  it('supports contains matching when exact is false', () => {
    expect(matches(tree.children[0], by.text('Wel', { exact: false }))).toBe(true);
    expect(matches(tree.children[0], by.text('Wel'))).toBe(false);
  });

  it('throws for XPath until the compatibility layer exists', () => {
    expect(() => matches(tree, by.xpath('//Button'))).toThrow(AsturError);
  });

  it('formats selectors and computes stable geometry', () => {
    expect(formatSelector(by.text('Welcome'))).toBe('text="Welcome"');
    expect(formatSelector(by.role('button', { name: 'Login' }))).toBe('role="button"[name="Login"]');
    expect(centerOf({ x: 10, y: 20, width: 101, height: 51 })).toEqual({ x: 61, y: 46 });
    expect(flattenTree(tree).map((node) => node.type)).toEqual([
      'root',
      'android.widget.TextView',
      'android.widget.Button',
      'android.widget.TextView'
    ]);
  });
});

describe('MobileLocator', () => {
  it('taps the center of the resolved element', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.label('Sign in'));

    await locator.tap({ timeout: 25, interval: 1 });

    expect(session.tap).toHaveBeenCalledWith({ x: 105, y: 130 });
  });

  it('delegates element actions to native session hooks when available', async () => {
    const session = createSession();
    session.tapElement = vi.fn();
    session.doubleTapElement = vi.fn();
    session.fillElement = vi.fn();
    session.longPressElement = vi.fn();
    session.dragElement = vi.fn();
    const locator = new MobileLocator(session, by.label('Sign in'));
    const target = new MobileLocator(session, by.text('Welcome'));

    await locator.tap({ timeout: 25, interval: 1 });
    await locator.doubleTap({ timeout: 25, interval: 1, intervalMs: 60 });
    await locator.fill('hello', { timeout: 25, interval: 1 });
    await locator.longPress({ timeout: 25, interval: 1, durationMs: 900 });
    await locator.dragTo(target, { timeout: 25, interval: 1, durationMs: 700 });

    expect(session.tapElement).toHaveBeenCalledWith(by.label('Sign in'), { timeout: 25, interval: 1 });
    expect(session.doubleTapElement).toHaveBeenCalledWith(by.label('Sign in'), {
      timeout: 25,
      interval: 1,
      intervalMs: 60
    });
    expect(session.fillElement).toHaveBeenCalledWith(by.label('Sign in'), 'hello', { timeout: 25, interval: 1 });
    expect(session.longPressElement).toHaveBeenCalledWith(by.label('Sign in'), {
      timeout: 25,
      interval: 1,
      durationMs: 900
    });
    expect(session.dragElement).toHaveBeenCalledWith(by.label('Sign in'), { selector: by.text('Welcome') }, {
      timeout: 25,
      interval: 1,
      durationMs: 700
    });
    expect(session.getTree).not.toHaveBeenCalled();
  });

  it('delegates element waits to native session hooks when available', async () => {
    const session = createSession();
    session.waitForElement = vi.fn(async () => tree.children[0]);
    session.waitForElementHidden = vi.fn();
    const locator = new MobileLocator(session, by.text('Welcome'));

    await expect(locator.waitForVisible({ timeout: 25, interval: 1 })).resolves.toBe(tree.children[0]);
    await locator.waitForHidden({ timeout: 25, interval: 1 });

    expect(session.waitForElement).toHaveBeenCalledWith(by.text('Welcome'), {
      timeout: 25,
      interval: 1,
      state: 'visible'
    });
    expect(session.waitForElementHidden).toHaveBeenCalledWith(by.text('Welcome'), {
      timeout: 25,
      interval: 1
    });
    expect(session.getTree).not.toHaveBeenCalled();
  });

  it('uses native element snapshots for predicate waits when available', async () => {
    const session = createSession();
    session.findElement = vi.fn(async () => tree.children[0]);
    const locator = new MobileLocator(session, by.text('Welcome'));

    await expect(locator.waitForSnapshot((snapshot) => snapshot.text === 'Welcome', {
      timeout: 25,
      interval: 1
    })).resolves.toBe(tree.children[0]);

    expect(session.findElement).toHaveBeenCalledWith(by.text('Welcome'));
    expect(session.getTree).not.toHaveBeenCalled();
  });

  it('uses native element lists when available', async () => {
    const session = createSession();
    session.findElements = vi.fn(async () => [tree.children[0], tree.children[1].children[0]]);
    const locator = new MobileLocator(session, by.role('text'));

    await expect(locator.all({ timeout: 25, interval: 1 })).resolves.toHaveLength(2);
    await expect(locator.queryAll()).resolves.toHaveLength(2);

    expect(session.findElements).toHaveBeenCalledWith(by.role('text'));
    expect(session.getTree).not.toHaveBeenCalled();
  });

  it('falls back to UI tree matching for element lists', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.role('text'));

    await expect(locator.all({ timeout: 25, interval: 1 })).resolves.toHaveLength(2);

    expect(session.getTree).toHaveBeenCalledOnce();
  });

  it('dismisses the soft keyboard before tapping a blocked locator', async () => {
    const blockedTree: MobileElementSnapshot = {
      ...tree,
      children: [
        {
          label: 'Submit',
          type: 'android.widget.Button',
          enabled: true,
          visible: true,
          bounds: { x: 30, y: 510, width: 150, height: 60 },
          children: []
        }
      ]
    };
    const session = createSession(blockedTree);
    session.getKeyboardState = vi.fn()
      .mockResolvedValueOnce({ visible: true, bounds: { x: 0, y: 450, width: 300, height: 150 } })
      .mockResolvedValue({ visible: false });
    session.dismissKeyboard = vi.fn();
    const locator = new MobileLocator(session, by.label('Submit'));

    await locator.tap({ timeout: 25, interval: 1 });

    expect(session.dismissKeyboard).toHaveBeenCalledOnce();
    expect(session.getTree).toHaveBeenCalledTimes(2);
    expect(session.tap).toHaveBeenCalledWith({ x: 105, y: 540 });
  });

  it('preserves the soft keyboard when a locator action opts out', async () => {
    const blockedTree: MobileElementSnapshot = {
      ...tree,
      children: [
        {
          label: 'Submit',
          type: 'android.widget.Button',
          enabled: true,
          visible: true,
          bounds: { x: 30, y: 510, width: 150, height: 60 },
          children: []
        }
      ]
    };
    const session = createSession(blockedTree);
    session.getKeyboardState = vi.fn(async () => ({ visible: true, bounds: { x: 0, y: 450, width: 300, height: 150 } }));
    session.dismissKeyboard = vi.fn();
    const locator = new MobileLocator(session, by.label('Submit'));

    await locator.tap({ timeout: 25, interval: 1, keyboard: 'preserve' });

    expect(session.dismissKeyboard).not.toHaveBeenCalled();
    expect(session.tap).toHaveBeenCalledWith({ x: 105, y: 540 });
  });

  it('delegates fill to the platform session after visibility is resolved', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.text('Welcome'));

    await locator.fill('hello', { timeout: 25, interval: 1 });

    expect(session.fill).toHaveBeenCalledWith(by.text('Welcome'), 'hello');
  });

  it('waits for hidden elements without requiring callers to poll snapshots', async () => {
    const visibleTree: MobileElementSnapshot = {
      ...tree,
      children: [
        {
          label: 'Toast',
          type: 'android.widget.TextView',
          enabled: true,
          visible: true,
          bounds: { x: 20, y: 200, width: 120, height: 40 },
          children: []
        }
      ]
    };
    const hiddenTree: MobileElementSnapshot = {
      ...visibleTree,
      children: [
        {
          ...visibleTree.children[0],
          visible: false
        }
      ]
    };
    const session = createSession();
    session.getTree = vi.fn()
      .mockResolvedValueOnce(visibleTree)
      .mockResolvedValue(hiddenTree);
    const locator = new MobileLocator(session, by.label('Toast'));

    await locator.waitForHidden({ timeout: 25, interval: 1 });

    expect(session.getTree).toHaveBeenCalledTimes(2);
  });

  it('waits for snapshot predicates using the session timeout defaults', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.text('Welcome'));

    await expect(locator.waitForSnapshot((snapshot) => snapshot.text === 'Welcome', {
      timeout: 25,
      interval: 1
    })).resolves.toMatchObject({ text: 'Welcome' });
  });

  it('long-presses the center of the resolved element', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.label('Sign in'));

    await locator.longPress({ timeout: 25, interval: 1, durationMs: 900 });

    expect(session.longPress).toHaveBeenCalledWith({ x: 105, y: 130 }, { durationMs: 900 });
  });

  it('double-taps the center of the resolved element', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.label('Sign in'));

    await locator.doubleTap({ timeout: 25, interval: 1, intervalMs: 60 });

    expect(session.doubleTap).toHaveBeenCalledWith({ x: 105, y: 130 }, {
      keyboard: undefined,
      intervalMs: 60
    });
  });

  it('drags from an element center to coordinates', async () => {
    const session = createSession();
    const locator = new MobileLocator(session, by.label('Sign in'));

    await locator.dragTo({ x: 220, y: 300 }, { timeout: 25, interval: 1, durationMs: 650 });

    expect(session.drag).toHaveBeenCalledWith({
      start: { x: 105, y: 130 },
      end: { x: 220, y: 300 },
      durationMs: 650
    });
  });

  it('drags between two resolved locators', async () => {
    const session = createSession();
    const source = new MobileLocator(session, by.text('Welcome'));
    const target = new MobileLocator(session, by.label('Sign in'));

    await source.dragTo(target, { timeout: 25, interval: 1, durationMs: 700 });

    expect(session.drag).toHaveBeenCalledWith({
      start: { x: 110, y: 45 },
      end: { x: 105, y: 130 },
      durationMs: 700
    });
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
    unlockDevice: vi.fn(),
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
