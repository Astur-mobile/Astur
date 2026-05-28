import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, unlink } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  AppResetOptions,
  AppUnderTest,
  Coordinates,
  DeviceInfo,
  DeviceOrientation,
  DeviceSelector,
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
  KeyboardState,
  LaunchOptions,
  LongPressOptions,
  MobileElementSnapshot,
  NativeAgentCommandParams,
  NativeAgentCommandResponse,
  NativeAgentInfo,
  NativeAgentMethod,
  NormalizedCapabilities,
  RecordingStopOptions,
  SwipeGesture
} from '@astur/protocol';
import {
  AsturError,
  connectNativeAgentClient,
  delay,
  type NativeAgentClient,
  type PlatformDriver,
  type PlatformSession
} from '@astur/core';
import { run, runText, spawnCommand } from './command.js';

export interface IosDriverOptions {
  xcrunPath?: string;
  xcodebuildPath?: string;
}

interface IosNativeAgentRuntime {
  client: NativeAgentClient;
  endpoint: string;
  bridge?: IosAgentBridge;
  hostPort?: number;
  process?: ChildProcess;
}

interface SimctlDevicesJson {
  devices: Record<string, Array<{
    name: string;
    udid: string;
    state: string;
    isAvailable?: boolean;
    availabilityError?: string;
  }>>;
}

export function createIosDriver(options: IosDriverOptions = {}): IosDriver {
  return new IosDriver(options);
}

export class IosDriver implements PlatformDriver {
  readonly platform = 'ios' as const;
  private readonly xcrunPath: string;
  private readonly xcodebuildPath: string;

  constructor(options: IosDriverOptions = {}) {
    this.xcrunPath = options.xcrunPath ?? process.env.ASTUR_XCRUN ?? 'xcrun';
    this.xcodebuildPath = options.xcodebuildPath ?? process.env.ASTUR_XCODEBUILD ?? 'xcodebuild';
  }

  async doctor(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    try {
      const version = await runText(this.xcodebuildPath, ['-version']);
      checks.push({
        id: 'ios.xcodebuild',
        label: 'Xcode',
        status: 'pass',
        message: firstLine(version)
      });
    } catch (error) {
      checks.push({
        id: 'ios.xcodebuild',
        label: 'Xcode',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Install Xcode and run xcode-select so xcodebuild is available.'
      });
    }

    try {
      const devices = await this.listDevices();
      checks.push({
        id: 'ios.simulators',
        label: 'iOS simulators',
        status: devices.length ? 'pass' : 'warn',
        message: devices.length ? `${devices.length} simulator(s) available.` : 'No iOS simulators were found.',
        fix: devices.length ? undefined : 'Install an iOS simulator runtime from Xcode settings.'
      });
    } catch (error) {
      checks.push({
        id: 'ios.simulators',
        label: 'iOS simulators',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error)
      });
    }

    checks.push({
      id: 'ios.xctest-agent',
      label: 'XCUITest agent',
      status: 'warn',
      message: 'Native iOS element automation requires the Swift XCUITest agent.',
      fix: 'Build agents/ios-xctest-agent and configure signing for real devices.'
    });

