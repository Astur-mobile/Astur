import {
  by,
  centerOf,
  flattenTree,
  pointInBounds,
  type AsturDevice,
  type Bounds,
  type MobileElementSnapshot,
  type MobileLocator
} from '@astur/test';

type DemoTab = 'home' | 'web' | 'login' | 'forms' | 'swipe' | 'drag';

const screenTitles: Record<DemoTab, string> = {
  home: 'Demo',
  web: 'Web Lab',
  login: 'Credentials',
  forms: 'Input controls',
  swipe: 'Capability carousel',
  drag: 'Drag & Drop'
};

export type TapLabCounters = {
  singleTaps: number;
  doubleTaps: number;
  longPresses: number;
};

export class AsturDemoApp {
  readonly home: HomePage;
  readonly login: LoginPage;
  readonly forms: FormsPage;
  readonly swipe: SwipePage;
  readonly drag: DragPage;
  readonly web: WebLabPage;
  readonly menu: MenuDrawer;
  readonly nav: BottomNavigation;

  constructor(private readonly device: AsturDevice) {
    this.home = new HomePage(device);
    this.login = new LoginPage(device);
    this.forms = new FormsPage(device);
    this.swipe = new SwipePage(device);
    this.drag = new DragPage(device);
    this.web = new WebLabPage(device);
    this.menu = new MenuDrawer(device);
    this.nav = new BottomNavigation(device);
  }

  get platform(): AsturDevice['deviceInfo']['platform'] {
    return this.device.deviceInfo.platform;
  }

  async launch(): Promise<void> {
    await this.device.app.launch();
    await this.waitForAppShell();
    await this.nav.open('home');
  }

  async reset(): Promise<void> {
    await this.device.setOrientation('portrait').catch(() => undefined);

    if (isIos(this.device)) {
      await this.device.app.terminate().catch(() => undefined);
      await this.device.app.launch().catch(() => undefined);
      await this.waitForAppShell();
      if (await this.closeMenuIfOpen()) {
        return;
      }

      await this.nav.open('home');
      return;
    }

    if (!isIos(this.device)) {
      await this.device.navigation.home().catch(() => undefined);
    }

    await this.device.app.terminate().catch(() => undefined);
    await this.device.app.launch();
    await this.waitForAppShell();
    await this.nav.open('home');
  }

  private async waitForAppShell(): Promise<void> {
    await waitForAnyVisible([this.home.screen, this.home.title, this.nav.home, this.nav.menu], 20_000);
  }

  private async closeMenuIfOpen(): Promise<boolean> {
    const backdrop = await this.menu.backdrop.snapshot({ timeout: 300 }).catch(() => undefined);
    if (backdrop?.visible) {
      await this.device.tap(centerOf(backdrop.bounds));
      await delay(300);
      return false;
    }

    if (await this.menu.home.isVisible({ timeout: 300 }).catch(() => false)) {
      await this.device.tap({ x: 20, y: 300 });
      await delay(300);
      return false;
    }

    return false;
  }
}

export class BottomNavigation {
  constructor(private readonly device: AsturDevice) {}

  get home() {
    return this.tabLocator('home');
  }

  get web(): MobileLocator {
    return this.tabLocator('web');
  }

  get login(): MobileLocator {
    return this.tabLocator('login');
  }

  get forms(): MobileLocator {
    return this.tabLocator('forms');
  }

  get swipe(): MobileLocator {
    return this.tabLocator('swipe');
  }

  get drag(): MobileLocator {
    return this.tabLocator('drag');
  }

  get menu(): MobileLocator {
    return this.device.getById('tab-menu');
  }

  async open(tab: DemoTab | 'menu'): Promise<void> {
    if (tab === 'menu') {
      await this.menu.tap();
      await this.menuNavLocator('home').waitForVisible();
      return;
    }

    const screen = this.screenLocator(tab);
    if (await screen.isVisible({ timeout: tab === 'home' ? 4_000 : 500 })) {
      return;
    }

    if (isIos(this.device)) {
      await this.tabLocator(tab).tap({ timeout: 4_000 });
      await screen.waitForVisible({ timeout: 4_000 });
      return;
    }

    if (await this.menuNavLocator('home').isVisible({ timeout: 200 })) {
      await this.menuNavLocator(tab).tap({ timeout: 4_000 });
      await screen.waitForVisible({ timeout: 4_000 });
      return;
    }

    try {
      await this.tabLocator(tab).tap({ timeout: 4_000 });
      await screen.waitForVisible({ timeout: 4_000 });
      return;
    } catch {
      await this.menu.tap({ timeout: 4_000 });
      await this.menuNavLocator('home').waitForVisible({ timeout: 4_000 });
      await this.menuNavLocator(tab).tap({ timeout: 4_000 });
    }

    await screen.waitForVisible({ timeout: 4_000 });
  }

