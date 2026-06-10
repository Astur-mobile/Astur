import { existsSync, readdirSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppUnderTest,
  AppResetOptions,
  Bounds,
  Coordinates,
  DeviceFileEntry,
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
  MobileContextInfo,
  MobileElementSnapshot,
  NativeAgentCommandParams,
  NativeAgentCommandResponse,
  NativeAgentMethod,
  NormalizedCapabilities,
  RecordingStopOptions,
  SwipeGesture,
  WebViewEndpoint,
  WebViewSelector
} from '@astur/protocol';
import {
  centerOf,
  connectNativeAgentClient,
  findElement,
  formatSelector,
  AsturError,
  delay,
  preparePointerTargetForKeyboard,
  waitFor,
  type NativeAgentClient,
  type PlatformDriver,
  type PlatformSession
} from '@astur/core';
import { run, runText, spawnCommand, spawnDetached } from './command.js';
import { parseUiAutomatorXml } from './uiautomatorXml.js';

export interface AndroidDriverOptions {
  adbPath?: string;
  emulatorPath?: string;
  aaptPath?: string;
}

export interface AndroidApkMetadata {
  packageName: string;
  launchActivity?: string;
  versionName?: string;
}

interface DevtoolsTarget {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface AndroidNativeAgentArtifacts {
  appApkPath: string;
  testApkPath: string;
}

interface AndroidNativeAgentRuntime {
  client: NativeAgentClient;
  hostPort?: number;
  packageName?: string;
  process?: ChildProcess;
}

export function createAndroidDriver(options: AndroidDriverOptions = {}): AndroidDriver {
  return new AndroidDriver(options);
}

export class AndroidDriver implements PlatformDriver {
  readonly platform = 'android' as const;
  private readonly adbPath: string;
  private readonly emulatorPath: string;
  private readonly aaptPath?: string;

  constructor(options: AndroidDriverOptions = {}) {
    this.adbPath = options.adbPath ?? process.env.ASTUR_ADB ?? 'adb';
    this.emulatorPath = options.emulatorPath ?? process.env.ASTUR_EMULATOR ?? resolveEmulatorPath();
    this.aaptPath = options.aaptPath ?? process.env.ASTUR_AAPT;
  }

  async doctor(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    try {
      const version = await runText(this.adbPath, ['version']);
      checks.push({
        id: 'android.adb',
        label: 'ADB',
        status: 'pass',
        message: firstLine(version)
      });
    } catch (error) {
      checks.push({
        id: 'android.adb',
        label: 'ADB',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Install Android SDK platform-tools and ensure adb is on PATH.'
      });
    }

    const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    checks.push({
      id: 'android.sdk',
      label: 'Android SDK',
      status: sdkRoot ? 'pass' : 'warn',
      message: sdkRoot ? sdkRoot : 'ANDROID_HOME or ANDROID_SDK_ROOT is not set.',
      fix: sdkRoot ? undefined : 'Set ANDROID_HOME or ANDROID_SDK_ROOT to your Android SDK path.'
    });

    try {
      const avds = await this.listAvds();
      checks.push({
        id: 'android.avds',
        label: 'Android AVDs',
        status: avds.length ? 'pass' : 'warn',
        message: avds.length ? `${avds.length} AVD(s) available: ${avds.join(', ')}` : 'No Android AVDs detected.',
        fix: avds.length ? undefined : 'Create an emulator from Android Studio Device Manager.'
      });
    } catch (error) {
      checks.push({
        id: 'android.avds',
        label: 'Android AVDs',
        status: 'warn',
        message: error instanceof Error ? error.message : String(error),
        fix: 'Ensure the Android emulator binary is on PATH.'
      });
    }

    try {
      const devices = await this.listDevices();
      checks.push({
        id: 'android.devices',
        label: 'Android devices',
        status: devices.some((device) => device.state === 'online') ? 'pass' : 'warn',
        message: devices.length ? `${devices.length} device(s) detected.` : 'No Android devices detected.',
        fix: devices.length ? undefined : 'Start an emulator or connect a device with USB debugging enabled.'
      });
    } catch (error) {
      checks.push({
        id: 'android.devices',
        label: 'Android devices',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return checks;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const output = await runText(this.adbPath, ['devices', '-l']);
    return parseAdbDevices(output);
  }

  async listAvds(): Promise<string[]> {
    const output = await runText(this.emulatorPath, ['-list-avds']);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async createSession(capabilities: NormalizedCapabilities): Promise<PlatformSession> {
    const resolvedCapabilities = await this.resolveCapabilities(capabilities);
    if (resolvedCapabilities.device.cloud) {
      throw new AsturError(
        'CLOUD_PROVIDER_NOT_IMPLEMENTED',
        'BrowserStack execution is scaffolded by Astur init, but the cloud driver is not implemented in this alpha. Use a local Android emulator or real device for now.',
        { cloud: resolvedCapabilities.device.cloud }
      );
    }

    let devices = await this.listDevices();
    let device = selectDevice(devices, resolvedCapabilities.device);

    if (!device && shouldAutoBoot(resolvedCapabilities.device)) {
      await this.bootConfiguredEmulator(resolvedCapabilities.device);
      devices = await this.listDevices();
      device = selectDevice(devices, resolvedCapabilities.device);
    }

    if (!device) {
      const selector = resolvedCapabilities.device;
      const pinnedEmulator = selector.kind === 'emulator' || Boolean(selector.id?.startsWith('emulator-'));
      const hint = pinnedEmulator && !selector.avd
        ? ' To let Astur boot it automatically when it is offline, also set device.avd (and optionally autoBoot: true) — an emulator cannot be started from its id alone.'
        : '';

      throw new AsturError('DEVICE_NOT_FOUND', `No matching Android device is online.${hint}`, {
        selector,
        devices
      });
    }

    const nativeAgent = await this.resolveNativeAgent(resolvedCapabilities, device);

    return new AndroidSession(this.adbPath, device, resolvedCapabilities, nativeAgent);
  }

  private async resolveNativeAgent(
    capabilities: NormalizedCapabilities,
    device: DeviceInfo
  ): Promise<AndroidNativeAgentRuntime | undefined> {
    if (capabilities.agent.mode === 'off') {
      return undefined;
    }

    const endpoint = capabilities.agent.endpoint ?? process.env.ASTUR_ANDROID_AGENT_ENDPOINT;
    if (!endpoint) {
      const hasBundledAgentArtifacts = capabilities.agent.install && Boolean(resolveAndroidAgentArtifacts());
      const runtime = await this.tryBootstrapBundledNativeAgent(capabilities, device);
      if (runtime) {
        return runtime;
      }

      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'ANDROID_AGENT_ENDPOINT_REQUIRED',
          'Android native-agent mode is required, but no endpoint or built Android agent APKs were available. Set use.astur.agent.endpoint, ASTUR_ANDROID_AGENT_ENDPOINT, or build packages/android-agent.'
        );
      }

      if (!hasBundledAgentArtifacts) {
        warnAndroidAgentFallback(
          'Android native agent is not configured and built agent APKs were not found. Using legacy ADB/XML interaction path.'
        );
      }
      return undefined;
    }

    try {
      const client = await connectNativeAgentClient({
        endpoint,
        platform: 'android',
        handshakeTimeout: capabilities.agent.launchTimeout,
        commandTimeout: capabilities.agent.commandTimeout
      });

      return { client };
    } catch (error) {
      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'ANDROID_AGENT_CONNECT_FAILED',
          `Failed to connect to Android native agent at ${endpoint}.`,
          {
            endpoint,
            cause: error
          }
        );
      }

      warnAndroidAgentFallback(
        `Failed to connect to Android native agent at ${endpoint}. Using legacy ADB/XML interaction path.`
      );
      return undefined;
    }
  }

