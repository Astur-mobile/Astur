# Network observation, and the Flutter reliability fixes it uncovered

## Why

We can drive the app but we can't see what it talks to. When a screen misbehaves
there's no way to ask "what did it actually call, and what came back" — you fall
back to reading app logs. Playwright gives you that in the browser; we should
have the equivalent for mobile.

Building it surfaced several Flutter reliability bugs that were already costing
us whole test runs, so those are in scope here too.

## What we want

**Observe traffic.** From a test:

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.networkLab.getProfile();

const [request] = await device.network.requests({ url: '/api/profile' });
expect(request).toMatchObject({ method: 'GET', status: 200 });
```

## Requirements

**Be honest about coverage.** Report *instrumented application traffic*, never
"all device traffic". A session must be able to say what it covers, so a test
can ask rather than assume — `observe`, `intercept`, `transports`,
`responseBodies`, `coverage`, `adapterRequired`.

**Never fail quietly.** If observation isn't available, `requests()` throws.
Returning an empty array would make an assertion pass for the wrong reason —
empty has to mean "no traffic happened".

**Don't leak secrets.** Redact `authorization`, `cookie`, `set-cookie`,
`x-api-key` by default. Captured traffic ends up in CI logs and HTML reports.

**Don't grow without bound.** Cap response bodies (64 KiB) and clear the buffer
between tests, so one test can't assert on another's traffic.

**No MITM proxy.** It looks universal and isn't: Android 7+ ignores
user-installed CAs unless the app opts in via `network_security_config`, and
Dart's `HttpClient` ignores the system proxy unless the app sets `findProxy`.
So it needs app changes anyway, while adding TLS and certificate failures as new
ways for unrelated tests to break. An explicit in-app adapter is more honest.

**Keep both demo builds identical.** The Network lab card ships in the Flutter
and React Native branches with the same testIDs, or the shared suite drifts.

## Scope

Observation only. Interception (stub/delay/fail) needs an in-app adapter that
can hold a request open, which a profiler can't do — `capabilities().intercept`
must report `false` until that exists.

Flutter Android first: it's the one platform where this is available without
app changes, via the Dart VM HTTP profiler.

## Also fix (found while building this)

These were breaking real runs:

- The UiAutomator agent, connected so `by.native()` could resolve, silently took
  over keyboard, gestures, and element actions on Flutter. Its `keyboard.dismiss`
  presses Back, which kills the Flutter app; its `gesture.tap` never reaches the
  Flutter view at all.
- An agent element-action failure aborted the test instead of falling back to a
  coordinate tap. This is why the native media picker failed on RN Android.
- Scroll reveals were flings, not drags — the same gesture at 300ms flung to the
  end of the content, at 1200ms moved predictably. Search loops bounced between
  the extremes forever.
- A Flutter VM read could block ~425s: retries were counted, not time-bounded,
  and a short per-call timeout can't interrupt an in-flight request.

## Done when

- [ ] `device.network` works on Flutter Android, verified on a device
- [ ] Unsupported platforms skip with a stated reason, not a false pass
- [ ] Unit tests cover mapping, redaction, body limits, filtering, gating
- [ ] All four suites green
- [ ] Docs state the coverage boundary and the capability matrix
- [ ] Both demo branches carry the Network lab card, all four artifacts rebuilt
