import { describe, expect, it, vi } from 'vitest';
import {
  AsturError,
  MobileLocator,
  by,
  checkedStateOf,
  placeholderOf,
  type MobileElementSnapshot,
  type PlatformSession
} from '@astur-mobile/core';

/**
 * A list of look-alike rows — the case a flat selector cannot address.
 *
 * Every row has the same type and the same button label, so `getByRole('button')`
 * alone matches three elements and nothing about the base selector says which
 * one belongs to the sold-out item. That is the whole reason composition exists,
 * so the fixture is built to be genuinely ambiguous rather than conveniently
 * unique.
 */
const catalogue: MobileElementSnapshot = {
  type: 'root',
  enabled: true,
  visible: true,
  bounds: { x: 0, y: 0, width: 400, height: 900 },
  children: [
    row('Sourdough', 'In stock', 0),
    row('Rye', 'Sold out', 1),
    row('Baguette', 'In stock', 2)
  ]
};

function row(name: string, availability: string, index: number): MobileElementSnapshot {
  const top = 100 * index;
  return {
    type: 'android.widget.LinearLayout',
    enabled: true,
    visible: true,
    bounds: { x: 0, y: top, width: 400, height: 100 },
    children: [
      {
        text: name,
        type: 'android.widget.TextView',
        enabled: true,
        visible: true,
        bounds: { x: 10, y: top + 10, width: 200, height: 30 },
        children: []
      },
      {
        text: availability,
        type: 'android.widget.TextView',
        enabled: true,
        visible: true,
        bounds: { x: 10, y: top + 45, width: 200, height: 20 },
        children: []
      },
      {
        label: 'Add',
        type: 'android.widget.Button',
        enabled: true,
        visible: true,
        bounds: { x: 300, y: top + 20, width: 80, height: 60 },
        children: []
      }
    ]
  };
}