  private async tryBootstrapBundledNativeAgent(
    capabilities: NormalizedCapabilities,
    device: DeviceInfo
  ): Promise<AndroidNativeAgentRuntime | undefined> {
    if (!capabilities.agent.install) {
      return undefined;
    }

    const artifacts = resolveAndroidAgentArtifacts();
    if (!artifacts) {
      return undefined;
    }

    const config = resolveAndroidAgentRuntimeConfig();
    const hostPort = config.hostPort ?? await findFreePort();
    const endpoint = `http://127.0.0.1:${hostPort}`;
    const adb = (args: readonly string[]) => run(this.adbPath, ['-s', device.id, ...args]);
    let agentProcess: ChildProcess | undefined;

    try {
      if (await shouldInstallAndroidAgent(adb, config)) {
        await adb(['install', '-r', artifacts.appApkPath]);
        await adb(['install', '-r', artifacts.testApkPath]);
      }

      await adb(['forward', `tcp:${hostPort}`, `tcp:${config.devicePort}`]);

      agentProcess = spawnCommand(this.adbPath, [
        '-s',
        device.id,
        'shell',
        'am',
        'instrument',
        '-w',
        '-e',
        'asturPort',
        String(config.devicePort),
        `${config.testPackage}/${config.runnerClass}`
      ]);

      const client = await waitForAndroidAgent(endpoint, capabilities);

      return {
        client,
        hostPort,
        packageName: config.packageName,
        process: agentProcess
      };
    } catch (error) {
      agentProcess?.kill('SIGINT');
      await adb(['forward', '--remove', `tcp:${hostPort}`]).catch(() => undefined);

      if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
        throw new AsturError(
          'ANDROID_AGENT_START_FAILED',
          'Failed to install or start the Android native agent.',
          {
            device,
            artifacts,
            endpoint,
            cause: error
          }
        );
      }

      warnAndroidAgentFallback(
        'Failed to bootstrap the built Android native agent. Using legacy ADB/XML interaction path.'
      );
      return undefined;
    }
  }

  private async resolveCapabilities(capabilities: NormalizedCapabilities): Promise<NormalizedCapabilities> {
    return {
      ...capabilities,
      app: await this.resolveApp(capabilities.app)
    };
  }

  private async resolveApp(app: AppUnderTest | undefined): Promise<AppUnderTest | undefined> {
    if (!app?.path || (app.packageName && app.activity)) {
      return app;
    }

    const metadata = await this.readApkMetadata(app.path);

    return {
      ...app,
      packageName: app.packageName ?? metadata.packageName,
      activity: app.activity ?? metadata.launchActivity
    };
  }

  private async readApkMetadata(path: string): Promise<AndroidApkMetadata> {
    const aaptPath = this.aaptPath ?? resolveAaptPath();
    if (!aaptPath) {
      throw new AsturError(
        'AAPT_NOT_FOUND',
        'Cannot infer Android package metadata because aapt was not found. Set ASTUR_AAPT or provide app.packageName in config.'
      );
    }

    const output = await runText(aaptPath, ['dump', 'badging', path]);
    return parseAaptBadging(output);
  }

  private async bootConfiguredEmulator(selector: DeviceSelector): Promise<void> {
    if (!selector.avd) {
      return;
    }

    const args = [
      '-avd',
      selector.avd,
      '-no-snapshot-save',
      '-no-audio',
      '-no-boot-anim'
    ];

    if (selector.headless !== false) {
      args.push('-no-window');
    }

    if (selector.wipeData) {
      args.push('-wipe-data');
    }

    args.push(...(selector.emulatorArgs ?? []));

    const child = spawnDetached(this.emulatorPath, args);
    let launchError: AsturError | undefined;
    child.once('error', (error: Error) => {
      launchError = new AsturError(
        'EMULATOR_LAUNCH_FAILED',
        `Could not launch the Android emulator "${this.emulatorPath}": ${error.message}. Install the Android SDK emulator and make sure it is on PATH, or set ASTUR_EMULATOR / ANDROID_HOME.`,
        { avd: selector.avd, emulatorPath: this.emulatorPath }
      );
    });
    child.once('exit', (code, signal) => {
      if (code != null && code !== 0) {
        launchError = new AsturError(
          'EMULATOR_LAUNCH_FAILED',
          `The Android emulator for AVD "${selector.avd}" exited (code ${code}) before finishing boot. The AVD name may be wrong, or an instance of it may already be running.`,
          { avd: selector.avd, code, signal }
        );
      }
    });

    await this.waitForBoot(selector, () => launchError);
  }

