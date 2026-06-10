import { describe, expect, it } from 'vitest';
import { parseDevicectlDevices, parseSimctlDevices, parseXcdeviceDevices } from '@astur-mobile/ios';

describe('iOS parser utilities', () => {
  it('normalizes available simulator devices from simctl JSON', () => {
    const devices = parseSimctlDevices(JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
          {
            name: 'iPhone 16 Pro',
            udid: 'A',
            state: 'Booted',
            isAvailable: true
          },
          {
            name: 'iPhone 15',
            udid: 'B',
            state: 'Shutdown',
            isAvailable: false
          }
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [
          {
            name: 'iPhone 17',
            udid: 'C',
            state: 'Creating',
            isAvailable: true
          }
        ]
      }
    }));

    expect(devices).toHaveLength(2);
    expect(devices.map((device) => [device.id, device.name, device.state, device.osVersion])).toEqual([
      ['A', 'iPhone 16 Pro', 'booted', '18.6'],
      ['C', 'iPhone 17', 'unknown', '26.1']
    ]);
    expect(devices.every((device) => device.platform === 'ios' && device.kind === 'simulator')).toBe(true);
  });

  it('normalizes connected real iOS devices from xcdevice JSON', () => {
    const devices = parseXcdeviceDevices(JSON.stringify([
      {
        simulator: false,
        available: true,
        platform: 'com.apple.platform.iphoneos',
        identifier: '00008030-000548220EF0802E',
        name: 'iPhone',
        modelName: 'iPhone 11 Pro Max',
        operatingSystemVersion: '26.5 (23F77)'
      },
      {
        simulator: false,
        available: true,
        platform: 'com.apple.platform.macosx',
        identifier: '00006040-000249AC1100801C',
        name: 'My Mac',
        modelName: 'MacBook Pro',
        operatingSystemVersion: '26.5 (25F71)'
      },
      {
        simulator: true,
        available: true,
        platform: 'com.apple.platform.iphonesimulator',
        identifier: 'SIM-1',
        name: 'iPhone 17 Pro',
        modelName: 'iPhone 17 Pro',
        operatingSystemVersion: '26.5 (23F77)'
      }
    ]));

    expect(devices).toEqual([
      {
        id: '00008030-000548220EF0802E',
        name: 'iPhone',
        platform: 'ios',
        kind: 'real',
        state: 'online',
        osVersion: '26.5',
        model: 'iPhone 11 Pro Max',
        raw: {
          simulator: false,
          available: true,
          platform: 'com.apple.platform.iphoneos',
          identifier: '00008030-000548220EF0802E',
          name: 'iPhone',
          modelName: 'iPhone 11 Pro Max',
          operatingSystemVersion: '26.5 (23F77)'
        }
      }
    ]);
  });

  it('normalizes connected real iOS devices from devicectl JSON', () => {
    const devices = parseDevicectlDevices({
      result: {
        devices: [
          {
            identifier: 'private-coredevice-id',
            connectionProperties: {
              pairingState: 'paired',
              transportType: 'wired'
            },
            deviceProperties: {
              bootState: 'booted',
              developerModeStatus: 'enabled',
              name: 'Amr iPhone',
              osVersionNumber: '26.5'
            },
            hardwareProperties: {
              marketingName: 'iPhone 11 Pro Max',
              platform: 'iOS',
              udid: '00008030-000548220EF0802E'
            }
          },
          {
            deviceProperties: {
              bootState: 'booted',
              name: 'Apple Watch'
            },
            hardwareProperties: {
              marketingName: 'Apple Watch',
              platform: 'watchOS',
              udid: 'WATCH-1'
            }
          },
          {
            connectionProperties: {
              pairingState: 'unpaired'
            },
            deviceProperties: {
              bootState: 'booted',
              name: 'Untrusted iPhone'
            },
            hardwareProperties: {
              marketingName: 'iPhone',
              platform: 'iOS',
              udid: 'UNTRUSTED-1'
            }
          }
        ]
      }
    });

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      id: '00008030-000548220EF0802E',
      name: 'Amr iPhone',
      platform: 'ios',
      kind: 'real',
      state: 'online',
      osVersion: '26.5',
      model: 'iPhone 11 Pro Max'
    });
    expect(devices[1]).toMatchObject({
      id: 'UNTRUSTED-1',
      name: 'Untrusted iPhone',
      platform: 'ios',
      kind: 'real',
      state: 'unauthorized'
    });
  });
});
