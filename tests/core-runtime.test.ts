import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  AsturError,
  AsturRuntime,
  by,
  type DeviceFileEntry,
  type DoctorCheck,
  type DeviceInfo,
  type MobileContextInfo,
  type PlatformDriver,
  type PlatformSession,
  type WebViewEndpoint
} from '@astur-mobile/core';

describe('AsturRuntime', () => {
  it('aggregates diagnostics and devices across registered drivers', async () => {
    const android = createDriver('android', 'emulator-5554');
    const ios = createDriver('ios', 'sim-1');
    const runtime = new AsturRuntime().register(android).register(ios);

    await expect(runtime.doctor()).resolves.toEqual([
      { id: 'android.doctor', label: 'android', status: 'pass', message: 'ok' },
      { id: 'ios.doctor', label: 'ios', status: 'pass', message: 'ok' }
    ]);
    await expect(runtime.listDevices()).resolves.toHaveLength(2);
    await expect(runtime.listDevices('ios')).resolves.toEqual([ios.device]);
  });

  it('creates a platform session and installs configured app paths', async () => {
    const driver = createDriver('android', 'emulator-5554');
    const runtime = new AsturRuntime().register(driver);

    const device = await runtime.createDevice({
      platform: 'android',
      app: { path: './demo.apk', packageName: 'dev.astur.demo' }
    });

    expect(driver.createSession).toHaveBeenCalledOnce();
    expect(driver.session.installApp).toHaveBeenCalledWith('./demo.apk');
    expect(device.deviceInfo.id).toBe('emulator-5554');
  });

  it('skips app install when package is already installed on the target device', async () => {
    const driver = createDriver('android', 'emulator-5554');
    driver.session.isAppInstalled = vi.fn(async () => true);
    const runtime = new AsturRuntime().register(driver);

    await runtime.createDevice({
      platform: 'android',
      app: { path: './demo.apk', packageName: 'dev.astur.demo' }
    });

    expect(driver.session.isAppInstalled).toHaveBeenCalledWith('dev.astur.demo');
    expect(driver.session.installApp).not.toHaveBeenCalled();
  });

  it('force-installs the configured Android app when requested', async () => {
    const driver = createDriver('android', 'emulator-5554');
    driver.session.isAppInstalled = vi.fn(async () => true);
    const runtime = new AsturRuntime().register(driver);
    vi.stubEnv('ASTUR_ANDROID_APP_FORCE_INSTALL', '1');

    try {
      await runtime.createDevice({
        platform: 'android',
        app: { path: './react-native.apk', packageName: 'dev.astur.demo' }
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(driver.session.isAppInstalled).not.toHaveBeenCalled();
    expect(driver.session.uninstallApp).toHaveBeenCalledWith('dev.astur.demo');
    expect(driver.session.installApp).toHaveBeenCalledWith('./react-native.apk');
  });

  it('exposes app and device management helpers on the device', async () => {
    const driver = createDriver('android', 'emulator-5554');
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({
      platform: 'android',
      app: { path: './demo.apk', packageName: 'dev.astur.demo' }
    });

    await device.app.clearData();
    await device.app.clearCache();
    await device.app.uninstall();
    await device.app.reset({ launch: true });
    await device.permissions.grant('camera');
    await device.permissions.revoke('camera');
    await device.lock();
    await device.unlock();
    await expect(device.isLocked()).resolves.toBe(false);

    expect(driver.session.clearAppData).toHaveBeenCalledWith('dev.astur.demo');
    expect(driver.session.clearAppCache).toHaveBeenCalledWith('dev.astur.demo');
    expect(driver.session.uninstallApp).toHaveBeenCalledWith('dev.astur.demo');
    expect(driver.session.resetApp).toHaveBeenCalledWith({ launch: true });
    expect(driver.session.grantPermission).toHaveBeenCalledWith('dev.astur.demo', 'camera');
    expect(driver.session.revokePermission).toHaveBeenCalledWith('dev.astur.demo', 'camera');
    expect(driver.session.lockDevice).toHaveBeenCalledOnce();
    expect(driver.session.unlockDevice).toHaveBeenCalledOnce();
    expect(driver.session.isDeviceLocked).toHaveBeenCalledOnce();
  });

  it('exposes Playwright-style native locator helpers on the device', async () => {
    const driver = createDriver('android', 'emulator-5554');
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'android' });

    expect(device.getByLabel('Login').selector).toEqual({
      strategy: 'accessibility',
      value: 'Login',
      exact: true
    });
    expect(device.getByText('Welcome', { exact: false }).selector).toEqual({
      strategy: 'text',
      value: 'Welcome',
      exact: false
    });
    expect(device.getByTestId('submit').selector).toEqual({
      strategy: 'id',
      value: 'submit',
      exact: true
    });
    expect(device.getByRole('button', { name: 'Login' }).selector).toEqual({
      strategy: 'role',
      value: 'button',
      exact: true,
      name: 'Login'
    });
    expect(device.locator(device.getByType('android.widget.Button').selector).selector).toEqual({
      strategy: 'type',
      value: 'android.widget.Button',
      exact: true
    });
  });

  it('delegates batched native element lookup through the device', async () => {
    const driver = createDriver('ios', 'sim-1');
    driver.session.findManyElements = vi.fn(async () => []);
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'ios' });

    await device.findMany([by.text('SINGLE TAPS'), by.text('0')]);

    expect(driver.session.findManyElements).toHaveBeenCalledWith([by.text('SINGLE TAPS'), by.text('0')]);
    expect(driver.session.getTree).not.toHaveBeenCalled();
  });

  it('returns the native viewport when the platform exposes it', async () => {
    const driver = createDriver('ios', 'sim-1');
    driver.session.getViewport = vi.fn(async () => ({ x: 0, y: 0, width: 390, height: 844 }));
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'ios' });

    await expect(device.viewport()).resolves.toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(driver.session.getViewport).toHaveBeenCalledOnce();
    expect(driver.session.getTree).not.toHaveBeenCalled();
  });

  it('falls back to the root tree bounds for viewport when the platform has no native viewport command', async () => {
    const driver = createDriver('android', 'emulator-5554');
    driver.session.getTree = vi.fn(async () => ({
      type: 'root',
      enabled: true,
      visible: true,
      bounds: { x: 0, y: 0, width: 1080, height: 2400 },
      children: []
    }));
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'android' });

    await expect(device.viewport()).resolves.toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('exposes gesture and system navigation helpers on the device', async () => {
    const driver = createDriver('android', 'emulator-5554');
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'android' });

    await device.doubleTap({ x: 4, y: 8 }, { intervalMs: 60 });
    await device.longPress({ x: 10, y: 20 }, { durationMs: 900 });
    await device.pressAndHold({ x: 30, y: 40 }, { durationMs: 700 });
    await device.drag({ start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, durationMs: 500 });
    await device.gestures.swipe({ start: { x: 5, y: 6 }, end: { x: 7, y: 8 }, durationMs: 300 });
    await device.back();
    await device.home();
    await device.recentApps();

    expect(driver.session.doubleTap).toHaveBeenCalledWith({ x: 4, y: 8 }, { intervalMs: 60 });
    expect(driver.session.longPress).toHaveBeenNthCalledWith(1, { x: 10, y: 20 }, { durationMs: 900 });
    expect(driver.session.longPress).toHaveBeenNthCalledWith(2, { x: 30, y: 40 }, { durationMs: 700 });
    expect(driver.session.drag).toHaveBeenCalledWith({
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      durationMs: 500
    });
    expect(driver.session.swipe).toHaveBeenCalledWith({
      start: { x: 5, y: 6 },
      end: { x: 7, y: 8 },
      durationMs: 300
    });
    expect(driver.session.pressKey).toHaveBeenNthCalledWith(1, 'BACK');
    expect(driver.session.pressKey).toHaveBeenNthCalledWith(2, 'HOME');
    expect(driver.session.pressKey).toHaveBeenNthCalledWith(3, 'APP_SWITCH');
  });

  it('exposes soft keyboard helpers on the device', async () => {
    const driver = createDriver('ios', 'sim-1');
    driver.session.getKeyboardState = vi.fn(async () => ({ visible: true }));
    driver.session.dismissKeyboard = vi.fn();
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'ios' });

    await expect(device.keyboard.isVisible()).resolves.toBe(true);
    await device.keyboard.dismiss();
    await device.keyboard.hide();
    await device.keyboard.show();

    expect(driver.session.getKeyboardState).toHaveBeenCalledTimes(2);
    expect(driver.session.dismissKeyboard).toHaveBeenCalledTimes(2);
  });

  it('exposes native and webview context helpers through the device', async () => {
    const driver = createDriver('android', 'emulator-5554');
    driver.session.listContexts = vi.fn(async (): Promise<MobileContextInfo[]> => [
      { id: 'native', type: 'native', title: 'Native' },
      { id: 'webview_devtools_remote_42', type: 'webview', socket: 'webview_devtools_remote_42' }
    ]);
    driver.session.connectWebView = vi.fn(async (): Promise<WebViewEndpoint> => ({
      context: {
        id: 'webview_devtools_remote_42:page-1',
        type: 'webview',
        socket: 'webview_devtools_remote_42',
        pageId: 'page-1',
        url: 'https://webdriver.io/'
      },
      cdpUrl: 'http://127.0.0.1:9222'
    }));
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'android' });

    await expect(device.contexts()).resolves.toEqual([
      { id: 'native', type: 'native', title: 'Native' },
      { id: 'webview_devtools_remote_42', type: 'webview', socket: 'webview_devtools_remote_42' }
    ]);
    await expect(device.webViewEndpoint({ url: 'webdriver.io' })).resolves.toMatchObject({
      cdpUrl: 'http://127.0.0.1:9222',
      context: {
        type: 'webview'
      }
    });
    expect(driver.session.connectWebView).toHaveBeenCalledWith({ url: 'webdriver.io' });
  });

  it('exposes device file transfer helpers and screenshot saving', async () => {
    const driver = createDriver('android', 'emulator-5554');
    const runtime = new AsturRuntime().register(driver);
    const device = await runtime.createDevice({ platform: 'android' });
    const tempDir = await mkdtemp(join(tmpdir(), 'astur-runtime-'));
    const screenshotPath = join(tempDir, 'screen.png');

    driver.session.pullFile = vi.fn(async () => Buffer.from('remote-file'));
    driver.session.pushFile = vi.fn();
    driver.session.saveFile = vi.fn();
    driver.session.removeFile = vi.fn();
    driver.session.listFiles = vi.fn(async (): Promise<DeviceFileEntry[]> => [
      { name: 'report.txt', path: '/sdcard/Download/report.txt', type: 'file', size: 11 }
    ]);
    driver.session.screenshot = vi.fn(async () => Buffer.from('png'));

    try {
      await device.files.push('./local.txt', '/sdcard/Download/local.txt');
      await expect(device.files.pull('/sdcard/Download/report.txt')).resolves.toEqual(Buffer.from('remote-file'));
      await device.files.save('/sdcard/Download/report.txt', './report.txt');
      await device.files.remove('/sdcard/Download/report.txt');
      await expect(device.files.list('/sdcard/Download')).resolves.toEqual([
        { name: 'report.txt', path: '/sdcard/Download/report.txt', type: 'file', size: 11 }
      ]);
      await expect(device.screenshot({ path: screenshotPath })).resolves.toEqual(Buffer.from('png'));
      await expect(readFile(screenshotPath)).resolves.toEqual(Buffer.from('png'));

      expect(driver.session.pushFile).toHaveBeenCalledWith('./local.txt', '/sdcard/Download/local.txt');
      expect(driver.session.saveFile).toHaveBeenCalledWith('/sdcard/Download/report.txt', './report.txt');
      expect(driver.session.removeFile).toHaveBeenCalledWith('/sdcard/Download/report.txt');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when no driver is registered for the requested platform', async () => {
    const runtime = new AsturRuntime();

    await expect(runtime.createDevice({ platform: 'android' })).rejects.toMatchObject({
      code: 'DRIVER_NOT_REGISTERED'
    } satisfies Partial<AsturError>);
  });
});

