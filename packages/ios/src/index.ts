import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { execFile, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppResetOptions,
  AppUnderTest,
  Bounds,
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
} from '@astur-mobile/protocol';
import {
  AsturError,
  connectNativeAgentClient,
  delay,
  FLUTTER_NETWORK_CAPABILITIES,
  isPrintableCharacter,
  resolveRedactionOptions,
  toNetworkRecords,
  DEFAULT_METRO_URL,
  REACT_NATIVE_NETWORK_CAPABILITIES,
  ReactNativeNetworkObserver,
  type NativeAgentClient,
  type NetworkCapabilities,
  type NetworkRedactionOptions,
  type NetworkRequestRecord,
  type PlatformDriver,
  type PlatformSession,
  type WebEvaluator,
  type WebViewSelector
} from '@astur-mobile/core';
import { run, runText, spawnCommand } from './command.js';
import { attachFlutterNetwork, IOS_NO_NETWORK_CAPABILITIES, type FlutterNetworkAttachment } from './flutterNetwork.js';
import { createIwdpEvaluator } from './iwdpWebEvaluator.js';

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

// Every bundled XCUITest agent is spawned `detached` so it leads its own
// process group; that lets us tear down xcodebuild *and* the test runner it
// spawns with a single group signal instead of leaking a session that keeps
// the simulator/device busy. The WeakSet drives group-vs-direct signalling in
// signalChildProcess; activeIosAgentPids backs the synchronous exit handler.
const detachedIosAgentProcesses = new WeakSet<ChildProcess>();
const activeIosAgentPids = new Set<number>();
let iosAgentExitHandlerInstalled = false;

function trackIosAgentProcess(child: ChildProcess): void {
  detachedIosAgentProcesses.add(child);
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  activeIosAgentPids.add(pid);
  child.once('exit', () => activeIosAgentPids.delete(pid));
  installIosAgentExitHandler();
}

// Last-resort cleanup: if the Node process exits for any reason that still runs
// 'exit' (normal return, process.exit, uncaught exception), synchronously
// SIGKILL every tracked agent process group so no orphaned xcodebuild session
// keeps holding the simulator. Catchable termination signals are wired to flow
// through the same path so the graceful close() runs first when possible.
function killTrackedIosAgentGroups(): void {
  for (const pid of activeIosAgentPids) {
    try {
      // Negative pid targets the whole process group (xcodebuild plus the
      // XCUITest runner it spawns), since agents are launched detached in their
      // own group.
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already gone.
      }
    }
  }
}

function installIosAgentExitHandler(): void {
  if (iosAgentExitHandlerInstalled) {
    return;
  }
  iosAgentExitHandlerInstalled = true;

  // Normal exit / process.exit / uncaught exception.
  process.once('exit', killTrackedIosAgentGroups);

  // Forcefully closing the terminal sends SIGHUP to the foreground process
  // group. Node does not fire 'exit' for it, and the detached agent group does
  // not receive it (it lives in its own group), so without this the xcodebuild
  // session is orphaned — holding the simulator and writing DerivedData — until
  // the next run reaps it. This process (the CLI for codegen, or the Playwright
  // worker for tests) is in the foreground group and does get SIGHUP, so kill
  // the tracked agent groups synchronously, then terminate with the
  // conventional SIGHUP exit code. The graceful close() still owns SIGINT /
  // SIGTERM and normal completion; this is only the last-resort net.
  process.once('SIGHUP', () => {
    killTrackedIosAgentGroups();
    process.exit(129);
  });
}

// Kill leftover XCUITest agent sessions for this project + device before
// starting a new one. Guards against accumulation when a previous run was
// SIGKILLed or crashed hard (cases where no in-process cleanup could run).
async function reapStaleIosAgentSessions(projectPath: string, deviceId: string): Promise<void> {
  // Escape hatch for setups that intentionally manage their own agent lifecycle
  // (e.g. an externally launched, shared XCUITest session).
  if (process.env.ASTUR_IOS_AGENT_REAP === '0') {
    return;
  }

  // Match xcodebuild test sessions for this exact project + device. Regex
  // metacharacters in the path (notably '.') stay permissive, which only widens
  // the match slightly while remaining specific to this device id.
  const pattern = `xcodebuild.*${projectPath}.*id=${deviceId}`;
  let stdout: string;
  try {
    ({ stdout } = await new Promise<{ stdout: string }>((resolve) => {
      execFile(
        'pgrep',
        ['-f', pattern],
        { encoding: 'utf8' },
        (_error, out) => resolve({ stdout: out ?? '' })
      );
    }));
  } catch {
    return;
  }

  const ownPid = process.pid;
  for (const line of stdout.split('\n')) {
    const pid = Number.parseInt(line.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === ownPid || activeIosAgentPids.has(pid)) {
      continue;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      continue;
    }

    await delay(500);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Exited after SIGTERM.
    }
  }
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

type XcdeviceListJson = Array<{
  architecture?: string;
  available?: boolean;
  identifier?: string;
  modelName?: string;
  name?: string;
  operatingSystemVersion?: string;
  platform?: string;
  simulator?: boolean;
}>;

interface DevicectlDevicesJson {
  result?: {
    devices?: DevicectlDeviceJson[];
  };
}

interface DevicectlDeviceJson {
  identifier?: string;
  connectionProperties?: {
    pairingState?: string;
    tunnelState?: string;
    transportType?: string;
  };
  deviceProperties?: {
    bootState?: string;
    developerModeStatus?: string;
    name?: string;
    osVersionNumber?: string;
  };
  hardwareProperties?: {
    marketingName?: string;
    platform?: string;
    udid?: string;
  };
}

interface DevicectlAppsJson {
  result?: {
    apps?: DevicectlAppInfo[];
  };
}

interface DevicectlAppInfo {
  bundleIdentifier?: string;
  name?: string;
  url?: string;
}

interface DevicectlProcessesJson {
  result?: {
    runningProcesses?: Array<{
      executable?: string;
      processIdentifier?: number;
    }>;
  };
}

interface DevicectlLockStateJson {
  result?: {
    lockState?: string;
    locked?: boolean;
  };
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
    const agentProjectPath = resolveDefaultIosAgentProject();

    const [versionResult, simulatorsResult, realDevicesResult] = await Promise.allSettled([
      runText(this.xcodebuildPath, ['-version']),
      this.listSimulators(),
      this.listConnectedDevices()
    ]);

    const checks: DoctorCheck[] = [];

    if (versionResult.status === 'fulfilled') {
      checks.push({
        id: 'ios.xcodebuild',
        label: 'Xcode',
        status: 'pass',
        message: firstLine(versionResult.value)
      });
    } else {
      checks.push({
        id: 'ios.xcodebuild',
        label: 'Xcode',
        status: 'fail',
        message: versionResult.reason instanceof Error ? versionResult.reason.message : String(versionResult.reason),
        fix: 'Install Xcode and run xcode-select so xcodebuild is available.'
      });
    }

    if (simulatorsResult.status === 'fulfilled') {
      const devices = simulatorsResult.value;
      checks.push({
        id: 'ios.simulators',
        label: 'iOS simulators',
        status: devices.length ? 'pass' : 'warn',
        message: devices.length ? `${devices.length} simulator(s) available.` : 'No iOS simulators were found.',
        fix: devices.length ? undefined : 'Install an iOS simulator runtime from Xcode settings.'
      });
    } else {
      checks.push({
        id: 'ios.simulators',
        label: 'iOS simulators',
        status: 'fail',
        message: simulatorsResult.reason instanceof Error ? simulatorsResult.reason.message : String(simulatorsResult.reason)
      });
    }

