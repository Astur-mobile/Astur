export type PlatformName = 'android' | 'ios';

export type DeviceKind = 'emulator' | 'simulator' | 'real';

export type DeviceState =
  | 'online'
  | 'offline'
  | 'booted'
  | 'shutdown'
  | 'unauthorized'
  | 'unknown';

export type DeviceOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape'
  | 'landscape-left'
  | 'landscape-right';

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type LocatorStrategy =
  | 'accessibility'
  | 'id'
  | 'role'
  | 'text'
  | 'type'
  | 'placeholder'
  | 'xpath'
  | 'coordinates'
  | 'native';

export type MobileRole =
  | 'button'
  | 'checkbox'
  | 'image'
  | 'img'
  | 'link'
  | 'menuitem'
  | 'radio'
  | 'slider'
  | 'switch'
  | 'tab'
  | 'text'
  | 'textbox';

export interface RoleSelectorOptions {
  name?: string | RegExp;
  exact?: boolean;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
}

/**
 * Which engine serves this session's UI tree.
 *
 * `'flutter'` means snapshots come from the Dart VM service: Flutter does not
 * publish its widget tree to the platform accessibility layer, so only
 * on-screen nodes exist and `by.native()` resolves through a separate agent.
 * `'native'` means the platform hierarchy (UiAutomator / XCUITest) is
 * authoritative — including for Flutter apps on iOS, where XCUITest reads the
 * merged accessibility tree exactly as it does for any other app.
 *
 * Tests should branch on this rather than on how the run was launched; it is
 * the property that actually changes what is in the tree.
 */
export type UiEngine = 'native' | 'flutter';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: PlatformName;
  kind: DeviceKind;
  state: DeviceState;
  osVersion?: string;
  model?: string;
  /** Defaults to `'native'` when a driver does not report one. */
  uiEngine?: UiEngine;
  /**
   * The framework that *paints* the app, when it differs from the engine Astur
   * reads the tree from.
   *
   * These come apart on iOS: XCUITest serves the accessibility tree for every
   * app, Flutter included, so `uiEngine` is always `'native'` there — but a
   * Flutter build does not render like a React Native one, which matters to
   * anything comparing pixels. Left unset when the two agree.
   */
  renderer?: UiEngine;
  raw?: unknown;
}

export interface DeviceSelector {
  id?: string;
  name?: string | RegExp;
  kind?: DeviceKind;
  avd?: string;
  autoBoot?: boolean;
  headless?: boolean;
  wipeData?: boolean;
  bootTimeout?: number;
  emulatorArgs?: string[];
  cloud?: CloudDeviceSelector;
}

export interface CloudDeviceSelector {
  provider: 'browserstack';
  deviceName?: string;
  osVersion?: string;
  project?: string;
  build?: string;
  appId?: string;
  usernameEnv?: string;
  accessKeyEnv?: string;
}

export interface AppUnderTest {
  path?: string;
  url?: string;
  downloadPath?: string;
  bundleId?: string;
  packageName?: string;
  activity?: string;
}

export interface AppResetOptions {
  app?: AppUnderTest;
  path?: string;
  bundleId?: string;
  packageName?: string;
  reinstall?: boolean;
  launch?: boolean;
}

export type AsturScreenshotMode = 'off' | 'on' | 'only-on-failure';

export type AsturVideoMode = 'off' | 'on' | 'retain-on-failure';

export interface AsturArtifacts {
  screenshot?: AsturScreenshotMode;
  video?: AsturVideoMode;
  snapshot?: AsturScreenshotMode;
  logs?: 'off' | 'on' | 'retain-on-failure';
  timings?: 'off' | 'on' | 'always';
}

export type KeyboardDismissMode = 'auto' | 'preserve';

export interface AsturKeyboardConfig {
  /**
   * `auto` dismisses the soft keyboard only when it blocks a pointer target.
   * `preserve` leaves the keyboard untouched for keyboard-specific tests.
   */
  dismiss?: KeyboardDismissMode;
}

export type NativeAgentMode = 'auto' | 'required' | 'off';
export type AsturAutomationEngine = 'auto' | 'agent' | 'legacy-adb';
export type AsturAutomationTransport = 'auto' | 'http' | 'websocket' | 'stdio';
export type AsturLegacyFallback = 'never' | 'on-agent-failure' | 'on-unsupported-command';
export type AsturSnapshotMode = 'never' | 'on-failure' | 'always' | 'debug';