  private async waitForBoot(selector: DeviceSelector, getLaunchError?: () => AsturError | undefined): Promise<void> {
    const timeout = selector.bootTimeout ?? 120_000;
    const startedAt = Date.now();
    let lastDevices: DeviceInfo[] = [];

    while (Date.now() - startedAt <= timeout) {
      const launchError = getLaunchError?.();
      if (launchError) {
        throw launchError;
      }

      lastDevices = await this.listDevices().catch(() => []);
      const device = selectDevice(lastDevices, { ...selector, kind: 'emulator' });

      if (device) {
        const bootCompleted = await runText(this.adbPath, ['-s', device.id, 'shell', 'getprop', 'sys.boot_completed'])
          .then((value) => value.trim() === '1')
          .catch(() => false);

        if (bootCompleted) {
          return;
        }
      }

      await delay(1_000);
    }

    throw new AsturError('EMULATOR_BOOT_TIMEOUT', `Timed out waiting for Android AVD ${selector.avd} to boot.`, {
      selector,
      devices: lastDevices
    });
  }
}

class AndroidSession implements PlatformSession {
  readonly deviceInfo: DeviceInfo;
  readonly capabilities: NormalizedCapabilities;
  private readonly adbPath: string;
  private nativeAgent?: NativeAgentClient;
  private readonly nativeAgentRuntime?: AndroidNativeAgentRuntime;
  private readonly unsupportedAgentMethods = new Set<NativeAgentMethod>();
  private recording?: {
    child: ChildProcess;
    remotePath: string;
  };
  private readonly forwardedWebViewPorts = new Set<number>();

  constructor(
    adbPath: string,
    deviceInfo: DeviceInfo,
    capabilities: NormalizedCapabilities,
    nativeAgentRuntime?: AndroidNativeAgentRuntime
  ) {
    this.adbPath = adbPath;
    this.deviceInfo = deviceInfo;
    this.capabilities = capabilities;
    this.nativeAgentRuntime = nativeAgentRuntime;
    this.nativeAgent = nativeAgentRuntime?.client;
  }

  async close(): Promise<void> {
    if (this.recording) {
      await this.stopRecording().catch(() => undefined);
    }

    await Promise.all(
      [...this.forwardedWebViewPorts].map((port) => this.adb(['forward', '--remove', `tcp:${port}`]).catch(() => undefined))
    );
    this.forwardedWebViewPorts.clear();

    if (this.nativeAgentRuntime?.hostPort) {
      await this.adb(['forward', '--remove', `tcp:${this.nativeAgentRuntime.hostPort}`]).catch(() => undefined);
    }

    this.nativeAgentRuntime?.process?.kill('SIGINT');

    if (this.nativeAgentRuntime?.packageName) {
      await this.adb(['shell', 'am', 'force-stop', this.nativeAgentRuntime.packageName]).catch(() => undefined);
    }

    return;
  }

  async installApp(path: string): Promise<void> {
    await this.adb(['install', '-r', path]);
  }

