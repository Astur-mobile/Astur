import {
  by,
  centerOf,
  delay,
  flattenTree,
  pointInBounds,
  type AsturDevice,
  type Bounds,
  type MobileElementSnapshot,
  type MobileLocator
} from '@astur-mobile/test';

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

/**
 * Horizontal position for scroll gestures on the Forms screen, as a fraction of
 * the viewport width.
 *
 * Kept near the left edge because the form contains a full-width slider: a
 * centred vertical swipe starts on the slider track and drags its value instead
 * of scrolling the list.
 */
const FORMS_SWIPE_X = 0.08;

export class AsturDemoApp {
  readonly home: HomePage;
  readonly nativeLab: NativeLabPage;
  readonly networkLab: NetworkLabPage;
  readonly login: LoginPage;
  readonly forms: FormsPage;
  readonly swipe: SwipePage;
  readonly drag: DragPage;
  readonly web: WebLabPage;
  readonly menu: MenuDrawer;
  readonly nav: BottomNavigation;

  constructor(private readonly device: AsturDevice) {
    this.home = new HomePage(device);
    this.nativeLab = new NativeLabPage(device);
    this.networkLab = new NetworkLabPage(device);
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
    await this.openHomeAtTop();
  }

  async reset(): Promise<void> {
    await this.device.setOrientation('portrait').catch(() => undefined);

    // A test that typed leaves the keyboard up, and it covers the bottom tab
    // bar — so the next test's very first navigation taps the keyboard instead
    // of a tab. Hot restart does not take the IME down with it, so clearing it
    // here is what makes each test start from the same place.
    await this.device.keyboard.dismiss().catch(() => undefined);

    if (isIos(this.device)) {
      await this.device.app.terminate().catch(() => undefined);
      await this.device.app.launch().catch(() => undefined);
      await this.waitForAppShell();
      if (await this.closeMenuIfOpen()) {
        return;
      }

      await this.openHomeAtTop();
      return;
    }

    if (isFlutterTree(this.device)) {
      // Do NOT background or force-stop a Flutter session. The driver keeps a
      // `flutter run` attached to the app's Dart VM, and launch() is a hot
      // restart over that connection — re-running main() for a clean tree.
      // Killing the process first destroys the VM the restart targets, so
      // reattach then blocks until `getVM` times out; pressing HOME can leave
      // the engine with a zero-size surface ("Width is zero. 0,0"), which tears
      // the service connection down the same way. Hot restart alone is both the
      // supported reset and the faster one.
      await this.device.app.launch();
      await this.waitForAppShell();
      await this.openHomeAtTop();
      return;
    }

    if (!isIos(this.device)) {
      await this.device.navigation.home().catch(() => undefined);
    }

    await this.device.app.terminate().catch(() => undefined);
    await this.device.app.launch();
    await this.waitForAppShell();
    await this.openHomeAtTop();
  }

  /**
   * Opens Home *and* returns it to the top of its scroll view.
   *
   * Flutter keeps a tab's ScrollController offset across activity restarts, so
   * terminating and relaunching the app does NOT reset the scroll position —
   * Home reopens exactly where the previous test left it. Every reveal helper
   * then starts from an unpredictable offset, and one that begins already past
   * its target can run out of correction attempts and settle with the element
   * under the bottom nav bar, where gestures land on the nav instead.
   *
   * This must live on the shared path both entry points use: the fixture calls
   * reset(), not launch(), so a scroll reset attached only to launch() never
   * runs during an actual suite.
   */
  private async openHomeAtTop(): Promise<void> {
    await this.nav.open('home');
    if (isFlutterTree(this.device)) {
      await this.home.heroCard.scrollIntoView({ direction: 'up', maxScrolls: 12 });
    }
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

    if (await this.screenVisible(tab, tab === 'home' ? 4_000 : 500)) {
      return;
    }

    if (isIos(this.device)) {
      await this.tabLocator(tab).tap({ timeout: 4_000 });
      await this.waitForScreen(tab, 4_000);
      return;
    }

    if (await this.menuNavLocator('home').isVisible({ timeout: 200 })) {
      await this.menuNavLocator(tab).tap({ timeout: 4_000 });
      await this.waitForScreen(tab, 4_000);
      return;
    }

    try {
      await this.tabLocator(tab).tap({ timeout: 4_000 });
      await this.waitForScreen(tab, 4_000);
      return;
    } catch {
      await this.menu.tap({ timeout: 4_000 });
      await this.menuNavLocator('home').waitForVisible({ timeout: 4_000 });
      await this.menuNavLocator(tab).tap({ timeout: 4_000 });
    }

    await this.waitForScreen(tab, 4_000);
  }