export interface AsturAutomationSnapshotConfig {
  mode?: AsturSnapshotMode;
  cacheTtlMs?: number;
}

export interface NormalizedAsturAutomationSnapshotConfig {
  mode: AsturSnapshotMode;
  cacheTtlMs: number;
}

export interface AsturAutomationTimingsConfig {
  enabled?: boolean;
  slowCommandThresholdMs?: number;
}

export interface NormalizedAsturAutomationTimingsConfig {
  enabled: boolean;
  slowCommandThresholdMs: number;
}

export interface AsturAutomationConfig {
  engine?: AsturAutomationEngine;
  transport?: AsturAutomationTransport;
  legacyFallback?: AsturLegacyFallback;
  commandTimeoutMs?: number;
  startupTimeoutMs?: number;
  strictLocators?: boolean;
  snapshot?: AsturAutomationSnapshotConfig;
  timings?: AsturAutomationTimingsConfig;
}

export interface NormalizedAsturAutomationConfig {
  engine: AsturAutomationEngine;
  transport: AsturAutomationTransport;
  legacyFallback: AsturLegacyFallback;
  commandTimeoutMs: number;
  startupTimeoutMs: number;
  strictLocators: boolean;
  snapshot: NormalizedAsturAutomationSnapshotConfig;
  timings: NormalizedAsturAutomationTimingsConfig;
}

export interface NativeAgentConfig {
  /**
   * `auto` uses a platform agent when one is available and falls back when safe.
   * `required` fails session creation if the platform agent is unavailable.
   * `off` forces the legacy platform-tool fallback.
   */
  mode?: NativeAgentMode;
  /**
   * Whether Astur may install/bootstrap its platform agent during session setup.
   */
  install?: boolean;
  /**
   * Optional platform-specific endpoint, for example a forwarded localhost port.
   */
  endpoint?: string;
  launchTimeout?: number;
  commandTimeout?: number;
  legacyFallback?: AsturLegacyFallback;
  transport?: AsturAutomationTransport;
}

export interface NormalizedNativeAgentConfig {
  mode: NativeAgentMode;
  install: boolean;
  endpoint?: string;
  launchTimeout: number;
  commandTimeout: number;
  legacyFallback: AsturLegacyFallback;
  transport: AsturAutomationTransport;
}

/** Stock browser Astur can drive as the target of a session. */
export type BrowserEngine = 'chrome' | 'safari';

/**
 * Drive a browser instead of an app.
 *
 * Set this *instead of* `app` when the thing under test is a web page rather
 * than an installed binary. Both may be set when a suite does each in turn, but
 * the browser is never launched implicitly — only `device.browser` reaches it.
 */
export interface BrowserTarget {
  /** Defaults to the platform's stock browser: Chrome on Android, Safari on iOS. */
  engine?: BrowserEngine;
  /**
   * Package or bundle id override, for a Chrome channel (`com.chrome.beta`) or
   * a device that ships a differently-named build.
   */
  id?: string;
}

/** What a session can actually do with a browser, answered at runtime. */
export interface BrowserCapabilities {
  /** A browser can be launched and its DOM driven. */
  supported: boolean;
  engine?: BrowserEngine;
  /** Package/bundle id Astur will launch. */
  identifier?: string;
  /**
   * Human-readable statement of what is and is not available, for error
   * messages and for `test.skip()` reasons.
   */
  coverage: string;
}

export interface AsturConfig {
  platform: PlatformName;
  device?: DeviceSelector;
  app?: string | AppUnderTest;
  /** Drive a browser rather than an app. See {@link BrowserTarget}. */
  browser?: BrowserTarget;
  timeout?: number;
  artifactsDir?: string;
  artifacts?: AsturArtifacts;
  keyboard?: AsturKeyboardConfig;
  automation?: AsturAutomationConfig;
  /**
   * Compatibility alias for the v1 agent configuration. Prefer `automation`
   * for engine/fallback policy and keep endpoint/install details here while
   * the native-agent transport is being migrated.
   */
  agent?: NativeAgentConfig;
}