    return checks;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const output = await runText(this.xcrunPath, ['simctl', 'list', 'devices', 'available', '--json']);
    return parseSimctlDevices(output);
  }

  async createSession(capabilities: NormalizedCapabilities): Promise<PlatformSession> {
    if (capabilities.device.cloud) {
      throw new AsturError(
        'CLOUD_PROVIDER_NOT_IMPLEMENTED',
        'BrowserStack execution is scaffolded by Astur init, but the cloud driver is not implemented in this alpha. Use a local iOS simulator or real device for now.',
        { cloud: capabilities.device.cloud }
      );
    }

    const devices = await this.listDevices();
    const device = selectDevice(devices, capabilities.device);

    if (!device) {
      throw new AsturError('DEVICE_NOT_FOUND', 'No matching iOS simulator was found.', {
        selector: capabilities.device,
        devices
      });
    }

    const nativeAgent = await this.resolveNativeAgent(capabilities, device);

    return new IosSession(this.xcrunPath, device, capabilities, nativeAgent);
  }

  private async resolveNativeAgent(
    capabilities: NormalizedCapabilities,
    device: DeviceInfo
  ): Promise<IosNativeAgentRuntime | undefined> {
    if (capabilities.agent.mode === 'off') {
      return undefined;
    }

    const endpoint = capabilities.agent.endpoint ?? process.env.ASTUR_IOS_AGENT_ENDPOINT;
    if (!endpoint) {
      const runtime = await this.tryBootstrapBundledNativeAgent(capabilities, device);
      if (runtime) {
        return runtime;
      }

      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_ENDPOINT_REQUIRED',
          'iOS native-agent mode is required, but no endpoint or buildable XCUITest agent project was available. Set use.astur.agent.endpoint, ASTUR_IOS_AGENT_ENDPOINT, or keep agents/ios-xctest-agent available.'
        );
      }

      return undefined;
    }

    try {
      const client = await connectNativeAgentClient({
        endpoint,
        platform: 'ios',
        handshakeTimeout: capabilities.agent.launchTimeout,
        commandTimeout: capabilities.agent.commandTimeout
      });

      return {
        client,
        endpoint
      };
    } catch (error) {
      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_CONNECT_FAILED',
          `Failed to connect to iOS native agent at ${endpoint}.`,
          {
            endpoint,
            cause: error
          }
        );
      }

      return undefined;
    }
  }

  private async tryBootstrapBundledNativeAgent(
    capabilities: NormalizedCapabilities,
    device: DeviceInfo
  ): Promise<IosNativeAgentRuntime | undefined> {
    if (!capabilities.agent.install || device.kind !== 'simulator') {
      return undefined;
    }

    const app = capabilities.app;
    const bundleId = app?.bundleId ?? app?.packageName;
    if (!bundleId) {
      return undefined;
    }

    const config = resolveIosAgentRuntimeConfig();
    if (!existsSync(config.projectPath)) {
      return undefined;
    }

    const hostPort = config.hostPort ?? await findFreePort();
    const bridge = await IosAgentBridge.start(hostPort, capabilities.agent.commandTimeout);
    const endpoint = bridge.endpoint;
    const launchTimeout = Math.max(capabilities.agent.launchTimeout, defaultBundledIosAgentLaunchTimeoutMs);
    const derivedDataPath = config.derivedDataPath ?? join(
      tmpdir(),
      'astur-ios-agent-derived-data',
      `${pathSafeName(device.id)}-${iosAgentSourceStamp(config.projectPath)}`
    );
    let agentProcess: ChildProcess | undefined;

    try {
      agentProcess = spawnCommand(this.xcodebuildPath, [
        'test',
        '-project',
        config.projectPath,
        '-scheme',
        config.scheme,
        '-destination',
        `id=${device.id}`,
        '-derivedDataPath',
        derivedDataPath,
        '-only-testing:AsturIOSAgentUITests/AsturAgentUITests/testAgentServer',
        `ASTUR_AUT_BUNDLE_ID=${bundleId}`,
        'ASTUR_AUT_LAUNCH=1',
        `ASTUR_IOS_AGENT_BRIDGE_URL=${endpoint}`
      ], {
        env: {
          ...process.env,
          ASTUR_AUT_BUNDLE_ID: bundleId,
          ASTUR_AUT_LAUNCH: '1',
          ASTUR_IOS_AGENT_BRIDGE_URL: endpoint
        }
      });

      const info = await bridge.waitForRegistration(launchTimeout);
      const client = bridge.createClient(info);

      return {
        client,
        endpoint,
        bridge,
        hostPort,
        process: agentProcess
      };
    } catch (error) {
      agentProcess?.kill('SIGINT');
      await bridge.close().catch(() => undefined);

      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_START_FAILED',
          'Failed to build or start the iOS XCUITest native agent.',
          {
            device,
            endpoint,
            projectPath: config.projectPath,
            scheme: config.scheme,
            launchTimeout,
            cause: error
          }
        );
      }

      return undefined;
    }
  }
}

class IosSession implements PlatformSession {
  readonly deviceInfo: DeviceInfo;
  readonly capabilities: NormalizedCapabilities;
  private readonly xcrunPath: string;
  private nativeAgent?: NativeAgentClient;
  private nativeAgentBridge?: IosAgentBridge;
  private nativeAgentProcess?: ChildProcess;
  private readonly unsupportedAgentMethods = new Set<NativeAgentMethod>();
  private recording?: {
    child: ChildProcess;
    path: string;
  };

