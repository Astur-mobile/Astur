#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { realpathSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAndroidDriver } from '@astur/android';
import { AsturRuntime, AsturDevice } from '@astur/core';
import { createIosDriver } from '@astur/ios';
import type {
  AsturConfig,
  DeviceInfo,
  DoctorCheck,
  ElementSelector,
  LocatorSuggestion,
  MobileElementSnapshot,
  PlatformName,
  SwipeGesture
} from '@astur/protocol';
import {
  __testing as inspectorServerTesting,
  startInspectorServer,
  type InspectorAppActionKind,
  type InspectorDeviceAction
} from './inspectorServer.js';
import { buildInitFiles, defaultInitAnswers, promptInitAnswers } from './scaffold.js';

interface CodegenArgs {
  help: boolean;
  json: boolean;
  ui: boolean;
  launch: boolean;
  platform?: PlatformName;
  deviceId?: string;
  appPath?: string;
  appId?: string;
}

interface CodegenBootstrap {
  selected: DeviceInfo;
  launched: boolean;
  launchWarning?: string;
  tree: MobileElementSnapshot;
  treeNodeCount: number;
  visibleNodeCount: number;
  suggestions: LocatorSuggestion[];
  suggestion?: LocatorSuggestion;
  /** Live device — caller is responsible for closing it. */
  device: AsturDevice;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = 'help', ...rest] = argv;

  switch (command) {
    case 'doctor':
      await doctor(rest);
      break;
    case 'devices':
      await devices(rest);
      break;
    case 'init':
      await init(rest);
      break;
    case 'test':
      await runPlaywright(rest);
      break;
    case 'codegen':
      await codegen(rest);
      break;
    case 'inspect':
      await codegen(rest);
      break;
    case '-h':
    case '--help':
    case 'help':
      help();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      help();
      process.exitCode = 1;
  }
}

function createRuntime(): AsturRuntime {
  const runtime = new AsturRuntime().register(createAndroidDriver());

  if (supportsLocalIos()) {
    runtime.register(createIosDriver());
  }

  return runtime;
}

async function doctor(args: string[]): Promise<void> {
  const checks = await createRuntime().doctor();
  if (!supportsLocalIos()) {
    checks.push(createIosSkipCheck());
  }
  printChecks(checks, { verbose: args.includes('--verbose') });

  if (checks.some((check) => check.status === 'fail')) {
    process.exitCode = 1;
  }
}

async function devices(args: string[]): Promise<void> {
  const platform = args.includes('--android') ? 'android' : args.includes('--ios') ? 'ios' : undefined;
  if (platform === 'ios' && !supportsLocalIos()) {
    printHeader('devices', 'Connected devices and available simulators');
    console.log(`\n${colors.yellow('iOS devices are not available on this host.')}`);
    console.log(colors.dim('Local iOS automation requires macOS with Xcode.'));
    return;
  }

  const found = await createRuntime().listDevices(platform);
  printDevices(found);
}

async function init(args: string[]): Promise<void> {
  printHeader('init', 'Create Astur Playwright config and starter test');
  const useDefaults = args.includes('--yes') || args.includes('-y') || !process.stdin.isTTY;
  const answers = useDefaults ? defaultInitAnswers() : await promptInitAnswers();

  for (const file of buildInitFiles(answers)) {
    await writeIfMissing(file.path, file.contents);
  }

  console.log('\nCreated Astur starter files.');
  console.log(colors.dim('Next: run `npx astur-mobile doctor`, then `npx astur-mobile test`.'));
}

