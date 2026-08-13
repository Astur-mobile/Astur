import { describe, expect, it, vi } from 'vitest';
import { AsturDevice, normalizeCapabilities, type DeviceInfo, type PlatformSession } from '@astur-mobile/core';
import { quoteAndroidInputText } from '../packages/android/src/index.js';

const DEVICE: DeviceInfo = {
  id: 'device-1',
  name: 'Test device',
  platform: 'ios',
  kind: 'simulator',
  state: 'booted'
};

function makeDevice(overrides: Partial<PlatformSession>, platform: 'ios' | 'android' = 'ios'): AsturDevice {
  const session = {
    capabilities: normalizeCapabilities({ platform }),
    deviceInfo: { ...DEVICE, platform },
    ...overrides
  } as unknown as PlatformSession;
  return new AsturDevice(session);
}

describe('device.keyboard.type', () => {
  it('sends the text straight through to the session', async () => {
    const typeText = vi.fn(async () => undefined);
    await makeDevice({ typeText }).keyboard.type('123456');

    expect(typeText).toHaveBeenCalledWith('123456');
  });

  it('throws a clear error when the platform cannot type', async () => {
    // Better than silently doing nothing: a test that types into a control and
    // sees no change would otherwise fail somewhere far from the cause.
    await expect(makeDevice({}).keyboard.type('123456')).rejects.toMatchObject({
      code: 'KEYBOARD_NOT_SUPPORTED'
    });
  });

  it('does not swallow a driver failure', async () => {
    const device = makeDevice({
      typeText: async () => {
        throw new Error('KEYBOARD_NOT_VISIBLE');
      }
    });

    await expect(device.keyboard.type('1')).rejects.toThrow('KEYBOARD_NOT_VISIBLE');
  });
});

describe('android input text quoting', () => {
  it('encodes spaces so the shell cannot split the argument', () => {
    // `input text hello world` would type only "hello" — the shell hands
    // `input` two arguments and it ignores the second.
    expect(quoteAndroidInputText('hello world')).toBe("'hello%sworld'");
  });

  it('quotes a leading dash so it is not read as a flag', () => {
    expect(quoteAndroidInputText('-1234')).toBe("'-1234'");
  });

  it('escapes embedded single quotes', () => {
    expect(quoteAndroidInputText("it's")).toBe("'it'\\''s'");
  });

  it('leaves a plain OTP digit string untouched apart from quoting', () => {
    expect(quoteAndroidInputText('123456')).toBe("'123456'");
  });
});
