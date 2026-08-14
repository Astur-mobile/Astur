import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  Coordinates,
  DeviceFileEntry,
  DeviceInfo,
  DeviceOrientation,
  DoctorCheck,
  DragGesture,
  DoubleTapOptions,
  ElementDragOptions,
  ElementDragTarget,
  ElementDoubleTapOptions,
  ElementFillOptions,
  ElementLongPressOptions,
  ElementSelector,
  ElementTapOptions,
  ElementWaitOptions,
  LaunchOptions,
  LongPressOptions,
  KeyboardState,
  MobileContextInfo,
  NetworkCapabilities,
  NetworkRedactionOptions,
  NetworkRequestFilter,
  NetworkRequestRecord,
  MobileElementSnapshot,
  MobileRole,
  NormalizedCapabilities,
  PlatformName,
  InspectorSession,
  LocatorSuggestion,
  RecordingStopOptions,
  RoleSelectorOptions,
  ScreenshotOptions,
  SwipeGesture,
  TapOptions,
  UiTreeSubscribeOptions,
  UiTreeUpdate,
  AsturConfig,
  AppResetOptions,
  AppUnderTest,
  Bounds,
  WebViewEndpoint,
  WebViewSelector
} from '@astur-mobile/protocol';
import { materializeCapabilities, normalizeCapabilities } from './config.js';
import { AsturError } from './errors.js';
import { createInspectorSession, type RuntimeInspectorSessionOptions } from './inspector.js';
import { preparePointerTargetForKeyboard } from './keyboard.js';
import { by, findElements, MobileLocator } from './locator.js';
import { WebContext, type WebEvaluator } from './webBridge.js';
import { delay } from './wait.js';

export interface PlatformDriver {
  readonly platform: PlatformName;
  doctor(): Promise<DoctorCheck[]>;
  listDevices(): Promise<DeviceInfo[]>;
  createSession(capabilities: NormalizedCapabilities): Promise<PlatformSession>;
}

