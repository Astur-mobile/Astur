import type {
  Bounds,
  Coordinates,
  DoubleTapOptions,
  ElementDoubleTapOptions,
  ElementFillOptions,
  ElementSelector,
  LongPressOptions,
  MobileElementSnapshot,
  MobileRole,
  RoleSelectorOptions,
  SwipeGesture,
  TapOptions
} from '@astur/protocol';
import { AsturError } from './errors.js';
import { preparePointerTargetForKeyboard } from './keyboard.js';
import type { PlatformSession } from './session.js';
import { delay, waitFor, type WaitOptions } from './wait.js';

export const by = {
  label(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'accessibility', value, exact: options?.exact ?? true };
  },

  a11y(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'accessibility', value, exact: options?.exact ?? true };
  },

  id(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'id', value, exact: options?.exact ?? true };
  },

  testId(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'id', value, exact: options?.exact ?? true };
  },

  role(value: MobileRole | string, options: RoleSelectorOptions = {}): ElementSelector {
    return { strategy: 'role', value, exact: options.exact ?? true, name: options.name };
  },

  text(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'text', value, exact: options?.exact ?? true };
  },

  type(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'type', value, exact: options?.exact ?? true };
  },

  xpath(value: string): ElementSelector {
    return { strategy: 'xpath', value, exact: true };
  },

  coordinates(x: number, y: number): Coordinates {
    return { x, y };
  }
};

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface ScrollIntoViewOptions extends WaitOptions {
  /** Direction to scroll the content toward the target. `'down'` (the default) reveals content further down the screen. */
  direction?: ScrollDirection;
  /** Maximum number of scroll gestures to attempt before giving up. Defaults to `10`. */
  maxScrolls?: number;
  /** Duration of each scroll gesture in milliseconds. Defaults to `400`. */
  durationMs?: number;
  /** Scrollable region to swipe within. Defaults to the device viewport. */
  container?: MobileLocator;
}

export class MobileLocator {
  readonly selector: ElementSelector;
  private readonly session: PlatformSession;

  constructor(session: PlatformSession, selector: ElementSelector) {
    this.session = session;
    this.selector = selector;
  }

  async tap(options: WaitOptions & TapOptions = {}): Promise<void> {
    if (this.session.tapElement) {
      await this.session.tapElement(this.selector, withKeyboardDefault(this.session, options));
      return;
    }

    let element = await this.waitForVisible(options);
    const dismissed = await preparePointerTargetForKeyboard(this.session, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForVisible(options);
    }

    await this.session.tap(centerOf(element.bounds));
  }

  async doubleTap(options: WaitOptions & DoubleTapOptions = {}): Promise<void> {
    if (this.session.doubleTapElement) {
      await this.session.doubleTapElement(
        this.selector,
        withKeyboardDefault(this.session, options) as WaitOptions & ElementDoubleTapOptions
      );
      return;
    }

    let element = await this.waitForVisible(options);
    const dismissed = await preparePointerTargetForKeyboard(this.session, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForVisible(options);
    }

    const point = centerOf(element.bounds);
    if (this.session.doubleTap) {
      await this.session.doubleTap(point, { keyboard: options.keyboard, intervalMs: options.intervalMs });
      return;
    }

    await this.session.tap(point);
    await delay(options.intervalMs ?? 80);
    await this.session.tap(point);
  }

  async longPress(options: WaitOptions & LongPressOptions = {}): Promise<void> {
    if (this.session.longPressElement) {
      await this.session.longPressElement(this.selector, withKeyboardDefault(this.session, options));
      return;
    }

    let element = await this.waitForVisible(options);
    const dismissed = await preparePointerTargetForKeyboard(this.session, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForVisible(options);
    }

    await this.session.longPress(centerOf(element.bounds), { durationMs: options.durationMs });
  }

  async pressAndHold(options: WaitOptions & LongPressOptions = {}): Promise<void> {
    await this.longPress(options);
  }