  async isAppInstalled(identifier: string): Promise<boolean> {
    const output = await this.adbText(['shell', 'pm', 'path', identifier]).catch(() => '');
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line.startsWith('package:'));
  }

  async uninstallApp(identifier: string): Promise<void> {
    await this.adb(['uninstall', identifier]);
  }

  async launchApp(options: LaunchOptions = {}): Promise<void> {
    if (options.url) {
      await this.openWeb(options.url);
      return;
    }

    const app = options.app ?? this.capabilities.app;
    const packageName = app?.packageName ?? app?.bundleId;

    if (!packageName) {
      throw new AsturError(
        'ANDROID_PACKAGE_REQUIRED',
        'Android launch requires app.packageName. Astur does not infer package names from APKs yet.'
      );
    }

    if (app?.activity) {
      await this.adb(['shell', 'am', 'start', '-n', `${packageName}/${app.activity}`]);
      return;
    }

    await this.adb([
      'shell',
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1'
    ]);
  }

  async terminateApp(): Promise<void> {
    const packageName = this.resolvePackageName();
    await this.adb(['shell', 'am', 'force-stop', packageName]);
  }

  async clearAppData(identifier: string): Promise<void> {
    await this.adb(['shell', 'pm', 'clear', identifier]);
  }

  async clearAppCache(identifier: string): Promise<void> {
    await this.adb(['shell', 'pm', 'clear', '--cache-only', identifier]);
  }

  async grantPermission(identifier: string, permission: string): Promise<void> {
    await this.adb(['shell', 'pm', 'grant', identifier, normalizeAndroidPermission(permission)]);
  }

  async revokePermission(identifier: string, permission: string): Promise<void> {
    await this.adb(['shell', 'pm', 'revoke', identifier, normalizeAndroidPermission(permission)]);
  }

  async resetApp(options: AppResetOptions = {}): Promise<void> {
    const app = options.app ?? {
      ...this.capabilities.app,
      path: options.path ?? this.capabilities.app?.path,
      packageName: options.packageName ?? this.capabilities.app?.packageName,
      bundleId: options.bundleId ?? this.capabilities.app?.bundleId
    };
    const packageName = options.packageName ?? options.bundleId ?? app.packageName ?? app.bundleId;

    if (!packageName) {
      throw new AsturError('ANDROID_PACKAGE_REQUIRED', 'Android reset requires app.packageName.');
    }

    await this.adb(['shell', 'am', 'force-stop', packageName]).catch(() => undefined);

    if (options.reinstall) {
      const path = options.path ?? app.path;
      if (!path) {
        throw new AsturError('APP_PATH_REQUIRED', 'Android reinstall reset requires an app path.');
      }

      await this.adb(['uninstall', packageName]).catch(() => undefined);
      await this.installApp(path);
    } else {
      await this.clearAppData(packageName);
    }

    if (options.launch) {
      await this.launchApp({ app });
    }
  }

  async setOrientation(orientation: DeviceOrientation): Promise<void> {
    if (this.nativeAgent?.info.capabilities.includes('device.setOrientation')) {
      try {
        const command = await this.tryNativeCommand('device.setOrientation', { orientation });
        if (command.ok) {
          return;
        }
      } catch {
        // Orientation is a lifecycle control; fall through to Android shell APIs
        // when the agent cannot apply it directly.
      }
    }

    const rotation = androidRotationForOrientation(orientation);

    await this.adb(['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']).catch(() => undefined);
    await this.adb(['shell', 'settings', 'put', 'system', 'user_rotation', String(rotation)]).catch(() => undefined);

    try {
      await this.adb(['shell', 'cmd', 'window', 'user-rotation', 'lock', String(rotation)]);
      await this.adb(['shell', 'cmd', 'window', 'fixed-to-user-rotation', 'enabled']).catch(() => undefined);
    } catch {
      // Older Android images may not expose cmd window user-rotation.
      // The settings writes above are the compatibility path.
    }

    await delay(500);
  }

  async lockDevice(): Promise<void> {
    await this.pressKey('SLEEP');
  }

  async unlockDevice(): Promise<void> {
    await this.pressKey('WAKEUP');
    await this.adb(['shell', 'wm', 'dismiss-keyguard']).catch(() => undefined);
  }

  async isDeviceLocked(): Promise<boolean> {
    return parseAndroidLockState(await this.adbText(['shell', 'dumpsys', 'window']));
  }

  async getTree(): Promise<MobileElementSnapshot> {
    const command = await this.tryNativeCommand('tree.get');
    if (command.ok) {
      return command.result;
    }

    const remotePath = '/sdcard/astur-window.xml';
    await this.adb(['shell', 'uiautomator', 'dump', remotePath]);
    const xml = await this.adbText(['shell', 'cat', remotePath]);
    return parseUiAutomatorXml(xml);
  }

  async findElement(selector: ElementSelector): Promise<MobileElementSnapshot | undefined> {
    const command = await this.tryNativeCommand('element.find', { selector });
    if (command.ok) {
      return command.result;
    }

    return findElement(await this.getTree(), selector);
  }

  async waitForElement(
    selector: ElementSelector,
    options: ElementWaitOptions = {}
  ): Promise<MobileElementSnapshot> {
    const state = options.state ?? 'attached';

    const command = await this.tryNativeCommand('element.wait', {
      selector,
      options: {
        ...options,
        state
      }
    });
    if (command.ok && command.result) {
      return command.result;
    }

    return waitFor(
      async () => {
        const element = await this.findElement(selector);

        if (!element) {
          return undefined;
        }

        if (state === 'visible' && !element.visible) {
          return undefined;
        }

        if (state === 'hidden') {
          return element.visible ? undefined : element;
        }

        return element;
      },
      {
        timeout: options.timeout ?? this.capabilities.timeout,
        interval: options.interval,
        message: `Timed out waiting for ${formatSelector(selector)} to be ${state}`
      }
    );
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

    await waitFor(
      async () => {
        const element = await this.findElement(selector);
        return !element || !element.visible;
      },
      {
        timeout: options.timeout ?? this.capabilities.timeout,
        interval: options.interval,
        message: `Timed out waiting for ${formatSelector(selector)} to be hidden`
      }
    );
  }

  async tapElement(selector: ElementSelector, options: ElementTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.tap', { selector, options });
    if (command.ok) {
      return;
    }

    let element = await this.waitForElement(selector, { ...options, state: 'visible' });
    const dismissed = await preparePointerTargetForKeyboard(this, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForElement(selector, { ...options, state: 'visible' });
    }

    await this.tap(centerOf(element.bounds));
  }

  async doubleTapElement(selector: ElementSelector, options: ElementDoubleTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.doubleTap', { selector, options });
    if (command.ok) {
      return;
    }

    let element = await this.waitForElement(selector, { ...options, state: 'visible' });
    const dismissed = await preparePointerTargetForKeyboard(this, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForElement(selector, { ...options, state: 'visible' });
    }

    await this.doubleTap(centerOf(element.bounds), { intervalMs: options.intervalMs });
  }

  async longPressElement(selector: ElementSelector, options: ElementLongPressOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.longPress', { selector, options });
    if (command.ok) {
      return;
    }

    let element = await this.waitForElement(selector, { ...options, state: 'visible' });
    const dismissed = await preparePointerTargetForKeyboard(this, centerOf(element.bounds), options.keyboard);
    if (dismissed) {
      element = await this.waitForElement(selector, { ...options, state: 'visible' });
    }

    await this.longPress(centerOf(element.bounds), { durationMs: options.durationMs });
  }

  async fillElement(selector: ElementSelector, value: string, options: ElementFillOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.fill', { selector, value, options });
    if (command.ok) {
      return;
    }

    const element = await this.waitForElement(selector, { ...options, state: 'visible' });
    await preparePointerTargetForKeyboard(this, centerOf(element.bounds), options.keyboard);
    await this.tap(centerOf(element.bounds));
    await this.adb(['shell', 'input', 'text', escapeAndroidInputText(value)]);
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

    let source = await this.waitForElement(selector, { ...options, state: 'visible' });
    const dismissed = await preparePointerTargetForKeyboard(this, centerOf(source.bounds), options.keyboard);
    if (dismissed) {
      source = await this.waitForElement(selector, { ...options, state: 'visible' });
    }

    const end = isElementSelectorTarget(target)
      ? centerOf((await this.waitForElement(target.selector, {
        timeout: options.timeout,
        interval: options.interval,
        state: 'visible'
      })).bounds)
      : target;

    await this.drag({
      start: centerOf(source.bounds),
      end,
      durationMs: options.durationMs
    });
  }

  async tap(target: Coordinates): Promise<void> {
    const command = await this.tryNativeCommand('gesture.tap', { target });
    if (command.ok) {
      return;
    }

    await this.adb(['shell', 'input', 'tap', String(target.x), String(target.y)]);
  }

  async doubleTap(target: Coordinates, options: DoubleTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('gesture.doubleTap', { target, options });
    if (command.ok) {
      return;
    }

    await this.tap(target);
    await delay(options.intervalMs ?? 80);
    await this.tap(target);
  }

  async longPress(target: Coordinates, options: LongPressOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('gesture.longPress', { target, options });
    if (command.ok) {
      return;
    }

    const durationMs = options.durationMs ?? 800;
    await this.adb([
      'shell',
      'input',
      'swipe',
      String(target.x),
      String(target.y),
      String(target.x),
      String(target.y),
      String(durationMs)
    ]);
  }

  async fill(selector: ElementSelector, value: string): Promise<void> {
    await this.fillElement(selector, value);
  }

  async pressKey(key: string): Promise<void> {
    await this.adb(['shell', 'input', 'keyevent', normalizeAndroidKey(key)]);
  }

  async swipe(gesture: SwipeGesture): Promise<void> {
    const command = await this.tryNativeCommand('gesture.swipe', { gesture });
    if (command.ok) {
      return;
    }

    await this.adb([
      'shell',
      'input',
      'swipe',
      String(gesture.start.x),
      String(gesture.start.y),
      String(gesture.end.x),
      String(gesture.end.y),
      String(gesture.durationMs ?? 300)
    ]);
  }

  async drag(gesture: DragGesture): Promise<void> {
    const command = await this.tryNativeCommand('gesture.drag', { gesture });
    if (command.ok) {
      return;
    }

    await this.adb([
      'shell',
      'input',
      'swipe',
      String(gesture.start.x),
      String(gesture.start.y),
      String(gesture.end.x),
      String(gesture.end.y),
      String(gesture.durationMs ?? 700)
    ]);
  }

  async startRecording(): Promise<void> {
    if (this.recording) {
      throw new AsturError('RECORDING_ALREADY_STARTED', 'Android screen recording is already running for this session.');
    }

    const remotePath = `/sdcard/astur-recording-${process.pid}-${Date.now()}.mp4`;
    const child = spawnCommand(this.adbPath, ['-s', this.deviceInfo.id, 'shell', 'screenrecord', remotePath]);
    this.recording = { child, remotePath };
    await delay(500);
  }

  async stopRecording(options: RecordingStopOptions = {}): Promise<Buffer | undefined> {
    const recording = this.recording;
    if (!recording) {
      return undefined;
    }

    this.recording = undefined;
    await this.adb(['shell', 'pkill', '-2', 'screenrecord']).catch(() => undefined);
    await waitForProcessExit(recording.child, 10_000);
    await this.waitForRemoteFileStable(recording.remotePath, 5_000);

    if (options.discard) {
      await this.adb(['shell', 'rm', '-f', recording.remotePath]).catch(() => undefined);
      return undefined;
    }

    try {
      const result = await this.adb(['exec-out', 'cat', recording.remotePath], 200 * 1024 * 1024);
      return result.stdout.length ? result.stdout : undefined;
    } finally {
      await this.adb(['shell', 'rm', '-f', recording.remotePath]).catch(() => undefined);
    }
  }

  private async waitForRemoteFileStable(remotePath: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let stableReads = 0;

    while (Date.now() <= deadline) {
      const size = await this.remoteFileSize(remotePath).catch(() => 0);

      if (size > 0 && size === lastSize) {
        stableReads += 1;
        if (stableReads >= 2) {
          return;
        }
      } else {
        stableReads = 0;
        lastSize = size;
      }

      await delay(250);
    }
  }

  private async remoteFileSize(remotePath: string): Promise<number> {
    const output = await this.adbText(['shell', 'stat', '-c', '%s', remotePath]);
    const size = Number(output.trim());
    return Number.isFinite(size) ? size : 0;
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.adb(['exec-out', 'screencap', '-p']);
    return result.stdout;
  }

  async pushFile(localPath: string, remotePath: string): Promise<void> {
    await this.adb(['push', localPath, remotePath]);
  }

  async pullFile(remotePath: string): Promise<Buffer> {
    const result = await this.adb(['exec-out', 'cat', remotePath], 200 * 1024 * 1024);
    return result.stdout;
  }

  async removeFile(remotePath: string): Promise<void> {
    await this.adb(['shell', 'rm', '-rf', remotePath]);
  }

  async listFiles(remotePath: string): Promise<DeviceFileEntry[]> {
    const output = await this.adbText(['shell', 'ls', '-la', remotePath]);
    return parseAndroidLs(output, remotePath);
  }

  async openWeb(url: string): Promise<void> {
    await this.adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  async listContexts(): Promise<MobileContextInfo[]> {
    const sockets = parseAndroidWebViewSockets(await this.adbText(['shell', 'cat', '/proc/net/unix']));

    return [
      {
        id: 'native',
        type: 'native',
        title: 'Native'
      },
      ...sockets.map((socket) => ({
        id: socket,
        type: 'webview' as const,
        socket
      }))
    ];
  }

  async connectWebView(selector: WebViewSelector = {}): Promise<WebViewEndpoint> {
    const timeout = selector.timeout ?? this.capabilities.timeout;
    const startedAt = Date.now();
    let lastContexts: MobileContextInfo[] = [];

    while (Date.now() - startedAt <= timeout) {
      const sockets = parseAndroidWebViewSockets(await this.adbText(['shell', 'cat', '/proc/net/unix']).catch(() => ''));
      const candidates = selector.id
        ? sockets.filter((socket) => socket === selector.id)
        : sockets;

      for (const socket of candidates) {
        const port = await this.forwardWebView(socket);
        const cdpUrl = `http://127.0.0.1:${port}`;
        const targets = await readDevtoolsTargets(cdpUrl).catch((): DevtoolsTarget[] => []);

        if (!targets.length && matchesWebViewSelector({ id: socket, type: 'webview', socket }, selector)) {
          return {
            context: { id: socket, type: 'webview', socket },
            cdpUrl
          };
        }

        for (const target of targets) {
          const context = webViewContextFromTarget(socket, target);
          lastContexts.push(context);

          if (matchesWebViewSelector(context, selector)) {
            return {
              context,
              cdpUrl
            };
          }
        }
      }

      await delay(500);
    }

    throw new AsturError('WEBVIEW_NOT_FOUND', 'No matching Android WebView context was available through DevTools.', {
      selector,
      contexts: lastContexts
    });
  }

  async getKeyboardState(): Promise<KeyboardState> {
    const command = await this.tryNativeCommand('keyboard.state');
    if (command.ok) {
      return command.result;
    }

    const output = await this.adbText(['shell', 'dumpsys', 'window']);
    return parseAndroidKeyboardState(output);
  }

  async dismissKeyboard(): Promise<void> {
    const command = await this.tryNativeCommand('keyboard.dismiss');
    if (command.ok) {
      return;
    }

    if (!(await this.getKeyboardState()).visible) {
      return;
    }

    await this.pressKey('BACK');

    const deadline = Date.now() + 1_500;
    while (Date.now() <= deadline) {
      if (!(await this.getKeyboardState()).visible) {
        return;
      }

      await delay(100);
    }
  }

  private async tryNativeCommand<M extends NativeAgentMethod>(
    method: M,
    params?: NativeAgentCommandParams<M>
  ): Promise<{ ok: true; result: NativeAgentCommandResponse<M> } | { ok: false }> {
    if (!this.nativeAgent) {
      return { ok: false };
    }

    if (this.unsupportedAgentMethods.has(method)) {
      if (this.capabilities.agent.mode === 'required' || !allowsLegacyFallback(this.capabilities, 'unsupported')) {
        throw new AsturError(
          'ANDROID_AGENT_COMMAND_UNSUPPORTED',
          `Android native agent does not advertise support for ${method}.`,
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
          'ANDROID_AGENT_COMMAND_UNSUPPORTED',
          `Android native agent does not advertise support for ${method}.`,
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
          'ANDROID_AGENT_COMMAND_UNSUPPORTED',
          `Android native agent does not support ${method}.`,
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
          'ANDROID_AGENT_COMMAND_FAILED',
          `Android native agent command ${method} failed.`,
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
          'ANDROID_AGENT_COMMAND_FAILED',
          `Android native agent command ${method} failed.`,
          {
            method,
            cause: error
          }
        );
      }

      return { ok: false };
    }
  }

  private adb(args: readonly string[], maxBuffer?: number) {
    return run(this.adbPath, ['-s', this.deviceInfo.id, ...args], maxBuffer);
  }

  private adbText(args: readonly string[]) {
    return runText(this.adbPath, ['-s', this.deviceInfo.id, ...args]);
  }

  private async forwardWebView(socket: string): Promise<number> {
    const output = await this.adbText(['forward', 'tcp:0', `localabstract:${socket}`]);
    const port = Number(output.trim());

    if (!Number.isInteger(port) || port <= 0) {
      throw new AsturError('WEBVIEW_FORWARD_FAILED', `ADB did not return a TCP port for ${socket}.`, { output });
    }

    this.forwardedWebViewPorts.add(port);
    return port;
  }

  private resolvePackageName(app: AppUnderTest | undefined = this.capabilities.app): string {
    const packageName = app?.packageName ?? app?.bundleId;
    if (!packageName) {
      throw new AsturError('ANDROID_PACKAGE_REQUIRED', 'Android app management requires app.packageName.');
    }

    return packageName;
  }
}

