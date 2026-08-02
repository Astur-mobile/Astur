# Network Observation

See the HTTP traffic your app makes while a test drives it — what it called, what came back, how long it took.

## Why you want this

When a screen misbehaves, the interesting question is usually *"what did it actually ask the server for?"* Without an answer you fall back to reading app logs side by side with a test run and guessing at the correlation.

Concretely, it lets you:

- **Assert on the call, not just the pixels.** "Tapping Save posts to `/api/session` and gets a 201" is a much stronger statement than "a success toast appeared".
- **Catch the calls you did not expect** — a duplicated request, a retry storm, an analytics ping firing on every keystroke.
- **Debug a failure without a debugger.** A failed run tells you the request 404'd instead of leaving you to reproduce it by hand.
- **Keep secrets out of your reports.** Credential headers are redacted before a record is ever returned.

## What it covers, and what it does not

Astur reports **instrumented application traffic** — never "all device traffic". That distinction is the whole design, so it is worth stating plainly: a WebView's own requests, a native SDK's calls, and platform-channel traffic are invisible, and always will be, to this backend.

| Target | Observe | Intercept |
| --- | --- | --- |
| Flutter Android | **Yes** — Dart VM HTTP profiler | needs the in-app adapter |
| Flutter iOS | not yet (no Dart VM service on iOS) | needs the in-app adapter |
| React Native (Android + iOS) | not yet | needs the in-app adapter |

On Flutter Android the source is the Dart VM's `dart:io` HTTP profiler — the same one Flutter DevTools' Network view reads. It covers `dart:io`'s `HttpClient`, and therefore `package:http` and Dio, since both are built on it.

Support is detected **at runtime**, by checking the isolate's registered extensions. It is never inferred from "this is a Flutter app".

## How to use it

Always ask before you assert. `capabilities()` answers on every platform, so a spec stays portable:

```ts
import { expect, test } from './fixtures.js';

test('login posts credentials', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, capabilities.coverage);

  await device.network.clear();
  await app.login.signIn('qa@astur.dev', 'Astur12345');

  const [request] = await device.network.requests({ url: '/api/session' });
  expect(request).toMatchObject({ method: 'POST', status: 201 });
  expect(request.durationMs).toBeLessThan(2_000);
});
```

`test.skip()` with `capabilities.coverage` means an unsupported platform reports *why* it skipped, instead of quietly passing.

### The API

```ts
// What can this session actually see?
const capabilities = await device.network.capabilities();
// { observe, intercept, transports, responseBodies, coverage, adapterRequired }

// Everything captured so far, newest last.
const all = await device.network.requests();

// Filter by url (substring or regex), method, or transport.
const posts = await device.network.requests({ url: /\/api\//, method: 'POST' });

// Start a fresh capture window mid-test.
await device.network.clear();
```

A record carries `method`, `url`, `status`, `requestHeaders`, `responseHeaders`, `startedAt`, `durationMs`, and `error` when the exchange failed before completing.

### Defaults you can rely on

- **Credential headers are redacted.** `authorization`, `cookie`, `set-cookie`, and `x-api-key` become `<redacted>` before the record reaches you — captured traffic ends up in CI logs and HTML reports.
- **Bodies are capped** at 64 KiB, dropped with `bodyOmittedReason: 'too-large'`, so a long run cannot accumulate megabytes of payload.
- **The buffer clears between tests**, so one test can never assert on another's traffic.

Override per call when you need to:

```ts
await device.network.requests({ url: '/api' }, {
  maxBodyBytes: 4096,
  redactHeaders: ['x-tenant-token']
});
```

### An empty list means "no traffic"

Where observation is unavailable, `requests()` **throws** `NETWORK_OBSERVATION_UNSUPPORTED` rather than returning `[]`. An empty array has to mean "nothing was requested" — otherwise `expect(requests).toHaveLength(0)` would pass on every platform that simply cannot see.

## Interception is not available yet

`capabilities().intercept` is `false` everywhere, and `adapterRequired` explains why. Stubbing, delaying, or failing a request means holding it open; a profiler only reports what already happened.

That needs a small, opt-in in-app adapter — the next phase. Astur deliberately does **not** ship a MITM proxy to fake it:

- Android 7+ ignores user-installed CAs unless the app opts in via `network_security_config`.
- Dart's `HttpClient` ignores the system proxy entirely unless the app sets `findProxy`.

So a proxy needs app changes *anyway*, while adding certificate expiry and TLS failures as new ways for unrelated tests to break. An explicit adapter is the honest version of the same requirement.

## Try it

The demo app's **Network lab** card on Home drives a loopback API it serves itself — real HTTP, no internet, deterministic:

```bash
cd examples
npm run test:android:flutter -- specs/network-observation.test.ts
```

See [Flutter & React Native](./frameworks/) for the framework-specific detail, and [Platform Limits](./platform-limits/) for the full boundary reference.