  private tabLocator(tab: DemoTab): MobileLocator {
    return this.device.getById(`tab-${tab}`);
  }

  private menuNavLocator(tab: DemoTab): MobileLocator {
    return this.device.getById(`menu-nav-${tab}`);
  }

  private screenLocator(tab: DemoTab): MobileLocator {
    return isIos(this.device) ? this.device.getByText(screenTitles[tab]) : this.device.getById(`screen-${tab}`);
  }
}

export class HomePage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-home');
  }

  get title(): MobileLocator {
    return this.device.getByText('Demo');
  }

  get heroCard(): MobileLocator {
    return this.device.getById('home-hero-card');
  }

  get openMenuButton(): MobileLocator {
    return this.device.getById('home-open-menu');
  }

  get permissionsButton(): MobileLocator {
    return this.device.getById('home-open-permissions');
  }

  get tapLabCard(): MobileLocator {
    return this.device.getById('home-tap-lab-card');
  }

  get tapTarget(): MobileLocator {
    return this.device.getById('home-tap-target');
  }

  async revealTapLaboratory(): Promise<void> {
    if (!isIos(this.device)) {
      await this.tapLabCard.scrollIntoView({ direction: 'down', maxScrolls: 5 });
      return;
    }

    // iOS-specific: the tap counters render in a row just below the tap target.
    // It is not enough for the target to be "visible" — it must have room
    // beneath it in the viewport so the counters are on screen too, because
    // iosTapLabCounters() only reads counters that the tree reports as visible.
    // Do NOT simplify this to a plain scrollIntoView: that leaves the counters
    // clipped at the bottom edge and the counter read fails.
    const viewport = await this.device.viewport();
    const bottomLimit = viewport.y + viewport.height - 140;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const target = await this.tapTarget.snapshot({ timeout: 400 }).catch(() => undefined);
      if (target?.visible && target.bounds.y + target.bounds.height <= bottomLimit) {
        return;
      }

      await this.device.swipe({
        start: pointInBounds(viewport, 0.5, 0.82),
        end: pointInBounds(viewport, 0.5, 0.25),
        durationMs: 350
      });
    }

    await this.tapTarget.waitForVisible({ timeout: 4_000 });
  }

  async tapLabCounters(): Promise<TapLabCounters> {
    if (isIos(this.device)) {
      return this.iosTapLabCounters();
    }

    const card = findNodeById(await this.device.tree(), 'home-tap-lab-card');

    if (!card) {
      throw new Error('Tap laboratory card is not visible in the current UI tree.');
    }

    return {
      singleTaps: readCounter(card, 'SINGLE TAPS'),
      doubleTaps: readCounter(card, 'DOUBLE TAPS'),
      longPresses: readCounter(card, 'LONG PRESS')
    };
  }

  private async iosTapLabCounters(): Promise<TapLabCounters> {
    // Read the accessibility tree once and locate each counter by its visible
    // label, then the digit rendered beneath it — the same geometry approach
    // the Android path uses. This replaces a multi-selector findMany scan that
    // times out on the iOS simulator, where XCTest re-enumerates every static
    // text on the (text-heavy) screen for each selector.
    const nodes = flattenTree(await this.device.tree()).filter((node) => node.visible);

    return {
      singleTaps: readCounterFromNodes(nodes, 'SINGLE TAPS'),
      doubleTaps: readCounterFromNodes(nodes, 'DOUBLE TAPS'),
      longPresses: readCounterFromNodes(nodes, 'LONG PRESS')
    };
  }

  async visibleIosTapLabCounterValues(values: number[]): Promise<number[]> {
    const target = await this.tapTarget.snapshot({ timeout: 1_000 });
    const candidates: Array<{ value: number; node: MobileElementSnapshot }> = [];

    for (const value of values) {
      candidates.push(
        ...(await this.device.getByText(String(value)).queryAll()).map((node) => ({ value, node }))
      );
    }

    const uniqueCounters = uniqueByBounds(candidates.map(({ node }) => node))
      .filter((node) => node.visible)
      .filter((node) => node.bounds.y >= target.bounds.y + target.bounds.height - 4)
      .filter((node) => horizontalOverlap(node.bounds, target.bounds) > 0)
      .sort((a, b) => a.bounds.x - b.bounds.x);

    return uniqueCounters
      .map((node) => candidates.find((candidate) => candidate.node === node || sameBounds(candidate.node, node))?.value)
      .filter((value): value is number => value !== undefined);
  }
}

