import type {
  NetworkCapabilities,
  NetworkRedactionOptions,
  NetworkRequestFilter,
  NetworkRequestRecord
} from '@astur-mobile/protocol';

/**
 * Network observation for Flutter Android, backed by the Dart VM service's
 * `dart:io` HTTP profiler — the same source Flutter DevTools' Network view uses.
 *
 * Coverage is exactly `dart:io`'s HttpClient: that includes `package:http` and
 * Dio's IO path, because both are built on it. It does NOT include a WebView's
 * own requests, native SDKs, platform channels, or any client that opens its
 * own sockets. Callers should read {@link capabilities} rather than assume.
 *
 * Read-only by design. Interception needs an in-app adapter that can hold a
 * request open, which the profiler cannot do — it reports what already
 * happened.
 */

export const DEFAULT_REDACTED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];

/** 64 KiB. Enough for a JSON payload, small enough that a long run cannot blow up. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export const FLUTTER_NETWORK_CAPABILITIES: NetworkCapabilities = {
  observe: true,
  intercept: false,
  transports: ['http'],
  responseBodies: true,
  coverage: "dart:io HttpClient traffic (package:http and Dio included); excludes WebView, native SDK, and platform-channel requests",
  adapterRequired: true
};

/** Case-insensitive header redaction, applied before a record is ever returned. */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
  redact: string[]
): Record<string, string> {
  const lowered = new Set(redact.map((name) => name.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    out[key] = lowered.has(key.toLowerCase())
      ? '<redacted>'
      : Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

/** Keeps a body only when it is within budget, and says why when it is not. */
export function applyBodyLimit(
  body: string | undefined,
  maxBytes: number
): Pick<NetworkRequestRecord, 'responseBody' | 'bodyOmittedReason'> {
  if (body === undefined) {
    return { bodyOmittedReason: 'not-captured' };
  }
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    return { bodyOmittedReason: 'too-large' };
  }
  return { responseBody: body };
}

/**
 * Maps the VM profiler's payload onto {@link NetworkRequestRecord}.
 *
 * Every field is read defensively: the Dart SDK owns this shape and has moved
 * fields between versions, so a missing key must degrade one record rather than
 * throw and lose the whole batch.
 */
export function toNetworkRecords(
  profile: unknown,
  options: Required<NetworkRedactionOptions>
): NetworkRequestRecord[] {
  const requests = (profile as { requests?: unknown[] } | undefined)?.requests;
  if (!Array.isArray(requests)) {
    return [];
  }

  return requests.flatMap((entry): NetworkRequestRecord[] => {
    // Guard the entry itself, not just its fields: a null/non-object row would
    // otherwise throw and take every other record in the batch with it.
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    const id = row.id === undefined ? undefined : String(row.id);
    const uri = typeof row.uri === 'string' ? row.uri : undefined;
    if (!id || !uri) {
      return [];
    }

    const request = (row.request ?? {}) as Record<string, unknown>;
    const response = (row.response ?? {}) as Record<string, unknown>;
    const startedMicros = Number(row.startTime ?? 0);
    const endMicros = Number(row.endTime ?? 0);

    const errorText = typeof request.error === 'string'
      ? request.error
      : typeof row.error === 'string' ? row.error : undefined;

    return [{
      id,
      transport: 'http',
      method: typeof row.method === 'string' ? row.method.toUpperCase() : 'GET',
      url: uri,
      requestHeaders: redactHeaders(request.headers as Record<string, unknown>, options.redactHeaders),
      ...(response.headers
        ? { responseHeaders: redactHeaders(response.headers as Record<string, unknown>, options.redactHeaders) }
        : {}),
      ...(response.statusCode === undefined ? {} : { status: Number(response.statusCode) }),
      // The VM reports microseconds since epoch; the public contract is ms.
      startedAt: Math.round(startedMicros / 1000),
      ...(endMicros > startedMicros ? { durationMs: Math.round((endMicros - startedMicros) / 1000) } : {}),
      ...(errorText ? { error: errorText } : {})
    }];
  });
}

/** Applies a {@link NetworkRequestFilter} to already-collected records. */
export function filterRecords(
  records: NetworkRequestRecord[],
  filter: NetworkRequestFilter | undefined
): NetworkRequestRecord[] {
  if (!filter) {
    return records;
  }
  return records.filter((record) => {
    if (filter.method && record.method.toUpperCase() !== filter.method.toUpperCase()) {
      return false;
    }
    if (filter.transport && record.transport !== filter.transport) {
      return false;
    }
    if (filter.url instanceof RegExp) {
      return filter.url.test(record.url);
    }
    if (typeof filter.url === 'string') {
      return record.url.includes(filter.url);
    }
    return true;
  });
}

export function resolveRedactionOptions(
  options: NetworkRedactionOptions | undefined
): Required<NetworkRedactionOptions> {
  return {
    redactHeaders: options?.redactHeaders ?? DEFAULT_REDACTED_HEADERS,
    maxBodyBytes: options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  };
}