    if (realDevicesResult.status === 'fulfilled') {
      const devices = realDevicesResult.value;
      const hasRealDevice = devices.some((device) => device.kind === 'real' && device.state === 'online');
      checks.push({
        id: 'ios.real-devices',
        label: 'iOS real devices',
        status: hasRealDevice ? 'pass' : 'warn',
        message: hasRealDevice ? `${devices.length} connected iOS device(s) available.` : 'No connected iOS real devices were found.',
        fix: hasRealDevice
          ? undefined
          : 'Connect a trusted iPhone or iPad with Developer Mode enabled, then run xcrun devicectl list devices.'
      });

      if (hasRealDevice) {
        const inferredTeam = process.env.ASTUR_IOS_DEVELOPMENT_TEAM
          ?? inferIosDevelopmentTeam(agentProjectPath);
        checks.push({
          id: 'ios.real-device-signing',
          label: 'iOS real-device signing',
          status: inferredTeam ? 'pass' : 'warn',
          message: inferredTeam
            ? `Development team ${inferredTeam} is configured.`
            : 'No development team was found for real-device XCUITest signing.',
          fix: inferredTeam
            ? undefined
            : 'Set ASTUR_IOS_DEVELOPMENT_TEAM or select a development team in agents/ios-xctest-agent so Astur can sign the bundled XCUITest runner.'
        });
      }
    } else {
      checks.push({
        id: 'ios.real-devices',
        label: 'iOS real devices',
        status: 'warn',
        message: realDevicesResult.reason instanceof Error ? realDevicesResult.reason.message : String(realDevicesResult.reason),
        fix: 'Run xcrun devicectl list devices and confirm the device is trusted, unlocked, and in Developer Mode.'
      });
    }

    const agentProjectAvailable = existsSync(join(agentProjectPath, 'project.pbxproj'));
    checks.push({
      id: 'ios.xctest-agent',
      label: 'XCUITest agent',
      status: agentProjectAvailable ? 'pass' : 'warn',
      message: agentProjectAvailable
        ? 'Bundled Swift XCUITest agent project is available.'
        : 'Native iOS element automation requires the bundled Swift XCUITest agent project.',
      fix: agentProjectAvailable
        ? undefined
        : 'Keep agents/ios-xctest-agent available when running from source or install the published @astur-mobile/ios package assets.'
    });

    return checks;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [realDevices, simulators] = await Promise.all([
      this.listConnectedDevices().catch(() => []),
      this.listSimulators().catch(() => [])
    ]);

