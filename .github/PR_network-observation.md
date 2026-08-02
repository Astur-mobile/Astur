# feat: network observation, plus the Flutter reliability fixes it uncovered

Closes the network-observation issue.

Adds `device.network` for observing app HTTP traffic, and fixes the Flutter
session bugs that surfaced while building it — several of which were failing
whole runs already.

## What you get

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.networkLab.getProfile();

const [request] = await device.network.requests({ url: '/api/profile' });
expect(request).toMatchObject({ method: 'GET', status: 200 });
```

Available on **Flutter Android** via the Dart VM's `dart:io` HTTP profiler — the
same source Flutter DevTools' Network view uses. Coverage is **instrumented
application traffic, never "all device traffic"**: it sees `dart:io`'s
`HttpClient` (so `package:http` and Dio), not WebView, native SDK, or
platform-channel requests. Support is detected at runtime from the isolate's
registered extensions, not inferred from "this is Flutter".

Everywhere else `capabilities().observe` is `false` and the specs skip with the
reason printed.

## Design decisions worth reviewing

- **`requests()` throws rather than returning `[]`** when observation is
  unavailable. An empty array has to mean "no traffic happened", or an assertion
  over it passes for the wrong reason.
- **Credential headers redacted by default**, bodies capped at 64 KiB, buffer
  cleared between tests. Captured traffic ends up in CI logs and HTML reports.
- **No MITM proxy.** Android 7+ ignores user-installed CAs unless the app opts in
  via `network_security_config`, and Dart's `HttpClient` ignores the system proxy
  unless the app sets `findProxy` — so a proxy needs app changes anyway while
  adding TLS failures as a new way for unrelated tests to break.
- **Interception is out of scope** and `capabilities().intercept` says so. It
  needs an in-app adapter that can hold a request open, which a profiler cannot.

## Bugs fixed along the way

Connecting the UiAutomator agent so `by.native()` could resolve had silently
re-routed everything that short-circuits before its `if (this.flutter?.vm)`
branch:

| Bug | Effect |
|---|---|
| `keyboard.dismiss` pressed Back | Backgrounded the Flutter app and killed the Dart VM. Nav taps fall inside IME bounds, so this broke ordinary navigation. |
| `gesture.tap` via agent | Never reached the Flutter view. Verified: tapping a nav tab at its exact centre did nothing; `adb shell input tap` at the same point navigated. |
| `element.tap` on a `Semantics` wrapper | Fails — the actionable node is merged beneath it. |
| Agent action failure | Aborted the test instead of falling back to a coordinate tap. This is what broke the RN media picker. |
| Scroll gestures | Were flings, not drags. Same 873px gesture: 300ms flings to the end of the content, 1200ms moves ~1.3x predictably. Search loops bounced between extremes until attempts ran out. |
| Flutter VM retries | Counted, not time-bounded — a single tree read could block ~425s, and `waitFor` can't interrupt an in-flight predicate. |

## Verified

| Suite | Result |
|---|---|
| Flutter Android | **19 passed** |
| React Native Android | **15 passed, 4 skipped** |
| React Native iOS | **13 passed, 4 skipped** |
| Flutter iOS | **12 passed, 4 skipped** |
| Unit | **178 passed** (+23) |

The 4 skips are the capability gate reporting an unsupported platform, not
silent passes.

All four demo artifacts rebuilt at 1.1.0 (build 2) and version-checked from the
built binaries, not from source — the footer reads the JS bundle and can be
right while native metadata is stale.

## Note for reviewers

`.github/ISSUE_network-observation.md` and this file are the ticket and PR text.
Delete them once the issue/PR exist, or keep them as the written record.
