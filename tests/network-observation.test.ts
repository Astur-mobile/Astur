import { describe, expect, it } from 'vitest';
import { AsturDevice, filterNetworkRecords, type PlatformSession } from '@astur-mobile/core';
import { normalizeCapabilities, type DeviceInfo, type NetworkRequestRecord } from '@astur-mobile/core';
import {
  applyBodyLimit,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_REDACTED_HEADERS,
  redactHeaders,
  resolveRedactionOptions,
  toNetworkRecords
} from '../packages/android/src/flutter/network.js';

const DEVICE: DeviceInfo = {
  id: 'emulator-5554',
  name: 'Pixel 9',
  platform: 'android',
  kind: 'emulator',
  state: 'online'
};

/** Minimal session; each test supplies only the network hooks it exercises. */
function makeDevice(overrides: Partial<PlatformSession>): AsturDevice {
  const session = {
    capabilities: normalizeCapabilities({ platform: 'android' }),
    deviceInfo: DEVICE,
    ...overrides
  } as unknown as PlatformSession;
  return new AsturDevice(session);
}

describe('network record mapping', () => {
  const options = resolveRedactionOptions(undefined);

  it('maps a completed exchange and converts VM microseconds to milliseconds', () => {
    const [record] = toNetworkRecords({
      requests: [{
        id: '7',
        uri: 'https://api.astur.dev/session',
        method: 'post',
        startTime: 5_000_000,
        endTime: 5_250_000,
        request: { headers: { 'content-type': 'application/json' } },
        response: { statusCode: 201, headers: { server: 'astur' } }
      }]
    }, options);

    expect(record).toMatchObject({
      id: '7',
      transport: 'http',
      // Normalised: the VM reports whatever case the caller used.
      method: 'POST',
      url: 'https://api.astur.dev/session',
      status: 201,
      startedAt: 5_000,
      durationMs: 250
    });
  });

  it('keeps an in-flight request but omits duration and status', () => {
    const [record] = toNetworkRecords({
      requests: [{ id: '1', uri: 'https://api.astur.dev/slow', method: 'get', startTime: 1_000_000, request: {} }]
    }, options);

    expect(record.status).toBeUndefined();
    expect(record.durationMs).toBeUndefined();
    expect(record.startedAt).toBe(1_000);
  });

  it('surfaces a transport error', () => {
    const [record] = toNetworkRecords({
      requests: [{ id: '2', uri: 'https://nope.invalid/x', method: 'get', startTime: 0, request: { error: 'Failed host lookup' } }]
    }, options);

    expect(record.error).toBe('Failed host lookup');
  });

  it('drops unusable rows instead of throwing, so one bad entry cannot lose the batch', () => {
    // The Dart SDK owns this schema and has moved fields between versions.
    const records = toNetworkRecords({
      requests: [
        { id: '1' },                                   // no uri
        { uri: 'https://api.astur.dev/a' },            // no id
        null,
        { id: '3', uri: 'https://api.astur.dev/ok', method: 'get', startTime: 0, request: {} }
      ]
    }, options);

    expect(records.map((r) => r.id)).toEqual(['3']);
  });

  it('returns nothing for a payload with no requests array', () => {
    expect(toNetworkRecords(undefined, options)).toEqual([]);
    expect(toNetworkRecords({}, options)).toEqual([]);
  });
});

describe('redaction', () => {
  it('redacts credential headers by default, case-insensitively', () => {
    const headers = redactHeaders(
      { Authorization: 'Bearer secret', 'Set-Cookie': 'sid=abc', 'content-type': 'application/json' },
      DEFAULT_REDACTED_HEADERS
    );

    expect(headers.Authorization).toBe('<redacted>');
    expect(headers['Set-Cookie']).toBe('<redacted>');
    // Non-sensitive headers must survive — redaction should not blind debugging.
    expect(headers['content-type']).toBe('application/json');
  });

  it('joins multi-value headers rather than stringifying an array', () => {
    expect(redactHeaders({ accept: ['a', 'b'] }, []).accept).toBe('a, b');
  });

  it('applies redaction while mapping, so a raw secret never reaches a record', () => {
    const [record] = toNetworkRecords({
      requests: [{
        id: '1',
        uri: 'https://api.astur.dev/me',
        method: 'get',
        startTime: 0,
        request: { headers: { authorization: 'Bearer super-secret' } }
      }]
    }, resolveRedactionOptions(undefined));

    expect(JSON.stringify(record)).not.toContain('super-secret');
  });
});