export class LoginPage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-login');
  }

  get title(): MobileLocator {
    return this.device.getByText('Credentials');
  }

  get email(): MobileLocator {
    return this.device.getById('login-email-input');
  }

  get password(): MobileLocator {
    return this.device.getById('login-password-input');
  }

  get submit(): MobileLocator {
    return this.device.getById('login-submit-button');
  }

  get biometric(): MobileLocator {
    return this.device.getById('login-biometric-button');
  }

  get signUpSwitch(): MobileLocator {
    return this.device.getById('login-switch-signup');
  }

  get feedbackPanel(): MobileLocator {
    return this.device.getById('login-feedback-panel');
  }

  get statusTitle(): MobileLocator {
    return this.device.getByText('SIGN-IN STATUS');
  }

  async enterCredentials(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.device.keyboard.dismiss().catch(() => this.device.back());
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.enterCredentials(email, password);
    await this.submit.tap();
  }

  async revealFeedbackControls(): Promise<void> {
    await this.biometric.scrollIntoView({ direction: 'down', maxScrolls: 4 });
  }
}

export class FormsPage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-forms');
  }

  get title(): MobileLocator {
    return this.device.getByText('Input controls');
  }

  get textInput(): MobileLocator {
    return this.device.getById('forms-main-input');
  }

  get sliderLabel(): MobileLocator {
    return this.device.getByText('Slider');
  }

  get mirror(): MobileLocator {
    return this.device.getById('forms-input-mirror');
  }

  get toggle(): MobileLocator {
    return this.device.getById('forms-main-switch');
  }

  get slider(): MobileLocator {
    return this.device.getByRole('slider');
  }

  get sliderMinLabel(): MobileLocator {
    return this.device.getByText('0%');
  }

  get sliderMaxLabel(): MobileLocator {
    return this.device.getByText('100%');
  }

  get checkbox(): MobileLocator {
    return this.device.getById('forms-main-checkbox');
  }

  get dropdown(): MobileLocator {
    return this.device.getById('forms-dropdown-trigger');
  }

  get activeButton(): MobileLocator {
    return this.device.getById('forms-active-button');
  }

  get inactiveButton(): MobileLocator {
    return this.device.getById('forms-inactive-button');
  }

  get uploadCard(): MobileLocator {
    return this.device.getById('forms-upload-card');
  }

  get pickMediaButton(): MobileLocator {
    return this.device.getById('forms-pick-media-button');
  }

  get clearMediaButton(): MobileLocator {
    return this.device.getById('forms-clear-media-button');
  }

  get selectedAsset(): MobileLocator {
    return this.device.getById('forms-selected-asset');
  }

  get selectedAssetMetadata(): MobileLocator {
    return this.device.getByText('image', { exact: false });
  }

  async typeText(value: string): Promise<void> {
    await this.revealTextInput();
    await this.textInput.fill(value);
  }

  async revealTextInput(): Promise<void> {
    await this.textInput.scrollIntoView({ direction: 'up', maxScrolls: 6 });
  }

  async revealSlider(): Promise<void> {
    // The slider can sit above or below the current viewport depending on where
    // the previous step left the form, so search down first, then up.
    // scrollIntoView returns immediately if it is already on screen.
    try {
      await this.sliderLabel.scrollIntoView({ direction: 'down', maxScrolls: 4 });
    } catch {
      await this.sliderLabel.scrollIntoView({ direction: 'up', maxScrolls: 4 });
    }
  }

  async sliderPercent(): Promise<number> {
    const sliderSnapshot = await this.slider.snapshot({ timeout: 4_000 }).catch(() => undefined);
    const sliderValue = sliderSnapshot ? parsePercentFromNode(sliderSnapshot) : undefined;
    if (sliderValue !== undefined && sliderValue > 0 && sliderValue < 100) {
      return sliderValue;
    }

    const values = (await this.device.find(by.text('%', { exact: false })).all({ timeout: 750 }).catch(() => []))
      .filter((node) => node.visible)
      .map((node) => parsePercentFromNode(node))
      .filter((value): value is number => value !== undefined)
      .filter((value) => value > 0 && value < 100);

    if (!values.length) {
      throw new Error('Forms slider value percentage was not visible.');
    }

    return values[0];
  }

  async setSliderPercent(percent: number): Promise<void> {
    const target = clamp(percent, 5, 95);
    const bounds = await this.sliderTrackBounds();

    await this.device.swipe({
      start: pointInBounds(bounds, 0.5, 0.5),
      end: pointInBounds(bounds, target / 100, 0.5),
      durationMs: 650
    });
  }

  async revealActionButtons(): Promise<void> {
    await this.activeButton.scrollIntoView({ direction: 'down', maxScrolls: 4 });
  }

  private async sliderTrackBounds(): Promise<Bounds> {
    const roleSnapshot = await this.slider.snapshot({ timeout: 500 }).catch(() => undefined);
    if (roleSnapshot?.visible && roleSnapshot.bounds.width > 40) {
      return roleSnapshot.bounds;
    }

    const labels = await this.device.findMany([
      by.text('0%'),
      by.text('100%')
    ]);
    const minLabel = labels.find((node) => textOf(node) === '0%');
    const maxLabel = labels.find((node) => textOf(node) === '100%');

    if (!minLabel || !maxLabel) {
      throw new Error('Forms slider range labels were not visible.');
    }

    const labelHeight = Math.max(minLabel.bounds.height, maxLabel.bounds.height, 20);
    const labelTop = Math.min(minLabel.bounds.y, maxLabel.bounds.y);
    const x = minLabel.bounds.x;
    const right = maxLabel.bounds.x + maxLabel.bounds.width;

    return {
      x,
      y: Math.round(labelTop - labelHeight * 2.5),
      width: Math.max(1, right - x),
      height: Math.max(24, labelHeight)
    };
  }

  async revealUploadCard(): Promise<void> {
    await this.uploadCard.scrollIntoView({ direction: 'down', maxScrolls: 4 });
  }

  async chooseFirstVisibleMedia(): Promise<void> {
    await this.revealUploadCard();
    await this.pickMediaButton.tap();
    await this.device.getByLabel('Photo taken', { exact: false }).tap({ timeout: 10_000 });
    await this.selectedAsset.waitForVisible({ timeout: 10_000 });
  }
}