export function parseAdbDevices(output: string): DeviceInfo[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .map((line) => {
      const [id, stateRaw, ...details] = line.split(/\s+/);
      const detailMap = parseDetailTokens(details);
      const model = detailMap.model?.replaceAll('_', ' ');

      return {
        id,
        name: model ?? id,
        platform: 'android' as const,
        kind: id.startsWith('emulator-') ? ('emulator' as const) : ('real' as const),
        state: normalizeAdbState(stateRaw),
        model,
        raw: line
      };
    });
}

export function parseAaptBadging(output: string): AndroidApkMetadata {
  const packageName = output.match(/package: name='([^']+)'/)?.[1];
  if (!packageName) {
    throw new AsturError('APK_PACKAGE_NOT_FOUND', 'Could not find package name in APK badging output.');
  }

  return {
    packageName,
    launchActivity: output.match(/launchable-activity: name='([^']+)'/)?.[1],
    versionName: output.match(/versionName='([^']+)'/)?.[1]
  };
}

export function parseAndroidKeyboardState(output: string): KeyboardState {
  const imeSource = output.match(/InsetsSource id=.*? type=ime .*?(?=\n)/);
  const imeSourceLine = imeSource?.[0] ?? '';
  const visible = /\bvisible=true\b/.test(imeSourceLine) || /\bmImeShowing=true\b/.test(output);

  if (!visible) {
    return { visible: false };
  }

  const visibleFrame = imeSourceLine.match(/visibleFrame=(\[[^\]]+\]\[[^\]]+\])/);
  const frame = imeSourceLine.match(/frame=(\[[^\]]+\]\[[^\]]+\])/);
  const sourceFrame = output.match(/mSourceFrame=Rect\((\d+),\s*(\d+)\s*-\s*(\d+),\s*(\d+)\)/);

  const bounds = parseAndroidWindowBounds(visibleFrame?.[1])
    ?? parseAndroidWindowBounds(frame?.[1])
    ?? (sourceFrame
      ? rectToBounds(Number(sourceFrame[1]), Number(sourceFrame[2]), Number(sourceFrame[3]), Number(sourceFrame[4]))
      : undefined);

  return bounds ? { visible: true, bounds } : { visible: true };
}