  async dragTo(target: MobileLocator | Coordinates, options: WaitOptions & { durationMs?: number } = {}): Promise<void> {
    if (this.session.dragElement) {
      if (target instanceof MobileLocator && target.session !== this.session) {
        throw new AsturError('CROSS_SESSION_LOCATOR', 'Cannot drag between locators from different Astur device sessions.');
      }

      await this.session.dragElement(
        this.selector,
        target instanceof MobileLocator ? { selector: target.selector } : target,
        withKeyboardDefault(this.session, options)
      );
      return;
    }

    let source = await this.waitForVisible(options);
    const dismissed = await preparePointerTargetForKeyboard(this.session, centerOf(source.bounds));
    if (dismissed) {
      source = await this.waitForVisible(options);
    }

    const end = isCoordinates(target)
      ? target
      : centerOf((await target.waitForVisible({
        timeout: options.timeout,
        interval: options.interval
      })).bounds);

    await this.session.drag({
      start: centerOf(source.bounds),
      end,
      durationMs: options.durationMs
    });
  }

  /**
   * Scrolls the surrounding scroll view until this element is visible, then
   * resolves with its snapshot. Replaces the hand-written "swipe in a loop
   * until visible" helpers that page objects otherwise have to craft, and
   * hides the iOS-viewport / Android-tree platform difference for the scroll
   * region. If the element is already visible no gesture is performed.
   */
  async scrollIntoView(options: ScrollIntoViewOptions = {}): Promise<MobileElementSnapshot> {
    const direction = options.direction ?? 'down';
    const maxScrolls = Math.max(0, options.maxScrolls ?? 10);
    const durationMs = options.durationMs ?? 400;

    const current = await this.currentMatch();
    if (current?.visible) {
      return current;
    }

    for (let attempt = 0; attempt < maxScrolls; attempt += 1) {
      const region = options.container
        ? (await options.container.waitForVisible({
          timeout: options.timeout,
          interval: options.interval
        })).bounds
        : await this.scrollRegion();

      await this.session.swipe(scrollGesture(region, direction, durationMs));

      const match = await this.currentMatch();
      if (match?.visible) {
        return match;
      }
    }

    return this.waitForVisible({
      ...options,
      message: options.message
        ?? `Timed out scrolling ${direction} to reveal ${formatSelector(this.selector)} after ${maxScrolls} scroll attempts`
    });
  }

  private async currentMatch(): Promise<MobileElementSnapshot | undefined> {
    return this.session.findElement
      ? this.session.findElement(this.selector)
      : findElement(await this.session.getTree(), this.selector);
  }

  private async scrollRegion(): Promise<Bounds> {
    if (this.session.getViewport) {
      return this.session.getViewport();
    }

    return (await this.session.getTree()).bounds;
  }

  async fill(value: string, options: WaitOptions & ElementFillOptions = {}): Promise<void> {
    if (this.session.fillElement) {
      await this.session.fillElement(this.selector, value, withKeyboardDefault(this.session, options));
      return;
    }

    const element = await this.waitForVisible(options);
    await preparePointerTargetForKeyboard(this.session, centerOf(element.bounds));
    await this.session.fill(this.selector, value);
  }

  async isVisible(options: WaitOptions = {}): Promise<boolean> {
    try {
      await this.waitForVisible(options);
      return true;
    } catch {
      return false;
    }
  }

  async isHidden(options: WaitOptions = {}): Promise<boolean> {
    try {
      await this.waitForHidden(options);
      return true;
    } catch {
      return false;
    }
  }

  async waitForVisible(options: WaitOptions = {}): Promise<MobileElementSnapshot> {
    if (this.session.waitForElement) {
      return this.session.waitForElement(this.selector, {
        ...options,
        state: 'visible'
      });
    }

    return this.waitForSnapshot(
      (snapshot) => snapshot.visible,
      {
        ...options,
        message: options.message ?? `Timed out waiting for ${formatSelector(this.selector)} to be visible`
      }
    );
  }