export class SwipePage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-swipe');
  }

  get title(): MobileLocator {
    return this.device.getByText('Capability carousel');
  }

  get carousel(): MobileLocator {
    return this.device.getById('swipe-carousel');
  }

  get introCard(): MobileLocator {
    return this.device.getById('swipe-card-intro');
  }

  get hybridCard(): MobileLocator {
    return this.device.getById('swipe-card-hybrid');
  }

  get verticalCard(): MobileLocator {
    return this.device.getById('swipe-vertical-card');
  }

  async swipeCarouselLeft(): Promise<void> {
    const carousel = await this.carousel.snapshot();
    await this.device.swipe({
      start: pointInBounds(carousel.bounds, 0.85, 0.5),
      end: pointInBounds(carousel.bounds, 0.15, 0.5),
      durationMs: 600
    });
  }

  async scrollToVerticalCard(): Promise<void> {
    await this.verticalCard.scrollIntoView({ direction: 'down' });
  }
}

export class DragPage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-drag');
  }

  get title(): MobileLocator {
    return this.device.getByText('Drag & Drop');
  }

  get reset(): MobileLocator {
    return this.device.getById('drag-reset-button');
  }

  get board(): MobileLocator {
    return this.device.getById('drag-board');
  }

  tileCount(count: number): MobileLocator {
    return this.device.getByText(`${count}/4 tiles placed`);
  }

  get solved(): MobileLocator {
    return this.device.getByText('Puzzle solved');
  }

  piece(id: 'north-west' | 'north-east' | 'south-west' | 'south-east'): MobileLocator {
    return this.device.getById(`drag-piece-${id}`);
  }

  slot(id: 'northWest' | 'northEast' | 'southWest' | 'southEast'): MobileLocator {
    return this.device.getById(`drag-slot-${id}`);
  }

  async solvePuzzle(): Promise<void> {
    await this.reset.tap();
    await this.piece('north-west').dragTo(this.slot('northWest'), { durationMs: 900 });
    await this.piece('north-east').dragTo(this.slot('northEast'), { durationMs: 900 });
    await this.piece('south-west').dragTo(centerOf((await this.slot('southWest').snapshot()).bounds), {
      durationMs: 900
    });

    const southEastPiece = await this.piece('south-east').snapshot();
    const southEastSlot = await this.slot('southEast').snapshot();
    await this.device.gestures.drag({
      start: centerOf(southEastPiece.bounds),
      end: centerOf(southEastSlot.bounds),
      durationMs: 900
    });
  }
}