function createDriver(platform: 'android' | 'ios', id: string): PlatformDriver & {
  device: DeviceInfo;
  session: PlatformSession;
  createSession: ReturnType<typeof vi.fn>;
} {
  const device: DeviceInfo = {
    id,
    name: id,
    platform,
    kind: platform === 'android' ? 'emulator' : 'simulator',
    state: platform === 'android' ? 'online' : 'shutdown'
  };
  const session: PlatformSession = {
    capabilities: {
      platform,
      device: {},
      timeout: 10_000,
      artifactsDir: 'test-results/astur',
      artifacts: {},
      keyboard: {
        dismiss: 'auto'
      },
      agent: {
        mode: 'auto',
        install: true,
        launchTimeout: 15_000,
        commandTimeout: 10_000
      }
    },
    deviceInfo: device,
    close: vi.fn(),
    isAppInstalled: vi.fn(async () => false),
    installApp: vi.fn(),
    uninstallApp: vi.fn(),
    launchApp: vi.fn(),
    terminateApp: vi.fn(),
    clearAppData: vi.fn(),
    clearAppCache: vi.fn(),
    grantPermission: vi.fn(),
    revokePermission: vi.fn(),
    resetApp: vi.fn(),
    lockDevice: vi.fn(),
    unlockDevice: vi.fn(),
    isDeviceLocked: vi.fn(async () => false),
    getTree: vi.fn(),
    tap: vi.fn(),
    doubleTap: vi.fn(),
    longPress: vi.fn(),
    fill: vi.fn(),
    pressKey: vi.fn(),
    swipe: vi.fn(),
    drag: vi.fn(),
    screenshot: vi.fn(),
    openWeb: vi.fn()
  };

  const createSession = vi.fn(async (capabilities) => {
    Object.assign(session, { capabilities });
    return session;
  });
  const doctor = vi.fn(async (): Promise<DoctorCheck[]> => [
    { id: `${platform}.doctor`, label: platform, status: 'pass', message: 'ok' }
  ]);

  return {
    platform,
    device,
    session,
    doctor,
    listDevices: vi.fn(async () => [device]),
    createSession
  };
}
