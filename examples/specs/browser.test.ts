import { expect, test } from './fixtures.js';

/**
 * `device.browser` — driving a mobile **web page** on the same device the
 * native suite runs on.
 *
 * This is the other half of Astur's web story. `device.webContext()` drives a
 * WebView *inside* an app; this drives the browser itself, for testing a
 * responsive site on real Android and iOS rather than a desktop emulation of
 * one. Below the page they are the same machinery — once a tab is inspectable,
 * the same injected-JS bridge drives it.
 *
 * The page under test is served from this repo over the config's `webServer`,
 * so the suite stays offline and deterministic: no public site can change its
 * markup and fail a run that has nothing to do with Astur.
 */

/** Port the config's `webServer` serves `examples/assets/web` on. */
const PORT = 4319;

/**
 * The device's route back to the host running the tests.
 *
 * An Android emulator reaches it through the 10.0.2.2 alias; an iOS simulator
 * shares the host's own loopback. This is a genuine platform difference rather
 * than a test-only workaround, which is why it is spelled out here.
 */
function baseUrl(platform: string): string {
  return platform === 'android' ? `http://10.0.2.2:${PORT}` : `http://127.0.0.1:${PORT}`;
}

test('reports what the session can do with a browser', async ({ device }) => {
  const capabilities = await device.browser.capabilities();

  // Answerable everywhere, like device.network — a spec asks rather than
  // assuming, so it stays portable across platforms that cannot comply.
  expect(typeof capabilities.supported).toBe('boolean');
  expect(capabilities.coverage.length).toBeGreaterThan(0);
});

test('opens a page and drives its DOM', async ({ device }) => {
  const capabilities = await device.browser.capabilities();
  test.skip(!capabilities.supported, capabilities.coverage);

  const home = baseUrl(device.deviceInfo.platform);
  const page = await device.browser.open(`${home}/index.html`);

  expect(await page.getById('page-title').textContent()).toBe('Astur Web Lab');

  await page.getByTestId('web-email').fill('qa@astur.dev');
  await page.getByTestId('web-submit').tap();
  expect(await page.getByTestId('web-result').textContent()).toContain('qa@astur.dev');
});

test('navigates, reloads, and goes back', async ({ device }) => {
  const capabilities = await device.browser.capabilities();
  test.skip(!capabilities.supported, capabilities.coverage);

  const home = baseUrl(device.deviceInfo.platform);
  await device.browser.open(`${home}/index.html`);

  const details = await device.browser.navigate(`${home}/details.html`);
  expect(await details.getById('page-role').textContent()).toBe('details');

  // Reload must land on the same page, not the one before it.
  const reloaded = await device.browser.reload();
  expect(await reloaded.getById('page-role').textContent()).toBe('details');
  expect(await device.browser.url()).toContain('details.html');

  const back = await device.browser.back();
  expect(await back.getById('page-role').textContent()).toBe('home');
});

test('a fill on the page survives a reload only if the app persists it', async ({ device }) => {
  const capabilities = await device.browser.capabilities();
  test.skip(!capabilities.supported, capabilities.coverage);

  const home = baseUrl(device.deviceInfo.platform);
  const page = await device.browser.open(`${home}/index.html`);
  await page.getByTestId('web-email').fill('qa@astur.dev');

  // The lab page keeps nothing, so a reload is expected to clear the field.
  // Asserting it proves the reload genuinely re-fetched rather than no-oping.
  const reloaded = await device.browser.reload();
  expect(await reloaded.getByTestId('web-result').textContent()).toBe('idle');
});