    return [...realDevices, ...simulators];
  }

  private async listDevicesForSelector(selector: DeviceSelector): Promise<DeviceInfo[]> {
    if (selector.kind === 'real') {
      return this.listConnectedDevices();
    }

    if (selector.kind === 'simulator') {
      return this.listSimulators();
    }

    return this.listDevices();
  }

  private async listSimulators(): Promise<DeviceInfo[]> {
    const output = await runText(this.xcrunPath, ['simctl', 'list', 'devices', 'available', '--json']);
    return parseSimctlDevices(output);
  }

  private async listConnectedDevices(): Promise<DeviceInfo[]> {
    try {
      return parseDevicectlDevices(await runDevicectlJson(this.xcrunPath, ['list', 'devices']));
    } catch {
      const output = await runText(this.xcrunPath, ['xcdevice', 'list']);
      return parseXcdeviceDevices(output);
    }
  }

  async createSession(capabilities: NormalizedCapabilities): Promise<PlatformSession> {
    if (capabilities.device.cloud) {
      throw new AsturError(
        'CLOUD_PROVIDER_NOT_IMPLEMENTED',
        'BrowserStack execution is scaffolded by Astur init, but the cloud driver is not implemented in this alpha. Use a local iOS simulator or real device for now.',
        { cloud: capabilities.device.cloud }
      );
    }

    const resolvedCapabilities = await resolveIosAppMetadata(capabilities);
    const devices = await this.listDevicesForSelector(resolvedCapabilities.device);
    const device = selectDevice(devices, resolvedCapabilities.device);

    if (!device) {
      throw new AsturError('DEVICE_NOT_FOUND', 'No matching iOS device was found.', {
        selector: resolvedCapabilities.device,
        devices
      });
    }

    const readyDevice = await this.ensureDeviceReady(device, resolvedCapabilities.device);
    const preAgentSession = new IosSession(this.xcrunPath, readyDevice, resolvedCapabilities);
    await ensureIosAppInstalled(preAgentSession, resolvedCapabilities);

    const nativeAgent = await this.resolveNativeAgent(resolvedCapabilities, readyDevice);

    return new IosSession(this.xcrunPath, readyDevice, resolvedCapabilities, nativeAgent);
  }

  private async ensureDeviceReady(device: DeviceInfo, selector: DeviceSelector): Promise<DeviceInfo> {
    if (device.kind !== 'simulator') {
      if (device.state === 'online') {
        return device;
      }

      throw new AsturError('DEVICE_NOT_READY', 'Selected iOS real device is not online.', { device, selector });
    }

    if (device.state === 'booted') {
      return device;
    }

    if (device.state !== 'shutdown') {
      throw new AsturError('DEVICE_NOT_READY', 'Selected iOS simulator is not booted or bootable.', { device, selector });
    }

    if (selector.autoBoot === false) {
      throw new AsturError('DEVICE_NOT_READY', 'Selected iOS simulator is shutdown and autoBoot is disabled.', {
        device,
        selector
      });
    }

    await run(this.xcrunPath, ['simctl', 'boot', device.id]).catch((error) => {
      if (!String(error).includes('Unable to boot device in current state: Booted')) {
        throw new AsturError('IOS_SIMULATOR_BOOT_FAILED', 'Failed to boot selected iOS simulator.', {
          device,
          selector,
          cause: error
        });
      }
    });
    await run(this.xcrunPath, ['simctl', 'bootstatus', device.id, '-b']);

    return {
      ...device,
      state: 'booted'
    };
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
    if (!capabilities.agent.install || !['simulator', 'real'].includes(device.kind)) {
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

    // Clear any XCUITest agent session left behind by a previous run that was
    // killed before it could clean up — otherwise it keeps the device busy and
    // contends with the new session (e.g. a wedged simctl/screenshot path).
    await reapStaleIosAgentSessions(config.projectPath, device.id);

    const launchTimeout = Math.max(capabilities.agent.launchTimeout, defaultBundledIosAgentLaunchTimeoutMs);
    const managedDerivedData = !config.derivedDataPath;
    const derivedDataPath = config.derivedDataPath ?? join(
      iosAgentDerivedDataRoot(),
      `${pathSafeName(device.id)}-${iosAgentSourceStamp(config.projectPath)}`
    );
    if (managedDerivedData) {
      // Each agent source version builds into its own DerivedData directory keyed
      // by source stamp. Drop the directories from previous versions for this
      // device so they do not pile up — one full Xcode build each — and exhaust
      // the disk over many runs (especially while the bundled agent is edited).
      await pruneStaleIosAgentDerivedData(device.id, derivedDataPath);
    }
    const attempts = parsePositiveInteger(process.env.ASTUR_IOS_AGENT_START_ATTEMPTS)
      ?? (device.kind === 'real' ? 1 : 2);
    let lastFailure: {
      error: unknown;
      endpoint?: string;
      hostPort?: number;
      xcodebuildOutput?: string;
    } | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const bridgeHosts = resolveIosAgentBridgeHosts(device, config);
      const hostPort = config.hostPort ?? await findFreePort(bridgeHosts.bindHost);
      const bridge = await IosAgentBridge.start(
        hostPort,
        capabilities.agent.commandTimeout,
        bridgeHosts
      );
      const endpoint = bridge.agentEndpoint;
      let agentProcess: ChildProcess | undefined;
      const output = createBoundedOutputCapture();

      try {
        agentProcess = spawnCommand(this.xcodebuildPath, [
          'test',
          ...xcodebuildRealDeviceSigningArgs(device, config),
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
          stdio: ['ignore', 'pipe', 'pipe'],
          // Own process group so teardown can group-signal xcodebuild together
          // with the XCUITest runner it spawns, instead of leaking a session
          // that keeps the simulator/device busy.
          detached: true,
          env: {
            ...process.env,
            ASTUR_AUT_BUNDLE_ID: bundleId,
            ASTUR_AUT_LAUNCH: '1',
            ASTUR_IOS_AGENT_BRIDGE_URL: endpoint
          }
        });
        trackIosAgentProcess(agentProcess);
        output.attach(agentProcess);

        // When registration wins this race, abort the exit watcher so it
        // detaches its exit/error listeners instead of leaking them on the
        // long-lived agent process.
        const exitWatch = new AbortController();
        const exitGuard = waitForChildExit(agentProcess, undefined, exitWatch.signal).then(({ code, signal }) => {
          // Registration won the race and aborted us — the resolve was the
          // abort sentinel, not a real exit, so don't fail the attempt.
          if (exitWatch.signal.aborted) {
            return undefined;
          }
          throw new AsturError(
            'IOS_XCTEST_AGENT_PROCESS_EXITED',
            `iOS XCUITest agent process exited before registration (${formatExitStatus(code, signal)}).`,
            {
              device,
              endpoint,
              projectPath: config.projectPath,
              scheme: config.scheme,
              attempt,
              attempts,
              xcodebuildOutput: output.text()
            }
          );
        });
        let info: NativeAgentInfo;
        try {
          info = await Promise.race([bridge.waitForRegistration(launchTimeout), exitGuard]) as NativeAgentInfo;
        } finally {
          // Detaches the child exit/error listeners once we have a winner.
          exitWatch.abort();
        }
        const client = bridge.createClient(info);

        return {
          client,
          endpoint,
          bridge,
          hostPort,
          process: agentProcess
        };
      } catch (error) {
        const xcodebuildOutput = output.text();
        lastFailure = {
          error,
          endpoint,
          hostPort,
          xcodebuildOutput
        };

        await terminateChildProcess(agentProcess);
        await bridge.close().catch(() => undefined);

        const unrecoverableRealDeviceFailure = device.kind === 'real' && (
          isIosDevelopmentTeamMissing(xcodebuildOutput)
          || isIosKeychainOrSigningPrompt(xcodebuildOutput)
          || isIosAppSignatureNotTrusted(xcodebuildOutput)
        );
        if (attempt < attempts && !unrecoverableRealDeviceFailure) {
          await delay(500);
          continue;
        }

        break;
      }
    }

    if (capabilities.agent.mode === 'required' || !allowsLegacyFallback(capabilities, 'failure')) {
      if (device.kind === 'real' && isIosDevelopmentTeamMissing(lastFailure?.xcodebuildOutput)) {
        throw new AsturError(
          'IOS_DEVELOPMENT_TEAM_REQUIRED',
          'Real iOS device execution requires signing the bundled Astur XCUITest runner. Set ASTUR_IOS_DEVELOPMENT_TEAM to your Apple development team id, then run the test again.',
          {
            device,
            endpoint: lastFailure?.endpoint,
            hostPort: lastFailure?.hostPort,
            projectPath: config.projectPath,
            scheme: config.scheme,
            launchTimeout,
            attempts,
            xcodebuildOutput: lastFailure?.xcodebuildOutput,
            cause: lastFailure?.error
          }
        );
      }

      if (device.kind === 'real' && isIosKeychainOrSigningPrompt(lastFailure?.xcodebuildOutput)) {
        throw new AsturError(
          'IOS_SIGNING_KEYCHAIN_LOCKED',
          'Real iOS device execution needs access to the macOS signing keychain. Unlock your login keychain or allow codesign access for the Apple Development certificate, then run Astur again.',
          {
            device,
            endpoint: lastFailure?.endpoint,
            hostPort: lastFailure?.hostPort,
            projectPath: config.projectPath,
            scheme: config.scheme,
            launchTimeout,
            attempts,
            xcodebuildOutput: lastFailure?.xcodebuildOutput,
            cause: lastFailure?.error
          }
        );
      }

      if (device.kind === 'real' && isIosAppSignatureNotTrusted(lastFailure?.xcodebuildOutput)) {
        throw new AsturError(
          'IOS_APP_SIGNATURE_NOT_TRUSTED',
          `iOS refused to launch ${bundleId} because the app signature, entitlements, provisioning profile, or developer trust state is invalid on this device.`,
          {
            bundleId,
            device,
            endpoint: lastFailure?.endpoint,
            hostPort: lastFailure?.hostPort,
            projectPath: config.projectPath,
            scheme: config.scheme,
            launchTimeout,
            attempts,
            xcodebuildOutput: lastFailure?.xcodebuildOutput,
            cause: lastFailure?.error
          }
        );
      }

      throw new AsturError(
        'IOS_XCTEST_AGENT_START_FAILED',
        'Failed to build or start the iOS XCUITest native agent.',
        {
          device,
          endpoint: lastFailure?.endpoint,
          hostPort: lastFailure?.hostPort,
          projectPath: config.projectPath,
          scheme: config.scheme,
          launchTimeout,
          attempts,
          xcodebuildOutput: lastFailure?.xcodebuildOutput,
          cause: lastFailure?.error
        }
      );
    }

    return undefined;
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
  /** Set once a debug Flutter build's Dart VM service has been found. */
  private flutterNetwork?: FlutterNetworkAttachment;
  private flutterNetworkProbed = false;
  /**
   * Whether this session ever found a VM service. Relaunching publishes a new
   * one, so a Flutter session must re-probe; a session that never had one is
   * not Flutter (or is a release build) and must not pay the log query again.
   */
  private flutterNetworkEverFound = false;
  /** When the app was last launched, used to bound the VM service log search. */
  private flutterLaunchedAt?: number;
  /**
   * React Native's CDP Network subscription. `undefined` means "not probed
   * yet"; `null` means "probed, no debuggable target" — the normal answer for a
   * release build, cached so it is not re-probed on every call.
   */
  private reactNativeNetwork?: ReactNativeNetworkObserver | null;

  constructor(
    xcrunPath: string,
    deviceInfo: DeviceInfo,
    capabilities: NormalizedCapabilities,
    nativeAgent?: IosNativeAgentRuntime
  ) {
    this.xcrunPath = xcrunPath;
    // XCUITest reads the merged accessibility tree for every app, Flutter
    // included, so iOS sessions are always 'native' from a test's perspective.
    this.deviceInfo = { ...deviceInfo, uiEngine: 'native' };
    this.capabilities = capabilities;
    this.nativeAgent = nativeAgent?.client;
    this.nativeAgentBridge = nativeAgent?.bridge;
    this.nativeAgentProcess = nativeAgent?.process;
  }

  async close(): Promise<void> {
    if (this.flutterNetwork) {
      await this.flutterNetwork.vm.dispose().catch(() => undefined);
      this.flutterNetwork = undefined;
    }

    this.reactNativeNetwork?.dispose();
    this.reactNativeNetwork = undefined;

    if (this.recording) {
      await this.stopRecording().catch(() => undefined);
    }

    if (this.nativeAgentProcess) {
      // Group-signal (SIGINT, then SIGKILL) so the xcodebuild session and the
      // XCUITest runner it spawned are both torn down — a bare kill on the
      // xcodebuild pid leaves the runner holding the simulator.
      await terminateChildProcess(this.nativeAgentProcess);
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
      if (this.isRealDevice()) {
        await this.devicectl(['device', 'install', 'app', '--device', this.deviceInfo.id, materialized.path]);
      } else {
        await this.simctl(['install', this.deviceInfo.id, materialized.path]);
      }
    } catch (error) {
      if (this.isRealDevice() && isIosAppInstallSignatureInvalid(error)) {
        throw new AsturError(
          'IOS_APP_INSTALL_SIGNATURE_INVALID',
          `iOS refused to install ${path} because the app signature, embedded provisioning profile, or developer trust state is invalid on this device.`,
          {
            appPath: path,
            installPath: materialized.path,
            device: this.deviceInfo,
            commandOutput: commandErrorOutput(error),
            cause: error
          }
        );
      }

      throw error;
    } finally {
      await materialized.cleanup?.().catch(() => undefined);
    }
  }

  async isAppInstalled(identifier: string): Promise<boolean> {
    if (this.isRealDevice()) {
      const app = await this.realDeviceAppInfo(identifier).catch(() => undefined);
      return Boolean(app);
    }

    try {
      await this.simctl(['get_app_container', this.deviceInfo.id, identifier, 'app']);
      return true;
    } catch {
      return false;
    }
  }

  async uninstallApp(identifier: string): Promise<void> {
    if (this.isRealDevice()) {
      await this.devicectl(['device', 'uninstall', 'app', '--device', this.deviceInfo.id, identifier]);
      return;
    }

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

    // Before the launch, not after: the log window is measured from here, and a
    // relaunch replaces any VM service the session was already attached to.
    this.invalidateFlutterNetwork();

    if (this.canUseNativeAppLifecycle(bundleId, 'app.launch')) {
      const command = await this.tryNativeCommand('app.launch');
      if (command.ok) {
        return;
      }
    }

    if (this.isRealDevice()) {
      await this.devicectl([
        'device',
        'process',
        'launch',
        '--device',
        this.deviceInfo.id,
        '--terminate-existing',
        bundleId
      ]);
      return;
    }

    await this.simctl(['launch', this.deviceInfo.id, bundleId]);
  }

  async terminateApp(): Promise<void> {
    const bundleId = this.resolveBundleId();
    if (this.canUseNativeAppLifecycle(bundleId, 'app.terminate')) {
      const command = await this.tryNativeCommand('app.terminate');
      if (command.ok) {
        return;
      }
    }

    if (this.isRealDevice()) {
      await this.terminateRealApp(bundleId);
      return;
    }

    await this.simctl(['terminate', this.deviceInfo.id, bundleId]);
  }

  async clearAppData(_identifier: string): Promise<void> {
    throw new AsturError(
      'IOS_APP_DATA_CLEAR_NOT_SUPPORTED',
      'iOS does not expose direct per-app data clearing through public local tooling. Use device.app.reset({ reinstall: true }) with an app path.'
    );
  }

  async clearAppCache(_identifier: string): Promise<void> {
    throw new AsturError(
      'IOS_APP_CACHE_CLEAR_NOT_SUPPORTED',
      'iOS does not expose direct per-app cache clearing through public local tooling. Use device.app.reset({ reinstall: true }) when a clean app container is required.'
    );
  }

  async grantPermission(identifier: string, permission: string): Promise<void> {
    if (this.isRealDevice()) {
      throw new AsturError(
        'IOS_REAL_DEVICE_PERMISSION_CONTROL_NOT_SUPPORTED',
        'iOS real devices do not expose reliable per-app permission mutation through Astur yet. Use app-controlled permission prompts or device settings.'
      );
    }

    await this.simctl(['privacy', this.deviceInfo.id, 'grant', normalizeIosPermission(permission), identifier]);
  }

  async revokePermission(identifier: string, permission: string): Promise<void> {
    if (this.isRealDevice()) {
      throw new AsturError(
        'IOS_REAL_DEVICE_PERMISSION_CONTROL_NOT_SUPPORTED',
        'iOS real devices do not expose reliable per-app permission mutation through Astur yet. Use app-controlled permission prompts or device settings.'
      );
    }

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

    await this.terminateApp().catch(() => undefined);
    await this.uninstallApp(bundleId).catch(() => undefined);
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
    if (this.isRealDevice()) {
      throw new AsturError(
        'IOS_REAL_DEVICE_LOCK_NOT_SUPPORTED',
        'iOS real devices do not expose lock control through devicectl. Lock the device manually when testing lock behavior.'
      );
    }

    await this.simctl(['io', this.deviceInfo.id, 'screenConfig', 'power', 'off']);
  }

  async unlockDevice(): Promise<void> {
    if (this.isRealDevice()) {
      throw new AsturError(
        'IOS_REAL_DEVICE_UNLOCK_NOT_SUPPORTED',
        'iOS real devices do not expose unlock control through devicectl. Unlock the device manually before starting the run.'
      );
    }

    await this.simctl(['io', this.deviceInfo.id, 'screenConfig', 'power', 'on']);
  }

  async isDeviceLocked(): Promise<boolean> {
    if (this.isRealDevice()) {
      const result = await this.devicectlJson<DevicectlLockStateJson>([
        'device',
        'info',
        'lockState',
        '--device',
        this.deviceInfo.id
      ]);
      return result.result?.locked ?? result.result?.lockState?.toLowerCase() === 'locked';
    }

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

  async getViewport(): Promise<Bounds> {
    const command = await this.tryNativeCommand('device.viewport');
    if (command.ok) {
      return command.result;
    }

    throw xctestRequired('reading the iOS viewport');
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

  private withDefaultElementWait<TOptions extends ElementWaitOptions>(options: TOptions): TOptions {
    if (options.timeout !== undefined) {
      return options;
    }

    return {
      ...options,
      timeout: this.capabilities.timeout
    };
  }

  async waitForElement(
    selector: ElementSelector,
    options: ElementWaitOptions = {}
  ): Promise<MobileElementSnapshot> {
    const command = await this.tryNativeCommand('element.wait', {
      selector,
      options: this.withDefaultElementWait(options)
    });
    if (command.ok && command.result) {
      return command.result;
    }

    throw xctestRequired('waiting for iOS native UI elements');
  }

  async waitForElementHidden(selector: ElementSelector, options: ElementWaitOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.wait', {
      selector,
      options: this.withDefaultElementWait({
        ...options,
        state: 'hidden'
      })
    });
    if (command.ok) {
      return;
    }

    throw xctestRequired('waiting for iOS native UI elements to be hidden');
  }

  async tapElement(selector: ElementSelector, options: ElementTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.tap', {
      selector,
      options: this.withDefaultElementWait(options)
    });
    if (command.ok) {
      return;
    }

    throw xctestRequired('tapping iOS native UI elements');
  }

  async doubleTapElement(selector: ElementSelector, options: ElementDoubleTapOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.doubleTap', {
      selector,
      options: this.withDefaultElementWait(options)
    });
    if (command.ok) {
      return;
    }

    throw xctestRequired('double-tapping iOS native UI elements');
  }

  async longPressElement(selector: ElementSelector, options: ElementLongPressOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.longPress', {
      selector,
      options: this.withDefaultElementWait(options)
    });
    if (command.ok) {
      return;
    }

    throw xctestRequired('long-pressing iOS native UI elements');
  }

  async fillElement(selector: ElementSelector, value: string, options: ElementFillOptions = {}): Promise<void> {
    const command = await this.tryNativeCommand('element.fill', {
      selector,
      value,
      options: this.withDefaultElementWait(options)
    });
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
    const command = await this.tryNativeCommand('element.drag', {
      selector,
      target,
      options: this.withDefaultElementWait(options)
    });
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

    // A single printable character is just typing it, on both platforms — see
    // `isPrintableCharacter`. Android routes the same call to `input text`.
    if (isPrintableCharacter(key)) {
      await this.typeText(key);
      return;
    }

    throw xctestRequired('pressing iOS keys');
  }

  async typeText(text: string): Promise<void> {
    const command = await this.tryNativeCommand('keyboard.type', { text });
    if (command.ok) {
      return;
    }

    throw xctestRequired('typing into the focused iOS input');
  }

  /**
   * Attaches to a debug Flutter build's Dart VM service, once per session.
   *
   * Probed lazily rather than at launch: most iOS sessions are not Flutter, and
   * the log query costs a few seconds that a session which never asks about
   * network traffic should not pay.
   */
  private async resolveFlutterNetwork(): Promise<FlutterNetworkAttachment | undefined> {
    if (this.flutterNetworkProbed) {
      return this.flutterNetwork;
    }

    this.flutterNetworkProbed = true;

    // Real devices keep the VM service on the device, reachable only through a
    // usbmuxd tunnel that Astur does not open yet, so the simulator's loopback
    // shortcut does not apply. Reported as unsupported rather than attempted.
    if (this.isRealDevice()) {
      return undefined;
    }


    this.flutterNetwork = await attachFlutterNetwork({
      udid: this.deviceInfo.id,
      requestTimeoutMs: this.capabilities.timeout,
      runLogShow: async (udid, window) => {
        return runText(this.xcrunPath, [
          'simctl',
          'spawn',
          udid,
          'log',
          'show',
          '--style',
          'compact',
          '--last',
          window,
          '--predicate',
          'eventMessage CONTAINS "Dart VM service"'
        ]);
      }
    }).catch(() => undefined);

    if (this.flutterNetwork) {
      this.flutterNetworkEverFound = true;
    }

    return this.flutterNetwork;
  }

  /**
   * Drops the cached VM service after a relaunch, which publishes a new one on
   * a new port. Without this the session keeps talking to a dead service and
   * reports an empty profile rather than the traffic the test just made.
   */
  private invalidateFlutterNetwork(): void {
    this.flutterLaunchedAt = Date.now();
    if (!this.flutterNetworkEverFound) {
      return;
    }

    const previous = this.flutterNetwork;
    this.flutterNetwork = undefined;
    this.flutterNetworkProbed = false;
    void previous?.vm.dispose().catch(() => undefined);
  }

  /**
   * The Metro dev server React Native dials out to. Astur connects to the same
   * address as a plain CDP client; it never stands in for Metro.
   */
  private get metroUrl(): string {
    return process.env.ASTUR_RN_DEV_SERVER ?? DEFAULT_METRO_URL;
  }

  /**
   * Attaches the React Native CDP Network observer once per session.
   *
   * The reporter lives in `ReactCommon`, so this is the same transport and the
   * same client as Android — only the discovery path above it differs.
   */
  private async resolveReactNativeNetwork(): Promise<ReactNativeNetworkObserver | undefined> {
    if (this.reactNativeNetwork !== undefined) {
      // Wait for the subscription to come back after a relaunch, for the same
      // reason as Android: the inspector page registers only once the bundle
      // has loaded, and earlier traffic would be missed rather than delayed.
      await this.reactNativeNetwork?.ensureLive();
      return this.reactNativeNetwork ?? undefined;
    }

    const observer = new ReactNativeNetworkObserver(
      this.metroUrl,
      this.capabilities.app?.bundleId ?? this.capabilities.app?.packageName
    );
    if (!(await observer.attach().catch(() => false))) {
      observer.dispose();
      this.reactNativeNetwork = null;
      return undefined;
    }
    this.reactNativeNetwork = observer;
    return observer;
  }

  async getNetworkCapabilities(): Promise<NetworkCapabilities> {
    const attachment = await this.resolveFlutterNetwork();
    if (!attachment) {
      // Flutter first because its probe is already cached by this point; React
      // Native is the fallback, detected by connecting rather than assumed.
      return (await this.resolveReactNativeNetwork())
        ? REACT_NATIVE_NETWORK_CAPABILITIES
        : IOS_NO_NETWORK_CAPABILITIES;
    }

    return FLUTTER_NETWORK_CAPABILITIES;
  }

  async getNetworkRequests(options?: NetworkRedactionOptions): Promise<NetworkRequestRecord[]> {
    const attachment = await this.resolveFlutterNetwork();
    if (!attachment) {
      const reactNative = await this.resolveReactNativeNetwork();
      if (reactNative) {
        return reactNative.records(options);
      }

      throw new AsturError(
        'NETWORK_OBSERVATION_UNSUPPORTED',
        IOS_NO_NETWORK_CAPABILITIES.coverage
      );
    }

    const profile = await attachment.vm.getHttpProfile();
    return toNetworkRecords(profile, resolveRedactionOptions(options));
  }

  async clearNetworkRequests(): Promise<void> {
    // Deliberately does not start discovery. The test fixture clears before
    // every test, and probing there would charge every single test the log
    // query — including the great majority that never look at network traffic.
    // Nothing has been recorded while unattached anyway, so there is nothing to
    // clear; the first read attaches and enables recording.
    const attachment = this.flutterNetwork;
    if (!attachment) {
      // Same rule for React Native: clear an observer that already exists, but
      // never start discovery from here. Awaited so the subscription is live
      // again before the test causes traffic.
      await this.reactNativeNetwork?.clear();
      return;
    }

    // Re-enable on every clear: the setting is scoped to the isolate, so a
    // restart between tests silently stops recording otherwise.
    await attachment.vm.enableHttpProfiling().catch(() => undefined);
    await attachment.vm.clearHttpProfile();
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
    if (this.isRealDevice()) {
      const command = await this.tryNativeCommand('device.screenshot');
      if (command.ok) {
        return Buffer.from(command.result.base64, 'base64');
      }

      throw xctestRequired('capturing a real iOS device screenshot');
    }

    // Prefer native agent screenshot for simulators when available: simctl io screenshot
    // can hang indefinitely when xcodebuild test is concurrently managing the simulator process.
    if (this.nativeAgent?.info.capabilities.includes('device.screenshot')) {
      const command = await this.tryNativeCommand('device.screenshot');
      if (command.ok) {
        return Buffer.from(command.result.base64, 'base64');
      }
    }

    const path = join(tmpdir(), `astur-${process.pid}-${Date.now()}.png`);
    await this.simctl(['io', this.deviceInfo.id, 'screenshot', path]);

    try {
      return await readFile(path);
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRealDevice()) {
      throw new AsturError(
        'IOS_REAL_DEVICE_RECORDING_NOT_SUPPORTED',
        'iOS real-device screen recording is not supported yet. Use screenshots or simulator video for now.'
      );
    }

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
    if (this.isRealDevice()) {
      await this.devicectl([
        'device',
        'process',
        'launch',
        '--device',
        this.deviceInfo.id,
        '--payload-url',
        url,
        'com.apple.mobilesafari'
      ]);
      return;
    }

    await this.simctl(['openurl', this.deviceInfo.id, url]);
  }

  /**
   * Opens a WKWebView DOM transport via ios-webkit-debug-proxy (WebKit RWI →
   * CDP-like). Backs {@link AsturDevice.webContext} on iOS so the same engine-
   * agnostic bridge that drives Android WebViews drives WKWebViews too. Requires
   * the app's WKWebView to set `isInspectable = true` (iOS 16.4+).
   */
  async createWebEvaluator(selector: WebViewSelector = {}): Promise<WebEvaluator> {
    return createIwdpEvaluator({
      udid: this.deviceInfo.id,
      deviceKind: this.deviceInfo.kind,
      bundleId: selector.packageName ?? this.capabilities.app?.bundleId ?? this.capabilities.app?.packageName,
      selector,
      timeoutMs: selector.timeout
    });
  }

  private canUseNativeAppLifecycle(bundleId: string, method: 'app.launch' | 'app.terminate'): boolean {
    const configuredBundleId = this.capabilities.app?.bundleId ?? this.capabilities.app?.packageName;
    return Boolean(
      this.nativeAgent
      && configuredBundleId === bundleId
      && this.nativeAgent.info.capabilities.includes(method)
    );
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

      if (isAgentCommandTimeout(error)) {
        if (allowsLegacyFallback(this.capabilities, 'failure')) {
          return { ok: false };
        }

        throw new AsturError(
          'IOS_XCTEST_AGENT_COMMAND_TIMEOUT',
          `iOS native agent command ${method} timed out.`,
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

  private devicectl(args: readonly string[]) {
    return run(this.xcrunPath, ['devicectl', ...args]);
  }

  private devicectlJson<T>(args: readonly string[]): Promise<T> {
    return runDevicectlJson<T>(this.xcrunPath, args);
  }

  private isRealDevice(): boolean {
    return this.deviceInfo.kind === 'real';
  }

  private async realDeviceAppInfo(bundleId: string): Promise<DevicectlAppInfo | undefined> {
    const result = await this.devicectlJson<DevicectlAppsJson>([
      'device',
      'info',
      'apps',
      '--device',
      this.deviceInfo.id,
      '--bundle-id',
      bundleId
    ]);

    return result.result?.apps?.find((app) => app.bundleIdentifier === bundleId);
  }

  private async terminateRealApp(bundleId: string): Promise<void> {
    const app = await this.realDeviceAppInfo(bundleId).catch(() => undefined);
    const appUrl = app?.url;
    const processes = await this.devicectlJson<DevicectlProcessesJson>([
      'device',
      'info',
      'processes',
      '--device',
      this.deviceInfo.id
    ]).catch(() => undefined);
    const process = processes?.result?.runningProcesses?.find((candidate) => {
      if (typeof candidate.processIdentifier !== 'number') {
        return false;
      }

      return appUrl
        ? candidate.executable?.startsWith(appUrl)
        : candidate.executable?.includes(`/${bundleId}`) === true;
    });

    if (process?.processIdentifier === undefined) {
      return;
    }

    await this.devicectl([
      'device',
      'process',
      'terminate',
      '--device',
      this.deviceInfo.id,
      '--pid',
      String(process.processIdentifier)
    ]);
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

interface CommandPoll {
  response: ServerResponse;
  timer: NodeJS.Timeout;
  onClose(): void;
}

class IosAgentBridge {
  readonly endpoint: string;
  readonly agentEndpoint: string;
  private readonly traceEnabled = process.env.ASTUR_IOS_AGENT_TRACE === '1';
  private readonly queue: BridgeCommand[] = [];
  private readonly commandPolls: CommandPoll[] = [];
  private readonly pending = new Map<string, {
    method: NativeAgentMethod;
    resolve(value: unknown): void;
    reject(error: unknown): void;
    timer?: NodeJS.Timeout;
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
    private readonly port: number,
    advertisedHost: string
  ) {
    this.endpoint = `http://127.0.0.1:${port}`;
    this.agentEndpoint = `http://${formatHostForUrl(advertisedHost)}:${port}`;
  }

  static async start(
    port: number,
    commandTimeout: number,
    options: { bindHost?: string; advertisedHost?: string } = {}
  ): Promise<IosAgentBridge> {
    let bridge!: IosAgentBridge;
    const server = createHttpServer((request, response) => {
      void bridge.handle(request, response);
    });
    const bindHost = options.bindHost ?? '127.0.0.1';
    const advertisedHost = options.advertisedHost ?? bindHost;
    bridge = new IosAgentBridge(server, commandTimeout, port, advertisedHost);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bindHost, () => {
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
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new AsturError(
        'AGENT_DISCONNECTED',
        'iOS XCUITest bridge closed before the command completed.',
        { endpoint: this.endpoint, method: pending.method }
      ));
    }
    this.pending.clear();

    for (const poll of this.commandPolls.splice(0)) {
      clearTimeout(poll.timer);
      poll.response.off('close', poll.onClose);
      if (!poll.response.writableEnded) {
        poll.response.statusCode = 204;
        poll.response.end();
      }
    }

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
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.queue.push(command);
      this.trace('queue', method, id);
      this.flushCommandPoll();
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
    if (command) {
      this.deliverCommand(response, command);
      return;
    }

    const longPollMs = 30_000;
    const timer = setTimeout(() => {
      cleanup();
      response.statusCode = 204;
      response.end();
    }, longPollMs);

    let poll: CommandPoll;
    const cleanup = (): void => {
      clearTimeout(timer);
      response.off('close', onClose);
      const index = this.commandPolls.indexOf(poll);
      if (index !== -1) {
        this.commandPolls.splice(index, 1);
      }
    };

    const onClose = (): void => {
      cleanup();
    };

    poll = {
      response,
      timer,
      onClose
    };
    response.on('close', onClose);
    this.commandPolls.push(poll);
  }

  private flushCommandPoll(): void {
    while (this.queue.length > 0 && this.commandPolls.length > 0) {
      const poll = this.commandPolls.shift();
      const command = this.queue.shift();
      if (!poll || !command) {
        return;
      }

      clearTimeout(poll.timer);
      poll.response.off('close', poll.onClose);
      if (!poll.response.writableEnded) {
        this.deliverCommand(poll.response, command);
      }
    }
  }

  private deliverCommand(response: ServerResponse, command: BridgeCommand): void {
    this.startCommandTimer(command);
    this.trace('deliver', command.method, command.id);
    writeJson(response, 200, command);
  }

  private startCommandTimer(command: BridgeCommand): void {
    const pending = this.pending.get(command.id);
    if (!pending || pending.timer) {
      return;
    }

    pending.timer = setTimeout(() => {
      this.pending.delete(command.id);
      this.trace('timeout', command.method, command.id);
      pending.reject(new AsturError(
        'AGENT_COMMAND_TIMEOUT',
        `iOS XCUITest agent command ${command.method} timed out.`,
        { endpoint: this.endpoint, method: command.method, timeout: this.commandTimeout }
      ));
    }, this.commandTimeout);
  }

  private async handleCommandResponse(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJson(request) as BridgeResponse;
    const pending = this.pending.get(body.id);
    if (!pending) {
      this.trace('orphan-response', undefined, body.id);
      writeJson(response, 200, { ok: true });
      return;
    }

    this.pending.delete(body.id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.trace(body.ok ? 'response-ok' : 'response-error', pending.method, body.id);

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

  private trace(event: string, method: NativeAgentMethod | string | undefined, id: string): void {
    if (!this.traceEnabled) {
      return;
    }

    console.log(`[astur/ios-agent] ${event} ${method ?? 'unknown'} ${id}`);
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

async function ensureIosAppInstalled(session: IosSession, capabilities: NormalizedCapabilities): Promise<void> {
  const app = capabilities.app;
  if (!app) {
    return;
  }

  const identifier = app.bundleId ?? app.packageName;
  const forceInstall = process.env.ASTUR_IOS_APP_FORCE_INSTALL === '1';
  if (identifier === 'dev.astur.iosagent.host' && !app.path) {
    return;
  }
  if (forceInstall && app.path) {
    await session.installApp(app.path);
    return;
  }

  if (identifier) {
    const installed = await session.isAppInstalled(identifier).catch(() => false);
    if (installed) {
      return;
    }

    if (!app.path) {
      throw new AsturError(
        'IOS_APP_NOT_INSTALLED',
        `iOS app ${identifier} is not installed on ${session.deviceInfo.name}. Pass --app <Simulator.app> or install the app before starting codegen.`,
        {
          identifier,
          device: session.deviceInfo
        }
      );
    }
  }

  if (!app.path) {
    return;
  }

  await session.installApp(app.path);
}

async function resolveIosAppMetadata(capabilities: NormalizedCapabilities): Promise<NormalizedCapabilities> {
  const app = capabilities.app;
  if (!app?.path || app.bundleId || app.packageName) {
    return capabilities;
  }

  const bundleId = await inferIosBundleId(app.path);
  return {
    ...capabilities,
    app: {
      ...app,
      bundleId
    }
  };
}

async function inferIosBundleId(path: string): Promise<string> {
  const materialized = await materializeIosInstallPath(path);
  try {
    const plist = join(materialized.path, 'Info.plist');
    const result = await run('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleIdentifier', plist]);
    const bundleId = result.stdout.toString('utf8').trim();
    if (!bundleId) {
      throw new AsturError('IOS_BUNDLE_ID_INFERENCE_FAILED', `No CFBundleIdentifier was found in ${plist}.`);
    }

    return bundleId;
  } finally {
    await materialized.cleanup?.().catch(() => undefined);
  }
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
  bridgeHost?: string;
  bridgeBindHost?: string;
  developmentTeam?: string;
  codeSignIdentity?: string;
  allowProvisioningUpdates?: boolean;
} {
  return {
    projectPath: process.env.ASTUR_IOS_AGENT_PROJECT ?? resolveDefaultIosAgentProject(),
    scheme: process.env.ASTUR_IOS_AGENT_SCHEME ?? 'AsturIOSAgent',
    hostPort: parseOptionalPort(process.env.ASTUR_IOS_AGENT_PORT),
    derivedDataPath: process.env.ASTUR_IOS_AGENT_DERIVED_DATA,
    bridgeHost: process.env.ASTUR_IOS_AGENT_HOST,
    bridgeBindHost: process.env.ASTUR_IOS_AGENT_BIND_HOST,
    developmentTeam: process.env.ASTUR_IOS_DEVELOPMENT_TEAM,
    codeSignIdentity: process.env.ASTUR_IOS_CODE_SIGN_IDENTITY,
    allowProvisioningUpdates: process.env.ASTUR_IOS_ALLOW_PROVISIONING_UPDATES === '0' ? false : undefined
  };
}

function resolveIosAgentBridgeHosts(
  device: DeviceInfo,
  config: ReturnType<typeof resolveIosAgentRuntimeConfig>
): { bindHost: string; advertisedHost: string } {
  if (device.kind !== 'real') {
    return {
      bindHost: config.bridgeBindHost ?? '127.0.0.1',
      advertisedHost: config.bridgeHost ?? '127.0.0.1'
    };
  }

  const advertisedHost = normalizeBridgeHost(config.bridgeHost)
    ?? firstUsableCoreDeviceHostAddress()
    ?? firstUsableHostAddress();
  if (!advertisedHost) {
    throw new AsturError(
      'IOS_AGENT_HOST_REQUIRED',
      'Real iOS device automation needs a host address the device can reach for the XCUITest bridge. Set ASTUR_IOS_AGENT_HOST to your Mac IP address.'
    );
  }

  return {
    bindHost: normalizeBridgeHost(config.bridgeBindHost) ?? (advertisedHost.includes(':') ? '::' : '0.0.0.0'),
    advertisedHost
  };
}

function xcodebuildRealDeviceSigningArgs(
  device: DeviceInfo,
  config: ReturnType<typeof resolveIosAgentRuntimeConfig>
): string[] {
  if (device.kind !== 'real') {
    return [];
  }

  const args = [
    '-allowProvisioningDeviceRegistration',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGNING_REQUIRED=YES',
    'CODE_SIGN_STYLE=Automatic'
  ];

  if (config.allowProvisioningUpdates !== false) {
    args.unshift('-allowProvisioningUpdates');
  }

  const developmentTeam = config.developmentTeam ?? inferIosDevelopmentTeam(config.projectPath);
  if (developmentTeam) {
    args.push(`DEVELOPMENT_TEAM=${developmentTeam}`);
  }

  if (config.codeSignIdentity) {
    args.push(`CODE_SIGN_IDENTITY=${config.codeSignIdentity}`);
  }

  return args;
}

function isIosDevelopmentTeamMissing(output: string | undefined): boolean {
  if (!output) {
    return false;
  }

  return output.includes('requires a development team') || output.includes('requires a provisioning profile');
}

function isIosKeychainOrSigningPrompt(output: string | undefined): boolean {
  if (!output) {
    return false;
  }

  return /Password:|User interaction is not allowed|errSecInteractionNotAllowed|No signing certificate/i.test(output);
}

function isIosAppSignatureNotTrusted(output: string | undefined): boolean {
  if (!output) {
    return false;
  }

  return /invalid code signature|inadequate entitlements|profile has not been explicitly trusted|not been explicitly trusted by the user|Unable to launch .* because it has an invalid/i.test(output);
}

function isIosAppInstallSignatureInvalid(error: unknown): boolean {
  const output = commandErrorOutput(error);
  if (!output) {
    return false;
  }

  return /integrity could not be verified|ApplicationVerificationFailed|Failed to install embedded profile|provisioning profile has expired|0xe8008011|embedded profile.*expired/i.test(output);
}

function commandErrorOutput(error: unknown): string {
  if (error instanceof AsturError) {
    const details = isRecord(error.details) ? error.details : undefined;
    const stdout = typeof details?.stdout === 'string' ? details.stdout : '';
    const stderr = typeof details?.stderr === 'string' ? details.stderr : '';
    return [error.message, stderr, stdout].filter(Boolean).join('\n').trim();
  }

  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const developmentTeamCache = new Map<string, string | undefined>();

function inferIosDevelopmentTeam(projectPath: string): string | undefined {
  const pbxprojPath = join(projectPath, 'project.pbxproj');
  if (developmentTeamCache.has(pbxprojPath)) {
    return developmentTeamCache.get(pbxprojPath);
  }

  let result: string | undefined;
  try {
    const project = readFileSync(pbxprojPath, 'utf8');
    for (const match of project.matchAll(/DEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/g)) {
      const value = match[1]?.trim();
      if (value) {
        result = value;
        break;
      }
    }
  } catch {
    result = undefined;
  }

  developmentTeamCache.set(pbxprojPath, result);
  return result;
}

function firstUsableHostAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return undefined;
}

function firstUsableCoreDeviceHostAddress(): string | undefined {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!name.startsWith('utun')) {
      continue;
    }

    for (const address of addresses ?? []) {
      if (address.family === 'IPv6' && !address.internal && address.address.toLowerCase().startsWith('fd')) {
        return address.address;
      }
    }
  }

  return undefined;
}

function normalizeBridgeHost(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }

  return host.trim().replace(/^\[(.*)\]$/, '$1') || undefined;
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function resolveDefaultIosAgentProject(): string {
  const iosPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sourceProject = join(iosPackageRoot, '..', '..', 'agents', 'ios-xctest-agent', 'AsturIOSAgent.xcodeproj');
  if (existsSync(join(sourceProject, 'project.pbxproj'))) {
    return sourceProject;
  }

  const packagedProject = join(
    iosPackageRoot,
    'assets',
    'ios-xctest-agent',
    'AsturIOSAgent.xcodeproj'
  );

  if (existsSync(join(packagedProject, 'project.pbxproj'))) {
    return packagedProject;
  }

  return sourceProject;
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

export function iosAgentDerivedDataRoot(): string {
  return join(tmpdir(), 'astur-ios-agent-derived-data');
}

/**
 * Removes the managed XCUITest agent DerivedData directories left behind by
 * previous agent source versions for a device, keeping only the current build
 * (`keepPath`). Without this, every change to the bundled Swift agent — and each
 * source-stamp it produces — leaves a full Xcode build behind, and they
 * accumulate until the disk fills. Other devices' builds are left untouched.
 * Best-effort: never throws.
 */
export async function pruneStaleIosAgentDerivedData(
  deviceId: string,
  keepPath: string,
  root: string = iosAgentDerivedDataRoot()
): Promise<void> {
  const prefix = `${pathSafeName(deviceId)}-`;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.startsWith(prefix) || join(root, entry) === keepPath) {
      return;
    }

    await rm(join(root, entry), { recursive: true, force: true }).catch(() => undefined);
  }));
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

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createBoundedOutputCapture(limit = 20_000): {
  attach(process: ChildProcess): void;
  text(): string;
} {
  let output = '';
  const append = (chunk: Buffer | string): void => {
    output += chunk.toString();
    if (output.length > limit) {
      output = output.slice(output.length - limit);
    }
  };

  return {
    attach(process) {
      process.stdout?.on('data', append);
      process.stderr?.on('data', append);
    },
    text() {
      return output.trim();
    }
  };
}

function waitForChildExit(
  child: ChildProcess | undefined,
  timeoutMs?: number,
  abortSignal?: AbortSignal
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (!child) {
    return Promise.resolve({ code: null, signal: null });
  }

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      child.off('exit', onExit);
      child.off('error', onError);
      abortSignal?.removeEventListener('abort', onAbort);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    // Lets the loser of a Promise.race detach its exit/error listeners instead
    // of leaking them on a child that lives for the whole session.
    const onAbort = (): void => {
      cleanup();
      resolve({ code: null, signal: null });
    };

    if (abortSignal?.aborted) {
      resolve({ code: null, signal: null });
      return;
    }

    child.once('exit', onExit);
    child.once('error', onError);
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        resolve({ code: null, signal: null });
      }, timeoutMs);
    }
  });
}