export interface NormalizedCapabilities extends AsturConfig {
  platform: PlatformName;
  device: DeviceSelector;
  app?: AppUnderTest;
  browser?: BrowserTarget;
  timeout: number;
  artifactsDir: string;
  artifacts: AsturArtifacts;
  keyboard: Required<AsturKeyboardConfig>;
  automation: NormalizedAsturAutomationConfig;
  agent: NormalizedNativeAgentConfig;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface KeyboardState {
  visible: boolean;
  bounds?: Bounds;
}

export type MobileContextType = 'native' | 'webview';

export interface MobileContextInfo {
  id: string;
  type: MobileContextType;
  title?: string;
  url?: string;
  packageName?: string;
  socket?: string;
  pageId?: string;
}

export interface WebViewSelector {
  id?: string;
  title?: string | RegExp;
  url?: string | RegExp;
  packageName?: string;
  timeout?: number;
  /**
   * Prefer the most recently opened matching page over the first one found.
   *
   * Off by default, because an app normally hosts one WebView and "first match"
   * is both cheaper and stable. A browser is the opposite: it keeps every tab a
   * suite ever opened, several of them on the same URL, and the oldest is
   * backgrounded — so driving "the first match" silently drives a frozen tab
   * where navigation never runs.
   */
  newest?: boolean;
  /**
   * Which debugging socket to prefer when a device exposes several.
   *
   * Defaults to `'webview'`. Android names them `webview_devtools_remote_<pid>`
   * for an app's WebView and `chrome_devtools_remote` for the browser, and they
   * sort alphabetically — so with Chrome running, "first socket" is the browser
   * and an app's WebView automation silently drives the wrong process.
   */
  target?: 'webview' | 'browser';
}

export interface WebViewEndpoint {
  context: MobileContextInfo;
  cdpUrl: string;
}

export type WebLocatorStrategy = 'testid' | 'id' | 'role' | 'text' | 'css';

export interface WebLocatorDescriptor {
  strategy: WebLocatorStrategy;
  value: string;
  /** Accessible name, only for the `role` strategy. */
  name?: string;
}

export interface WebElementSnapshot {
  tag: string;
  id?: string;
  testId?: string;
  role?: string;
  name?: string;
  value?: string;
  /** CSS pixels relative to the WebView viewport. */
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  /** The best (most stable) locator Astur would generate for this element. */
  locator: WebLocatorDescriptor;
  children: WebElementSnapshot[];
}

export interface WebTreeSnapshot {
  /** window.devicePixelRatio — maps CSS px (bounds) to device px for overlays. */
  devicePixelRatio: number;
  /** Visual viewport size in CSS px. */
  viewport: { width: number; height: number };
  url: string;
  title: string;
  root: WebElementSnapshot;
}

export type WebElementAction = 'fill' | 'tap' | 'clear' | 'select';

export interface DeviceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
}

export interface ScreenshotOptions {
  path?: string;
}

export interface RecordingStopOptions {
  /**
   * Stop recording and delete the native artifact without transferring it to
   * the host. Useful for retain-on-failure after a passing test.
   */
  discard?: boolean;
}

export interface TapOptions {
  keyboard?: KeyboardDismissMode;
}

export interface DoubleTapOptions extends TapOptions {
  intervalMs?: number;
}

/**
 * A well-defined Android element query, built from androidx.test.uiautomator's
 * `By`/`BySelector` fields — the same API the bundled UiAutomator agent already
 * uses for every other strategy. Each present field further constrains the
 * match (logical AND); `hasChild`/`hasDescendant` nest the same shape to
 * express structural relationships ("the button inside this specific card").
 * Deliberately NOT an arbitrary expression language (no eval, no custom
 * parser) — every field maps 1:1 to a real `BySelector` instance method.
 */
export interface AndroidNativeSelector {
  className?: string;
  classNameMatches?: string;
  text?: string;
  textContains?: string;
  textMatches?: string;
  description?: string;
  descriptionContains?: string;
  descriptionMatches?: string;
  resourceId?: string;
  resourceIdMatches?: string;
  packageName?: string;
  /** Matches elements that have at least one direct child satisfying this selector. */
  hasChild?: AndroidNativeSelector;
  /** Matches elements that have at least one descendant (any depth) satisfying this selector. */
  hasDescendant?: AndroidNativeSelector;
}