export interface PlatformSession {
  readonly capabilities: NormalizedCapabilities;
  readonly deviceInfo: DeviceInfo;
  close(): Promise<void>;
  isAppInstalled?(identifier: string): Promise<boolean>;
  installApp(path: string): Promise<void>;
  uninstallApp(identifier: string): Promise<void>;
  launchApp(options?: LaunchOptions): Promise<void>;
  terminateApp(): Promise<void>;
  clearAppData(identifier: string): Promise<void>;
  clearAppCache(identifier: string): Promise<void>;
  grantPermission?(identifier: string, permission: string): Promise<void>;
  revokePermission?(identifier: string, permission: string): Promise<void>;
  resetApp(options?: AppResetOptions): Promise<void>;
  setOrientation?(orientation: DeviceOrientation): Promise<void>;
  lockDevice(): Promise<void>;
  unlockDevice(): Promise<void>;
  isDeviceLocked(): Promise<boolean>;
  getTree(): Promise<MobileElementSnapshot>;
  getViewport?(): Promise<Bounds>;
  subscribeTree?(options?: UiTreeSubscribeOptions): AsyncIterable<UiTreeUpdate>;
  hitTest?(point: Coordinates): Promise<MobileElementSnapshot | undefined>;
  highlightElement?(selector: ElementSelector): Promise<void>;
  clearHighlight?(): Promise<void>;
  findElement?(selector: ElementSelector): Promise<MobileElementSnapshot | undefined>;
  findElements?(selector: ElementSelector): Promise<MobileElementSnapshot[]>;
  findManyElements?(selectors: ElementSelector[]): Promise<MobileElementSnapshot[]>;
  waitForElement?(selector: ElementSelector, options?: ElementWaitOptions): Promise<MobileElementSnapshot>;
  waitForElementHidden?(selector: ElementSelector, options?: ElementWaitOptions): Promise<void>;
  tapElement?(selector: ElementSelector, options?: ElementTapOptions): Promise<void>;
  doubleTapElement?(selector: ElementSelector, options?: ElementDoubleTapOptions): Promise<void>;
  longPressElement?(selector: ElementSelector, options?: ElementLongPressOptions): Promise<void>;
  fillElement?(selector: ElementSelector, value: string, options?: ElementFillOptions): Promise<void>;
  dragElement?(selector: ElementSelector, target: ElementDragTarget, options?: ElementDragOptions): Promise<void>;
  tap(target: Coordinates): Promise<void>;
  doubleTap?(target: Coordinates, options?: DoubleTapOptions): Promise<void>;
  longPress(target: Coordinates, options?: LongPressOptions): Promise<void>;
  fill(selector: ElementSelector, value: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  swipe(gesture: SwipeGesture): Promise<void>;
  drag(gesture: DragGesture): Promise<void>;
  startRecording?(): Promise<void>;
  stopRecording?(options?: RecordingStopOptions): Promise<Buffer | undefined>;
  screenshot(): Promise<Buffer>;
  openWeb(url: string): Promise<void>;
  pushFile?(localPath: string, remotePath: string): Promise<void>;
  pullFile?(remotePath: string): Promise<Buffer>;
  saveFile?(remotePath: string, localPath: string): Promise<void>;
  removeFile?(remotePath: string): Promise<void>;
  listFiles?(remotePath: string): Promise<DeviceFileEntry[]>;
  getKeyboardState?(): Promise<KeyboardState>;
  dismissKeyboard?(): Promise<void>;
  /**
   * Types into whatever currently holds keyboard focus, with no element to
   * target. See {@link AsturDevice.keyboard.type} for when that is the only
   * option.
   */
  typeText?(text: string): Promise<void>;
  /**
   * What this session can see of the app's network traffic. A driver that
   * cannot observe anything omits these entirely, and {@link AsturDevice.network}
   * reports `observe: false` rather than returning an empty request list — an
   * empty list must mean "nothing happened", never "not supported".
   */
  getNetworkCapabilities?(): Promise<NetworkCapabilities>;
  getNetworkRequests?(options?: NetworkRedactionOptions): Promise<NetworkRequestRecord[]>;
  clearNetworkRequests?(): Promise<void>;
  listContexts?(): Promise<MobileContextInfo[]>;
  connectWebView?(selector?: WebViewSelector): Promise<WebViewEndpoint>;
  /**
   * Opens a transport into a WebView's DOM that ships a JS expression and returns
   * its JSON value. Powers {@link AsturDevice.webContext}. Platforms back it with
   * whatever remote-debugging protocol the engine exposes (CDP on Android,
   * WebKit RWI on iOS) — callers never see the protocol.
   */
  createWebEvaluator?(selector?: WebViewSelector): Promise<WebEvaluator>;
}

export class AsturDevice {
  readonly capabilities: NormalizedCapabilities;
  readonly deviceInfo: DeviceInfo;
  private readonly session: PlatformSession;

  constructor(session: PlatformSession) {
    this.session = session;
    this.capabilities = session.capabilities;
    this.deviceInfo = session.deviceInfo;
  }

  readonly app = {
    install: async (path?: string): Promise<void> => {
      const appPath = path ?? this.capabilities.app?.path;
      if (!appPath) {
        throw new AsturError('APP_PATH_REQUIRED', 'No app path was provided.');
      }

      await this.session.installApp(appPath);
    },

    uninstall: async (target?: string | AppUnderTest): Promise<void> => {
      await this.session.uninstallApp(appIdentifier(this.capabilities, target));
    },

    launch: async (options?: LaunchOptions): Promise<void> => {
      await this.session.launchApp(options);
    },

    terminate: async (): Promise<void> => {
      await this.session.terminateApp();
    },

    clearData: async (target?: string | AppUnderTest): Promise<void> => {
      await this.session.clearAppData(appIdentifier(this.capabilities, target));
    },

    clearCache: async (target?: string | AppUnderTest): Promise<void> => {
      await this.session.clearAppCache(appIdentifier(this.capabilities, target));
    },

    reset: async (options?: AppResetOptions): Promise<void> => {
      await this.session.resetApp(options);
    }
  };

  readonly gestures = {
    tap: async (point: Coordinates, options?: TapOptions): Promise<void> => {
      await this.tap(point, options);
    },

    doubleTap: async (point: Coordinates, options?: DoubleTapOptions): Promise<void> => {
      await this.doubleTap(point, options);
    },

    longPress: async (point: Coordinates, options?: LongPressOptions): Promise<void> => {
      await this.longPress(point, options);
    },

    pressAndHold: async (point: Coordinates, options?: LongPressOptions): Promise<void> => {
      await this.pressAndHold(point, options);
    },

    swipe: async (gesture: SwipeGesture): Promise<void> => {
      await this.swipe(gesture);
    },

    drag: async (gesture: DragGesture): Promise<void> => {
      await this.drag(gesture);
    }
  };