async function codegen(args: string[]): Promise<void> {
  const parsed = parseCodegenArgs(args);

  if (parsed.help) {
    printCodegenHelp();
    return;
  }

  if (parsed.platform === 'ios' && !supportsLocalIos()) {
    printHeader('codegen', 'Playwright-style mobile inspector bootstrap');
    console.log(`\n${colors.yellow('iOS codegen requires macOS with Xcode.')}`);
    process.exitCode = 1;
    return;
  }

  const runtime = createRuntime();
  const available = await runtime.listDevices(parsed.platform);
  const selected = selectCodegenDevice(available, parsed.deviceId);

  if (!selected) {
    printHeader('codegen', 'Playwright-style mobile inspector bootstrap');
    console.log(`\n${colors.yellow('No matching online/booted device was found.')}`);
    console.log(colors.dim('Run `astur devices` to list available targets.'));
    process.exitCode = 1;
    return;
  }

  // ── Live inspector path (default) ─────────────────────────────────────────
  if (parsed.ui) {
    printHeader('codegen', 'Astur Inspector UI');

    // Create device without fetching tree — server streams everything
    const config = buildCodegenConfig(selected, parsed);
    let device: AsturDevice;
    let selectedDevice = selected;
    try {
      device = await runtime.createDevice(config);
      if (parsed.launch && config.app) {
        await device.app.launch();
      }
    } catch (err) {
      console.error(`\n${colors.red('Failed to connect to device:')} ${String(err)}`);
      process.exitCode = 1;
      return;
    }

    let handle: { port: number; close(): void };
    try {
      handle = await startInspectorServer(device.inspector({ pollIntervalMs: 500 }), selectedDevice, {
        captureScreenshot: () => device.screenshot().catch(() => undefined) as Promise<Buffer | undefined>,
        performDeviceAction: (action) => runInspectorDeviceAction(device, action),
        performTap: (point) => device.tap(point),
        performSwipe: (gesture) => device.swipe(gesture),
        installApp: (path) => device.app.install(path),
        performAppAction: async (action, options) => {
          if (action === 'launch' && device.deviceInfo.platform === 'ios') {
            const identifier = requireInspectorAppIdentifier(options.identifier);
            const nextConfig = buildCodegenConfig(selectedDevice, {
              ...parsed,
              platform: selectedDevice.platform,
              deviceId: selectedDevice.id,
              appId: identifier,
              launch: false
            });
            const nextDevice = await runtime.createDevice(nextConfig);
            await nextDevice.app.launch({ app: { bundleId: identifier } });
            const previousDevice = device;
            device = nextDevice;
            await previousDevice.close().catch(() => undefined);
            return {
              device: selectedDevice,
              inspector: nextDevice.inspector({ pollIntervalMs: 500 })
            };
          }

          await runInspectorAppAction(device, action, options);
        },
        listDevices: () => runtime.listDevices(),
        switchDevice: async (deviceId) => {
          const devices = await runtime.listDevices();
          const next = selectCodegenDevice(devices, deviceId);
          if (!next) {
            throw new Error(`No ready device found for ${deviceId}.`);
          }

          const nextConfig = buildCodegenConfig(next, {
            ...parsed,
            platform: next.platform,
            deviceId: next.id,
            launch: false
          });
          const nextDevice = await runtime.createDevice(nextConfig);
          const previousDevice = device;
          device = nextDevice;
          selectedDevice = next;
          await previousDevice.close().catch(() => undefined);
          return {
            device: next,
            inspector: nextDevice.inspector({ pollIntervalMs: 500 })
          };
        },
        onListen: (port) => {
          const url = `http://localhost:${port}`;
          console.log(`\n${colors.bold('device')}   ${selectedDevice.platform} ${selectedDevice.name} (${selectedDevice.id})`);
          console.log(`${colors.bold('ui')}       ${colors.green('live')} ${colors.dim(url)}`);
          openBrowser(url);
        }
      });
    } catch (err) {
      console.error(`\n${colors.red('Failed to start inspector server:')} ${String(err)}`);
      await device.close().catch(() => undefined);
      process.exitCode = 1;
      return;
    }

    const cleanup = async () => {
      handle.close();
      await device.close().catch(() => undefined);
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    await new Promise<never>(() => undefined);
    return;
  }

  // ── CLI / JSON path ────────────────────────────────────────────────────────
  const bootstrap = await bootstrapCodegen(runtime, selected, parsed);

  if (parsed.json) {
    console.log(JSON.stringify({
      command: 'codegen',
      selectedDevice: {
        id: bootstrap.selected.id,
        name: bootstrap.selected.name,
        platform: bootstrap.selected.platform,
        kind: bootstrap.selected.kind,
        state: bootstrap.selected.state
      },
      app: {
        launched: bootstrap.launched,
        warning: bootstrap.launchWarning
      },
      tree: {
        nodes: bootstrap.treeNodeCount,
        visibleNodes: bootstrap.visibleNodeCount
      },
      suggestion: bootstrap.suggestion?.code,
      suggestions: bootstrap.suggestions.map((candidate) => ({
        code: candidate.code,
        score: candidate.score
      }))
    }, null, 2));
    await bootstrap.device.close().catch(() => undefined);
    return;
  }

  await bootstrap.device.close().catch(() => undefined);

  printHeader('codegen', 'Playwright-style mobile inspector bootstrap');
  console.log(`\n${colors.bold('device')}   ${bootstrap.selected.platform} ${bootstrap.selected.name} (${bootstrap.selected.id})`);
  console.log(`${colors.bold('mirror')}   ready for inspector frontend attachment`);

  if (bootstrap.launched) {
    console.log(`${colors.bold('app')}      launched on selected device`);
  } else if (bootstrap.launchWarning) {
    console.log(`${colors.bold('app')}      ${colors.yellow('launch skipped')} ${colors.dim(`(${bootstrap.launchWarning})`)}`);
  } else {
    console.log(`${colors.bold('app')}      ${colors.dim('not launched (pass --app or --app-id for automatic launch)')}`);
  }

  console.log(`${colors.bold('tree')}     ${bootstrap.treeNodeCount} nodes (${bootstrap.visibleNodeCount} visible)`);

  if (bootstrap.suggestion) {
    console.log(`${colors.bold('locator')}  ${colors.green(bootstrap.suggestion.code)} ${colors.dim(`score=${bootstrap.suggestion.score}`)}`);
  }

  console.log(`\n${colors.bold('next')} start recording interactions in the inspector UI layer and convert actions into Astur codegen snippets.`);
}

function runPlaywright(args: string[]): Promise<void> {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(bin, ['playwright', 'test', ...args], {
    stdio: 'inherit',
    shell: false
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright was terminated by ${signal}.`));
        return;
      }

      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function writeIfMissing(path: string, contents: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
    console.log(`Skipped existing ${path}`);
    return;
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, 'utf8');
    console.log(`Created ${path}`);
  }
}

function printChecks(checks: DoctorCheck[], options: { verbose?: boolean } = {}): void {
  printHeader('doctor', 'Environment diagnostics');

  for (const [group, groupChecks] of groupChecksByPlatform(checks)) {
    console.log(`\n${colors.dim('◦')} ${colors.bold(group)}`);

    for (const check of groupChecks) {
      const status = renderStatus(check.status);
      const message = options.verbose ? check.message : compactMessage(check.message);
      console.log(`  ${status} ${colors.bold(check.label.padEnd(18))} ${message}`);
      if (!options.verbose && check.message !== message) {
        console.log(`      ${colors.dim('details hidden; run astur doctor --verbose')}`);
      }
      if (check.fix) {
        console.log(`      ${colors.dim('fix')} ${colors.yellow(check.fix)}`);
      }
    }
  }

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  const skipped = checks.filter((check) => check.status === 'skip').length;
  const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : '';
  const summary =
    failures > 0
      ? colors.red(`${failures} failed, ${warnings} warning(s)${skippedSuffix}`)
      : warnings > 0
        ? colors.yellow(`${warnings} warning(s)${skippedSuffix}, ready with limits`)
        : skipped > 0
          ? colors.cyan(`${skipped} skipped, ready for supported platforms`)
          : colors.green('all checks passed');

  console.log(`\n${colors.dim('summary')} ${summary}`);
  printNextSteps(checks);
}

function printDevices(devices: DeviceInfo[]): void {
  printHeader('devices', 'Connected devices and available simulators');

  if (!devices.length) {
    console.log(`\n${colors.yellow('No devices found.')}`);
    console.log(colors.dim('Start an Android emulator, connect a device, or install an iOS simulator runtime.'));
    return;
  }

  console.log('');
  for (const device of devices) {
    const version = device.osVersion ? ` ${device.osVersion}` : '';
    const state = renderDeviceState(device.state);
    const platform = device.platform === 'android' ? colors.green('android') : colors.cyan('ios');
    console.log(
      `  ${platform.padEnd(16)} ${colors.dim(device.kind.padEnd(9))} ${state} ${colors.dim(device.id)} ${device.name}${version}`
    );
  }
}

function help(): void {
  printHeader('cli', 'Native mobile automation');
  console.log(`
${colors.bold('Usage')}
  astur doctor       Check Android, iOS, and agent prerequisites
  astur doctor --verbose
  astur devices      List connected devices and available simulators
  astur init         Create starter Playwright config and test interactively
  astur init --yes   Create starter files with Android emulator defaults
  astur codegen      Bootstrap runtime-backed inspector/codegen session
  astur test [args]  Run Playwright Test
  astur inspect      Alias for astur codegen
`);
}

function printCodegenHelp(): void {
  printHeader('codegen', 'Playwright-style mobile inspector bootstrap');
  console.log(`
${colors.bold('Usage')}
  astur codegen [options]

${colors.bold('Options')}
  --android            Target Android devices only
  --ios                Target iOS devices only
  --platform <name>    Explicit platform: android or ios
  --device <id>        Prefer a specific device id/UDID
  --app <path>         App path to install/use for launch (.apk, .app, .ipa)
  --app-id <id>        Installed package (Android) or bundle id (iOS)
  --ui                 Open Astur Inspector UI (default)
  --no-ui              Print CLI summary only
  --no-launch          Skip app launch even if app metadata is available
  --json               Print machine-readable bootstrap output
  -h, --help           Show this help
`);
}

function printHeader(command: string, subtitle: string): void {
  console.log(`${colors.cyan('Astur')} ${colors.dim('›')} ${colors.bold(command)}`);
  console.log(colors.dim(subtitle));
}

function groupChecksByPlatform(checks: DoctorCheck[]): Array<[string, DoctorCheck[]]> {
  const groups = new Map<string, DoctorCheck[]>();

  for (const check of checks) {
    const key = check.id.startsWith('android.')
      ? 'Android'
      : check.id.startsWith('ios.')
        ? 'iOS'
        : 'General';
    groups.set(key, [...(groups.get(key) ?? []), check]);
  }

  return [...groups.entries()];
}

function renderStatus(status: DoctorCheck['status']): string {
  switch (status) {
    case 'pass':
      return colors.green('✓ PASS');
    case 'warn':
      return colors.yellow('⚠ WARN');
    case 'fail':
      return colors.red('✕ FAIL');
    case 'skip':
      return colors.cyan('• SKIP');
  }
}

function renderDeviceState(state: DeviceInfo['state']): string {
  switch (state) {
    case 'online':
    case 'booted':
      return colors.green(state.padEnd(8));
    case 'offline':
    case 'unauthorized':
      return colors.red(state.padEnd(8));
    case 'shutdown':
      return colors.yellow(state.padEnd(8));
    case 'unknown':
      return colors.dim(state.padEnd(8));
  }
}

function compactMessage(message: string): string {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? message;
}

function printNextSteps(checks: DoctorCheck[]): void {
  const actionable = checks.filter((check) => check.status !== 'pass' && check.fix);
  if (!actionable.length) {
    return;
  }

  console.log(`\n${colors.bold('next steps')}`);
  for (const [index, check] of actionable.entries()) {
    console.log(`  ${index + 1}. ${colors.bold(check.label)}: ${check.fix}`);
  }
}

function supportsLocalIos(): boolean {
  return process.platform === 'darwin';
}

function parseCodegenArgs(args: string[]): CodegenArgs {
  const parsed: CodegenArgs = {
    help: false,
    json: false,
    ui: true,
    launch: true
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    switch (token) {
      case '-h':
      case '--help':
        parsed.help = true;
        break;
      case '--json':
        parsed.json = true;
        parsed.ui = false;
        break;
      case '--ui':
        parsed.ui = true;
        break;
      case '--no-ui':
        parsed.ui = false;
        break;
      case '--launch':
        parsed.launch = true;
        break;
      case '--no-launch':
        parsed.launch = false;
        break;
      case '--android':
        parsed.platform = 'android';
        break;
      case '--ios':
        parsed.platform = 'ios';
        break;
      case '--platform': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('--platform requires a value: android or ios');
        }

        if (value !== 'android' && value !== 'ios') {
          throw new Error(`Unsupported --platform value: ${value}`);
        }

        parsed.platform = value;
        index += 1;
        break;
      }
      case '--device': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('--device requires a value');
        }

        parsed.deviceId = value;
        index += 1;
        break;
      }
      case '--app': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('--app requires a value');
        }

        parsed.appPath = value;
        index += 1;
        break;
      }
      case '--app-id': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('--app-id requires a value');
        }

        parsed.appId = value;
        index += 1;
        break;
      }
      default:
        if (token.startsWith('-')) {
          throw new Error(`Unknown codegen option: ${token}`);
        }

        throw new Error(`Unexpected positional argument for codegen: ${token}`);
    }
  }

  return parsed;
}

function selectCodegenDevice(devices: DeviceInfo[], deviceId?: string): DeviceInfo | undefined {
  const isReady = (device: DeviceInfo) => device.state === 'online' || device.state === 'booted';

  if (deviceId) {
    return devices.find((device) => device.id === deviceId && isReady(device));
  }

  return devices.find(isReady);
}

async function bootstrapCodegen(runtime: AsturRuntime, selected: DeviceInfo, parsed: CodegenArgs): Promise<CodegenBootstrap> {
  const config = buildCodegenConfig(selected, parsed);
  const device = await runtime.createDevice(config);

  let launched = false;
  let launchWarning: string | undefined;

  try {
    if (parsed.launch && config.app) {
      await device.app.launch();
      launched = true;
    } else if (parsed.launch && !config.app) {
      launchWarning = 'no app was provided';
    }

    const inspector = device.inspector({ pollIntervalMs: 500 });
    const update = await firstTreeUpdate(inspector);
    const nodes = flattenTree(update.root);
    const locatorContext = await bestLocatorContext(device, update.root);

    return {
      selected,
      launched,
      launchWarning,
      tree: update.root,
      treeNodeCount: nodes.length,
      visibleNodeCount: nodes.filter((node) => node.visible).length,
      suggestions: locatorContext?.suggestions ?? [],
      suggestion: locatorContext?.suggestions[0],
      device
    };
  } catch (err) {
    await device.close().catch(() => undefined);
    throw err;
  }
}

function buildCodegenConfig(selected: DeviceInfo, parsed: CodegenArgs): AsturConfig {
  const appId = parsed.appId ?? defaultCodegenAppId(selected.platform);
  const config: AsturConfig = {
    platform: selected.platform,
    automation: {
      engine: selected.platform === 'ios' ? 'agent' : 'auto',
      commandTimeoutMs: selected.platform === 'ios' ? 30_000 : undefined,
      startupTimeoutMs: selected.platform === 'ios' ? 60_000 : undefined
    },
    device: {
      id: selected.id
    }
  };

  if (!parsed.appPath && !appId) {
    return config;
  }

  if (selected.platform === 'android') {
    config.app = {
      path: parsed.appPath,
      packageName: appId
    };
    return config;
  }

  config.app = {
    path: parsed.appPath,
    bundleId: appId
  };
  return config;
}

function defaultCodegenAppId(platform: PlatformName): string | undefined {
  if (process.env.ASTUR_CODEGEN_APP_ID) {
    return process.env.ASTUR_CODEGEN_APP_ID;
  }

  if (platform === 'android') {
    return process.env.ASTUR_ANDROID_PACKAGE_NAME ?? process.env.ASTUR_ANDROID_APP_ID;
  }

  return process.env.ASTUR_IOS_BUNDLE_ID
    ?? process.env.ASTUR_AUT_BUNDLE_ID
    ?? 'com.astur.demo';
}

async function runInspectorDeviceAction(device: AsturDevice, action: InspectorDeviceAction): Promise<void> {
  switch (action) {
    case 'refresh':
      return;
    case 'orientation.portrait':
      await device.orientation.portrait();
      return;
    case 'orientation.landscape':
      await device.orientation.landscape();
      return;
    case 'keyboard.dismiss':
      await device.keyboard.dismiss();
      return;
    case 'device.lock':
      await device.system.lock();
      return;
    case 'device.unlock':
      await device.system.unlock();
      return;
    case 'navigation.back':
      await device.navigation.back();
      return;
    case 'navigation.home':
      await device.navigation.home();
      return;
    case 'navigation.recents':
      await device.navigation.recentApps();
      return;
  }
}

async function runInspectorAppAction(
  device: AsturDevice,
  action: InspectorAppActionKind,
  options: { identifier?: string; permission?: string }
): Promise<void> {
  switch (action) {
    case 'launch': {
      const identifier = requireInspectorAppIdentifier(options.identifier);
      await device.app.launch({
        app: device.deviceInfo.platform === 'android'
          ? { packageName: identifier }
          : { bundleId: identifier }
      });
      return;
    }
    case 'clearData':
      await device.app.clearData(requireInspectorAppIdentifier(options.identifier));
      return;
    case 'clearCache':
      await device.app.clearCache(requireInspectorAppIdentifier(options.identifier));
      return;
    case 'grantPermission':
      await device.permissions.grant(
        requireInspectorPermission(options.permission),
        requireInspectorAppIdentifier(options.identifier)
      );
      return;
    case 'revokePermission':
      await device.permissions.revoke(
        requireInspectorPermission(options.permission),
        requireInspectorAppIdentifier(options.identifier)
      );
      return;
  }
}

function requireInspectorAppIdentifier(identifier: string | undefined): string {
  const value = identifier?.trim();
  if (!value) {
    throw new Error('Package or bundle id is required.');
  }

  return value;
}

function requireInspectorPermission(permission: string | undefined): string {
  const value = permission?.trim();
  if (!value) {
    throw new Error('Permission is required.');
  }

  return value;
}

async function firstTreeUpdate(inspector: {
  subscribeTree(options?: { maxUpdates?: number }): AsyncIterable<{ root: MobileElementSnapshot }>;
}): Promise<{ root: MobileElementSnapshot }> {
  for await (const update of inspector.subscribeTree({ maxUpdates: 1 })) {
    return update;
  }

  throw new Error('Failed to receive an initial UI tree update for codegen bootstrap.');
}

async function bestLocatorContext(
  device: {
    suggestLocators(selector: ElementSelector): Promise<LocatorSuggestion[]>;
  },
  root: MobileElementSnapshot
): Promise<{ suggestions: LocatorSuggestion[] } | undefined> {
  const target = flattenTree(root).find((node) => {
    return node.visible
      && node.enabled
      && node.type !== 'android.root'
      && node.type !== 'ios.root'
      && Boolean(node.id || node.label || node.text);
  });

  if (!target) {
    return undefined;
  }

  const selector = selectorFromNode(target);
  if (!selector) {
    return undefined;
  }

  const suggestions = await device.suggestLocators(selector);
  if (!suggestions.length) {
    return undefined;
  }

  return { suggestions };
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore
  }
}

function selectorFromNode(node: MobileElementSnapshot): ElementSelector | undefined {
  if (node.id) {
    return {
      strategy: 'id',
      value: node.id,
      exact: true
    };
  }

  if (node.label) {
    return {
      strategy: 'accessibility',
      value: node.label,
      exact: true
    };
  }

  if (node.text) {
    return {
      strategy: 'text',
      value: node.text,
      exact: true
    };
  }

  return undefined;
}

function flattenTree(root: MobileElementSnapshot): MobileElementSnapshot[] {
  return [root, ...root.children.flatMap((child) => flattenTree(child))];
}

function createIosSkipCheck(): DoctorCheck {
  const host = hostName();
  return {
    id: 'ios.platform',
    label: 'iOS platform',
    status: 'skip',
    message: `Local iOS automation requires macOS with Xcode. Current host is ${host}.`,
    fix: 'Use macOS for iOS simulators/devices, or use Android-only checks on this host.'
  };
}

function hostName(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'darwin':
      return 'macOS';
    default:
      return process.platform;
  }
}

const shouldColor = process.env.NO_COLOR === undefined && process.stdout.isTTY;

const colors = {
  bold: (value: string) => color(value, '1'),
  dim: (value: string) => color(value, '2'),
  green: (value: string) => color(value, '32'),
  yellow: (value: string) => color(value, '33'),
  red: (value: string) => color(value, '31'),
  cyan: (value: string) => color(value, '36')
};

function color(value: string, code: string): string {
  return shouldColor ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function isDirectEntry(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}

export const __testing = {
  printChecks,
  buildInitFiles,
  defaultInitAnswers,
  parseCodegenArgs,
  selectCodegenDevice,
  buildCodegenConfig,
  inspectorServer: inspectorServerTesting
};

if (isDirectEntry()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