  async waitForHidden(options: WaitOptions = {}): Promise<void> {
    if (this.session.waitForElementHidden) {
      await this.session.waitForElementHidden(this.selector, options);
      return;
    }

    await waitFor(
      async () => {
        const root = await this.session.getTree();
        const match = findElement(root, this.selector);
        return !match || !match.visible;
      },
      {
        ...options,
        timeout: options.timeout ?? this.session.capabilities.timeout,
        message: options.message ?? `Timed out waiting for ${formatSelector(this.selector)} to be hidden`
      }
    );
  }

  async waitForSnapshot(
    predicate: (snapshot: MobileElementSnapshot) => boolean = () => true,
    options: WaitOptions = {}
  ): Promise<MobileElementSnapshot> {
    return waitFor(
      async () => {
        const match = this.session.findElement
          ? await this.session.findElement(this.selector)
          : findElement(await this.session.getTree(), this.selector);
        return match && predicate(match) ? match : undefined;
      },
      {
        ...options,
        timeout: options.timeout ?? this.session.capabilities.timeout,
        message: options.message ?? `Timed out waiting for ${formatSelector(this.selector)}`
      }
    );
  }

  async snapshot(options: WaitOptions = {}): Promise<MobileElementSnapshot> {
    return this.waitForSnapshot(
      () => true,
      {
        ...options,
        message: options.message ?? `Timed out waiting for ${formatSelector(this.selector)}`
      }
    );
  }

  async all(options: WaitOptions = {}): Promise<MobileElementSnapshot[]> {
    return waitFor(
      async () => {
        const matches = await this.queryAll();
        return matches.length > 0 ? matches : undefined;
      },
      {
        ...options,
        timeout: options.timeout ?? this.session.capabilities.timeout,
        message: options.message ?? `Timed out waiting for ${formatSelector(this.selector)} to match at least one element`
      }
    );
  }

  async queryAll(): Promise<MobileElementSnapshot[]> {
    return this.session.findElements
      ? this.session.findElements(this.selector)
      : findElements(await this.session.getTree(), this.selector);
  }

  toString(): string {
    return formatSelector(this.selector);
  }
}