/**
 * Raw native-agent escape hatch (`by.native(...)`) for the rare element the
 * semantic tree match (id/label/text/role/type) cannot express — most often a
 * badly-instrumented screen with no accessibility metadata, where the only
 * way to pin an element down is by structure or by combining several native
 * conditions at once.
 *
 * `ios` is passed verbatim to XCUITest's own `NSPredicate(format:)` — the
 * same declarative predicate grammar Apple's own APIs and Appium's `-ios
 * predicate string` strategy use. It is data for a restricted query grammar,
 * not executable code.
 *
 * `android` is a structured `AndroidNativeSelector` chain (see above) rather
 * than a raw string, because Android has no equivalent built-in predicate
 * grammar — the closest analogue (Appium's `-android uiautomator` strategy)
 * works by compiling arbitrary source at runtime, which this escape hatch
 * deliberately does not attempt.
 *
 * Provide whichever platform(s) the test needs to run on; a selector with
 * only `ios` set still throws a clear, structured error if it reaches an
 * Android session (and vice versa) rather than silently matching nothing.
 * Requires a connected native agent — cannot be resolved against a cached
 * UI-tree snapshot (legacy/no-agent sessions throw `NATIVE_SELECTOR_REQUIRES_AGENT`).
 */
export interface NativeSelectorPayload {
  ios?: string;
  android?: AndroidNativeSelector;
  /**
   * 0-based index into the elements matching `android` / `ios`, applied
   * after all `hasChild`/`hasDescendant` constraints (Android) or as the
   * predicate query's own nth match (iOS). Omit to take the first match.
   */
  instance?: number;
}

export interface ElementSelector {
  strategy: LocatorStrategy;
  value: string;
  exact?: boolean;
  name?: string | RegExp;
  /** Present only when `strategy === 'native'`. See {@link NativeSelectorPayload}. */
  native?: NativeSelectorPayload;
}

export type ElementWaitState = 'attached' | 'visible' | 'hidden';

export interface ElementWaitOptions {
  timeout?: number;
  interval?: number;
  state?: ElementWaitState;
}

export interface ElementActionability {
  visible?: boolean;
  enabled?: boolean;
  stable?: boolean;
  hittable?: boolean;
}

export interface ElementActionOptions extends ElementWaitOptions {
  keyboard?: KeyboardDismissMode;
  actionability?: ElementActionability;
}

export interface ElementTapOptions extends ElementActionOptions {}

export interface ElementDoubleTapOptions extends ElementActionOptions {
  intervalMs?: number;
}

export interface ElementLongPressOptions extends ElementActionOptions {
  durationMs?: number;
}

export interface ElementFillOptions extends ElementWaitOptions {
  keyboard?: KeyboardDismissMode;
  clear?: boolean;
  textInputMode?: 'paste' | 'type';
}

export type ElementDragTarget = Coordinates | { selector: ElementSelector };

export interface ElementDragOptions extends ElementActionOptions {
  durationMs?: number;
}

/** One app installed on the device, as reported by {@link AsturDevice.app.list}. */
export interface InstalledApp {
  /** Package name on Android, bundle identifier on iOS. */
  identifier: string;
  /** Display name where the platform reports one cheaply; absent otherwise. */
  name?: string;
  /**
   * `true` for an app that ships with the system image.
   *
   * Listing is filtered to third-party apps by default because a system list
   * runs to hundreds of entries and buries the app under test.
   */
  system?: boolean;
}

/** The app currently in the foreground, as reported by {@link AsturDevice.app.foreground}. */
export interface ForegroundApp {
  /** Package name on Android, bundle identifier on iOS. */
  identifier: string;
  /** Fully qualified Activity on Android. Not reported on iOS. */
  activity?: string;
}

export interface MobileElementSnapshot {
  id?: string;
  text?: string;
  label?: string;
  value?: string;
  type: string;
  enabled: boolean;
  visible: boolean;
  selected?: boolean;
  focused?: boolean;
  /**
   * Checked state of a checkbox, switch, radio button, or toggle.
   *
   * Left `undefined` by drivers that cannot report it, and by elements the
   * concept does not apply to — which is why it is a tri-state rather than a
   * boolean defaulting to `false`. A missing value means "unknown", not
   * "unchecked", so an assertion can fail with that distinction intact.
   */
  checked?: boolean;
  bounds: Bounds;
  children: MobileElementSnapshot[];
  platform?: PlatformName;
  raw?: unknown;
}

export interface SwipeGesture {
  start: Coordinates;
  end: Coordinates;
  durationMs?: number;
}

export interface DragGesture {
  start: Coordinates;
  end: Coordinates;
  durationMs?: number;
}