export function parseAndroidLockState(output: string): boolean {
  return /\bshowing=true\b/.test(output)
    || /\bmDreamingLockscreen=true\b/.test(output)
    || /\bmInputRestricted=true\b/.test(output)
    || /\bmAwake=false\b/.test(output)
    || /\bmScreenOn(?:Early|Fully)?=false\b/.test(output);
}

export function parseAndroidWebViewSockets(output: string): string[] {
  const sockets = new Set<string>();
  const pattern = /@?((?:webview|chrome|content_shell)_devtools_remote(?:_[A-Za-z0-9_.-]+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(output)) !== null) {
    sockets.add(match[1]);
  }

  return [...sockets].sort();
}

export function parseAndroidLs(output: string, remotePath: string): DeviceFileEntry[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('total '))
    .map((line) => parseAndroidLsLine(line, remotePath))
    .filter((entry): entry is DeviceFileEntry => Boolean(entry));
}

function webViewContextFromTarget(socket: string, target: DevtoolsTarget): MobileContextInfo {
  return {
    id: target.id ? `${socket}:${target.id}` : socket,
    type: 'webview',
    title: target.title,
    url: target.url,
    socket,
    pageId: target.id
  };
}

function matchesWebViewSelector(context: MobileContextInfo, selector: WebViewSelector): boolean {
  if (selector.id && selector.id !== context.id && selector.id !== context.socket && selector.id !== context.pageId) {
    return false;
  }

  if (selector.packageName && selector.packageName !== context.packageName) {
    return false;
  }

  if (selector.title && !matchesText(context.title, selector.title)) {
    return false;
  }

  if (selector.url && !matchesText(context.url, selector.url)) {
    return false;
  }

  return true;
}