describe('body limits', () => {
  it('keeps a body within budget', () => {
    expect(applyBodyLimit('{"ok":true}', DEFAULT_MAX_BODY_BYTES)).toEqual({ responseBody: '{"ok":true}' });
  });

  it('drops an oversized body and says why', () => {
    const huge = 'x'.repeat(DEFAULT_MAX_BODY_BYTES + 1);
    expect(applyBodyLimit(huge, DEFAULT_MAX_BODY_BYTES)).toEqual({ bodyOmittedReason: 'too-large' });
  });

  it('measures bytes, not characters, so multi-byte payloads cannot slip past', () => {
    // 'é' is two bytes in UTF-8: 3 chars but 6 bytes.
    expect(applyBodyLimit('ééé', 5)).toEqual({ bodyOmittedReason: 'too-large' });
    expect(applyBodyLimit('ééé', 6)).toEqual({ responseBody: 'ééé' });
  });

  it('marks a missing body as not-captured rather than empty', () => {
    expect(applyBodyLimit(undefined, DEFAULT_MAX_BODY_BYTES)).toEqual({ bodyOmittedReason: 'not-captured' });
  });
});

describe('filtering', () => {
  const records = [
    { id: '1', transport: 'http', method: 'GET', url: 'https://api.astur.dev/users', requestHeaders: {}, startedAt: 0 },
    { id: '2', transport: 'http', method: 'POST', url: 'https://api.astur.dev/session', requestHeaders: {}, startedAt: 0 },
    { id: '3', transport: 'websocket', method: 'GET', url: 'wss://api.astur.dev/live', requestHeaders: {}, startedAt: 0 }
  ] as NetworkRequestRecord[];

  it('matches a url substring', () => {
    expect(filterNetworkRecords(records, { url: '/session' }).map((r) => r.id)).toEqual(['2']);
  });

  it('matches a url regex', () => {
    expect(filterNetworkRecords(records, { url: /\/(users|session)$/ }).map((r) => r.id)).toEqual(['1', '2']);
  });

  it('matches method case-insensitively', () => {
    expect(filterNetworkRecords(records, { method: 'post' }).map((r) => r.id)).toEqual(['2']);
  });

  it('matches transport', () => {
    expect(filterNetworkRecords(records, { transport: 'websocket' }).map((r) => r.id)).toEqual(['3']);
  });

  it('combines criteria', () => {
    expect(filterNetworkRecords(records, { url: 'astur.dev', method: 'GET', transport: 'http' }).map((r) => r.id))
      .toEqual(['1']);
  });

  it('returns everything with no filter', () => {
    expect(filterNetworkRecords(records, undefined)).toHaveLength(3);
  });
});

describe('device.network capability gating', () => {
  it('reports observe:false when the session has no network backend', async () => {
    const capabilities = await makeDevice({}).network.capabilities();

    expect(capabilities.observe).toBe(false);
    expect(capabilities.intercept).toBe(false);
    expect(capabilities.transports).toEqual([]);
  });

  it('throws instead of returning an empty list when observation is unsupported', async () => {
    // This is the whole point of the error: [] has to mean "no traffic
    // happened", never "this platform cannot see traffic" — otherwise an
    // assertion on an empty list passes for the wrong reason.
    await expect(makeDevice({}).network.requests()).rejects.toMatchObject({
      code: 'NETWORK_OBSERVATION_UNSUPPORTED'
    });
  });

  it('never reports intercept:true while no adapter exists', async () => {
    const capabilities = await makeDevice({
      getNetworkCapabilities: async () => ({
        observe: true,
        intercept: false,
        transports: ['http'],
        responseBodies: true,
        coverage: 'dart:io HttpClient traffic',
        adapterRequired: true
      })
    }).network.capabilities();

    expect(capabilities.intercept).toBe(false);
    expect(capabilities.adapterRequired).toBe(true);
  });

  it('passes the filter through to collected records', async () => {
    const device = makeDevice({
      getNetworkRequests: async () => ([
        { id: '1', transport: 'http', method: 'GET', url: 'https://api.astur.dev/a', requestHeaders: {}, startedAt: 0 },
        { id: '2', transport: 'http', method: 'GET', url: 'https://api.astur.dev/b', requestHeaders: {}, startedAt: 0 }
      ] as NetworkRequestRecord[])
    });

    expect((await device.network.requests({ url: '/b' })).map((r) => r.id)).toEqual(['2']);
  });

  it('clear() is a no-op when the session cannot clear', async () => {
    await expect(makeDevice({}).network.clear()).resolves.toBeUndefined();
  });
});
