import type {
  AndroidNativeSelector,
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
} from '@astur-mobile/protocol';
import { AsturError } from './errors.js';
import { cropPng, maskPng, pngSize, screenshotScale, toPixelRect, type ImageSize } from './image.js';
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
  },

  /**
   * Escape hatch for elements the semantic tree match (id/label/text/role/type)
   * cannot express — most often a screen with no accessibility metadata, where
   * the only way to pin an element down is by structure or by combining several
   * native conditions at once. Requires a connected native agent; see
   * {@link NativeSelectorPayload} for the exact platform semantics.
   *
   * Provide whichever platform(s) the test needs to run on:
   * ```ts
   * by.native({
   *   ios: "type == 'Button' AND label CONTAINS 'Save'",
   *   android: { className: 'android.widget.Button', textContains: 'Save' }
   * })
   * ```
   */
  native(payload: { ios?: string; android?: AndroidNativeSelector; instance?: number }): ElementSelector {
    if (!payload.ios && !payload.android) {
      throw new AsturError(
        'NATIVE_SELECTOR_EMPTY',
        'by.native() requires at least one of `ios` or `android`.'
      );
    }

    return {
      strategy: 'native',
      value: formatNativeSelectorValue(payload),
      exact: true,
      native: { ios: payload.ios, android: payload.android, instance: payload.instance }
    };
  }
};