  readonly navigation = {
    back: async (): Promise<void> => {
      await this.back();
    },

    home: async (): Promise<void> => {
      await this.home();
    },

    recentApps: async (): Promise<void> => {
      await this.recentApps();
    }
  };

  readonly orientation = {
    set: async (orientation: DeviceOrientation): Promise<void> => {
      await this.setOrientation(orientation);
    },

    portrait: async (): Promise<void> => {
      await this.setOrientation('portrait');
    },

    landscape: async (): Promise<void> => {
      await this.setOrientation('landscape');
    }
  };

  readonly system = {
    lock: async (): Promise<void> => {
      await this.lock();
    },

    unlock: async (): Promise<void> => {
      await this.unlock();
    },

    isLocked: async (): Promise<boolean> => this.isLocked()
  };

  readonly permissions = {
    grant: async (permission: string, target?: string | AppUnderTest): Promise<void> => {
      if (!this.session.grantPermission) {
        throw new AsturError('PERMISSIONS_NOT_SUPPORTED', `${this.deviceInfo.platform} does not expose permission control yet.`);
      }

      await this.session.grantPermission(appIdentifier(this.capabilities, target), permission);
    },

    revoke: async (permission: string, target?: string | AppUnderTest): Promise<void> => {
      if (!this.session.revokePermission) {
        throw new AsturError('PERMISSIONS_NOT_SUPPORTED', `${this.deviceInfo.platform} does not expose permission control yet.`);
      }

      await this.session.revokePermission(appIdentifier(this.capabilities, target), permission);
    }
  };

  /**
   * Observation of the app's **instrumented** network traffic — never "all
   * device traffic". What is covered depends entirely on the backend, so ask
   * {@link network.capabilities} instead of assuming; anything outside that
   * coverage is invisible and always will be.
   *
   * Read-only today. Stubbing/failing requests needs an in-app adapter that can
   * hold a request open, which no current backend provides — hence
   * `capabilities().intercept === false` everywhere for now.
   */
  readonly network = {
    capabilities: async (): Promise<NetworkCapabilities> => {
      if (!this.session.getNetworkCapabilities) {
        return {
          observe: false,
          intercept: false,
          transports: [],
          responseBodies: false,
          coverage: `${this.deviceInfo.platform} sessions do not expose network observation yet`,
          adapterRequired: true
        };
      }

      return this.session.getNetworkCapabilities();
    },

    /**
     * Requests seen so far, newest last. Throws rather than returning `[]` when
     * the session cannot observe at all — an empty array has to mean "no
     * traffic", or a test asserting on it would pass for the wrong reason.
     */
    requests: async (
      filter?: NetworkRequestFilter,
      options?: NetworkRedactionOptions
    ): Promise<NetworkRequestRecord[]> => {
      if (!this.session.getNetworkRequests) {
        throw new AsturError(
          'NETWORK_OBSERVATION_UNSUPPORTED',
          `Network observation is not available for this session (${this.deviceInfo.platform}`
          + `${this.deviceInfo.uiEngine ? `/${this.deviceInfo.uiEngine}` : ''}). `
          + 'Check device.network.capabilities() before calling requests().'
        );
      }

      return filterNetworkRecords(await this.session.getNetworkRequests(options), filter);
    },

    /**
     * Drops everything buffered so far. Called automatically between tests by
     * the Astur fixture, so one test's traffic can never be asserted on by the
     * next; call it directly to isolate a step within a test.
     */
    clear: async (): Promise<void> => {
      await this.session.clearNetworkRequests?.();
    }
  };

