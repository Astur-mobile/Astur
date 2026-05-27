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
  | 'xpath'
  | 'coordinates';

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

export interface DeviceInfo {
  id: string;
  name: string;
  platform: PlatformName;
  kind: DeviceKind;
  state: DeviceState;
  osVersion?: string;
  model?: string;
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

export interface AsturConfig {
  platform: PlatformName;
  device?: DeviceSelector;
  app?: string | AppUnderTest;
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
}

export interface WebViewEndpoint {
  context: MobileContextInfo;
  cdpUrl: string;
}

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

export interface ElementSelector {
  strategy: LocatorStrategy;
  value: string;
  exact?: boolean;
  name?: string | RegExp;
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
}

export type ElementDragTarget = Coordinates | { selector: ElementSelector };

export interface ElementDragOptions extends ElementActionOptions {
  durationMs?: number;
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
  | 'keyboard.dismiss';

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
}

export interface NativeAgentCommandResultMap {
  'agent.ping': NativeAgentInfo;
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
}

export type NativeAgentCommandParams<M extends NativeAgentMethod> = NativeAgentCommandParamsMap[M];

export type NativeAgentCommandResponse<M extends NativeAgentMethod> = NativeAgentCommandResultMap[M];
