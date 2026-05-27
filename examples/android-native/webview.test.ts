import { expect, test } from './fixtures.js';

test('webview supports native navigation and DOM form submission', async ({ app, webview }) => {
  await app.nav.open('web');

  await expect(app.web.title).toBeVisible();
  await expect(app.web.webViewCard).toBeVisible();

  const web = await webview({ timeout: 30_000 });
  await expect(web.page.locator('body')).toContainText(/Astur Web Lab|Built for Astur validation/);

  await web.page.getByRole('button', { name: /Submit web form/i }).click();
  await expect(web.page.locator('body')).toContainText(/submitted|success|Astur/i);
});