  readonly keyboard = {
    isVisible: async (): Promise<boolean> => {
      if (!this.session.getKeyboardState) {
        return false;
      }

      return (await this.session.getKeyboardState()).visible;
    },

    dismiss: async (): Promise<void> => {
      if (!this.session.dismissKeyboard) {
        throw new AsturError(
          'KEYBOARD_NOT_SUPPORTED',
          `${this.deviceInfo.platform} does not expose soft keyboard control yet.`
        );
      }

      await this.session.dismissKeyboard();
    },

    hide: async (): Promise<void> => {
      await this.keyboard.dismiss();
    },

    /**
     * Types into whatever currently holds keyboard focus.
     *
     * Prefer `locator.fill()` — it resolves the field, clears it, and verifies
     * the value landed. Reach for this only when there is no element to target:
     * a custom control whose real input never reaches the accessibility tree.
     * A multi-box OTP field is the usual case — the boxes are plain views and
     * the `UITextField`/`TextInput` behind them is hidden, so `getByType` finds
     * nothing to fill.
     *
     * Focus the control first (a tap on the box normally does it), then:
     *
     * ```ts
     * await device.getByTestId('otp-input').tap();
     * await device.keyboard.type('123456');
     * ```
     *
     * Because it targets focus rather than an element, nothing verifies where
     * the characters landed — that is the trade for reaching a control the tree
     * cannot describe.
     */
    type: async (text: string): Promise<void> => {
      if (!this.session.typeText) {
        throw new AsturError(
          'KEYBOARD_NOT_SUPPORTED',
          `${this.deviceInfo.platform} does not expose keyboard typing yet.`
        );
      }

      await this.session.typeText(text);
    },

    show: async (target?: MobileLocator | ElementSelector): Promise<void> => {
      if (!target) {
        const visible = this.session.getKeyboardState
          ? (await this.session.getKeyboardState().catch((): KeyboardState => ({ visible: false }))).visible
          : false;

        if (visible) {
          return;
        }

        throw new AsturError(
          'KEYBOARD_TARGET_REQUIRED',
          'Showing the mobile keyboard requires a text-input locator. Use device.keyboard.show(device.getById("field")) or locator.tap({ keyboard: "preserve" }).'
        );
      }

      const locator = target instanceof MobileLocator ? target : this.find(target);
      await locator.tap({ keyboard: 'preserve' });
    }
  };

  readonly files = {
    push: async (localPath: string, remotePath: string): Promise<void> => {
      if (!this.session.pushFile) {
        throw unsupportedFilesError(this.deviceInfo.platform);
      }

      await this.session.pushFile(localPath, remotePath);
    },

    pull: async (remotePath: string): Promise<Buffer> => {
      if (!this.session.pullFile) {
        throw unsupportedFilesError(this.deviceInfo.platform);
      }

      return this.session.pullFile(remotePath);
    },

    save: async (remotePath: string, localPath: string): Promise<void> => {
      if (this.session.saveFile) {
        await this.session.saveFile(remotePath, localPath);
        return;
      }

      if (!this.session.pullFile) {
        throw unsupportedFilesError(this.deviceInfo.platform);
      }

      await writeLocalFile(localPath, await this.session.pullFile(remotePath));
    },

    remove: async (remotePath: string): Promise<void> => {
      if (!this.session.removeFile) {
        throw unsupportedFilesError(this.deviceInfo.platform);
      }

      await this.session.removeFile(remotePath);
    },

    list: async (remotePath: string): Promise<DeviceFileEntry[]> => {
      if (!this.session.listFiles) {
        throw unsupportedFilesError(this.deviceInfo.platform);
      }

      return this.session.listFiles(remotePath);
    }
  };

  find(selector: ElementSelector): MobileLocator {
    return new MobileLocator(this.session, selector);
  }

  async findAll(selector: ElementSelector): Promise<MobileElementSnapshot[]> {
    return this.find(selector).all();
  }

  async findMany(selectors: ElementSelector[]): Promise<MobileElementSnapshot[]> {
    if (this.session.findManyElements) {
      return this.session.findManyElements(selectors);
    }

    const root = await this.session.getTree();
    return selectors.flatMap((selector) => findElements(root, selector));
  }

  locator(selector: ElementSelector): MobileLocator {
    return this.find(selector);
  }

  getByLabel(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.label(value, options));
  }