export class WebLabPage {
  constructor(private readonly device: AsturDevice) {}

  get screen(): MobileLocator {
    return isIos(this.device) ? this.title : this.device.getById('screen-web');
  }

  get title(): MobileLocator {
    return this.device.getByText('Web Lab');
  }

  get overviewCard(): MobileLocator {
    return this.device.getById('web-overview-card');
  }

  get webViewCard(): MobileLocator {
    return this.device.getById('web-webview-card');
  }
}

export class MenuDrawer {
  constructor(private readonly device: AsturDevice) {}

  get backdrop(): MobileLocator {
    return this.device.getById('menu-backdrop');
  }

  get home(): MobileLocator {
    return this.device.getById('menu-nav-home');
  }

  get web(): MobileLocator {
    return this.device.getById('menu-nav-web');
  }

  get login(): MobileLocator {
    return this.device.getById('menu-nav-login');
  }

  get forms(): MobileLocator {
    return this.device.getById('menu-nav-forms');
  }

  get swipe(): MobileLocator {
    return this.device.getById('menu-nav-swipe');
  }

  get drag(): MobileLocator {
    return this.device.getById('menu-nav-drag');
  }

  get permissions(): MobileLocator {
    return this.device.getById('menu-nav-permissions');
  }

  get portraitOrientation(): MobileLocator {
    return this.device.getByText('Portrait view active');
  }

  get landscapeOrientation(): MobileLocator {
    return this.device.getByText('Landscape view active');
  }

  async close(): Promise<void> {
    if (await this.backdrop.isVisible({ timeout: 300 })) {
      await this.backdrop.tap();
      return;
    }

    await this.device.back().catch(() => undefined);
  }
}

function findNodeById(root: MobileElementSnapshot, id: string): MobileElementSnapshot | undefined {
  return flattenTree(root).find((node) => node.id === id);
}

function readCounter(root: MobileElementSnapshot, label: string): number {
  return readCounterFromNodes(flattenTree(root), label);
}

function readCounterFromNodes(nodes: MobileElementSnapshot[], label: string): number {
  const labelNode = nodes.find((node) => textOf(node) === label);

  if (!labelNode) {
    throw new Error(`Tap laboratory label was not visible: ${label}`);
  }

  const valueNode = nodes
    .filter((node) => /^\d+$/.test(textOf(node)))
    .filter((node) => node.bounds.y >= labelNode.bounds.y)
    .filter((node) => horizontalOverlap(node.bounds, labelNode.bounds) > 0)
    .sort((a, b) => a.bounds.y - b.bounds.y)[0];

  if (!valueNode) {
    throw new Error(`Tap laboratory counter was not visible for: ${label}`);
  }

  return Number(textOf(valueNode));
}

function textOf(node: MobileElementSnapshot): string {
  return node.text ?? node.label ?? node.value ?? '';
}

function parsePercent(value: string): number | undefined {
  const match = value.match(/(\d{1,3})(?:\.\d+)?\s*%/);
  if (!match) {
    return undefined;
  }

  const percent = Number(match[1]);
  return Number.isFinite(percent) ? percent : undefined;
}

function parsePercentFromNode(node: MobileElementSnapshot): number | undefined {
  return [node.text, node.label, node.value]
    .map((value) => value ? parsePercent(value) : undefined)
    .find((value) => value !== undefined);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function horizontalOverlap(
  a: MobileElementSnapshot['bounds'],
  b: MobileElementSnapshot['bounds']
): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}

function uniqueByBounds(nodes: MobileElementSnapshot[]): MobileElementSnapshot[] {
  const seen = new Set<string>();
  const unique: MobileElementSnapshot[] = [];

  for (const node of nodes) {
    const key = [
      textOf(node),
      node.bounds.x,
      node.bounds.y,
      node.bounds.width,
      node.bounds.height
    ].join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(node);
  }

  return unique;
}

function sameBounds(a: MobileElementSnapshot, b: MobileElementSnapshot): boolean {
  return textOf(a) === textOf(b)
    && a.bounds.x === b.bounds.x
    && a.bounds.y === b.bounds.y
    && a.bounds.width === b.bounds.width
    && a.bounds.height === b.bounds.height;
}

function isIos(device: AsturDevice): boolean {
  return device.deviceInfo.platform === 'ios';
}

async function waitForAnyVisible(locators: MobileLocator[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      if (await locator.isVisible({ timeout: 250 })) {
        return;
      }
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for the Astur demo app shell.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
