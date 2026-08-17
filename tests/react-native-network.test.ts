import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listInspectorTargets,
  selectInspectorTarget,
  REACT_NATIVE_NETWORK_CAPABILITIES,
  DEFAULT_METRO_URL
} from '../packages/core/src/reactNative/network.js';

const TARGETS = [
  { appId: 'com.other.app', webSocketDebuggerUrl: 'ws://127.0.0.1:8081/inspector/debug?device=a&page=1' },
  { appId: 'com.astur.demo', webSocketDebuggerUrl: 'ws://127.0.0.1:8081/inspector/debug?device=b&page=1' },
  { appId: 'com.astur.demo', webSocketDebuggerUrl: 'ws://127.0.0.1:8081/inspector/debug?device=c&page=1' }
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('React Native inspector target selection', () => {
  it('picks the newest target for the app under test', () => {
    // Newest last: a relaunch leaves the previous page listed for a moment, and
    // the live one is the one just registered.
    expect(selectInspectorTarget(TARGETS, 'com.astur.demo')?.webSocketDebuggerUrl)
      .toContain('device=c');
  });

  it('returns nothing when no target matches the app id', () => {
    // Never fall back to "some other app's target". A dev server left running
    // for a different project would otherwise report its traffic as ours, and a
    // wrong answer is worse than an unsupported one.
    expect(selectInspectorTarget(TARGETS, 'com.astur.absent')).toBeUndefined();
  });

  it('falls back to the newest target only when the app id is unknown', () => {
    expect(selectInspectorTarget(TARGETS)?.webSocketDebuggerUrl).toContain('device=c');
  });

  it('ignores targets that advertise no debugger socket', () => {
    expect(selectInspectorTarget([{ appId: 'com.astur.demo' }], 'com.astur.demo')).toBeUndefined();
  });

  it('handles an empty list', () => {
    expect(selectInspectorTarget([], 'com.astur.demo')).toBeUndefined();
  });
});

describe('React Native inspector discovery', () => {
  it('reports no targets when the dev server is not running', async () => {
    // "No dev server" is the normal case for a release build, so it has to read
    // as unsupported rather than throw and fail the test that asked.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await listInspectorTargets(DEFAULT_METRO_URL)).toEqual([]);
  });

  it('reports no targets when the dev server answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await listInspectorTargets(DEFAULT_METRO_URL)).toEqual([]);
  });

  it('reports no targets when the payload is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await listInspectorTargets(DEFAULT_METRO_URL)).toEqual([]);
  });

  it('returns the dev server list as-is', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => TARGETS }));
    expect(await listInspectorTargets(DEFAULT_METRO_URL)).toHaveLength(3);
  });
});

describe('React Native network capabilities', () => {
  it('observes but cannot intercept', () => {
    // Interception needs something that can hold a request open; the CDP
    // reporter only says what already happened.
    expect(REACT_NATIVE_NETWORK_CAPABILITIES.observe).toBe(true);
    expect(REACT_NATIVE_NETWORK_CAPABILITIES.intercept).toBe(false);
    expect(REACT_NATIVE_NETWORK_CAPABILITIES.responseBodies).toBe(true);
  });

  it('states the two boundaries a caller will actually trip over', () => {
    // Both were measured against a live build: Expo's native fetch bypasses
    // React Native's networking module entirely, and the reporter is compiled
    // out of release builds.
    expect(REACT_NATIVE_NETWORK_CAPABILITIES.coverage).toMatch(/Expo's native fetch/);
    expect(REACT_NATIVE_NETWORK_CAPABILITIES.coverage).toMatch(/debug build/);
  });
});