export interface LongPressOptions {
  durationMs?: number;
  keyboard?: KeyboardDismissMode;
}

export interface LaunchOptions {
  app?: AppUnderTest;
  url?: string;
}

export type UiTreeUpdateReason = 'initial' | 'poll' | 'action' | 'manual';

export interface UiTreeUpdate {
  revision: number;
  timestamp: number;
  reason: UiTreeUpdateReason;
  root: MobileElementSnapshot;
}

export interface UiTreeSubscribeOptions {
  /**
   * Poll interval for fallback host-side tree updates when a native stream
   * is unavailable.
   */
  pollIntervalMs?: number;
  /**
   * Optional finite update count for one-off bootstrap reads.
   */
  maxUpdates?: number;
}

export interface LocatorSuggestion {
  code: string;
  selector: ElementSelector;
  score: number;
  uniqueness: number;
  stability: number;
  readable: boolean;
  crossPlatform: boolean;
}

export type InspectorAction =
  | {
    kind: 'wait';
    selector: ElementSelector;
    options?: ElementWaitOptions;
  }
  | {
    kind: 'tap';
    selector: ElementSelector;
    options?: ElementTapOptions;
  }
  | {
    kind: 'doubleTap';
    selector: ElementSelector;
    options?: ElementDoubleTapOptions;
  }
  | {
    kind: 'longPress';
    selector: ElementSelector;
    options?: ElementLongPressOptions;
  }
  | {
    kind: 'fill';
    selector: ElementSelector;
    value: string;
    options?: ElementFillOptions;
  }
  | {
    kind: 'drag';
    selector: ElementSelector;
    target: ElementDragTarget;
    options?: ElementDragOptions;
  };

export interface InspectorSession {
  subscribeTree(options?: UiTreeSubscribeOptions): AsyncIterable<UiTreeUpdate>;
  hitTest(point: Coordinates): Promise<MobileElementSnapshot | undefined>;
  highlight(selector: ElementSelector): Promise<void>;
  clearHighlight(): Promise<void>;
  generateLocator(selector: ElementSelector): Promise<LocatorSuggestion[]>;
  executeAction(action: InspectorAction): Promise<void>;
  /**
   * Reads the DOM of the device's active WebView (if any) so the inspector can
   * splice web elements into the UI tree with real DOM locators. Resolves
   * undefined when the platform/app exposes no inspectable WebView.
   */
  webSnapshot?(): Promise<WebTreeSnapshot | undefined>;
  /** Performs a fill/tap/clear/select on a WebView DOM element by its locator. */
  webAct?(descriptor: WebLocatorDescriptor, action: WebElementAction, value?: string): Promise<void>;
}

export interface CommandEnvelope<TParams = unknown> {
  id: string;
  method: string;
  params?: TParams;
}

export interface AgentTraceContext {
  testId?: string;
  workerIndex?: number;
  projectName?: string;
}

export interface AgentCommandEnvelope<TPayload = unknown> {
  id: string;
  protocolVersion: string;
  command: string;
  deadlineMs: number;
  payload?: TPayload;
  trace?: AgentTraceContext;
}

export interface CommandTiming {
  totalMs: number;
  agentMs?: number;
  nativeLookupMs?: number;
  nativeActionMs?: number;
  snapshotMs?: number;
  screenshotMs?: number;
  attempts?: number;
  hostRoundTrips?: number;
  usedSnapshot?: boolean;
  usedLegacyFallback?: boolean;
}

export type AgentErrorCode =
  | 'LOCATOR_TIMEOUT'
  | 'ELEMENT_NOT_VISIBLE'
  | 'ELEMENT_NOT_ENABLED'
  | 'ELEMENT_STALE'
  | 'AMBIGUOUS_LOCATOR'
  | 'APP_NOT_RUNNING'
  | 'AGENT_DISCONNECTED'
  | 'UNSUPPORTED_SELECTOR'
  | 'PLATFORM_ERROR'
  | 'UNKNOWN'
  | string;

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  selector?: ElementSelector;
  timeoutMs?: number;
  platformMessage?: string;
  details?: unknown;
}

export interface AgentDiagnostics {
  currentApp?: string;
  lastVisibleTexts?: string[];
  matchingCandidates?: number;
  snapshot?: MobileElementSnapshot;
  logs?: string[];
  [key: string]: unknown;
}