async function terminateChildProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child) {
    return;
  }

  signalChildProcess(child, 'SIGINT');
  const gracefulExit = await waitForChildExit(child, 2_000).catch(() => ({ code: null, signal: null }));
  if (gracefulExit.code !== null || gracefulExit.signal !== null) {
    return;
  }

  signalChildProcess(child, 'SIGKILL');
  await waitForChildExit(child, 1_000).catch(() => undefined);
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (detachedIosAgentProcesses.has(child) && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct child signaling.
    }
  }

  child.kill(signal);
}

function formatExitStatus(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `signal ${signal}`;
  }

  if (code !== null) {
    return `exit code ${code}`;
  }

  return 'unknown exit status';
}

function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
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

async function runDevicectlJson<T>(xcrunPath: string, args: readonly string[]): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const path = join(tmpdir(), `astur-devicectl-${process.pid}-${Date.now()}-${randomUUID()}.json`);
    try {
      await run(xcrunPath, ['devicectl', ...args, '--json-output', path, '--quiet']);
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(750 * attempt);
      }
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  throw lastError;
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

export function parseXcdeviceDevices(output: string): DeviceInfo[] {
  const parsed = JSON.parse(output) as XcdeviceListJson;

  return parsed
    .filter((device) => device.simulator === false)
    .filter((device) => device.available !== false)
    .filter((device) => device.platform === 'com.apple.platform.iphoneos')
    .filter((device) => typeof device.identifier === 'string' && typeof device.name === 'string')
    .map((device) => ({
      id: device.identifier!,
      name: device.name!,
      platform: 'ios' as const,
      kind: 'real' as const,
      state: 'online' as const,
      osVersion: normalizeAppleDeviceOsVersion(device.operatingSystemVersion),
      model: device.modelName,
      raw: device
    }));
}

