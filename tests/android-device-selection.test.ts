import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidDriver } from '@astur-mobile/android';
import { normalizeCapabilities, type DeviceInfo } from '@astur-mobile/core';
import { createFakeAdb, type FakeAdb } from './support/fake-adb.js';

const OTHER: DeviceInfo = { id: 'emulator-5554', name: 'Other', platform: 'android', kind: 'emulator', state: 'online' };
const TARGET: DeviceInfo = { id: 'emulator-5556', name: 'Pixel', platform: 'android', kind: 'emulator', state: 'online' };

describe('Android device selection by AVD', () => {
  let adb: FakeAdb | undefined;

  afterEach(() => {
    adb?.dispose();
    adb = undefined;
    vi.restoreAllMocks();
  });

  function driverWith(devices: DeviceInfo[]) {
    adb = createFakeAdb([
      ['emulator-5554 emu avd name', 'Other_AVD\nOK'],
      ['emulator-5556 emu avd name', 'Pixel_Target\nOK']
    ]);
    const driver = createAndroidDriver({ adbPath: adb.path, emulatorPath: '__missing_emulator__' });
    vi.spyOn(driver, 'listDevices').mockResolvedValue(devices);
    return driver;
  }

  it('opens the emulator running the configured AVD, not the first emulator online', async () => {
    const session = await driverWith([OTHER, TARGET]).createSession(normalizeCapabilities({
      platform: 'android',
      device: { avd: 'Pixel_Target', autoBoot: false },
      agent: { mode: 'off' }
    }));

    expect(session.deviceInfo.id).toBe(TARGET.id);
  });

  it('does not settle for another emulator when the configured AVD is not running', async () => {
    await expect(driverWith([OTHER]).createSession(normalizeCapabilities({
      platform: 'android',
      device: { avd: 'Pixel_Target', autoBoot: false },
      agent: { mode: 'off' }
    }))).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  it('names the device a selector means without opening a session', async () => {
    const driver = driverWith([OTHER, TARGET]);

    await expect(driver.findDevice({ avd: 'Pixel_Target' })).resolves.toEqual(TARGET);
    await expect(driver.findDevice({ avd: 'Missing_AVD' })).resolves.toBeUndefined();
    expect(adb!.calls().some((call) => / (install|instrument|force-stop) /.test(` ${call} `))).toBe(false);
  });
});