export interface AgentCommandResponse<TData = unknown> {
  id: string;
  ok: true;
  data: TData;
  timing: CommandTiming;
}

export interface AgentCommandErrorResponse {
  id: string;
  ok: false;
  error: AgentError;
  timing: CommandTiming;
  diagnostics?: AgentDiagnostics;
}

export interface CommandResult<TResult = unknown> {
  id: string;
  ok: boolean;
  result?: TResult;
  data?: TResult;
  timing?: CommandTiming;
  diagnostics?: AgentDiagnostics;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface NativeAgentInfo {
  id: string;
  platform: PlatformName;
  version: string;
  protocolVersion: number;
  capabilities: string[];
}

export type NativeAgentMethod =
  | 'agent.ping'
  | 'app.launch'
  | 'app.terminate'
  | 'device.screenshot'
  | 'device.viewport'
  | 'device.setOrientation'
  | 'tree.get'
  | 'element.find'
  | 'element.findAll'
  | 'element.findMany'
  | 'element.wait'
  | 'element.tap'
  | 'element.doubleTap'
  | 'element.longPress'
  | 'element.fill'
  | 'element.drag'
  | 'gesture.tap'
  | 'gesture.doubleTap'
  | 'gesture.longPress'
  | 'gesture.swipe'
  | 'gesture.drag'
  | 'keyboard.state'
  | 'keyboard.dismiss'
  | 'keyboard.type';

export interface NativeAgentCommandEnvelope<TParams = unknown> extends CommandEnvelope<TParams>, AgentCommandEnvelope<TParams> {
  method: NativeAgentMethod;
  command: NativeAgentMethod;
  payload?: TParams;
}

export type NativeAgentCommandResult<TResult = unknown> = CommandResult<TResult>;

export interface NativeAgentElementCommandParams {
  selector: ElementSelector;
}

export interface NativeAgentElementManyCommandParams {
  selectors: ElementSelector[];
}

export interface NativeAgentElementWaitParams extends NativeAgentElementCommandParams {
  options?: ElementWaitOptions;
}

export interface NativeAgentElementTapParams extends NativeAgentElementCommandParams {
  options?: ElementTapOptions;
}

export interface NativeAgentElementDoubleTapParams extends NativeAgentElementCommandParams {
  options?: ElementDoubleTapOptions;
}

export interface NativeAgentElementLongPressParams extends NativeAgentElementCommandParams {
  options?: ElementLongPressOptions;
}

export interface NativeAgentElementFillParams extends NativeAgentElementCommandParams {
  value: string;
  options?: ElementFillOptions;
}

export interface NativeAgentElementDragParams extends NativeAgentElementCommandParams {
  target: ElementDragTarget;
  options?: ElementDragOptions;
}

export interface NativeAgentGestureTapParams {
  target: Coordinates;
  options?: TapOptions;
}

export interface NativeAgentGestureDoubleTapParams {
  target: Coordinates;
  options?: DoubleTapOptions;
}

export interface NativeAgentGestureLongPressParams {
  target: Coordinates;
  options?: LongPressOptions;
}

export interface NativeAgentGestureSwipeParams {
  gesture: SwipeGesture;
}

export interface NativeAgentGestureDragParams {
  gesture: DragGesture;
}

export interface NativeAgentDeviceOrientationParams {
  orientation: DeviceOrientation;
}

export interface NativeAgentCommandParamsMap {
  'agent.ping': undefined;
  'app.launch': undefined;
  'app.terminate': undefined;
  'device.screenshot': undefined;
  'device.viewport': undefined;
  'device.setOrientation': NativeAgentDeviceOrientationParams;
  'tree.get': undefined;
  'element.find': NativeAgentElementCommandParams;
  'element.findAll': NativeAgentElementCommandParams;
  'element.findMany': NativeAgentElementManyCommandParams;
  'element.wait': NativeAgentElementWaitParams;
  'element.tap': NativeAgentElementTapParams;
  'element.doubleTap': NativeAgentElementDoubleTapParams;
  'element.longPress': NativeAgentElementLongPressParams;
  'element.fill': NativeAgentElementFillParams;
  'element.drag': NativeAgentElementDragParams;
  'gesture.tap': NativeAgentGestureTapParams;
  'gesture.doubleTap': NativeAgentGestureDoubleTapParams;
  'gesture.longPress': NativeAgentGestureLongPressParams;
  'gesture.swipe': NativeAgentGestureSwipeParams;
  'gesture.drag': NativeAgentGestureDragParams;
  'keyboard.state': undefined;
  'keyboard.dismiss': undefined;
  'keyboard.type': { text: string };
}

export interface NativeAgentCommandResultMap {
  'agent.ping': NativeAgentInfo;
  'app.launch': void;
  'app.terminate': void;
  'device.screenshot': { base64: string };
  'device.viewport': Bounds;
  'device.setOrientation': void;
  'tree.get': MobileElementSnapshot;
  'element.find': MobileElementSnapshot | undefined;
  'element.findAll': MobileElementSnapshot[];
  'element.findMany': MobileElementSnapshot[];
  'element.wait': MobileElementSnapshot | undefined;
  'element.tap': void;
  'element.doubleTap': void;
  'element.longPress': void;
  'element.fill': void;
  'element.drag': void;
  'gesture.tap': void;
  'gesture.doubleTap': void;
  'gesture.longPress': void;
  'gesture.swipe': void;
  'gesture.drag': void;
  'keyboard.state': KeyboardState;
  'keyboard.dismiss': void;
  'keyboard.type': void;
}

export type NativeAgentCommandParams<M extends NativeAgentMethod> = NativeAgentCommandParamsMap[M];

export type NativeAgentCommandResponse<M extends NativeAgentMethod> = NativeAgentCommandResultMap[M];

// ---------------------------------------------------------------------------
// Network observation
//
// Scope note, deliberately narrow: Astur reports **instrumented application
// traffic**, never "all device traffic". Each backend covers a specific set of
// transports and nothing else — a WebView, a native SDK, or a client that
// bypasses the instrumented layer is invisible. `NetworkCapabilities` exists so
// a test can ask what is actually covered instead of assuming, and so an
// unsupported call fails loudly rather than returning a misleadingly empty list.
// ---------------------------------------------------------------------------

/**
 * A class of traffic a backend can see. Listed explicitly because coverage is
 * per-transport: the Dart VM profiler reports `dart:io` HTTP and sockets but
 * says nothing about a WebView's own requests.
 */
export type NetworkTransport = 'http' | 'websocket';

/** What a session can actually do with network traffic right now. */
export interface NetworkCapabilities {
  /** Requests can be listed after the fact. */
  observe: boolean;
  /**
   * Requests can be stubbed, delayed, or failed. Always false until an
   * in-app adapter is present — no backend can intercept without one.
   */
  intercept: boolean;
  /** Transports the observe/intercept flags apply to. */
  transports: NetworkTransport[];
  /** Whether response bodies are retrievable, or only metadata. */
  responseBodies: boolean;
  /**
   * Human-readable statement of what is instrumented, for error messages and
   * reports — e.g. "dart:io HTTP client traffic (Dart VM service profiler)".
   */
  coverage: string;
  /** True when the app must embed the Astur network adapter to go further. */
  adapterRequired: boolean;
}

/** One observed request/response exchange. */
export interface NetworkRequestRecord {
  id: string;
  transport: NetworkTransport;
  method: string;
  url: string;
  /** Header values are redacted per NetworkRedactionOptions before this is built. */
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  status?: number;
  /** Wall-clock start, epoch ms. */
  startedAt: number;
  /** Total duration in ms, absent while still in flight. */
  durationMs?: number;
  /** Absent when the backend cannot supply bodies, or the body exceeded the cap. */
  responseBody?: string;
  /** Set when the body was dropped, saying which limit was hit. */
  bodyOmittedReason?: 'too-large' | 'not-captured';
  /** Populated when the exchange failed before completing. */
  error?: string;
}

/** Filter for {@link NetworkObserver.requests}. */
export interface NetworkRequestFilter {
  /** Substring or pattern the URL must match. */
  url?: string | RegExp;
  method?: string;
  transport?: NetworkTransport;
}

export interface NetworkRedactionOptions {
  /**
   * Header names replaced with `<redacted>`, compared case-insensitively.
   * Defaults to authorization/cookie/set-cookie/x-api-key — credentials should
   * not reach a CI log or an HTML report by default.
   */
  redactHeaders?: string[];
  /**
   * Largest response body retained, in bytes. Bodies above it are dropped with
   * `bodyOmittedReason: 'too-large'` so a long run cannot accumulate megabytes
   * of payload in memory.
   */
  maxBodyBytes?: number;
}
