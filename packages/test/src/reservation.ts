import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerInfo } from '@playwright/test';
import type { AsturConfig, DeviceInfo, DeviceSelector } from '@astur-mobile/core';

/**
 * Cross-process device locks: a native device runs one automation session at
 * a time, and Playwright workers are separate processes.
 */

export function pathSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/** What reservation needs from the runtime: the devices, and which one a config means. */
export interface DeviceDirectory {
  listDevices(platform?: AsturConfig['platform']): Promise<DeviceInfo[]>;
  findDevice(config: AsturConfig): Promise<DeviceInfo | undefined>;
}

export interface DeviceReservation {
  config: AsturConfig;
  /**
   * Also locks the device the session actually opened, when that was not
   * known up front (an emulator booted for this session). Throws when another
   * worker holds it.
   */
  claimDevice(id: string): Promise<void>;
  release(): Promise<void>;
}

export async function acquireDeviceReservation(
  astur: AsturConfig,
  devices: DeviceDirectory,
  workerInfo: WorkerInfo
): Promise<DeviceReservation> {
  const candidates = await deviceReservationCandidates(astur, devices, workerInfo);
  const blockedKeys: string[] = [];

  for (const candidate of candidates) {
    const release = await tryAcquireDeviceReservation(candidate, workerInfo);
    if (release) {
      return trackReservation(candidate, release, workerInfo);
    }

    blockedKeys.push(deviceReservationKey(candidate));
  }

  const keyList = blockedKeys.length > 0 ? blockedKeys.join(', ') : deviceReservationKey(astur);
  throw new Error(
    [
      `Astur could not reserve an available mobile device for ${astur.platform}.`,
      `Checked: ${keyList}.`,
      'Native mobile devices can run only one active app automation session at a time.',
      'Use one Playwright project per physical device, or leave device.id unset so Astur can choose a free matching device from the pool.',
      `Current project: ${workerInfo.project.name || 'default'}, worker: ${workerInfo.workerIndex}.`
    ].join(' ')
  );
}

function trackReservation(
  config: AsturConfig,
  release: () => Promise<void>,
  workerInfo: WorkerInfo
): DeviceReservation {
  const releases = [release];

  return {
    config,
    async claimDevice(id) {
      if (config.device?.id === id) {
        return;
      }

      const byId: AsturConfig = { ...config, device: { ...config.device, id } };
      const releaseId = await tryAcquireDeviceReservation(byId, workerInfo);
      if (!releaseId) {
        throw new Error(
          `Astur opened ${deviceReservationKey(byId)}, but it is already reserved by another worker. ` +
          'Two configurations select the same device; give each worker its own device.'
        );
      }
      releases.push(releaseId);
    },
    async release() {
      await Promise.all(releases.map((releaseOne) => releaseOne()));
    }
  };
}

async function tryAcquireDeviceReservation(astur: AsturConfig, workerInfo: WorkerInfo): Promise<(() => Promise<void>) | undefined> {
  const key = deviceReservationKey(astur);
  const root = join(tmpdir(), 'astur-device-locks');
  const lockDir = join(root, pathSafeName(key));
  const ownerPath = join(lockDir, 'owner.json');

  await mkdir(root, { recursive: true });

  try {
    await mkdir(lockDir);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const owner = await readReservationOwner(ownerPath);
    if (owner?.pid && !isProcessAlive(owner.pid)) {
      await rm(lockDir, { recursive: true, force: true });
      await mkdir(lockDir);
    } else {
      return undefined;
    }
  }

  await writeFile(ownerPath, JSON.stringify({
    key,
    pid: process.pid,
    projectName: workerInfo.project.name || 'default',
    workerIndex: workerInfo.workerIndex,
    createdAt: new Date().toISOString()
  }, null, 2));

  return async () => {
    await rm(lockDir, { recursive: true, force: true });
  };
}

async function deviceReservationCandidates(
  astur: AsturConfig,
  directory: DeviceDirectory,
  workerInfo: WorkerInfo
): Promise<AsturConfig[]> {
  if (!usesLooseDeviceSelector(astur.device)) {
    // Lock the device itself, not the words used to pick it: an id, an AVD,
    // and a name can all select the same emulator. Pinning the id also keeps
    // the session from opening a different device than the one reserved.
    const resolved = await directory.findDevice(astur).catch(() => undefined);
    return [resolved ? { ...astur, device: { ...astur.device, id: resolved.id } } : astur];
  }

  const devices = (await directory.listDevices(astur.platform))
    .filter((device) => matchesDeviceSelector(device, astur.device))
    .filter(isReservableDevice)
    .sort(compareDeviceInfo);

  if (devices.length === 0) {
    return [astur];
  }

  const start = workerInfo.workerIndex % devices.length;
  const ordered = [...devices.slice(start), ...devices.slice(0, start)];

  return ordered.map((device) => ({
    ...astur,
    device: {
      ...astur.device,
      id: device.id,
      kind: device.kind
    }
  }));
}

function usesLooseDeviceSelector(selector: DeviceSelector | undefined): boolean {
  return !selector?.id && !selector?.name && !selector?.avd && !selector?.cloud;
}

function matchesDeviceSelector(device: DeviceInfo, selector: DeviceSelector | undefined): boolean {
  if (selector?.kind && device.kind !== selector.kind) {
    return false;
  }

  return true;
}

function isReservableDevice(device: DeviceInfo): boolean {
  return device.state === 'online' || device.state === 'booted';
}

function compareDeviceInfo(left: DeviceInfo, right: DeviceInfo): number {
  return `${left.platform}:${left.kind}:${left.name}:${left.id}`
    .localeCompare(`${right.platform}:${right.kind}:${right.name}:${right.id}`);
}

function deviceReservationKey(astur: AsturConfig): string {
  const device = astur.device ?? {};
  const selector = device.id
    ? `id=${device.id}`
    : device.avd
      ? `avd=${device.avd}`
      : device.name
        ? `name=${String(device.name)}`
        : device.kind
          ? `kind=${device.kind}`
          : 'auto';

  return `${astur.platform}:${selector}`;
}

async function readReservationOwner(path: string): Promise<{
  pid?: number;
  projectName?: string;
  workerIndex?: number;
} | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as {
      pid?: number;
      projectName?: string;
      workerIndex?: number;
    };
  } catch {
    return undefined;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
