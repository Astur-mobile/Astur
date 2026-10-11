import type { WorkerInfo } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import type { AsturConfig, DeviceInfo } from '@astur-mobile/core';
import { acquireDeviceReservation, type DeviceDirectory } from '../packages/test/src/reservation.js';

// Serials no real device uses, so these locks never meet a live run's.
const SERIAL = `emulator-test-${process.pid}`;
const OTHER_SERIAL = `emulator-test-${process.pid}-b`;

function worker(workerIndex: number): WorkerInfo {
  return { workerIndex, project: { name: 'reservation-test' } } as unknown as WorkerInfo;
}

function directory(resolved: DeviceInfo | undefined): DeviceDirectory {
  return {
    listDevices: async () => (resolved ? [resolved] : []),
    findDevice: async () => resolved
  };
}

const emulator: DeviceInfo = { id: SERIAL, name: 'Pixel', platform: 'android', kind: 'emulator', state: 'online' };

describe('device reservation', () => {
  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(releases.splice(0).map((release) => release()));
  });

  it('treats an id and an AVD that name the same emulator as one device', async () => {
    const byId: AsturConfig = { platform: 'android', device: { id: SERIAL } };
    const byAvd: AsturConfig = { platform: 'android', device: { avd: 'Pixel_Test' } };

    const first = await acquireDeviceReservation(byId, directory(emulator), worker(0));
    releases.push(first.release);

    await expect(acquireDeviceReservation(byAvd, directory(emulator), worker(1)))
      .rejects.toThrow(/could not reserve/);
  });

  it('pins the reserved device so the session opens that same device', async () => {
    const byAvd: AsturConfig = { platform: 'android', device: { avd: 'Pixel_Test' } };

    const reservation = await acquireDeviceReservation(byAvd, directory(emulator), worker(0));
    releases.push(reservation.release);

    expect(reservation.config.device).toEqual({ avd: 'Pixel_Test', id: SERIAL });
  });

  it('locks a device that was booted for the session once its serial is known', async () => {
    const byAvd: AsturConfig = { platform: 'android', device: { avd: 'Pixel_Test_Offline' } };
    const holder = await acquireDeviceReservation(
      { platform: 'android', device: { id: OTHER_SERIAL } },
      directory(undefined),
      worker(1)
    );
    releases.push(holder.release);

    const reservation = await acquireDeviceReservation(byAvd, directory(undefined), worker(0));
    releases.push(reservation.release);

    await expect(reservation.claimDevice(OTHER_SERIAL)).rejects.toThrow(/already reserved/);
  });
});