function formatNativeSelectorValue(payload: { ios?: string; android?: AndroidNativeSelector; instance?: number }): string {
  const parts: string[] = [];
  if (payload.ios) {
    parts.push(`ios:${JSON.stringify(payload.ios)}`);
  }
  if (payload.android) {
    parts.push(`android:${JSON.stringify(payload.android)}`);
  }
  if (payload.instance !== undefined) {
    parts.push(`instance:${payload.instance}`);
  }
  return parts.join(' ');
}

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
        return this.settleAfterScroll(match);
      }
    }

    return this.settleAfterScroll(await this.waitForVisible({
      ...options,
      message: options.message
        ?? `Timed out scrolling ${direction} to reveal ${formatSelector(this.selector)} after ${maxScrolls} scroll attempts`
    }));
  }

  /**
   * Waits for the element's bounds to stop moving after a scroll. A scroll gesture
   * leaves residual momentum: the element can be "visible" while the list is still
   * decelerating, so its reported bounds keep drifting for a few frames. Returning
   * (or letting a caller tap) on those mid-flight bounds lands the tap in the wrong
   * place. Poll until two consecutive reads agree, capped so a continuously
   * animating neighbour can't hang the call.
   */
  private async settleAfterScroll(initial: MobileElementSnapshot): Promise<MobileElementSnapshot> {
    let previous = initial;
    const deadline = Date.now() + 1_500;

    while (Date.now() < deadline) {
      await delay(120);
      const next = await this.currentMatch();
      if (!next?.visible) {
        continue;
      }
      if (boundsRoughlyEqual(previous.bounds, next.bounds)) {
        return next;
      }
      previous = next;
    }

    return previous;
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

  async waitFor(options: WaitOptions & { state?: 'visible' | 'hidden' | 'attached' } = {}): Promise<void> {
    const { state = 'visible', ...wait } = options;
    if (state === 'hidden') {
      await this.waitForHidden(wait);
      return;
    }
    if (state === 'attached') {
      await this.waitForSnapshot(() => true, wait);
      return;
    }
    await this.waitForVisible(wait);
  }

  async count(): Promise<number> {
    return (await this.queryAll()).length;
  }

  async clear(options: WaitOptions & ElementFillOptions = {}): Promise<void> {
    await this.fill('', options);
  }

  async textContent(options: WaitOptions = {}): Promise<string> {
    return (await this.snapshot(options)).text ?? '';
  }

  async inputValue(options: WaitOptions = {}): Promise<string> {
    const snapshot = await this.snapshot(options);
    return snapshot.value ?? snapshot.text ?? '';
  }

  async bounds(options: WaitOptions = {}): Promise<Bounds> {
    return (await this.snapshot(options)).bounds;
  }

  /**
   * A PNG of just this element, cropped out of a full-screen capture.
   *
   * Cropping on the host rather than asking the platform for an element capture
   * keeps one code path across every driver, and the platforms that can do it
   * natively disagree about what "the element" includes (shadows, ripples).
   *
   * Masks are applied to the whole screen before the crop, because a mask is
   * expressed in screen coordinates — masking after the crop would need every
   * rect translated into the element's space for no benefit.
   */
  async screenshot(options: WaitOptions & { mask?: MobileLocator[] } = {}): Promise<Buffer> {
    const bounds = await this.bounds(options);
    const image = await captureMaskedScreenshot(this.session, options.mask);
    const { size, scale } = await screenshotGeometry(this.session, image);

    return cropPng(image, toPixelRect(bounds, scale, size));
  }

  /** Identifies the device a baseline belongs to. See {@link screenshotKey}. */
  async screenshotKey(): Promise<string> {
    return screenshotKey(this.session);
  }

  async isEnabled(options: WaitOptions = {}): Promise<boolean> {
    return (await this.snapshot(options)).enabled;
  }

  async isDisabled(options: WaitOptions = {}): Promise<boolean> {
    return !(await this.isEnabled(options));
  }

  async isSelected(options: WaitOptions = {}): Promise<boolean> {
    return (await this.snapshot(options)).selected === true;
  }

  async isFocused(options: WaitOptions = {}): Promise<boolean> {
    return (await this.snapshot(options)).focused === true;
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
        'XPath is reserved and not implemented. For cases by.label/by.id/by.text/by.type/by.role cannot express, use by.native({ ios, android }) instead.'
      );
    case 'native':
      throw new AsturError(
        'NATIVE_SELECTOR_REQUIRES_AGENT',
        'by.native() selectors resolve on the native agent and cannot be matched against a cached UI-tree snapshot. Use agent.mode: "required" (recommended), or ensure a native agent is connected in "auto" mode.'
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

/** Bounds equality with a small tolerance, used to detect when a scroll has stopped drifting. */
function boundsRoughlyEqual(a: Bounds, b: Bounds, tolerance = 2): boolean {
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance;
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

/**
 * A full-screen capture with any masked regions painted out, plus the factor
 * needed to map element bounds onto its pixels.
 *
 * Shared by device and element screenshots so both resolve the scale the same
 * way — the two spaces are identical on Android but differ by the device pixel
 * ratio on iOS, and getting that wrong crops the wrong part of the screen.
 */
export async function captureMaskedScreenshot(
  session: PlatformSession,
  mask?: MobileLocator[]
): Promise<Buffer> {
  const image = await session.screenshot();

  // Nothing to mask means nothing to measure. Decoding the header regardless
  // would make a plain screenshot fail on any driver whose capture this code
  // does not need to understand.
  if (!mask?.length) {
    return image;
  }

  const { size, scale } = await screenshotGeometry(session, image);
  const rects: Bounds[] = [];
  for (const locator of mask) {
    // A mask that matches nothing is not a failure: masking an element that
    // only appears sometimes is a normal reason to mask it in the first place.
    const bounds = await locator.bounds({ timeout: 1_000 }).catch(() => undefined);
    if (bounds) {
      rects.push(toPixelRect(bounds, scale, size));
    }
  }

  return maskPng(image, rects);
}

/** Image dimensions plus how element bounds map onto them. */
export async function screenshotGeometry(
  session: PlatformSession,
  image: Buffer
): Promise<{ size: ImageSize; scale: number }> {
  const size = pngSize(image);
  const viewport = await resolveViewport(session, size);

  return { size, scale: screenshotScale(size, viewport) };
}

/**
 * Identifies which device a baseline was recorded on.
 *
 * Resolution alone is not enough: a React Native and a Flutter build of the
 * same screen render differently on the same emulator, and comparing across
 * them produces a diff that looks like a regression instead of a mismatch.
 */
export async function screenshotKey(session: PlatformSession): Promise<string> {
  const info = session.deviceInfo;
  const viewport = await resolveViewport(session, { width: 0, height: 0 });
  const engine = info.uiEngine ?? 'native';

  return `${info.platform}-${engine}-${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
}

async function resolveViewport(session: PlatformSession, fallback: ImageSize): Promise<Bounds> {
  if (!session.getViewport) {
    return { x: 0, y: 0, ...fallback };
  }

  return await session.getViewport().catch(() => ({ x: 0, y: 0, ...fallback }));
}