function createSession(snapshot: MobileElementSnapshot = catalogue): PlatformSession {
  return {
    capabilities: {
      platform: 'android',
      device: {},
      timeout: 1_000,
      artifactsDir: 'test-results/astur',
      artifacts: {},
      keyboard: { dismiss: 'auto' },
      agent: { mode: 'auto', install: true, launchTimeout: 15_000, commandTimeout: 10_000 }
    },
    deviceInfo: { id: 'emulator-5554', name: 'Pixel', platform: 'android', kind: 'emulator', state: 'online' },
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

function locator(session: PlatformSession, selector = by.type('android.widget.LinearLayout')): MobileLocator {
  return new MobileLocator(session, selector);
}

describe('scoped locators', () => {
  it('searches only inside the parent', async () => {
    const session = createSession();
    const rows = locator(session);

    // Three buttons on screen, one per row.
    expect(await rows.getByRole('button').count()).toBe(3);

    // Scoped to the sold-out row, exactly one.
    const soldOut = rows.filter({ hasText: 'Sold out' });
    expect(await soldOut.getByRole('button').count()).toBe(1);
  });

  it('does not treat the parent as its own descendant', async () => {
    const session = createSession();
    const rows = locator(session);
    // The row itself is a LinearLayout; scoping to it must not match it again.
    expect(await rows.first().getByType('android.widget.LinearLayout').count()).toBe(0);
  });
});

describe('filter', () => {
  it('narrows by contained text', async () => {
    const session = createSession();
    const rows = locator(session);
    expect(await rows.filter({ hasText: 'In stock' }).count()).toBe(2);
  });

  it('narrows by absent text', async () => {
    const session = createSession();
    const rows = locator(session);
    const available = rows.filter({ hasNotText: 'Sold out' });
    expect(await available.count()).toBe(2);
  });

  it('accepts a RegExp', async () => {
    const session = createSession();
    expect(await locator(session).filter({ hasText: /sold\s+out/i }).count()).toBe(1);
  });

  it('narrows by a contained locator', async () => {
    const session = createSession();
    const rows = locator(session);
    const withButton = rows.filter({ has: new MobileLocator(session, by.label('Add')) });
    expect(await withButton.count()).toBe(3);

    const withMissing = rows.filter({ has: new MobileLocator(session, by.label('Remove')) });
    expect(await withMissing.count()).toBe(0);
  });

  it('narrows by an absent locator', async () => {
    const session = createSession();
    const rows = locator(session);
    expect(await rows.filter({ hasNot: new MobileLocator(session, by.label('Add')) }).count()).toBe(0);
  });

  it('stacks — every filter must pass', async () => {
    const session = createSession();
    const rows = locator(session);
    const both = rows.filter({ hasText: 'In stock' }).filter({ hasText: 'Baguette' });
    expect(await both.count()).toBe(1);
  });
});

describe('positional narrowing', () => {
  it('picks first, last, and nth', async () => {
    const session = createSession();
    const names = new MobileLocator(session, by.type('android.widget.TextView'));

    expect((await names.first().snapshot()).text).toBe('Sourdough');
    expect((await names.nth(1).snapshot()).text).toBe('In stock');
    expect((await names.last().snapshot()).text).toBe('In stock');
  });

  it('counts nth from the end when negative', async () => {
    const session = createSession();
    const names = new MobileLocator(session, by.type('android.widget.TextView'));
    expect((await names.nth(-1).snapshot()).text).toBe('In stock');
  });

  it('applies position after filtering, not before', async () => {
    const session = createSession();
    const rows = locator(session);

    // The first *available* row is Sourdough. Applying position first would
    // pick Sourdough too, so assert on the case that distinguishes them: the
    // last available row is Baguette, not the last row overall (Baguette) —
    // use the sold-out filter, whose only match is Rye.
    const soldOut = rows.filter({ hasText: 'Sold out' }).first();
    expect(await soldOut.getByType('android.widget.TextView').first().textContent()).toBe('Rye');
  });

  it('resolves to nothing when the index is out of range', async () => {
    const session = createSession();
    expect(await locator(session).nth(9).count()).toBe(0);
  });
});

describe('and / or', () => {
  it('and keeps only elements both locators match', async () => {
    const session = createSession();
    const buttons = new MobileLocator(session, by.type('android.widget.Button'));
    const labelled = new MobileLocator(session, by.label('Add'));
    expect(await buttons.and(labelled).count()).toBe(3);

    const other = new MobileLocator(session, by.label('Remove'));
    expect(await buttons.and(other).count()).toBe(0);
  });

  it('or unions both match sets in document order', async () => {
    const session = createSession();
    const sourdough = new MobileLocator(session, by.text('Sourdough'));
    const rye = new MobileLocator(session, by.text('Rye'));

    const either = sourdough.or(rye);
    expect(await either.count()).toBe(2);
    expect((await either.first().snapshot()).text).toBe('Sourdough');
  });

  it('or does not double-count an element both sides match', async () => {
    const session = createSession();
    const byText = new MobileLocator(session, by.text('Rye'));
    const byType = new MobileLocator(session, by.type('android.widget.TextView'));
    // Every Rye node is also a TextView; the union must not repeat it.
    const union = byText.or(byType);
    expect(await union.count()).toBe(await byType.count());
  });
});

describe('composition and the driver fast path', () => {
  it('hands a plain locator straight to the driver', async () => {
    const session = createSession();
    const tapElement = vi.fn();
    const composed = { ...session, tapElement } as PlatformSession;

    await new MobileLocator(composed, by.label('Add')).tap();
    expect(tapElement).toHaveBeenCalledTimes(1);
  });

  it('resolves a composed locator itself rather than sending an unresolvable selector', async () => {
    const session = createSession();
    const tapElement = vi.fn();
    const tap = vi.fn();
    const composed = { ...session, tapElement, tap } as unknown as PlatformSession;

    await new MobileLocator(composed, by.type('android.widget.LinearLayout'))
      .filter({ hasText: 'Sold out' })
      .getByRole('button')
      .tap();

    // The driver's selector-based fast path cannot express the refinement, so
    // it must not be used; the tap lands on the resolved element's centre.
    expect(tapElement).not.toHaveBeenCalled();
    expect(tap).toHaveBeenCalledWith({ x: 340, y: 150 });
  });
});

describe('placeholder', () => {
  it('reads the driver raw hint first', () => {
    expect(placeholderOf({
      type: 'android.widget.EditText',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      children: [],
      raw: { hint: 'Email address' }
    })).toBe('Email address');
  });

  it('falls back to the value of an empty field', () => {
    expect(placeholderOf({
      type: 'XCUIElementTypeTextField',
      value: 'Search…',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      children: []
    })).toBe('Search…');
  });

  it('reports nothing once the field has content', () => {
    expect(placeholderOf({
      type: 'XCUIElementTypeTextField',
      text: 'qa@astur.dev',
      value: 'qa@astur.dev',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      children: []
    })).toBeUndefined();
  });
});

describe('checked state', () => {
  const base = { enabled: true, visible: true, bounds: { x: 0, y: 0, width: 0, height: 0 }, children: [] };

  it('prefers what the driver reports', () => {
    expect(checkedStateOf({ ...base, type: 'android.widget.CheckBox', checked: true })).toBe(true);
  });

  it('reads the raw attribute when the driver carries no field', () => {
    expect(checkedStateOf({ ...base, type: 'android.widget.CheckBox', raw: { checked: 'true' } })).toBe(true);
    expect(checkedStateOf({ ...base, type: 'android.widget.CheckBox', raw: { checked: 'false' } })).toBe(false);
  });

  it('derives a toggle from its value string', () => {
    expect(checkedStateOf({ ...base, type: 'XCUIElementTypeSwitch', value: '1' })).toBe(true);
    expect(checkedStateOf({ ...base, type: 'XCUIElementTypeSwitch', value: '0' })).toBe(false);
  });

  it('reports unknown rather than false for a non-checkable element', () => {
    expect(checkedStateOf({ ...base, type: 'android.widget.TextView', value: 'hello' })).toBeUndefined();
  });

  it('isChecked fails loudly on an element with no checked state', async () => {
    const session = createSession();
    const text = new MobileLocator(session, by.text('Sourdough'));
    await expect(text.isChecked()).rejects.toBeInstanceOf(AsturError);
  });
});