  constructor(
    xcrunPath: string,
    deviceInfo: DeviceInfo,
    capabilities: NormalizedCapabilities,
    nativeAgent?: IosNativeAgentRuntime
  ) {
    this.xcrunPath = xcrunPath;
    this.deviceInfo = deviceInfo;
    this.capabilities = capabilities;
    this.nativeAgent = nativeAgent?.client;
    this.nativeAgentBridge = nativeAgent?.bridge;
    this.nativeAgentProcess = nativeAgent?.process;
  }

  async close(): Promise<void> {
    if (this.recording) {
      await this.stopRecording().catch(() => undefined);
    }

    if (this.nativeAgentProcess) {
      this.nativeAgentProcess.kill('SIGINT');
      await waitForProcessExit(this.nativeAgentProcess, 5_000);
      this.nativeAgentProcess = undefined;
    }

    if (this.nativeAgentBridge) {
      await this.nativeAgentBridge.close().catch(() => undefined);
      this.nativeAgentBridge = undefined;
    }

    return;
  }

  async installApp(path: string): Promise<void> {
    const materialized = await materializeIosInstallPath(path);
    try {
      await this.simctl(['install', this.deviceInfo.id, materialized.path]);
    } finally {
      await materialized.cleanup?.().catch(() => undefined);
    }
  }

  async isAppInstalled(identifier: string): Promise<boolean> {
    await this.simctl(['get_app_container', this.deviceInfo.id, identifier, 'app']);
    return true;
  }

  async uninstallApp(identifier: string): Promise<void> {
    await this.simctl(['uninstall', this.deviceInfo.id, identifier]);
  }

  async launchApp(options: LaunchOptions = {}): Promise<void> {
    if (options.url) {
      await this.openWeb(options.url);
      return;
    }

    const app = options.app ?? this.capabilities.app;
    const bundleId = app?.bundleId ?? app?.packageName;

    if (!bundleId) {
      throw new AsturError('IOS_BUNDLE_ID_REQUIRED', 'iOS launch requires app.bundleId.');
    }

    await this.simctl(['launch', this.deviceInfo.id, bundleId]);
  }

  async terminateApp(): Promise<void> {
    await this.simctl(['terminate', this.deviceInfo.id, this.resolveBundleId()]);
  }

  async clearAppData(_identifier: string): Promise<void> {
    throw new AsturError(
      'IOS_APP_DATA_CLEAR_NOT_SUPPORTED',
      'iOS Simulator does not expose direct per-app data clearing. Use device.app.reset({ reinstall: true }) with an app path.'
    );
  }

  async clearAppCache(_identifier: string): Promise<void> {
    throw new AsturError(
      'IOS_APP_CACHE_CLEAR_NOT_SUPPORTED',
      'iOS Simulator does not expose direct per-app cache clearing. Use device.app.reset({ reinstall: true }) when a clean app container is required.'
    );
  }

  async grantPermission(identifier: string, permission: string): Promise<void> {
    await this.simctl(['privacy', this.deviceInfo.id, 'grant', normalizeIosPermission(permission), identifier]);
  }

  async revokePermission(identifier: string, permission: string): Promise<void> {
    await this.simctl(['privacy', this.deviceInfo.id, 'revoke', normalizeIosPermission(permission), identifier]);
  }

  async resetApp(options: AppResetOptions = {}): Promise<void> {
    if (options.reinstall === false) {
      throw new AsturError(
        'IOS_RESET_REQUIRES_REINSTALL',
        'iOS reset requires uninstalling and reinstalling the app because simctl has no direct app-data clear command.'
      );
    }

    const app: AppUnderTest = options.app ?? {
      ...this.capabilities.app,
      path: options.path ?? this.capabilities.app?.path,
      bundleId: options.bundleId ?? this.capabilities.app?.bundleId,
      packageName: options.packageName ?? this.capabilities.app?.packageName
    };
    const bundleId = options.bundleId ?? options.packageName ?? app.bundleId ?? app.packageName;
    const path = options.path ?? app.path;

    if (!bundleId) {
      throw new AsturError('IOS_BUNDLE_ID_REQUIRED', 'iOS reset requires app.bundleId.');
    }

    if (!path) {
      throw new AsturError('APP_PATH_REQUIRED', 'iOS reset requires an app path so Astur can reinstall after uninstall.');
    }

    await this.simctl(['terminate', this.deviceInfo.id, bundleId]).catch(() => undefined);
    await this.simctl(['uninstall', this.deviceInfo.id, bundleId]).catch(() => undefined);
    await this.installApp(path);

    if (options.launch) {
      await this.launchApp({ app });
    }
  }