  getByA11y(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.a11y(value, options));
  }

  getByText(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.text(value, options));
  }

  getByTestId(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.testId(value, options));
  }

  getById(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.id(value, options));
  }

  getByRole(role: MobileRole | string, options?: RoleSelectorOptions): MobileLocator {
    return this.find(by.role(role, options));
  }

  getByType(value: string, options?: { exact?: boolean }): MobileLocator {
    return this.find(by.type(value, options));
  }

  inspector(options?: RuntimeInspectorSessionOptions): InspectorSession {
    return createInspectorSession(this.session, options);
  }

  async suggestLocators(selector: ElementSelector): Promise<LocatorSuggestion[]> {
    return this.inspector().generateLocator(selector);
  }

  async tap(point: Coordinates, options: TapOptions = {}): Promise<void> {
    await preparePointerTargetForKeyboard(this.session, point, options.keyboard);
    await this.session.tap(point);
  }

  async doubleTap(point: Coordinates, options: DoubleTapOptions = {}): Promise<void> {
    await preparePointerTargetForKeyboard(this.session, point, options.keyboard);
    if (this.session.doubleTap) {
      await this.session.doubleTap(point, options);
      return;
    }

    await this.session.tap(point);
    await delay(options.intervalMs ?? 80);
    await this.session.tap(point);
  }

  async longPress(point: Coordinates, options?: LongPressOptions): Promise<void> {
    await preparePointerTargetForKeyboard(this.session, point, options?.keyboard);
    await this.session.longPress(point, options);
  }

  async pressAndHold(point: Coordinates, options?: LongPressOptions): Promise<void> {
    await this.longPress(point, options);
  }

  async setOrientation(orientation: DeviceOrientation): Promise<void> {
    if (!this.session.setOrientation) {
      throw new AsturError(
        'ORIENTATION_NOT_SUPPORTED',
        `${this.deviceInfo.platform} does not expose orientation control yet.`
      );
    }

    await this.session.setOrientation(orientation);
  }

  async pressKey(key: string): Promise<void> {
    await this.session.pressKey(key);
  }

  async back(): Promise<void> {
    await this.pressKey('BACK');
  }

  async home(): Promise<void> {
    await this.pressKey('HOME');
  }

  async recentApps(): Promise<void> {
    await this.pressKey('APP_SWITCH');
  }

  async recents(): Promise<void> {
    await this.recentApps();
  }

  async lock(): Promise<void> {
    await this.session.lockDevice();
  }

  async unlock(): Promise<void> {
    await this.session.unlockDevice();
  }

  async isLocked(): Promise<boolean> {
    return this.session.isDeviceLocked();
  }

  async swipe(gesture: SwipeGesture): Promise<void> {
    await this.session.swipe(gesture);
  }

  async drag(gesture: DragGesture): Promise<void> {
    await this.session.drag(gesture);
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const image = await this.session.screenshot();
    if (options.path) {
      await writeLocalFile(options.path, image);
    }

    return image;
  }

  async startRecording(): Promise<void> {
    if (!this.session.startRecording) {
      throw new AsturError('RECORDING_NOT_SUPPORTED', `${this.deviceInfo.platform} does not support native video recording yet.`);
    }

    await this.session.startRecording();
  }

  async stopRecording(options: RecordingStopOptions = {}): Promise<Buffer | undefined> {
    if (!this.session.stopRecording) {
      throw new AsturError('RECORDING_NOT_SUPPORTED', `${this.deviceInfo.platform} does not support native video recording yet.`);
    }

    return this.session.stopRecording(options);
  }

  async tree(): Promise<MobileElementSnapshot> {
    return this.session.getTree();
  }

  async viewport(): Promise<Bounds> {
    if (this.session.getViewport) {
      return this.session.getViewport();
    }

    return (await this.session.getTree()).bounds;
  }

  async openWeb(url: string): Promise<void> {
    await this.session.openWeb(url);
  }

  async contexts(): Promise<MobileContextInfo[]> {
    if (!this.session.listContexts) {
      return [nativeContext()];
    }

    const contexts = await this.session.listContexts();
    return contexts.some((context) => context.type === 'native')
      ? contexts
      : [nativeContext(), ...contexts];
  }

  async webViewEndpoint(selector?: WebViewSelector): Promise<WebViewEndpoint> {
    if (!this.session.connectWebView) {
      throw new AsturError(
        'WEBVIEW_NOT_SUPPORTED',
        `${this.deviceInfo.platform} does not expose WebView DOM contexts yet.`
      );
    }

    return this.session.connectWebView(selector);
  }

  /**
   * Opens a {@link WebContext} into a native WebView's DOM — inspect the tree,
   * generate stable locators, and fill/tap elements — driven entirely by injected
   * JS over the engine's remote-debugging transport. Works the same across
   * frameworks (Flutter, React Native) on each platform that exposes the transport.
   */
  async webContext(selector?: WebViewSelector): Promise<WebContext> {
    if (!this.session.createWebEvaluator) {
      throw new AsturError(
        'WEBVIEW_NOT_SUPPORTED',
        `${this.deviceInfo.platform} cannot open WebView DOM contexts yet.`
      );
    }

    return new WebContext(await this.session.createWebEvaluator(selector));
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}

