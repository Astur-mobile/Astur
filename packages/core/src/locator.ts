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

  /**
   * Placeholder / hint text of an empty input.
   *
   * Neither platform exposes this as a first-class accessibility field, so it
   * is read from the driver's raw attributes where they carry it (`hint` on
   * Android, `placeholderValue` on iOS) and falls back to the element's own
   * value or label when the field is empty — which is how a placeholder
   * surfaces on a field the user has not typed into. See {@link placeholderOf}.
   */
  placeholder(value: string, options?: { exact?: boolean }): ElementSelector {
    return { strategy: 'placeholder', value, exact: options?.exact ?? true };
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

/** Narrowing predicate for {@link MobileLocator.filter}. */
export interface LocatorFilter {
  /** Keep matches whose own text, or any descendant's, contains this. */
  hasText?: string | RegExp;
  /** Drop matches whose own text, or any descendant's, contains this. */
  hasNotText?: string | RegExp;
  /** Keep matches containing at least one element the given locator matches. */
  has?: MobileLocator;
  /** Drop matches containing an element the given locator matches. */
  hasNot?: MobileLocator;
}

/**
 * Everything layered on top of a locator's base selector.
 *
 * Held separately rather than folded into {@link ElementSelector} because a
 * selector is the atom the native agents understand. A locator carrying no
 * refinement is still handed to the agent whole, exactly as before; only a
 * refined one is resolved here against a tree snapshot.
 */
interface LocatorRefinement {
  /** Search only within this locator's matches. */
  within?: MobileLocator;
  filters: LocatorFilter[];
  /** Intersected with the base match set. */
  and: MobileLocator[];
  /** Unioned with the base match set. */
  or: MobileLocator[];
  /** Positional narrowing, applied last. Negative counts from the end. */
  index?: number;
}

function emptyRefinement(): LocatorRefinement {
  return { filters: [], and: [], or: [] };
}

export class MobileLocator {
  readonly selector: ElementSelector;
  private readonly session: PlatformSession;
  /** `undefined` for a plain locator — the fast path that reaches the agent untouched. */
  private readonly refinement?: LocatorRefinement;

  constructor(session: PlatformSession, selector: ElementSelector, refinement?: LocatorRefinement) {
    this.session = session;
    this.selector = selector;
    this.refinement = refinement;
  }

  /**
   * True when this locator is nothing but its base selector.
   *
   * Every action checks this before taking a driver's element fast path: those
   * take an {@link ElementSelector}, which cannot carry a refinement, so a
   * refined locator has to resolve here and act on the resulting coordinates.
   */
  private get isPlain(): boolean {
    return this.refinement === undefined;
  }

  private derive(change: Partial<LocatorRefinement>): MobileLocator {
    const base = this.refinement ?? emptyRefinement();
    return new MobileLocator(this.session, this.selector, { ...base, ...change });
  }

  /** Scope a child lookup to this locator's matches. */
  private scoped(selector: ElementSelector): MobileLocator {
    return new MobileLocator(this.session, selector, { ...emptyRefinement(), within: this });
  }

  locator(selector: ElementSelector): MobileLocator {
    return this.scoped(selector);
  }

  getByLabel(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.label(value, options));
  }

  getByA11y(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.a11y(value, options));
  }

  getByText(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.text(value, options));
  }

  getByTestId(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.testId(value, options));
  }

  getById(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.id(value, options));
  }

  getByRole(role: MobileRole | string, options?: RoleSelectorOptions): MobileLocator {
    return this.scoped(by.role(role, options));
  }

  getByType(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.type(value, options));
  }

  getByPlaceholder(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.scoped(by.placeholder(value, options));
  }

  /**
   * Narrow a locator that matches several elements.
   *
   * ```ts
   * device.getByType('Cell').filter({ hasText: 'In stock' })
   * ```
   *
   * Repeated calls stack: every filter must pass.
   */
  filter(filter: LocatorFilter): MobileLocator {
    const base = this.refinement ?? emptyRefinement();
    return this.derive({ filters: [...base.filters, filter] });
  }

  /** Match elements this locator and `other` both match. */
  and(other: MobileLocator): MobileLocator {
    const base = this.refinement ?? emptyRefinement();
    return this.derive({ and: [...base.and, other] });
  }

  /** Match elements either this locator or `other` matches, in document order. */
  or(other: MobileLocator): MobileLocator {
    const base = this.refinement ?? emptyRefinement();
    return this.derive({ or: [...base.or, other] });
  }

  first(): MobileLocator {
    return this.nth(0);
  }

  last(): MobileLocator {
    return this.nth(-1);
  }

  /** Match at `index`; negative counts from the end, so `-1` is the last. */
  nth(index: number): MobileLocator {
    return this.derive({ index });
  }

  async tap(options: WaitOptions & TapOptions = {}): Promise<void> {
    if (this.isPlain && this.session.tapElement) {
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
    if (this.isPlain && this.session.doubleTapElement) {
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
    if (this.isPlain && this.session.longPressElement) {
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
    if (this.isPlain && this.session.dragElement) {
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
    if (this.isPlain) {
      return this.session.findElement
        ? this.session.findElement(this.selector)
        : findElement(await this.session.getTree(), this.selector);
    }

    return (await this.queryAll())[0];
  }

  /**
   * A plain locator addressing the same element, when the element can be named
   * on its own.
   *
   * A composed locator cannot be handed to a driver, because the drivers take
   * an {@link ElementSelector} and a refinement does not fit in one. Falling
   * straight to coordinates would work for pointer actions but quietly lose
   * everything else the drivers do — clearing a field before typing, waiting
   * on the IME, honouring per-element options. So before giving up on the fast
   * path, check whether the resolved element happens to be uniquely
   * identifiable by an id, label, or text of its own. In a list of look-alike
   * rows nothing will be unique and this returns `undefined`; for the far more
   * common "the field inside that section" it succeeds, and the composed
   * locator then behaves exactly like a plain one.
   */
  private async plainEquivalent(): Promise<MobileLocator | undefined> {
    if (this.isPlain) {
      return this;
    }

    const tree = await this.session.getTree();
    const element = this.resolveAgainst(tree, documentOrder(tree))[0];
    if (!element) {
      return undefined;
    }

    const candidates = [
      element.id === undefined ? undefined : by.id(element.id),
      element.label === undefined ? undefined : by.label(element.label),
      element.text === undefined ? undefined : by.text(element.text)
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const found = findElements(tree, candidate);
      if (found.length === 1 && found[0] === element) {
        return new MobileLocator(this.session, candidate);
      }
    }

    return undefined;
  }

  private async scrollRegion(): Promise<Bounds> {
    if (this.session.getViewport) {
      return this.session.getViewport();
    }

    return (await this.session.getTree()).bounds;
  }

  async fill(value: string, options: WaitOptions & ElementFillOptions = {}): Promise<void> {
    if (!this.isPlain) {
      const plain = await this.plainEquivalent();
      if (plain) {
        await plain.fill(value, options);
        return;
      }

      // Nothing names this element on its own, so the drivers' selector-based
      // fill is out of reach. Focus it by tapping and type into that focus.
      if (!this.session.typeText) {
        throw new AsturError(
          'COMPOSED_LOCATOR_FILL_UNSUPPORTED',
          `Cannot fill ${formatSelector(this.selector)} through a composed locator: the element is not uniquely identifiable on its own, and this platform cannot type into the focused element. Target the field with a plain locator instead.`
        );
      }

      const target = await this.waitForVisible(options);
      await preparePointerTargetForKeyboard(this.session, centerOf(target.bounds), options.keyboard);
      await this.session.tap(centerOf(target.bounds));
      await this.session.typeText(value);
      return;
    }

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
    if (this.isPlain && this.session.waitForElement) {
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
    if (this.isPlain && this.session.waitForElementHidden) {
      await this.session.waitForElementHidden(this.selector, options);
      return;
    }

    await waitFor(
      async () => {
        const match = await this.currentMatch();
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
        const match = await this.currentMatch();
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
    if (this.isPlain) {
      return this.session.findElements
        ? this.session.findElements(this.selector)
        : findElements(await this.session.getTree(), this.selector);
    }

    // A refinement is relative to a whole tree, so it must be resolved against
    // one snapshot. Taking a single snapshot also keeps the comparison honest:
    // resolving each stage with its own query could interleave with a UI
    // change and produce a set that never existed on screen at one instant.
    const tree = await this.session.getTree();
    return this.resolveAgainst(tree, documentOrder(tree));
  }

  /**
   * Resolve selector + refinement against one tree snapshot.
   *
   * Order matters and mirrors how the API reads left to right: scope, then the
   * base match, then set combination, then filters, then position. `nth` last
   * is what makes `.filter(...).first()` mean "first of the filtered set"
   * rather than "the first match, if it survives the filter".
   */
  /** @internal — module-level helpers resolve nested locators through this. */
  resolveAgainst(
    tree: MobileElementSnapshot,
    order: Map<MobileElementSnapshot, number>
  ): MobileElementSnapshot[] {
    const refinement = this.refinement;
    if (!refinement) {
      return findElements(tree, this.selector);
    }

    let matches: MobileElementSnapshot[];
    if (refinement.within) {
      // Strict descendants: a parent does not contain itself.
      const roots = refinement.within.resolveAgainst(tree, order);
      matches = roots.flatMap((root) => root.children.flatMap((child) => findElements(child, this.selector)));
    } else {
      matches = findElements(tree, this.selector);
    }

    for (const other of refinement.and) {
      const allowed = new Set(other.resolveAgainst(tree, order));
      matches = matches.filter((element) => allowed.has(element));
    }

    for (const other of refinement.or) {
      matches = matches.concat(other.resolveAgainst(tree, order));
    }

    matches = sortByDocumentOrder(dedupe(matches), order);

    for (const filter of refinement.filters) {
      matches = matches.filter((element) => this.passesFilter(element, filter, tree, order));
    }

    if (refinement.index !== undefined) {
      const index = refinement.index < 0 ? matches.length + refinement.index : refinement.index;
      const picked = matches[index];
      return picked ? [picked] : [];
    }

    return matches;
  }

  private passesFilter(
    element: MobileElementSnapshot,
    filter: LocatorFilter,
    tree: MobileElementSnapshot,
    order: Map<MobileElementSnapshot, number>
  ): boolean {
    if (filter.hasText !== undefined && !textMatches(subtreeText(element), filter.hasText)) {
      return false;
    }
    if (filter.hasNotText !== undefined && textMatches(subtreeText(element), filter.hasNotText)) {
      return false;
    }
    if (filter.has !== undefined && !containsMatch(element, filter.has, tree, order)) {
      return false;
    }
    if (filter.hasNot !== undefined && containsMatch(element, filter.hasNot, tree, order)) {
      return false;
    }
    return true;
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

  /**
   * Checked state of a checkbox, switch, radio, or toggle.
   *
   * Throws rather than returning `false` when the element reports no checked
   * state at all — "this is not a checkable control" is a different fact from
   * "it is unchecked", and silently conflating them turns a mis-aimed locator
   * into a passing assertion.
   */
  async isChecked(options: WaitOptions = {}): Promise<boolean> {
    const element = await this.snapshot(options);
    const checked = checkedStateOf(element);
    if (checked === undefined) {
      throw new AsturError(
        'ELEMENT_NOT_CHECKABLE',
        `${formatSelector(this.selector)} reports no checked state. It resolved to a ${element.type}, which is not a checkbox, switch, radio button, or toggle.`
      );
    }
    return checked;
  }

  /** True when the element and everything beneath it carry no text at all. */
  async isEmpty(options: WaitOptions = {}): Promise<boolean> {
    return subtreeText(await this.snapshot(options)).trim().length === 0;
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
    case 'placeholder': {
      const placeholder = placeholderOf(element);
      return placeholder === undefined ? false : matchValue(placeholder, selector);
    }
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

/**
 * Placeholder / hint text for an element, or `undefined` when it has none.
 *
 * Read from the driver's raw attributes first, because that is the only place
 * either platform reports it faithfully. The fallback covers the common case
 * the raw attributes miss: an *empty* field whose only visible string is the
 * placeholder, which both platforms surface as the value or the label. A field
 * the user has typed into reports its content there instead, so the fallback is
 * deliberately skipped once `text` is present — otherwise typing into a field
 * would silently change what `getByPlaceholder` matches.
 */
export function placeholderOf(element: MobileElementSnapshot): string | undefined {
  const raw = element.raw;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['hint', 'hintText', 'placeholder', 'placeholderValue']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }

  // Only an empty field can be showing its placeholder.
  if (element.text !== undefined && element.text.length > 0) {
    return undefined;
  }

  return emptyToUndefined(element.value) ?? emptyToUndefined(element.label);
}

/**
 * Checked state of a checkbox, switch, radio, or toggle.
 *
 * Prefers the driver's own report. Where a driver does not carry one, the state
 * is derived from the raw attributes and then from the value string the
 * platforms use for toggles (`"1"`, `"true"`, `"on"`). Returns `undefined`
 * rather than `false` when nothing answers, so "this element has no checked
 * state" stays distinguishable from "it is unchecked".
 */
export function checkedStateOf(element: MobileElementSnapshot): boolean | undefined {
  if (element.checked !== undefined) {
    return element.checked;
  }

  const raw = element.raw;
  if (raw && typeof raw === 'object') {
    const value = (raw as Record<string, unknown>).checked;
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string' && value.length > 0) {
      return value === 'true';
    }
  }

  if (!isToggleType(element.type)) {
    return undefined;
  }

  const value = element.value?.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  if (value === '0' || value === 'false' || value === 'off') {
    return false;
  }

  return element.selected;
}

function isToggleType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized.includes('switch')
    || normalized.includes('checkbox')
    || normalized.includes('toggle')
    || normalized.includes('radio');
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Every text-ish string an element carries, used by `filter({ hasText })`. */
function textOf(element: MobileElementSnapshot): string {
  return [element.text, element.label, element.value].filter(Boolean).join(' ');
}

/** Concatenated text of an element and everything beneath it. */
export function subtreeText(element: MobileElementSnapshot): string {
  return flattenTree(element).map(textOf).join(' ');
}

function textMatches(haystack: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(haystack) : haystack.includes(expected);
}

/** Position of every node in a pre-order walk, so unions can be re-sorted. */
function documentOrder(tree: MobileElementSnapshot): Map<MobileElementSnapshot, number> {
  const order = new Map<MobileElementSnapshot, number>();
  flattenTree(tree).forEach((element, index) => order.set(element, index));
  return order;
}

function sortByDocumentOrder(
  elements: MobileElementSnapshot[],
  order: Map<MobileElementSnapshot, number>
): MobileElementSnapshot[] {
  return [...elements].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Identity here is object identity, which holds because every stage resolves
 * against the same snapshot object. Two elements with identical fields are
 * still two elements, and that is the behaviour a list of look-alike rows
 * needs.
 */
function dedupe(elements: MobileElementSnapshot[]): MobileElementSnapshot[] {
  return [...new Set(elements)];
}

/** Does `candidate`'s subtree contain anything `locator` matches? */
function containsMatch(
  candidate: MobileElementSnapshot,
  locator: MobileLocator,
  tree: MobileElementSnapshot,
  order: Map<MobileElementSnapshot, number>
): boolean {
  const withinCandidate = new Set(flattenTree(candidate));
  return locator
    .resolveAgainst(tree, order)
    .some((element) => element !== candidate && withinCandidate.has(element));
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
  // `renderer` first: on iOS the tree engine is always 'native', so keying on
  // `uiEngine` alone would hand a Flutter build the React Native baseline.
  const engine = info.renderer ?? info.uiEngine ?? 'native';

  return `${info.platform}-${engine}-${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
}

async function resolveViewport(session: PlatformSession, fallback: ImageSize): Promise<Bounds> {
  if (!session.getViewport) {
    return { x: 0, y: 0, ...fallback };
  }

  return await session.getViewport().catch(() => ({ x: 0, y: 0, ...fallback }));
}