  private tabLocator(tab: DemoTab): MobileLocator {
    return this.device.getById(`tab-${tab}`);
  }

  private menuNavLocator(tab: DemoTab): MobileLocator {
    return this.device.getById(`menu-nav-${tab}`);
  }

  // The Android builds (React Native + Flutter) and the Flutter iOS build expose
  // a stable `screen-<tab>` identifier. The React Native iOS build instead
  // surfaces a screen only by its title text, so on iOS accept either — one
  // shared suite then drives all four app builds without per-build forks.
  private screenCandidates(tab: DemoTab): MobileLocator[] {
    const byId = this.device.getById(`screen-${tab}`);
    return isIos(this.device) ? [byId, this.device.getByText(screenTitles[tab])] : [byId];
  }

  private async screenVisible(tab: DemoTab, timeout: number): Promise<boolean> {
    for (const locator of this.screenCandidates(tab)) {
      if (await locator.isVisible({ timeout }).catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  private async waitForScreen(tab: DemoTab, timeout: number): Promise<void> {
    await waitForAnyVisible(this.screenCandidates(tab), timeout, `the ${tab} screen`);
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
    // The tap counters render in a row just below the tap target, and the bottom
    // navigation bar floats over the scroll view. So "target is visible" is not a
    // sufficient stop condition: the target must sit in the free area *above* the
    // nav bar, or the counters are off screen and taps land on the bar instead.
    // Under Flutter this is stricter still — only on-screen nodes exist at all,
    // so a counter below the fold is absent from the tree rather than invisible.
    //
    // Home also has a "Native locator lab" card directly BELOW this section (see
    // the by.native() demos). Before it existed the tap-lab card was last, so an
    // imprecise forward swipe clamped at the end of the content and still landed
    // in the acceptance window — an accidental safety net. With content past it,
    // a forward-only search can jump clean through the window and never recover,
    // so treat that card becoming visible as an unambiguous "went too far" and
    // swipe back.
    // Name both things the test actually needs: the tap target (to aim
    // gestures at) and the counter row below it (to read the result). The old
    // hard-coded "reserve 180px beneath the target" was approximating exactly
    // this. Anchoring on their shared card instead looked tidier but is not
    // equivalent — the card's bounds can sit inside the window while the target
    // itself is still absent from the Flutter tree, which then fails later, at
    // the gesture, far from the cause.
    await revealFully(this.device, ['home-tap-target', 'home-tap-long-press-count'], {
      overshootId: 'home-native-lab-card'
    });
  }

  async tapLabCounters(): Promise<TapLabCounters> {
    // Read each counter by its stable id. The Flutter iOS accessibility tree
    // and newer React Native Android builds merge the label and digit into one
    // accessibility node, so relying on separate text nodes and their geometry is
    // brittle. The value pills retain stable ids on every build.
    //
    // All three come from a single tree read: one round-trip instead of three,
    // and the values then describe one instant rather than three successive
    // ones — which matters when asserting that exactly one counter moved.
    const counterIds = ['home-tap-single-count', 'home-tap-double-count', 'home-tap-long-press-count'] as const;
    const tree = await this.device.tree();
    const fromTree = counterIds.map((id) => findNodeById(tree, id));

    if (fromTree.every((node) => node !== undefined)) {
      const [singleTaps, doubleTaps, longPresses] = fromTree.map((node) => numericValueOf(node!));
      return { singleTaps, doubleTaps, longPresses };
    }

    // A single tree read cannot wait. Some builds only surface these pills a
    // moment after the row settles, so fall back to per-id snapshots, which do
    // wait — slower, but it keeps a mid-render read from failing the test.
    const [singleTaps, doubleTaps, longPresses] = await Promise.all(
      counterIds.map(async (id) => numericValueOf(await this.device.getById(id).snapshot({ timeout: 4_000 })))
    );
    return { singleTaps, doubleTaps, longPresses };
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

export type NativeLabLaneCounts = {
  a: number;
  b: number;
  c: number;
};

/**
 * The Home screen's "Native locator lab" card.
 *
 * Every target here deliberately ships WITHOUT an accessibility id, and the lane
 * buttons all share the same visible text — so `getByText('+')` is ambiguous and
 * `getById` has nothing to bind to. They are reachable only through
 * `by.native()`, which is the point of this page object.
 *
 * The readout pills DO keep stable ids, so assertions can prove which target was
 * actually hit rather than just that something was tapped.
 */
export class NativeLabPage {
  private readonly androidUsesContentDescriptions: boolean;

  constructor(private readonly device: AsturDevice) {
    this.androidUsesContentDescriptions = isFlutterTree(device);
  }

  get card(): MobileLocator {
    return this.device.getById('home-native-lab-card');
  }

  get selectedRecordPill(): MobileLocator {
    return this.device.getById('native-lab-selected-record');
  }

  /**
   * The nth unlabeled "+" lane button (0-based). All three are identical, so
   * position is the only thing that separates them:
   * - Android: match the "+" text node, take the nth match.
   * - iOS: the same, expressed as an XCUITest predicate.
   */
  laneButton(index: number): MobileLocator {
    return this.device.find(
      by.native({
        android: this.androidUsesContentDescriptions ? { description: '+' } : { text: '+' },
        ios: "label == '+'",
        instance: index
      })
    );
  }

  /**
   * The structure-only row that *contains* the given record name — the row
   * itself has no id and no distinguishing text of its own.
   * - Android: `hasDescendant` matches the row by a child node's text.
   * - iOS: the row's merged accessibility label contains the record name, so a
   *   `CONTAINS` predicate expresses the same intent natively.
   */
  recordRow(record: string): MobileLocator {
    return this.device.find(
      by.native({
        // Both express "find the row by the text nested inside it" — but the
        // two trees nest it differently, so the cheap query differs.
        //
        // Flutter MERGES a row's child labels into one node's content-desc
        // content-desc (the row reports "Beta record\nChoose"), so matching the
        // row directly is both sufficient and correct. Do NOT use hasDescendant
        // here: UiAutomator re-walks the whole subtree for every candidate, and
        // against a Flutter tree that is slow enough to time the command out —
        // and it has been observed taking the Dart VM connection down with it.
        //
        // React Native keeps the text in a separate child node, so there the
        // subtree walk is the only way to express it.
        android: this.androidUsesContentDescriptions
          ? { descriptionContains: record }
          : { hasDescendant: { text: record } },
        ios: `label CONTAINS '${record}'`
      })
    );
  }

  /**
   * The nth lane button again, but located through a *compound* native query
   * rather than a single condition — every field below narrows the same match
   * (logical AND), and `instance` is applied last:
   * - Android: class + text + position in one `BySelector` chain.
   * - iOS: the equivalent compound NSPredicate.
   *
   * `classNameMatches` is kept deliberately permissive because the two demo
   * builds render different native classes for the same control: React Native
   * emits real widget classes (`android.widget.TextView`), while Flutter
   * surfaces every semantics node as `android.view.View`.
   */
  laneButtonByCompoundQuery(index: number): MobileLocator {
    return this.device.find(
      by.native({
        android: this.androidUsesContentDescriptions
          ? {
            className: 'android.widget.Button',
            description: '+',
            packageName: 'com.astur.demo'
          }
          : {
            classNameMatches: 'android\\..*',
            text: '+',
            packageName: 'com.astur.demo'
          },
        // React Native exposes the merged Pressable as `Other`, while Flutter
        // may expose a different element type. `label` + `enabled` still proves
        // that several native conditions are combined without coupling the
        // shared suite to one framework's accessibility implementation.
        ios: "label == '+' AND enabled == true",
        instance: index
      })
    );
  }

  /**
   * A record row located by a *regex* over the text nested inside it, rather
   * than an exact string — `textMatches` on Android, `MATCHES` on iOS.
   */
  recordRowMatching(pattern: string): MobileLocator {
    return this.device.find(
      by.native({
        // UiAutomator's regex criteria match the WHOLE native value, so the
        // surrounding wildcards are explicit to get contains-style behaviour
        // equivalent to the iOS predicate below. `(?s)` lets `.` span the
        // newline Flutter inserts when it merges a row's child labels.
        //
        // Flutter matches the row's own merged description; React Native needs
        // `hasDescendant` (any depth, not `hasChild`) because the text lives in
        // a separate child node. See recordRow() for why the subtree walk is
        // avoided on Flutter.
        android: this.androidUsesContentDescriptions
          ? { descriptionMatches: `(?s).*(?:${pattern}).*` }
          : { hasDescendant: { textMatches: `.*(?:${pattern}).*` } },
        ios: `label MATCHES '.*${pattern}.*'`
      })
    );
  }

  /**
   * Shows that `by.native()` is not limited to id-less nodes: the readout pills
   * DO carry ids, and can be addressed by an id *pattern* — useful when ids are
   * generated with a stable prefix but an unstable suffix.
   *
   * The Android pattern tolerates both the bare id and the package-qualified
   * `com.astur.demo:id/<name>` form.
   */
  lanePillByIdPattern(lane: 'a' | 'b' | 'c'): MobileLocator {
    return this.device.find(
      by.native({
        android: { resourceIdMatches: `.*native-lab-lane-${lane}-count` },
        ios: `identifier BEGINSWITH 'native-lab-lane-${lane}'`
      })
    );
  }

  /**
   * Scrolls the card fully into view. Targets the last element in the card (the
   * selected-record pill) so everything above it — the lane buttons and their
   * counters — is on screen too.
   */
  async reveal(): Promise<void> {
    await this.revealRecords();
  }

  /**
   * Brings the lane buttons *and* their readout pills fully on screen.
   *
   * Targets the pills rather than the buttons: the pills sit below the buttons,
   * so satisfying them satisfies both. A plain `scrollIntoView` on the pills is
   * not enough — it stops as soon as they enter the tree, which routinely
   * leaves them clipped by the bottom nav bar, where `by.native()` (reading the
   * UiAutomator hierarchy, not the Dart VM snapshot) reports them as not
   * visible even though the buttons above them are perfectly tappable.
   */
  async revealLanes(): Promise<void> {
    await revealFully(this.device, 'native-lab-lane-b-count');
  }

  async revealRecords(): Promise<void> {
    // The record rows carry no ids — that is the point of this card — so they
    // cannot be named directly. Bracket them instead: the lane counters sit
    // immediately above the rows and the selected-record pill immediately
    // below, so putting BOTH on screen guarantees everything between them is
    // too. Anchoring on the pill alone scrolls until the pill is in view, which
    // can push the rows off the top — and under Flutter that removes them from
    // the tree, so by.native() cannot resolve them at all.
    await revealFully(this.device, ['native-lab-lane-a-count', 'native-lab-selected-record']);
  }

  async selectedRecord(): Promise<string> {
    const snapshot = await this.selectedRecordPill.snapshot({ timeout: 4_000 });
    return flattenTree(snapshot)
      .flatMap((node) => [node.text, node.label, node.value])
      .find((value): value is string => Boolean(value)) ?? '';
  }

  async laneCounts(): Promise<NativeLabLaneCounts> {
    return {
      a: await this.readCount('native-lab-lane-a-count'),
      b: await this.readCount('native-lab-lane-b-count'),
      c: await this.readCount('native-lab-lane-c-count')
    };
  }

  /**
   * Reads a MetricPill's numeric value. Both platforms may merge the pill's
   * label and value into one node ("LANE A 1"), so strip to digits rather than
   * assuming a discrete value node.
   */
  private async readCount(id: string): Promise<number> {
    return numericValueOf(await this.device.getById(id).snapshot({ timeout: 4_000 }));
  }
}

/**
 * Home's "Network lab" card: buttons that drive real HTTP against a loopback
 * API the app serves itself, so `device.network` has deterministic, offline
 * traffic to observe.
 */
export class NetworkLabPage {
  constructor(private readonly device: AsturDevice) {}

  get card(): MobileLocator {
    return this.device.getById('home-network-lab-card');
  }

  get statusPill(): MobileLocator {
    return this.device.getById('network-lab-status');
  }

  /**
   * Brings the buttons AND the status readout on screen together — the buttons
   * are what a test presses, the readout is how it knows the call finished.
   */
  async reveal(): Promise<void> {
    await revealFully(this.device, ['network-lab-get', 'network-lab-status']);
  }

  async getProfile(): Promise<void> {
    await this.device.getById('network-lab-get').tap();
  }

  async postSession(): Promise<void> {
    await this.device.getById('network-lab-post').tap();
  }

  async getMissing(): Promise<void> {
    await this.device.getById('network-lab-404').tap();
  }

  /**
   * The card's own report of the last call, e.g. "GET /api/profile -> 200".
   *
   * Read from the app rather than from `device.network`, so a test can wait for
   * the request to *complete* before asserting on what Astur observed — the two
   * are independent, which is what makes the assertion meaningful.
   */
  async lastStatus(): Promise<string> {
    const snapshot = await this.statusPill.snapshot({ timeout: 4_000 });
    return flattenTree(snapshot)
      .flatMap((node) => [node.value, node.text, node.label])
      .filter((value): value is string => Boolean(value))
      .join(' ');
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

  async revealCredentials(): Promise<void> {
    // Target the password field, not the email one: it is the lower of the two,
    // so bringing it fully on screen puts the email field above it in view as
    // well. Revealing the email field alone can stop with it just above the nav
    // bar and the password still below the fold.
    await revealFully(this.device, 'login-password-input');
  }

  async enterCredentials(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    // Dismiss the soft keyboard so the submit button below the form is reachable.
    // The Flutter driver hides the IME by clearing the Dart primary focus (no Back
    // press), so this can't pop the route or background the app.
    await this.device.keyboard.dismiss().catch(() => undefined);
    // Typing into the password field focuses it and scrolls the form up to keep
    // it above the soft keyboard, which can push the email field off the top of
    // the viewport. The Flutter driver only exposes on-screen nodes, so bring
    // the email field back before any value assertion.
    await revealFully(this.device, 'login-email-input');
  }

  async revealSubmit(): Promise<void> {
    await revealFully(this.device, 'login-submit-button');
  }

  async submitCredentials(): Promise<void> {
    await this.submit.tap();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.enterCredentials(email, password);
    await this.submitCredentials();
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
    // The button row is narrow and sits directly before the upload card, so the
    // upload card becoming visible is a reliable "scrolled past it" marker.
    await revealFully(this.device, 'forms-active-button', {
      overshootId: 'forms-upload-card',
      swipeX: FORMS_SWIPE_X
    });
  }

  async revealCheckbox(): Promise<void> {
    await revealFully(this.device, 'forms-main-checkbox', { swipeX: FORMS_SWIPE_X });
  }

  private async sliderTrackBounds(): Promise<Bounds> {
    // Prefer the dedicated track id: it is the actual swipe surface and is exposed
    // on every build (React Native, Flutter Android, Flutter iOS). On Flutter iOS
    // the slider has no ARIA "slider" role and the 0%/100% labels are merged into
    // the card label, so the role/label fallbacks below cannot resolve it.
    const trackSnapshot = await this.device.getById('forms-slider-track').snapshot({ timeout: 500 }).catch(() => undefined);
    if (trackSnapshot?.visible && trackSnapshot.bounds.width > 40) {
      return trackSnapshot.bounds;
    }

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

  /**
   * The system photo picker can open behind a "Choose Google Photos account"
   * prompt, which covers the grid — the photos are in the tree but nothing can
   * be tapped. It appears on a freshly provisioned device and never again once
   * dismissed, so it has to be handled rather than waited out.
   */
  private async dismissPickerAccountPrompt(): Promise<void> {
    const dismiss = this.device.getByText('Dismiss', { exact: true });
    if (await dismiss.isVisible({ timeout: 2_000 })) {
      await dismiss.tap();
      await delay(500);
    }
  }

  async chooseFirstVisibleMedia(): Promise<void> {
    await this.revealUploadCard();
    await this.pickMediaButton.tap();
    await this.dismissPickerAccountPrompt();

    const asset = this.device.getByLabel('Photo taken', { exact: false });

    // A device with an empty gallery has nothing for the picker to show, and
    // "timed out waiting for Photo taken" does not say that. Name the cause.
    if (!(await asset.isVisible({ timeout: 10_000 }))) {
      throw new Error(
        'The system photo picker showed no images. This spec needs at least one '
        + 'photo in the device gallery — seed one, e.g. '
        + '`adb push image.png /sdcard/Pictures/ && adb shell am broadcast '
        + '-a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/image.png`.'
      );
    }

    // A tap can land mid-layout and be dropped, leaving the picker open with
    // nothing selected, so re-tap until the picker closes.
    //
    // Only tap while a thumbnail is actually on screen. Retrying blind was the
    // bug: a successful tap closes the picker, and the next iteration then
    // tapped at a thumbnail that no longer existed and failed the whole test
    // *after* the selection had already worked.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await asset.isVisible({ timeout: 2_000 }))) {
        break;
      }

      await asset.tap({ timeout: 10_000 });
      await delay(500);
    }

    // The picker closes back to the form, where the chip can be left scrolled
    // out of view. Scroll to the chip itself rather than to the card around it:
    // revealing the card only guarantees the card's own edge is on screen, and
    // the chip sits further down inside it. Without this, a selection that
    // worked reads as "not visible" and fails the test.
    await this.selectedAsset.scrollIntoView().catch(() => undefined);
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

/**
 * True when the UI tree is served by Flutter's Dart VM service rather than the
 * platform accessibility hierarchy.
 *
 * The distinction that matters to tests is that Flutter publishes *only
 * on-screen* nodes, so anything below the fold is absent from the tree instead
 * of merely `visible: false`, and elements must be scrolled into view before
 * they can be located at all.
 *
 * Ask the driver rather than inspecting how the run was launched: an env var
 * like ASTUR_FLUTTER_PROJECT describes which npm script was used, not what the
 * session actually connected to, and leaks into unrelated suites if it happens
 * to be exported in the shell.
 */
function isFlutterTree(device: AsturDevice): boolean {
  return device.deviceInfo.uiEngine === 'flutter';
}

/**
 * Reads the numeric value out of a metric pill.
 *
 * Every build merges the pill's label and value into a single accessibility
 * node at some point ("LANE A 1"), and which field carries it — `value`, `text`
 * or `label` — differs per platform, so search the whole subtree for the first
 * field containing a digit and strip everything else.
 */
function numericValueOf(snapshot: MobileElementSnapshot): number {
  const raw = flattenTree(snapshot)
    .flatMap((node) => [node.value, node.text, node.label])
    .find((value) => value !== undefined && /\d/.test(value)) ?? '';
  const digits = raw.replace(/\D+/g, '');
  return digits.length ? Number(digits) : 0;
}

interface RevealOptions {
  /** Id of an element that is only visible once we have scrolled PAST the target. */
  overshootId?: string;
  /** Horizontal position of the swipe, as a fraction of the viewport width. */
  swipeX?: number;
  maxAttempts?: number;
}

/**
 * Scrolls every id in `ids` into the *usable* area at the same time: each fully
 * on screen, and clear of the bottom navigation bar that floats over the scroll
 * view.
 *
 * `MobileLocator.scrollIntoView()` stops as soon as a node enters the tree,
 * which is a weaker condition than it appears. Under Flutter a node can enter
 * the Dart VM snapshot while still clipped by the nav bar — present, but
 * reported not-visible by UiAutomator (which is what `by.native()` reads) and
 * untappable either way. Every reveal in this suite needs the stricter
 * condition, so they share one loop instead of each growing its own tuned
 * swipe sequence.
 *
 * Pass several ids when a test needs several elements on screen together (a
 * control plus the readout it updates). Naming them beats anchoring on their
 * common ancestor: a container's bounds can satisfy the window while a child is
 * still absent from the tree, which fails later and far from the cause.
 */
async function revealFully(
  device: AsturDevice,
  ids: string | string[],
  options: RevealOptions = {}
): Promise<void> {
  const { overshootId, swipeX = 0.5, maxAttempts = 10 } = options;
  const required = Array.isArray(ids) ? ids : [ids];
  const viewport = await device.viewport();
  // Scroll direction, and the previous frame's fingerprint used to notice that
  // a swipe achieved nothing (see the direction logic below).
  let forward = true;
  let lastSignature: string | undefined;
  // No headroom above the anchor, deliberately. Reserving a margin here pushes
  // the anchor down the screen, which pushes whatever sits ABOVE it off the top
  // — and under Flutter that means out of the tree entirely. When a test needs
  // an element that has no id of its own (the record rows), bracket it by
  // naming the id-bearing elements on either side rather than insetting the
  // window and hoping.
  const positions = (tree: MobileElementSnapshot, bottomLimit: number): number[] | undefined => {
    const found = required.map((id) => findNodeById(tree, id));
    const ok = found.every((node) => node?.visible
      && node.bounds.y >= viewport.y
      && node.bounds.y + node.bounds.height <= bottomLimit);
    return ok ? found.map((node) => node!.bounds.y) : undefined;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // A single tree read answers everything this loop needs: where the targets
    // are, where the nav bar is, and whether we have gone too far. Querying each
    // of those as its own locator would multiply the round-trips, and on the
    // Flutter driver every round-trip is a full on-device tree walk.
    const tree = await device.tree();
    const bottomLimit = contentBottomLimit(tree, viewport);
    const placed = positions(tree, bottomLimit);
    if (placed) {
      // In the window — but a fling may still be decelerating, so an element is
      // in place for *this* frame and somewhere else by the time the caller
      // reads its bounds to aim a gesture. That produces the worst kind of
      // failure: the reveal "succeeds", the tap lands on empty space, and the
      // assertion reports a count that never moved. Require the positions to
      // repeat before declaring the scroll finished.
      await delay(150);
      const settled = positions(await device.tree(), bottomLimit);
      // Compare with a tolerance, never for exact equality. Demanding identical
      // pixels means any lingering animation or sub-pixel drift never matches,
      // so this branch loops until the attempts run out — with the element
      // sitting perfectly placed the whole time, which is a maddening failure
      // to read. A real fling moves hundreds of pixels in 150ms and is still
      // rejected; 1% of the viewport only absorbs jitter.
      const jitter = viewport.height * 0.01;
      if (settled && settled.every((y, index) => Math.abs(y - placed[index]) <= jitter)) {
        return;
      }
      continue;
    }

    // Work out which way to scroll, in order of how trustworthy the signal is.
    const first = findNodeById(tree, required[0]);
    const markerVisible = overshootId
      ? Boolean(findNodeById(tree, overshootId)?.visible)
      : undefined;
    const signature = scrollSignature(tree);

    if (markerVisible) {
      // The marker is only reachable by scrolling PAST the target, so this is
      // unambiguous.
      forward = false;
    } else if (signature === lastSignature) {
      // The previous swipe changed nothing: we are pinned against one end of
      // the scroll view. Neither the target nor the marker is reachable from
      // here, so no amount of scrolling this way will help — turn around.
      // Without this the loop grinds against the end until it runs out of
      // attempts, which is what a "scrolled past everything" start looks like.
      forward = !forward;
    } else if (first && first.bounds.y < viewport.y) {
      // Partially on screen above the fold — we are slightly past it.
      forward = false;
    }
    lastSignature = signature;

    await device.swipe({
      // Fractions of the viewport, so the step scales with the device rather
      // than encoding one screen's pixel geometry. The backward step is
      // shorter than the forward one so a correction cannot overshoot back.
      start: pointInBounds(viewport, swipeX, forward ? 0.82 : 0.30),
      end: pointInBounds(viewport, swipeX, forward ? 0.46 : 0.58),
      // Slow enough to be a DRAG, not a fling. This is the single most
      // important parameter here. Measured on Home: the same gesture over
      // 300ms flings the list all the way to the end of its content (the
      // search then bounces between the two extremes and never lands in
      // between); at 1200ms it moves a predictable ~1.3x the gesture distance
      // and stops. Release velocity, not distance, is what Flutter's ballistic
      // scroll simulation reacts to.
      durationMs: 1_200
    });

    // Let the fling finish before judging where anything is. `swipe()` returns
    // when the gesture is delivered, not when the list stops moving, so reading
    // immediately samples a position that is still changing — the loop then
    // mistakes a mid-flight frame for the resting one, flips its overshoot
    // decision, and reverses. That reads on-device as endless scrolling up and
    // down until the attempts run out.
    await delay(350);
  }

  // Out of attempts. A bare "timed out waiting for id=X" here is close to
  // useless: it cannot distinguish "never scrolled far enough" from "scrolled
  // past it" from "the element is on screen but clipped by the nav bar", and
  // under Flutter every one of those looks identical (the node is simply
  // absent). Report what the last frame actually contained instead.
  const tree = await device.tree().catch(() => undefined);
  const bottomLimit = tree ? contentBottomLimit(tree, viewport) : undefined;
  const seen = required.map((id) => {
    const node = tree ? findNodeById(tree, id) : undefined;
    if (!node) {
      return `${id}=absent`;
    }
    return `${id}=y${node.bounds.y}..${node.bounds.y + node.bounds.height}${node.visible ? '' : ' (not visible)'}`;
  });
  const marker = overshootId && tree
    ? ` ${overshootId}=${findNodeById(tree, overshootId)?.visible ? 'visible (scrolled past)' : 'not visible'}`
    : '';

  // Also say what WAS on screen. "Everything absent" has two very different
  // causes — scrolled off the target, or not on the right screen at all — and
  // the id list distinguishes them immediately.
  const present = tree
    ? (scrollSignature(tree).split('|').filter(Boolean).slice(0, 14).join(', ') || 'no id-bearing nodes')
    : 'tree unavailable';

  throw new Error(
    `revealFully gave up after ${maxAttempts} attempts. `
    + `Required window y=${viewport.y}..${bottomLimit ?? '?'}; `
    + `last frame: ${seen.join(', ')}.${marker}\n`
    + `On screen: ${present}`
  );
}

/**
 * Lowest y a scrolled element may occupy and still be fully usable — the top of
 * the bottom navigation bar, which floats over the scroll view.
 *
 * Measured from the bar itself rather than hard-coded: its height varies with
 * platform, display density and the system gesture inset, so a fixed pixel
 * budget silently mis-scrolls on any device it was not tuned against. Falls
 * back to a conservative inset only where the bar is not an addressable node
 * (the React Native iOS build exposes screens by title text, not by id).
 */
/**
 * Fingerprint of what is currently scrolled into view.
 *
 * Two identical fingerprints across a swipe mean the swipe moved nothing — the
 * scroll view is pinned at its top or bottom. Ids plus their y offsets are
 * enough: any real scroll changes at least one offset, while a repaint that
 * shifts nothing leaves them all alone.
 */
function scrollSignature(tree: MobileElementSnapshot): string {
  const parts: string[] = [];
  const walk = (node: MobileElementSnapshot): void => {
    if (node.id) {
      parts.push(`${node.id}@${node.bounds.y}`);
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);
  return parts.join('|');
}

function contentBottomLimit(tree: MobileElementSnapshot, viewport: Bounds): number {
  const navBar = findNodeById(tree, 'tab-home');

  if (navBar?.visible && navBar.bounds.height > 0 && navBar.bounds.y > viewport.y) {
    return navBar.bounds.y;
  }
  return viewport.y + viewport.height - 180;
}

async function waitForAnyVisible(
  locators: MobileLocator[],
  timeoutMs: number,
  label = 'the Astur demo app shell'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    for (const locator of locators) {
      if (await locator.isVisible({ timeout: 250 })) {
        return;
      }
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for ${label}.`);
}
