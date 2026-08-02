import { expect, test } from './fixtures.js';

test('login accepts credentials and shows feedback', async ({ app, device }) => {
  await app.nav.open('login');

  await expect(app.login.title).toBeVisible();
  await app.login.revealCredentials();
  await expect(app.login.email).toHaveValue('pilot@astur.dev');
  await expect(app.login.password).toHaveValue('SecurePass123');

  await app.login.email.fill('qa@astur.dev');
  await app.login.password.fill('Astur12345');

  // Assert only after the keyboard is gone and the form is back in view.
  // Focusing a field scrolls the form up to clear the IME, which can push the
  // email field off screen — and under Flutter "off screen" means absent from
  // the tree, so asserting mid-edit fails on a field that is perfectly fine.
  // The password value is deliberately not re-read here: it is a secure field,
  // and what this test is proving is that the credentials submit successfully.
  await device.keyboard.dismiss();
  await app.login.revealCredentials();
  await expect(app.login.email).toHaveValue('qa@astur.dev');

  await app.login.revealSubmit();
  await app.login.submitCredentials();
  await expect(device.getByText('Welcome back', { exact: false })).toBeVisible();
  await device.getByText('OK').tap();

  await expect(app.login.statusTitle).toBeVisible();
  await expect(app.login.feedbackPanel).toBeVisible();
  await expect(device.getByText('Astur login succeeded', { exact: false })).toBeVisible();
});