  async setOrientation(orientation: DeviceOrientation): Promise<void> {
    const command = await this.tryNativeCommand('device.setOrientation', { orientation });
    if (command.ok) {
      return;
    }

    throw xctestRequired('setting iOS orientation');
  }

  async lockDevice(): Promise<void> {
    await this.simctl(['io', this.deviceInfo.id, 'screenConfig', 'power', 'off']);
  }

  async unlockDevice(): Promise<void> {
    await this.simctl(['io', this.deviceInfo.id, 'screenConfig', 'power', 'on']);
  }

  async isDeviceLocked(): Promise<boolean> {
    throw new AsturError(
      'IOS_LOCK_STATE_NOT_SUPPORTED',
      'iOS Simulator does not expose a stable lock-state query through simctl.'
    );
  }

  async getTree(): Promise<MobileElementSnapshot> {
    const command = await this.tryNativeCommand('tree.get');
    if (command.ok) {
      return command.result;
    }

    throw xctestRequired('reading the iOS UI tree');
  }

  async findElement(selector: ElementSelector): Promise<MobileElementSnapshot | undefined> {
    const command = await this.tryNativeCommand('element.find', { selector });
    if (command.ok) {
      return command.result;
    }

    throw xctestRequired('finding iOS native UI elements');
  }

  async findElements(selector: ElementSelector): Promise<MobileElementSnapshot[]> {
    const command = await this.tryNativeCommand('element.findAll', { selector });
    if (command.ok) {
      return command.result;
    }

    throw xctestRequired('finding iOS native UI elements');
  }

  async findManyElements(selectors: ElementSelector[]): Promise<MobileElementSnapshot[]> {
    const command = await this.tryNativeCommand('element.findMany', { selectors });
    if (command.ok) {
      return command.result;
    }

    throw xctestRequired('finding iOS native UI elements');
  }

  async waitForElement(
    selector: ElementSelector,
    options: ElementWaitOptions = {}
  ): Promise<MobileElementSnapshot> {
    const command = await this.tryNativeCommand('element.wait', {
      selector,
      options
    });
    if (command.ok && command.result) {
      return command.result;
    }

    throw xctestRequired('waiting for iOS native UI elements');
  }

