import { describe, expect, it, vi } from 'vitest';
import {
  attachFlutterNetwork,
  extractVmServiceUrls,
  toVmWebSocketUrl,
  IOS_NO_NETWORK_CAPABILITIES
} from '../packages/ios/src/flutterNetwork.js';

const LOG_SAMPLE = `
Filtering the log data using "eventMessage CONTAINS "Dart VM service""
2026-08-16 00:31:02.145 Db Runner: flutter: The Dart VM service is listening on http://127.0.0.1:60602/BxtkBhm0dRU=/
2026-08-16 00:44:18.902 Db Runner: flutter: The Dart VM service is listening on http://127.0.0.1:62241/Y6NCWP25paA=/
`;

describe('iOS Flutter VM service discovery', () => {
  it('converts the logged http URL into the websocket endpoint', () => {
    expect(toVmWebSocketUrl('http://127.0.0.1:60602/BxtkBhm0dRU=/')).toBe(
      'ws://127.0.0.1:60602/BxtkBhm0dRU=/ws'
    );
  });

  it('returns every logged URL, newest first', () => {
    // Newest first because the current app's service is the most recently
    // logged one; the older entries belong to runs that have since exited.
    expect(extractVmServiceUrls(LOG_SAMPLE)).toEqual([
      'http://127.0.0.1:62241/Y6NCWP25paA=/',
      'http://127.0.0.1:60602/BxtkBhm0dRU=/'
    ]);
  });

  it('de-duplicates a URL logged more than once', () => {
    const repeated = `${LOG_SAMPLE}\nagain http://127.0.0.1:62241/Y6NCWP25paA=/`;
    expect(extractVmServiceUrls(repeated)).toHaveLength(2);
  });

  it('finds nothing in a log with no VM service line', () => {
    expect(extractVmServiceUrls('nothing to see here')).toEqual([]);
  });

  it('reports no attachment when the log has no URL', async () => {
    // A release build logs no VM service. That is the normal case for most iOS
    // apps and must resolve to "unsupported", not an error.
    const runLogShow = vi.fn(async () => 'no urls in here');

    await expect(
      attachFlutterNetwork({ udid: 'SIM-1', runLogShow, discoveryTimeoutMs: 0 })
    ).resolves.toBeUndefined();

    expect(runLogShow).toHaveBeenCalled();
  });

  it('survives a log query that fails outright', async () => {
    const runLogShow = vi.fn(async () => {
      throw new Error('simctl unavailable');
    });

    await expect(
      attachFlutterNetwork({ udid: 'SIM-1', runLogShow, discoveryTimeoutMs: 0 })
    ).resolves.toBeUndefined();
  });
});

describe('iOS network capabilities when unsupported', () => {
  it('never claims observation it cannot deliver', () => {
    expect(IOS_NO_NETWORK_CAPABILITIES).toMatchObject({
      observe: false,
      intercept: false,
      responseBodies: false
    });
  });

  it('explains the likely reasons rather than just saying no', () => {
    // The coverage string is what a skipped test prints, so it has to be enough
    // to act on: which build types work, and which targets have no hook at all.
    const coverage = IOS_NO_NETWORK_CAPABILITIES.coverage;

    expect(coverage).toMatch(/debug Flutter build/i);
    expect(coverage).toMatch(/release/i);
    expect(coverage).toMatch(/React Native/i);
    expect(coverage).toMatch(/real device/i);
  });
});
