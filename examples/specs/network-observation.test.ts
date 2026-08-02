import { expect, test } from './fixtures.js';

/**
 * `device.network` — observing the app's HTTP traffic.
 *
 * Coverage is **instrumented application traffic**, never "all device traffic".
 * On Flutter Android that means `dart:io` HttpClient calls (so `package:http`
 * and Dio too), read from the Dart VM's HTTP profiler — the same source Flutter
 * DevTools' Network view uses. A WebView's own requests, native SDK calls, and
 * platform-channel traffic are invisible to it and always will be.
 *
 * Every test here gates on `capabilities()` rather than on the platform name,
 * because support is detected at runtime: the profiler extensions have to be
 * registered by the Dart isolate, which is not guaranteed by "this is Flutter".
 *
 * The Network lab card drives a loopback API the app itself serves, so the
 * traffic is real HTTP but needs no internet and no test-side server.
 */

test('device.network reports what it can and cannot see', async ({ app, device }) => {
  await app.nav.open('home');

  const capabilities = await device.network.capabilities();

  // The contract is always answerable, on every platform — that is the point of
  // asking rather than assuming.
  expect(typeof capabilities.observe).toBe('boolean');
  expect(capabilities.coverage.length).toBeGreaterThan(0);

  // Interception needs an in-app adapter no build ships yet, so this must stay
  // false everywhere. If it ever flips, the adapter landed and these tests
  // should grow a routing case.
  expect(capabilities.intercept).toBe(false);
});

test('observes a GET, its status, and its timing', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, `Network observation unavailable: ${capabilities.coverage}`);

  await app.nav.open('home');
  await app.networkLab.reveal();
  await device.network.clear();

  await app.networkLab.getProfile();
  await expect.poll(() => app.networkLab.lastStatus()).toContain('200');

  const requests = await device.network.requests({ url: '/api/profile' });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: 'GET', status: 200, transport: 'http' });
  expect(requests[0].durationMs).toBeGreaterThanOrEqual(0);
});

test('distinguishes requests by method and status', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, `Network observation unavailable: ${capabilities.coverage}`);

  await app.nav.open('home');
  await app.networkLab.reveal();
  await device.network.clear();

  await app.networkLab.postSession();
  await expect.poll(() => app.networkLab.lastStatus()).toContain('201');
  await app.networkLab.getMissing();
  await expect.poll(() => app.networkLab.lastStatus()).toContain('404');

  // A failing request is still an observed request — that is what makes this
  // useful for debugging rather than only for happy paths.
  const [created] = await device.network.requests({ url: '/api/session' });
  const [missing] = await device.network.requests({ url: '/api/missing' });

  expect(created).toMatchObject({ method: 'POST', status: 201 });
  expect(missing).toMatchObject({ method: 'GET', status: 404 });
});

test('redacts credential headers by default', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, `Network observation unavailable: ${capabilities.coverage}`);

  await app.nav.open('home');
  await app.networkLab.reveal();
  await device.network.clear();

  // The app sends a real bearer token and the server sets a session cookie.
  await app.networkLab.getProfile();
  await expect.poll(() => app.networkLab.lastStatus()).toContain('200');

  const [record] = await device.network.requests({ url: '/api/profile' });
  const serialized = JSON.stringify(record);

  // Secrets must not reach a CI log or an HTML report just because a test
  // captured traffic.
  expect(serialized).not.toContain('demo-secret-token');
  expect(serialized).not.toContain('astur-session=');
  expect(Object.values(record.requestHeaders)).toContain('<redacted>');
});

test('clear() isolates one step from the next', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, `Network observation unavailable: ${capabilities.coverage}`);

  await app.nav.open('home');
  await app.networkLab.reveal();

  await app.networkLab.getProfile();
  await expect.poll(() => app.networkLab.lastStatus()).toContain('200');
  expect((await device.network.requests({ url: '/api/profile' })).length).toBeGreaterThan(0);

  await device.network.clear();
  expect(await device.network.requests({ url: '/api/profile' })).toHaveLength(0);
});