export function parseDevicectlDevices(output: string | DevicectlDevicesJson): DeviceInfo[] {
  const parsed = typeof output === 'string' ? JSON.parse(output) as DevicectlDevicesJson : output;

  return (parsed.result?.devices ?? [])
    .filter((device) => device.hardwareProperties?.platform === 'iOS')
    .filter((device) => typeof device.hardwareProperties?.udid === 'string')
    .map((device) => ({
      id: device.hardwareProperties!.udid!,
      name: device.deviceProperties?.name ?? device.hardwareProperties?.marketingName ?? 'iOS Device',
      platform: 'ios' as const,
      kind: 'real' as const,
      state: normalizeDevicectlDeviceState(device),
      osVersion: device.deviceProperties?.osVersionNumber,
      model: device.hardwareProperties?.marketingName,
      raw: device
    }));
}

function normalizeDevicectlDeviceState(device: DevicectlDeviceJson): DeviceInfo['state'] {
  if (device.connectionProperties?.pairingState && device.connectionProperties.pairingState !== 'paired') {
    return 'unauthorized';
  }

  if (device.deviceProperties?.bootState === 'booted') {
    return 'online';
  }

  if (device.deviceProperties?.bootState === 'shutdown') {
    return 'offline';
  }

  return 'unknown';
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

const defaultBundledIosAgentLaunchTimeoutMs = 30_000;

function runtimeToVersion(runtime: string): string | undefined {
  const match = runtime.match(/SimRuntime\.iOS-(.+)$/);
  return match?.[1]?.replaceAll('-', '.');
}

function normalizeAppleDeviceOsVersion(version: string | undefined): string | undefined {
  return version?.split('(')[0]?.trim() || undefined;
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

function isAgentCommandTimeout(error: unknown): boolean {
  return error instanceof AsturError && error.code === 'AGENT_COMMAND_TIMEOUT';
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