  async waitForElementHidden(selector: ElementSelector, options: ElementWaitOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.wait', {
      selector,
      options: {
        ...options,
        state: 'hidden'
      }
    });
    if (command.ok) {
      return;
    }

    throw xctestRequired('waiting for iOS native UI elements to be hidden');
  }

  async tapElement(selector: ElementSelector, options: ElementTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.tap', { selector, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('tapping iOS native UI elements');
  }

  async doubleTapElement(selector: ElementSelector, options: ElementDoubleTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.doubleTap', { selector, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('double-tapping iOS native UI elements');
  }

  async longPressElement(selector: ElementSelector, options: ElementLongPressOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.longPress', { selector, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('long-pressing iOS native UI elements');
  }

  async fillElement(selector: ElementSelector, value: string, options: ElementFillOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.fill', { selector, value, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('filling iOS native UI elements');
  }

  async dragElement(
    selector: ElementSelector,
    target: ElementDragTarget,
    options: ElementDragOptions = {}
  ): Promise<void> {
    const command = await this.tryNativeCommand('element.drag', { selector, target, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('dragging iOS native UI elements');
  }

  async tap(target: Coordinates): Promise<void> {
    const command = await this.tryNativeCommand('gesture.tap', { target });
    if (command.ok) {
      return;
    }

    throw xctestRequired('tapping iOS native UI');
  }

  async doubleTap(target: Coordinates, options: DoubleTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('gesture.doubleTap', { target, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('double-tapping iOS native UI');
  }

  async longPress(target: Coordinates, options: LongPressOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('gesture.longPress', { target, options });
    if (command.ok) {
      return;
    }

    throw xctestRequired('long-pressing iOS native UI');
  }

  async fill(selector: ElementSelector, value: string): Promise<void> {
    await this.fillElement(selector, value);
  }

  async pressKey(key: string): Promise<void> {
    if (['back', 'escape'].includes(key.trim().toLowerCase())) {
      await this.dismissKeyboard();
      return;
    }

    throw xctestRequired('pressing iOS keys');
  }

  async getKeyboardState(): Promise<KeyboardState> {
    const command = await this.tryNativeCommand('keyboard.state');
    if (command.ok) {
      return command.result;
    }

    return { visible: false };
  }

  async dismissKeyboard(): Promise<void> {
    const command = await this.tryNativeCommand('keyboard.dismiss');
    if (command.ok) {
      return;
    }

    throw xctestRequired('dismissing the iOS keyboard');
  }

  async swipe(gesture: SwipeGesture): Promise<void> {
    const command = await this.tryNativeCommand('gesture.swipe', { gesture });
    if (command.ok) {
      return;
    }

    throw xctestRequired('swiping iOS native UI');
  }

  async drag(gesture: DragGesture): Promise<void> {
    const command = await this.tryNativeCommand('gesture.drag', { gesture });
    if (command.ok) {
      return;
    }

    throw xctestRequired('dragging iOS native UI');
  }

  async screenshot(): Promise<Buffer> {
    const path = join(tmpdir(), `astur-${process.pid}-${Date.now()}.png`);
    await this.simctl(['io', this.deviceInfo.id, 'screenshot', path]);

    try {
      return await readFile(path);
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  async startRecording(): Promise<void> {
    if (this.recording) {
      throw new AsturError('RECORDING_ALREADY_STARTED', 'iOS simulator recording is already running for this session.');
    }

    const path = join(tmpdir(), `astur-${process.pid}-${Date.now()}.mp4`);
    const child = spawnCommand(this.xcrunPath, ['simctl', 'io', this.deviceInfo.id, 'recordVideo', path]);
    this.recording = { child, path };
  }

  async stopRecording(options: RecordingStopOptions = {}): Promise<Buffer | undefined> {
    const recording = this.recording;
    if (!recording) {
      return undefined;
    }

    this.recording = undefined;
    recording.child.kill('SIGINT');
    await waitForProcessExit(recording.child, 5_000);

    if (options.discard) {
      await unlink(recording.path).catch(() => undefined);
      return undefined;
    }

    try {
      return await readFile(recording.path);
    } finally {
      await unlink(recording.path).catch(() => undefined);
    }
  }

  async openWeb(url: string): Promise<void> {
    await this.simctl(['openurl', this.deviceInfo.id, url]);
  }

  private async tryNativeCommand<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<{ ok: true; result: NativeAgentCommandResponse<M> } | { ok: false }> {
    if (!this.nativeAgent) {
      if (this.capabilities.agent.mode === 'off') {
        return { ok: false };
      }

      if (this.capabilities.agent.mode === 'required' || !allowsLegacyFallback(this.capabilities, 'failure')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_UNAVAILABLE',
          `iOS native agent is unavailable while running ${method}.`,
          {
            method
          }
        );
      }

      return { ok: false };
    }

    if (this.unsupportedAgentMethods.has(method)) {
      if (this.capabilities.agent.mode === 'required' || !allowsLegacyFallback(this.capabilities, 'unsupported')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_UNSUPPORTED',
          `iOS XCTest agent does not advertise support for ${method}.`,
          {
            endpoint: this.nativeAgent.endpoint,
            method,
            capabilities: this.nativeAgent.info.capabilities
          }
        );
      }

      return { ok: false };
    }

    if (!this.nativeAgent.info.capabilities.includes(method)) {
      this.unsupportedAgentMethods.add(method);

      if (this.capabilities.agent.mode === 'required' || !allowsLegacyFallback(this.capabilities, 'unsupported')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_UNSUPPORTED',
          `iOS XCTest agent does not advertise support for ${method}.`,
          {
            endpoint: this.nativeAgent.endpoint,
            method,
            capabilities: this.nativeAgent.info.capabilities
          }
        );
      }

      return { ok: false };
    }

    try {
      const result = await this.nativeAgent.command(method, params);
      return {
        ok: true,
        result
      };
    } catch (error) {
      if (isAgentCommandUnsupported(error)) {
        this.unsupportedAgentMethods.add(method);
        if (allowsLegacyFallback(this.capabilities, 'unsupported')) {
          return { ok: false };
        }

        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_UNSUPPORTED',
          `iOS XCTest agent does not support ${method}.`,
          {
            endpoint: this.nativeAgent.endpoint,
            method,
            cause: error
          }
        );
      }

      if (isAgentCommandFailure(error)) {
        if (allowsLegacyFallback(this.capabilities, 'failure')) {
          return { ok: false };
        }

        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_FAILED',
          `iOS native agent command ${method} failed.`,
          {
            endpoint: this.nativeAgent.endpoint,
            method,
            cause: error
          }
        );
      }

      this.nativeAgent = undefined;
      if (!allowsLegacyFallback(this.capabilities, 'failure')) {
        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_FAILED',
          `iOS native agent command ${method} failed.`,
          {
            method,
            cause: error
          }
        );
      }

      return { ok: false };
    }
  }

  private simctl(args: readonly string[]) {
    return run(this.xcrunPath, ['simctl', ...args]);
  }

  private resolveBundleId(app: AppUnderTest | undefined = this.capabilities.app): string {
    const bundleId = app?.bundleId ?? app?.packageName;
    if (!bundleId) {
      throw new AsturError('IOS_BUNDLE_ID_REQUIRED', 'iOS app management requires app.bundleId.');
    }

    return bundleId;
  }
}

