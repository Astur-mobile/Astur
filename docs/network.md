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
| Flutter iOS (simulator) | **Yes** — Dart VM HTTP profiler | needs the in-app adapter |
| Flutter iOS (real device) | No — VM service not reachable from the host | needs the in-app adapter |
| React Native Android | **Yes** — CDP `Network` domain (debug build on Metro) | needs the in-app adapter |
| React Native iOS | **Yes** — CDP `Network` domain (debug build on Metro) | needs the in-app adapter |
| Native Android / iOS | No — no equivalent hook exists | needs the in-app adapter |

On Flutter the source is the Dart VM's `dart:io` HTTP profiler — the same one Flutter DevTools' Network view reads. It covers `dart:io`'s `HttpClient`, and therefore `package:http` and Dio, since both are built on it.

On React Native the source is the CDP `Network` domain that React Native DevTools reads. Because the reporter lives in `ReactCommon` — the shared C++ layer — one implementation covers Android and iOS identically.

Support is detected **at runtime**, by checking the isolate's registered extensions. It is never inferred from "this is a Flutter app" — which matters, because the same Flutter app can support it or not depending on how it was built.

### Flutter needs a debug or profile build

Observation reads the Dart VM service, and a **release (AOT) build does not have one** — there is nothing to attach to, on either platform. Debug and profile builds both publish it. This is not an Astur limitation and cannot be worked around from the outside:

- **Android** launches through the Flutter tool, so the debug requirement is already part of running the suite.
- **iOS simulator** needs nothing extra. A debug `.app` starts its VM service by itself and logs the URL, and on the simulator that URL is already on the host's loopback — so Astur attaches without changing how the app is installed, launched, or driven.
- **iOS real devices** keep the VM service on the device, behind a usbmuxd tunnel Astur does not open yet. Reported as unsupported rather than attempted.

### React Native needs a debug build on Metro

React Native's reporter is behind a compile-time `REACT_NATIVE_DEBUGGER_ENABLED` flag. In a release build the code is not present at all and `isDebuggingEnabled()` returns `false` — so, exactly as with Flutter's release AOT builds, there is nothing to attach to and no way to change that from outside the app.

What that requires in practice:

1. **Run a debug build.** `npx expo run:android`, `npx react-native run-android`, or the equivalent iOS command.
2. **Keep Metro running.** The app dials out to the dev server; Astur connects to that same server as an ordinary CDP client. It does **not** stand in for Metro, and needs no proxy, no certificate, and no change to how the app is launched or driven.
3. **Point Astur at the dev server** if it is not on the default `http://127.0.0.1:8081` — set `ASTUR_RN_DEV_SERVER`.

Astur matches the inspector target by application id — the package name on Android, the bundle id on iOS — so a dev server left running for a different project can never be mistaken for the app under test.

If your app was configured to run standalone in debug, two settings have to go back to their React Native defaults, and **both are debug-only, so release builds are byte-for-byte unaffected**:

```kotlin
// android/app/src/main/java/…/MainApplication.kt
ExpoReactHostFactory.getDefaultReactHost(
  context = applicationContext,
  useDevSupport = BuildConfig.DEBUG,  // not a hardcoded false
  …
)
```

```groovy
// android/app/build.gradle
react {
    debuggableVariants = ["debug"]   // not []
}
```

#### What React Native observation covers

Everything that goes through React Native's **`XMLHttpRequest`** — which is RN's own `fetch` polyfill, `axios`, and most HTTP libraries in the ecosystem, because they all bottom out there. Requests, responses, status, timing, headers, and response bodies all arrive.

One exclusion matters enough to call out: **Expo's native `fetch`**. From SDK 52 Expo installs its own `fetch` implementation as the global, written in native code, and it never touches React Native's networking module — so it emits no CDP events at all. If you are on Expo and want a call observed, reach for `XMLHttpRequest` or `axios` rather than the global `fetch`. This was measured against a live build, not inferred: the same request is invisible via `fetch` and fully reported via `XMLHttpRequest`.

As always, WebView requests, native SDK calls, and anything opening its own sockets stay invisible.

### Native apps

A plain Android or iOS app exposes no equivalent hook, so there is nothing to attach to. That case needs the in-app adapter (or a MITM proxy, which Astur deliberately does not ship — see [Interception](#interception-is-not-available-yet)).

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

The Flutter demo app's **Network lab** card on Home drives a loopback API it serves itself — real HTTP, no internet, deterministic:

```bash
cd examples
npm run test:android:flutter -- specs/network-observation.test.ts
```

The React Native demo app ships as a **release** build, so `capabilities().observe` is `false` there and the spec skips with its reason — which is the contract working, not a failure. Its Network lab card is also still a placeholder: it calls Expo's native `fetch` against a port nothing listens on, so it would be unobservable even in a debug build. Point the lab at a real endpoint through `XMLHttpRequest` to see the backend work against your own app.

See [Flutter & React Native](../frameworks/) for the framework-specific detail, and [Platform Limits](../platform-limits/) for the full boundary reference.