export function findElement(
  root: MobileElementSnapshot,
  selector: ElementSelector
): MobileElementSnapshot | undefined {
  if (matches(root, selector)) {
    return root;
  }

  for (const child of root.children) {
    const match = findElement(child, selector);
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function findElements(
  root: MobileElementSnapshot,
  selector: ElementSelector
): MobileElementSnapshot[] {
  const descendants = root.children.flatMap((child) => findElements(child, selector));
  return matches(root, selector) ? [root, ...descendants] : descendants;
}

export function matches(element: MobileElementSnapshot, selector: ElementSelector): boolean {
  switch (selector.strategy) {
    case 'accessibility':
      return matchValue(element.label, selector) || matchValue(element.id, selector);
    case 'id':
      return matchValue(element.id, selector);
    case 'role':
      return hasRole(element, selector.value) && matchAccessibleName(element, selector);
    case 'text':
      return matchValue(element.text, selector) || matchValue(element.label, selector);
    case 'type':
      if (selector.value.trim().toLowerCase() === 'any') {
        return true;
      }
      return matchValue(element.type, selector);
    case 'coordinates':
      return false;
    case 'xpath':
      throw new AsturError(
        'UNSUPPORTED_LOCATOR',
        'XPath is reserved for a future compatibility layer. Prefer by.label, by.id, by.text, or by.type.'
      );
  }
}

export function flattenTree(root: MobileElementSnapshot): MobileElementSnapshot[] {
  return [root, ...root.children.flatMap((child) => flattenTree(child))];
}

export function centerOf(bounds: Bounds): Coordinates {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  };
}

export function pointInBounds(bounds: Bounds, xRatio: number, yRatio: number): Coordinates {
  return {
    x: Math.round(bounds.x + bounds.width * xRatio),
    y: Math.round(bounds.y + bounds.height * yRatio)
  };
}

function scrollGesture(region: Bounds, direction: ScrollDirection, durationMs: number): SwipeGesture {
  const near = 0.78;
  const far = 0.25;

  switch (direction) {
    case 'up':
      return { start: pointInBounds(region, 0.5, far), end: pointInBounds(region, 0.5, near), durationMs };
    case 'left':
      return { start: pointInBounds(region, far, 0.5), end: pointInBounds(region, near, 0.5), durationMs };
    case 'right':
      return { start: pointInBounds(region, near, 0.5), end: pointInBounds(region, far, 0.5), durationMs };
    case 'down':
    default:
      return { start: pointInBounds(region, 0.5, near), end: pointInBounds(region, 0.5, far), durationMs };
  }
}

function withKeyboardDefault<TOptions extends object>(
  session: PlatformSession,
  options: TOptions
): TOptions & { keyboard?: TapOptions['keyboard'] } {
  if ('keyboard' in options && options.keyboard !== undefined) {
    return options as TOptions & { keyboard?: TapOptions['keyboard'] };
  }

  return {
    ...options,
    keyboard: session.capabilities.keyboard.dismiss
  };
}

export function formatSelector(selector: ElementSelector): string {
  const base = `${selector.strategy}=${JSON.stringify(selector.value)}`;
  return selector.name === undefined ? base : `${base}[name=${formatExpected(selector.name)}]`;
}

function matchValue(actual: string | undefined, selector: ElementSelector): boolean {
  return matchExpected(actual, selector.value, selector.exact);
}

function matchAccessibleName(element: MobileElementSnapshot, selector: ElementSelector): boolean {
  if (selector.name === undefined) {
    return true;
  }

  const name = selector.name;
  return [
    element.label,
    element.text,
    element.value,
    element.id
  ].some((candidate) => matchExpected(candidate, name, selector.exact));
}

function matchExpected(actual: string | undefined, expected: string | RegExp, exact = true): boolean {
  if (!actual) {
    return false;
  }

  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    const pass = expected.test(actual);
    expected.lastIndex = 0;
    return pass;
  }

  return exact === false ? actual.includes(expected) : actual === expected;
}

function hasRole(element: MobileElementSnapshot, role: string): boolean {
  return rolesForElement(element).includes(normalizeRole(role));
}

function rolesForElement(element: MobileElementSnapshot): string[] {
  const type = element.type.toLowerCase();
  const roles = new Set<string>();

  if (type.includes('button')) {
    roles.add('button');
  }

  if (type.includes('checkbox')) {
    roles.add('checkbox');
  }

  if (type.includes('image')) {
    roles.add('image');
    roles.add('img');
  }

  if (type.includes('link')) {
    roles.add('link');
  }

  if (type.includes('menuitem')) {
    roles.add('menuitem');
  }

  if (type.includes('radiobutton') || type.endsWith('.radio') || type.includes('radio')) {
    roles.add('radio');
  }

  if (type.includes('seekbar') || type.includes('slider')) {
    roles.add('slider');
  }

  if (type.includes('switch')) {
    roles.add('switch');
  }

  if (type.includes('tab')) {
    roles.add('tab');
  }

  if (type.includes('edittext')
    || type.includes('textfield')
    || type.includes('securetextfield')
    || type.includes('searchfield')
    || type.includes('textinput')) {
    roles.add('textbox');
  }

  if (type.includes('textview')
    || type.includes('statictext')
    || type.includes('label')) {
    roles.add('text');
  }

  return [...roles];
}

function normalizeRole(role: string): string {
  return role === 'img' ? 'img' : role.trim().toLowerCase();
}

function formatExpected(expected: string | RegExp): string {
  return expected instanceof RegExp ? expected.toString() : JSON.stringify(expected);
}

function isCoordinates(target: MobileLocator | Coordinates): target is Coordinates {
  return typeof (target as Coordinates).x === 'number' && typeof (target as Coordinates).y === 'number';
}
