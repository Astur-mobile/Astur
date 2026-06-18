import { expect, test } from './fixtures.js';

test('webview supports native navigation and DOM form submission', async ({ app, device }) => {
  await app.nav.open('web');

  await expect(app.web.title).toBeVisible();
  await expect(app.web.webViewCard).toBeVisible();

  // Drive the in-app WebView's DOM with the engine-agnostic web context. It acts
  // in-page over the remote-debugging transport, so it is immune to the offscreen
  // WebView rAF throttling that intermittently stalls Playwright actionability —
  // the reliable path for both Flutter and React Native hosts.
  const web = await device.webContext();
  try {
    await web.getById('astur-email').fill('qa@astur.dev');
    await web.getById('astur-submit').tap();
    expect(await web.getById('astur-result').textContent()).toMatch(/Submitted/i);
  } finally {
    await web.close();
  }
});
