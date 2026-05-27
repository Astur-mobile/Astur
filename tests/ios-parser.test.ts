import { describe, expect, it } from 'vitest';
import { parseSimctlDevices } from '@astur/ios';

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
});