function matchesText(actual: string | undefined, expected: string | RegExp): boolean {
  if (!actual) {
    return false;
  }

  return expected instanceof RegExp ? expected.test(actual) : actual.includes(expected);
}

function readDevtoolsTargets(cdpUrl: string): Promise<DevtoolsTarget[]> {
  return new Promise((resolve, reject) => {
    const request = httpGet(`${cdpUrl}/json/list`, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(body) as DevtoolsTarget[];
          resolve(parsed.filter((target) => !target.type || target.type === 'page' || target.type === 'webview'));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(3_000, () => {
      request.destroy(new Error(`Timed out reading ${cdpUrl}/json/list`));
    });
  });
}

function selectDevice(devices: DeviceInfo[], selector: DeviceSelector): DeviceInfo | undefined {
  return devices.find((device) => {
    if (device.state !== 'online') {
      return false;
    }

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

function isElementSelectorTarget(target: ElementDragTarget): target is { selector: ElementSelector } {
  return 'selector' in target;
}

function shouldAutoBoot(selector: DeviceSelector): boolean {
  return Boolean(selector.avd && selector.autoBoot !== false);
}

function resolveAndroidAgentArtifacts(): AndroidNativeAgentArtifacts | undefined {
  const appApkPath = process.env.ASTUR_ANDROID_AGENT_APK
    ?? resolveFirstExistingAndroidAgentArtifact('astur-android-agent-debug.apk', 'debug');
  const testApkPath = process.env.ASTUR_ANDROID_AGENT_TEST_APK
    ?? resolveFirstExistingAndroidAgentArtifact('astur-android-agent-debug-androidTest.apk', 'androidTest/debug');

  if (!existsSync(appApkPath) || !existsSync(testApkPath)) {
    return undefined;
  }

  return {
    appApkPath,
    testApkPath
  };
}

function resolveFirstExistingAndroidAgentArtifact(fileName: string, variantPath: string): string {
  const androidPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    join(androidPackageRoot, 'assets', 'agent', fileName),
    resolveDefaultAndroidAgentArtifact(fileName, variantPath)
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveDefaultAndroidAgentArtifact(fileName: string, variantPath: string): string {
  const androidPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return join(androidPackageRoot, '..', 'android-agent', 'build', 'outputs', 'apk', variantPath, fileName);
}

function resolveAndroidAgentRuntimeConfig(): {
  devicePort: number;
  hostPort?: number;
  packageName: string;
  testPackage: string;
  runnerClass: string;
} {
  return {
    devicePort: parseOptionalPort(process.env.ASTUR_ANDROID_AGENT_DEVICE_PORT) ?? 8729,
    hostPort: parseOptionalPort(process.env.ASTUR_ANDROID_AGENT_HOST_PORT),
    packageName: process.env.ASTUR_ANDROID_AGENT_PACKAGE ?? 'dev.astur.agent',
    testPackage: process.env.ASTUR_ANDROID_AGENT_TEST_PACKAGE ?? 'dev.astur.agent.test',
    runnerClass: process.env.ASTUR_ANDROID_AGENT_RUNNER ?? 'dev.astur.agent.AsturInstrumentationRunner'
  };
}

async function shouldInstallAndroidAgent(
  adb: (args: readonly string[]) => Promise<{ stdout: Buffer }>,
  config: ReturnType<typeof resolveAndroidAgentRuntimeConfig>
): Promise<boolean> {
  if (isTruthy(process.env.ASTUR_ANDROID_AGENT_FORCE_INSTALL)) {
    return true;
  }

  const [appInstalled, testInstalled] = await Promise.all([
    isAndroidPackageInstalled(adb, config.packageName),
    isAndroidPackageInstalled(adb, config.testPackage)
  ]);

  return !appInstalled || !testInstalled;
}

async function isAndroidPackageInstalled(
  adb: (args: readonly string[]) => Promise<{ stdout: Buffer }>,
  packageName: string
): Promise<boolean> {
  try {
    const result = await adb(['shell', 'pm', 'path', packageName]);
    return result.stdout.toString('utf8').trim().startsWith('package:');
  } catch {
    return false;
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

function androidRotationForOrientation(orientation: DeviceOrientation): number {
  switch (orientation) {
    case 'portrait':
      return 0;
    case 'landscape':
    case 'landscape-left':
      return 1;
    case 'portrait-upside-down':
      return 2;
    case 'landscape-right':
      return 3;
  }
}

function normalizeAndroidPermission(permission: string): string {
  const value = permission.trim();
  if (value.includes('.')) {
    return value;
  }

  return `android.permission.${value.replace(/[\s-]+/g, '_').toUpperCase()}`;
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new AsturError('ANDROID_AGENT_PORT_INVALID', `Invalid Android agent port: ${value}`);
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
          reject(new AsturError('ANDROID_AGENT_PORT_UNAVAILABLE', 'Failed to allocate a host port for the Android agent.'));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function waitForAndroidAgent(
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
        platform: 'android',
        handshakeTimeout: Math.min(1_000, remaining),
        commandTimeout: capabilities.agent.commandTimeout
      });
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new AsturError(
    'ANDROID_AGENT_CONNECT_FAILED',
    `Timed out waiting for Android native agent at ${endpoint}.`,
    {
      endpoint,
      timeout: capabilities.agent.launchTimeout,
      cause: lastError
    }
  );
}

function resolveEmulatorPath(): string {
  const executable = process.platform === 'win32' ? 'emulator.exe' : 'emulator';
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;

  if (sdkRoot) {
    const candidate = join(sdkRoot, 'emulator', executable);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to PATH lookup so an explicitly-configured emulator still works.
  return executable;
}

function resolveAaptPath(): string | undefined {
  const executable = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;

  if (!sdkRoot) {
    return undefined;
  }

  const buildToolsPath = join(sdkRoot, 'build-tools');
  if (!existsSync(buildToolsPath)) {
    return undefined;
  }

  const versions = readdirSync(buildToolsPath).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = join(buildToolsPath, version, executable);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function parseDetailTokens(tokens: string[]): Record<string, string> {
  const details: Record<string, string> = {};

  for (const token of tokens) {
    const index = token.indexOf(':');
    if (index > 0) {
      details[token.slice(0, index)] = token.slice(index + 1);
    }
  }

  return details;
}

function parseAndroidWindowBounds(value: string | undefined): Bounds | undefined {
  const match = value?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return undefined;
  }

  return rectToBounds(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
}

function rectToBounds(left: number, top: number, right: number, bottom: number): Bounds | undefined {
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    x: left,
    y: top,
    width,
    height
  };
}

function parseAndroidLsLine(line: string, remotePath: string): DeviceFileEntry | undefined {
  const parts = line.split(/\s+/);
  if (parts.length < 8) {
    return undefined;
  }

  const mode = parts[0];
  const size = Number(parts[4]);
  const name = parts.slice(7).join(' ');

  if (!name || name === '.' || name === '..') {
    return undefined;
  }

  return {
    name,
    path: joinRemotePath(remotePath, name),
    type: mode.startsWith('d') ? 'directory' : mode.startsWith('-') ? 'file' : 'other',
    size: Number.isFinite(size) ? size : undefined
  };
}

function joinRemotePath(remotePath: string, name: string): string {
  return `${remotePath.replace(/\/+$/, '')}/${name}`;
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

export function normalizeAndroidKey(key: string): string {
  const normalized = key.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    APP_SWITCH: 'KEYCODE_APP_SWITCH',
    BACK: 'KEYCODE_BACK',
    ENTER: 'KEYCODE_ENTER',
    HOME: 'KEYCODE_HOME',
    MENU: 'KEYCODE_MENU',
    POWER: 'KEYCODE_POWER',
    RECENT_APPS: 'KEYCODE_APP_SWITCH',
    RECENTS: 'KEYCODE_APP_SWITCH',
    SEARCH: 'KEYCODE_SEARCH',
    SLEEP: 'KEYCODE_SLEEP',
    TAB: 'KEYCODE_TAB',
    WAKEUP: 'KEYCODE_WAKEUP',
    VOLUME_DOWN: 'KEYCODE_VOLUME_DOWN',
    VOLUME_UP: 'KEYCODE_VOLUME_UP'
  };

  return aliases[normalized] ?? (normalized.startsWith('KEYCODE_') ? normalized : key);
}

function normalizeAdbState(state: string | undefined): DeviceInfo['state'] {
  if (state === 'device') {
    return 'online';
  }

  if (state === 'offline' || state === 'unauthorized') {
    return state;
  }

  return 'unknown';
}

function escapeAndroidInputText(value: string): string {
  return value.replaceAll('%', '%25').replace(/\s/g, '%s');
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean) ?? value.trim();
}

function warnAndroidAgentFallback(message: string): void {
  if (process.env.ASTUR_ANDROID_AGENT_QUIET === '1') {
    return;
  }

  console.warn(`[astur/android] ${message}`);
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