async function writeLocalFile(path: string, contents: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function unsupportedFilesError(platform: PlatformName): AsturError {
  return new AsturError('FILE_TRANSFER_NOT_SUPPORTED', `${platform} does not expose device file transfer yet.`);
}

function nativeContext(): MobileContextInfo {
  return {
    id: 'native',
    type: 'native',
    title: 'Native'
  };
}

function appIdentifier(capabilities: NormalizedCapabilities, target?: string | AppUnderTest): string {
  const app = typeof target === 'object' ? target : capabilities.app;
  const identifier = typeof target === 'string'
    ? target
    : app?.packageName ?? app?.bundleId;

  if (!identifier) {
    throw new AsturError(
      'APP_IDENTIFIER_REQUIRED',
      'App management requires app.packageName on Android or app.bundleId on iOS.'
    );
  }

  return identifier;
}

export class AsturRuntime {
  private readonly drivers = new Map<PlatformName, PlatformDriver>();

  register(driver: PlatformDriver): this {
    this.drivers.set(driver.platform, driver);
    return this;
  }

  async doctor(): Promise<DoctorCheck[]> {
    const checks = await Promise.all([...this.drivers.values()].map((driver) => driver.doctor()));
    return checks.flat();
  }

  async listDevices(platform?: PlatformName): Promise<DeviceInfo[]> {
    const drivers = platform ? [this.requireDriver(platform)] : [...this.drivers.values()];
    const devices = await Promise.all(drivers.map((driver) => driver.listDevices()));
    return devices.flat();
  }

  async createDevice(config: AsturConfig): Promise<AsturDevice> {
    const capabilities = await materializeCapabilities(normalizeCapabilities(config));
    const driver = this.requireDriver(capabilities.platform);
    const session = await driver.createSession(capabilities);

    const app = session.capabilities.app;
    if (app?.path) {
      const identifier = app.packageName ?? app.bundleId;
      const forceInstall = capabilities.platform === 'android'
        && process.env.ASTUR_ANDROID_APP_FORCE_INSTALL === '1';

      if (forceInstall) {
        if (identifier) {
          try {
            await session.uninstallApp(identifier);
          } catch {
            // The package may not be installed yet; the install below is still
            // the authoritative operation.
          }
        }
        await session.installApp(app.path);
      } else if (identifier && session.isAppInstalled) {
        const installed = await session.isAppInstalled(identifier).catch(() => false);
        if (!installed) {
          await session.installApp(app.path);
        }
      } else {
        await session.installApp(app.path);
      }
    }

    return new AsturDevice(session);
  }

  private requireDriver(platform: PlatformName): PlatformDriver {
    const driver = this.drivers.get(platform);
    if (!driver) {
      throw new AsturError('DRIVER_NOT_REGISTERED', `No Astur driver registered for ${platform}.`);
    }

    return driver;
  }
}

/**
 * Applies a {@link NetworkRequestFilter} to collected records.
 *
 * Lives in core so every backend filters identically — a driver only has to
 * produce records, never interpret the filter.
 */
export function filterNetworkRecords(
  records: NetworkRequestRecord[],
  filter: NetworkRequestFilter | undefined
): NetworkRequestRecord[] {
  if (!filter) {
    return records;
  }

  return records.filter((record) => {
    if (filter.method && record.method.toUpperCase() !== filter.method.toUpperCase()) {
      return false;
    }
    if (filter.transport && record.transport !== filter.transport) {
      return false;
    }
    if (filter.url instanceof RegExp) {
      return filter.url.test(record.url);
    }
    if (typeof filter.url === 'string') {
      return record.url.includes(filter.url);
    }
    return true;
  });
}
