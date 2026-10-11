import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndroidDriver } from '@astur-mobile/android';
import { normalizeCapabilities, type DeviceInfo, type NativeAgentInfo } from '@astur-mobile/core';
import { createFakeAdb, type FakeAdb } from './support/fake-adb.js';

const DEVICE: DeviceInfo = { id: 'emulator-5554', name: 'Pixel 9', platform: 'android', kind: 'emulator', state: 'online' };
const INSTALLED = '/data/app/~~Cr8U2U4OM6F7==/com.astur.demo-QuzOTFwj==/base.apk';

describe('Android installed-build check', () => {
  let dir: string;
  let apk: string;
  let apkHash: string;
  let adb: FakeAdb | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'astur-apk-'));
    apk = join(dir, 'demo.apk');
    writeFileSync(apk, 'pretend this is an apk');
    apkHash = sha256(readFileSync(apk));
  });

  afterEach(() => {
    adb?.dispose();
    adb = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function sessionWith(responses: Array<[string, string]>) {
    adb = createFakeAdb(responses);
    const driver = createAndroidDriver({ adbPath: adb.path, emulatorPath: '__missing_emulator__' });
    vi.spyOn(driver, 'listDevices').mockResolvedValue([DEVICE]);
    return driver.createSession(normalizeCapabilities({ platform: 'android', device: { id: DEVICE.id }, agent: { mode: 'off' } }));
  }

  it('reports the same build when the installed APK hashes to the local one', async () => {
    const session = await sessionWith([
      ['pm path com.astur.demo', `package:${INSTALLED}`],
      ['sha256sum', `${apkHash}  ${INSTALLED}`]
    ]);

    await expect(session.isInstalledAppCurrent!('com.astur.demo', apk)).resolves.toBe(true);
  });

  it('reports a different build when the hashes differ, even at the same version', async () => {
    const session = await sessionWith([
      ['pm path com.astur.demo', `package:${INSTALLED}`],
      ['sha256sum', `${'0'.repeat(64)}  ${INSTALLED}`]
    ]);

    await expect(session.isInstalledAppCurrent!('com.astur.demo', apk)).resolves.toBe(false);
  });

  it('reports a missing app as not current', async () => {
    const session = await sessionWith([]);

    await expect(session.isInstalledAppCurrent!('com.astur.demo', apk)).resolves.toBe(false);
  });

  it('cannot tell for a split install, which no single APK matches', async () => {
    const session = await sessionWith([
      ['pm path com.astur.demo', `package:${INSTALLED}\npackage:/data/app/x/split_config.arm64_v8a.apk`]
    ]);

    await expect(session.isInstalledAppCurrent!('com.astur.demo', apk)).resolves.toBeUndefined();
  });

  it('cannot tell when the device has no sha256sum', async () => {
    const session = await sessionWith([
      ['pm path com.astur.demo', `package:${INSTALLED}`],
      ['sha256sum', '/system/bin/sh: sha256sum: inaccessible or not found']
    ]);

    await expect(session.isInstalledAppCurrent!('com.astur.demo', apk)).resolves.toBeUndefined();
  });
});

describe('Android app install', () => {
  let adb: FakeAdb | undefined;

  afterEach(() => {
    adb?.dispose();
    adb = undefined;
    vi.restoreAllMocks();
  });

  it('explains a signature clash instead of surfacing the raw adb failure', async () => {
    adb = createFakeAdb([[
      'install -r',
      'adb: failed to install demo.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.astur.demo signatures do not match newer version; ignoring!]',
      1
    ]]);
    const driver = createAndroidDriver({ adbPath: adb.path, emulatorPath: '__missing_emulator__' });
    vi.spyOn(driver, 'listDevices').mockResolvedValue([DEVICE]);
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: { id: DEVICE.id },
      agent: { mode: 'off' }
    }));

    await expect(session.installApp('demo.apk')).rejects.toMatchObject({
      code: 'ANDROID_APP_SIGNATURE_MISMATCH',
      message: expect.stringMatching(/com\.astur\.demo.*ASTUR_ANDROID_APP_FORCE_INSTALL=1/s)
    });
  });
});

describe('bundled Android agent install', () => {
  const assets = fileURLToPath(new URL('../packages/android/assets/agent/', import.meta.url));
  const appHash = sha256(readFileSync(join(assets, 'astur-android-agent-debug.apk')));
  const testHash = sha256(readFileSync(join(assets, 'astur-android-agent-debug-androidTest.apk')));
  const info: NativeAgentInfo = {
    id: 'astur-android-uiautomator',
    platform: 'android',
    version: '0.1.0-alpha.0',
    protocolVersion: 1,
    capabilities: ['agent.ping', 'tree.get']
  };
  let adb: FakeAdb | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  let previousHostPort: string | undefined;

  beforeEach(async () => {
    previousHostPort = process.env.ASTUR_ANDROID_AGENT_HOST_PORT;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      const { id, method } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: string; method: string };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id, ok: true, result: method === 'agent.ping' ? info : undefined }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    process.env.ASTUR_ANDROID_AGENT_HOST_PORT = String(typeof address === 'object' && address ? address.port : 0);
    closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    adb?.dispose();
    adb = undefined;
    await closeServer?.();
    if (previousHostPort === undefined) {
      delete process.env.ASTUR_ANDROID_AGENT_HOST_PORT;
    } else {
      process.env.ASTUR_ANDROID_AGENT_HOST_PORT = previousHostPort;
    }
    vi.restoreAllMocks();
  });

  async function startAgent(responses: Array<[string, string]>) {
    adb = createFakeAdb(responses);
    const driver = createAndroidDriver({ adbPath: adb.path, emulatorPath: '__missing_emulator__' });
    vi.spyOn(driver, 'listDevices').mockResolvedValue([DEVICE]);
    const session = await driver.createSession(normalizeCapabilities({
      platform: 'android',
      device: { id: DEVICE.id },
      agent: { mode: 'required', launchTimeout: 10_000, commandTimeout: 2_000 }
    }));
    await session.close();
    return adb.calls().filter((call) => / install /.test(` ${call} `));
  }

  it('reinstalls an agent left over from an older release', async () => {
    const installs = await startAgent([
      ['pm path dev.astur.agent.test', 'package:/data/app/t/base.apk'],
      ['pm path dev.astur.agent', 'package:/data/app/a/base.apk'],
      ['sha256sum /data/app/t/base.apk', `${'0'.repeat(64)}  /data/app/t/base.apk`],
      ['sha256sum /data/app/a/base.apk', `${appHash}  /data/app/a/base.apk`]
    ]);

    expect(installs).toHaveLength(2);
  });

  it('keeps an agent that is already the bundled build', async () => {
    const installs = await startAgent([
      ['pm path dev.astur.agent.test', 'package:/data/app/t/base.apk'],
      ['pm path dev.astur.agent', 'package:/data/app/a/base.apk'],
      ['sha256sum /data/app/t/base.apk', `${testHash}  /data/app/t/base.apk`],
      ['sha256sum /data/app/a/base.apk', `${appHash}  /data/app/a/base.apk`]
    ]);

    expect(installs).toEqual([]);
  });
});

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