interface BridgeCommand {
  id: string;
  protocolVersion: string;
  command: NativeAgentMethod;
  method: NativeAgentMethod;
  deadlineMs: number;
  payload?: unknown;
  params?: unknown;
}

interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

class IosAgentBridge {
  readonly endpoint: string;
  private readonly queue: BridgeCommand[] = [];
  private readonly pending = new Map<string, {
    method: NativeAgentMethod;
    resolve(value: unknown): void;
    reject(error: unknown): void;
    timer: NodeJS.Timeout;
  }>();
  private readonly registrationWaiters: Array<{
    resolve(info: NativeAgentInfo): void;
    reject(error: unknown): void;
    timer: NodeJS.Timeout;
  }> = [];
  private registration?: NativeAgentInfo;

  private constructor(
    private readonly server: HttpServer,
    private readonly commandTimeout: number,
    private readonly port: number
  ) {
    this.endpoint = `http://127.0.0.1:${port}`;
  }

  static async start(port: number, commandTimeout: number): Promise<IosAgentBridge> {
    let bridge!: IosAgentBridge;
    const server = createHttpServer((request, response) => {
      void bridge.handle(request, response);
    });
    bridge = new IosAgentBridge(server, commandTimeout, port);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    return bridge;
  }

  createClient(info: NativeAgentInfo): NativeAgentClient {
    return {
      endpoint: this.endpoint,
      platform: 'ios',
      info,
      commandTimeout: this.commandTimeout,
      command: async <M extends NativeAgentMethod>(
        method: M,
        params?: NativeAgentCommandParams<M>
      ): Promise<NativeAgentCommandResponse<M>> => {
        return this.command(method, params) as Promise<NativeAgentCommandResponse<M>>;
      }
    };
  }

