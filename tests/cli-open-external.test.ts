import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

import { openExternal } from '../packages/cli/src/openExternal.js';

class FakeChild extends EventEmitter {
  unref = vi.fn();
}

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('openExternal', () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it('uses `open` on macOS', () => {
    spawnMock.mockReturnValue(new FakeChild());

    withPlatform('darwin', () => {
      expect(openExternal('http://localhost:63396')).toBe(true);
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['http://localhost:63396'],
      { detached: true, stdio: 'ignore' }
    );
  });

  it('routes through `cmd /c start ""` on Windows — `start` is a shell built-in, not an executable', () => {
    spawnMock.mockReturnValue(new FakeChild());

    withPlatform('win32', () => {
      expect(openExternal('http://localhost:63396')).toBe(true);
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '', 'http://localhost:63396'],
      { detached: true, stdio: 'ignore' }
    );
  });

  it('uses `xdg-open` on Linux', () => {
    spawnMock.mockReturnValue(new FakeChild());

    withPlatform('linux', () => {
      expect(openExternal('http://localhost:1234')).toBe(true);
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'xdg-open',
      ['http://localhost:1234'],
      { detached: true, stdio: 'ignore' }
    );
  });

  it('survives an async spawn ENOENT instead of crashing the process', () => {
    // This is the exact Windows failure mode from the field reports: spawn()
    // returns a child, then an ENOENT arrives as an async 'error' event. With
    // no listener attached Node throws an unhandled 'error' event and the CLI
    // dies AFTER the inspector server is already live.
    const child = new FakeChild();
    spawnMock.mockReturnValue(child);

    withPlatform('linux', () => {
      expect(openExternal('http://localhost:9999')).toBe(true);
    });

    expect(child.listenerCount('error')).toBeGreaterThan(0);
    // Emitting the error must not throw anywhere.
    expect(() => child.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }))).not.toThrow();
    expect(child.unref).toHaveBeenCalled();
  });

  it('returns false when spawn throws synchronously', () => {
    spawnMock.mockImplementation(() => {
      throw new Error('EPERM');
    });

    withPlatform('darwin', () => {
      expect(openExternal('http://localhost:1')).toBe(false);
    });
  });
});