  waitForRegistration(timeoutMs: number): Promise<NativeAgentInfo> {
    if (this.registration) {
      return Promise.resolve(this.registration);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AsturError(
          'IOS_XCTEST_AGENT_CONNECT_FAILED',
          `Timed out waiting for iOS XCUITest agent registration at ${this.endpoint}.`,
          { endpoint: this.endpoint, timeout: timeoutMs }
        ));
      }, timeoutMs);

      this.registrationWaiters.push({ resolve, reject, timer });
    });
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AsturError(
        'AGENT_DISCONNECTED',
        'iOS XCUITest bridge closed before the command completed.',
        { endpoint: this.endpoint, method: pending.method }
      ));
    }
    this.pending.clear();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private command<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<NativeAgentCommandResponse<M>> {
    const id = randomUUID();
    const command: BridgeCommand = {
      id,
      protocolVersion: '1.0',
      command: method,
      method,
      deadlineMs: Date.now() + this.commandTimeout,
      payload: params,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AsturError(
          'AGENT_COMMAND_TIMEOUT',
          `iOS XCUITest agent command ${method} timed out.`,
          { endpoint: this.endpoint, method, timeout: this.commandTimeout }
        ));
      }, this.commandTimeout);

      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });
      this.queue.push(command);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method === 'POST' && request.url === '/register') {
        await this.handleRegister(request, response);
        return;
      }

      if (request.method === 'GET' && request.url === '/command') {
        this.handleCommandPoll(response);
        return;
      }

      if (request.method === 'POST' && request.url === '/response') {
        await this.handleCommandResponse(request, response);
        return;
      }

      writeJson(response, 404, {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Unknown iOS bridge route: ${request.method ?? 'GET'} ${request.url ?? '/'}`
        }
      });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: {
          code: 'BRIDGE_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async handleRegister(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as { result?: NativeAgentInfo; data?: NativeAgentInfo };
    const info = body.result ?? body.data;
    if (!info || info.platform !== 'ios') {
      writeJson(response, 400, {
        ok: false,
        error: {
          code: 'INVALID_REGISTRATION',
          message: 'iOS bridge registration must include iOS native-agent info.'
        }
      });
      return;
    }

    this.registration = info;
    for (const waiter of this.registrationWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(info);
    }

    writeJson(response, 200, { ok: true });
  }

  private handleCommandPoll(response: ServerResponse): void {
    const command = this.queue.shift();
    if (!command) {
      response.statusCode = 204;
      response.end();
      return;
    }

    writeJson(response, 200, command);
  }

  private async handleCommandResponse(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as BridgeResponse;
    const pending = this.pending.get(body.id);
    if (!pending) {
      writeJson(response, 200, { ok: true });
      return;
    }

    this.pending.delete(body.id);
    clearTimeout(pending.timer);

    if (body.ok) {
      pending.resolve(body.result ?? body.data);
    } else {
      pending.reject(new AsturError(
        body.error?.code ?? 'AGENT_COMMAND_FAILED',
        body.error?.message ?? `iOS XCUITest agent command ${pending.method} failed.`,
        {
          endpoint: this.endpoint,
          method: pending.method,
          error: body.error
        }
      ));
    }

    writeJson(response, 200, { ok: true });
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function waitForProcessExit(child: ChildProcess, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeout);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function resolveIosAgentRuntimeConfig(): {
  projectPath: string;
  scheme: string;
  hostPort?: number;
  derivedDataPath?: string;
} {
  return {
    projectPath: process.env.ASTUR_IOS_AGENT_PROJECT ?? resolveDefaultIosAgentProject(),
    scheme: process.env.ASTUR_IOS_AGENT_SCHEME ?? 'AsturIOSAgent',
    hostPort: parseOptionalPort(process.env.ASTUR_IOS_AGENT_PORT),
    derivedDataPath: process.env.ASTUR_IOS_AGENT_DERIVED_DATA
  };
}

function resolveDefaultIosAgentProject(): string {
  const iosPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const packagedProject = join(
    iosPackageRoot,
    'assets',
    'ios-xctest-agent',
    'AsturIOSAgent.xcodeproj'
  );

  if (existsSync(join(packagedProject, 'project.pbxproj'))) {
    return packagedProject;
  }

  return join(iosPackageRoot, '..', '..', 'agents', 'ios-xctest-agent', 'AsturIOSAgent.xcodeproj');
}

function iosAgentSourceStamp(projectPath: string): string {
  const projectRoot = dirname(projectPath);
  const candidates = [
    'AsturAgent.swift',
    'AsturAgentBridgeClient.swift',
    'AsturAgentServer.swift',
    'AsturAgentUITests.swift',
    'AsturIOSAgent.xcodeproj/project.pbxproj'
  ];
  const latest = candidates.reduce((max, candidate) => {
    try {
      return Math.max(max, statSync(join(projectRoot, candidate)).mtimeMs);
    } catch {
      return max;
    }
  }, 0);

  return Math.max(1, Math.floor(latest)).toString(36);
}

function pathSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new AsturError('IOS_AGENT_PORT_INVALID', `Invalid iOS agent port: ${value}`);
  }

  return port;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new AsturError('IOS_AGENT_PORT_UNAVAILABLE', 'Failed to allocate a host port for the iOS agent.'));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function waitForIosAgent(
  endpoint: string,
  capabilities: NormalizedCapabilities
): Promise<NativeAgentClient> {
  const deadline = Date.now() + capabilities.agent.launchTimeout;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      const remaining = Math.max(100, deadline - Date.now());
      return await connectNativeAgentClient({
        endpoint,
        platform: 'ios',
        handshakeTimeout: Math.min(1_000, remaining),
        commandTimeout: capabilities.agent.commandTimeout
      });
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new AsturError(
    'IOS_XCTEST_AGENT_CONNECT_FAILED',
    `Timed out waiting for iOS XCUITest agent at ${endpoint}.`,
    {
      endpoint,
      timeout: capabilities.agent.launchTimeout,
      cause: lastError
    }
  );
}

export function parseSimctlDevices(output: string): DeviceInfo[] {
  const parsed = JSON.parse(output) as SimctlDevicesJson;
  const devices: DeviceInfo[] = [];

  for (const [runtime, runtimeDevices] of Object.entries(parsed.devices)) {
    for (const device of runtimeDevices) {
      if (device.isAvailable === false) {
        continue;
      }

      devices.push({
        id: device.udid,
        name: device.name,
        platform: 'ios',
        kind: 'simulator',
        state: normalizeSimctlState(device.state),
        osVersion: runtimeToVersion(runtime),
        raw: { runtime, ...device }
      });
    }
  }

  return devices;
}

function selectDevice(devices: DeviceInfo[], selector: DeviceSelector): DeviceInfo | undefined {
  return devices.find((device) => {
    if (selector.id && selector.id !== device.id) {
      return false;
    }

    if (selector.kind && selector.kind !== device.kind) {
      return false;
    }

    if (selector.name instanceof RegExp && !selector.name.test(device.name)) {
      return false;
    }

    if (typeof selector.name === 'string' && selector.name !== device.name) {
      return false;
    }

    return true;
  });
}

function normalizeSimctlState(state: string): DeviceInfo['state'] {
  if (state === 'Booted') {
    return 'booted';
  }

  if (state === 'Shutdown') {
    return 'shutdown';
  }

  return 'unknown';
}

const defaultBundledIosAgentLaunchTimeoutMs = 60_000;

function runtimeToVersion(runtime: string): string | undefined {
  const match = runtime.match(/SimRuntime\.iOS-(.+)$/);
  return match?.[1]?.replaceAll('-', '.');
}

function xctestRequired(action: string): AsturError {
  return new AsturError(
    'XCTEST_AGENT_REQUIRED',
    `Astur cannot complete ${action} without the iOS XCUITest agent. This is an iOS platform requirement, not an Appium requirement.`
  );
}

function normalizeIosPermission(permission: string): string {
  const value = permission.trim().toLowerCase().replace(/[\s-]+/g, '-');
  const aliases: Record<string, string> = {
    camera: 'camera',
    microphone: 'microphone',
    photos: 'photos',
    photo: 'photos',
    contacts: 'contacts',
    calendar: 'calendar',
    reminders: 'reminders',
    location: 'location',
    'location-always': 'location-always',
    'location-when-in-use': 'location',
    notifications: 'notifications'
  };

  return aliases[value] ?? value;
}

async function materializeIosInstallPath(path: string): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  if (extname(path).toLowerCase() !== '.ipa') {
    return { path };
  }

  const dir = await mkdtemp(join(tmpdir(), 'astur-ios-ipa-'));

  try {
    await run('/usr/bin/ditto', ['-x', '-k', path, dir]);
    const appPath = await findFirstAppBundle(join(dir, 'Payload')) ?? await findFirstAppBundle(dir);
    if (!appPath) {
      throw new AsturError('IOS_IPA_APP_NOT_FOUND', `No .app bundle was found inside IPA: ${path}`);
    }

    return {
      path: appPath,
      cleanup: () => rm(dir, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function findFirstAppBundle(root: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.name.endsWith('.app')) {
      return fullPath;
    }

    const nested = await findFirstAppBundle(fullPath);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean) ?? value.trim();
}

function isAgentCommandUnsupported(error: unknown): boolean {
  if (!(error instanceof AsturError)) {
    return false;
  }

  return error.code === 'NOT_IMPLEMENTED' || error.code === 'UNKNOWN_COMMAND';
}

function isAgentCommandFailure(error: unknown): boolean {
  if (!(error instanceof AsturError)) {
    return false;
  }

  return !isAgentTransportFailure(error);
}

function isAgentTransportFailure(error: AsturError): boolean {
  return error.code.startsWith('AGENT_') && !isAgentCommandUnsupported(error);
}

function allowsLegacyFallback(
  capabilities: NormalizedCapabilities,
  reason: 'unsupported' | 'failure'
): boolean {
  if (capabilities.agent.mode === 'required') {
    return false;
  }

  switch (capabilities.agent.legacyFallback) {
    case 'never':
      return false;
    case 'on-unsupported-command':
      return reason === 'unsupported';
    case 'on-agent-failure':
      return true;
  }
}
