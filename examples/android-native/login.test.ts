import { expect, test } from './fixtures.js';

test('login accepts credentials and shows feedback', async ({ app, device }) => {
  await app.nav.open('login');

  await expect(app.login.title).toBeVisible();
  await expect(app.login.email).toHaveValue('pilot@astur.dev');
  await expect(app.login.password).toHaveValue('SecurePass123');

  await app.login.enterCredentials('qa@astur.dev', 'Astur12345');
  await expect(app.login.email).toHaveValue('qa@astur.dev');

  await app.login.submit.tap();
  await expect(device.getByText('Welcome back')).toBeVisible();
  await device.getByText('OK').tap();

  await expect(app.login.statusTitle).toBeVisible();
  await expect(app.login.biometric).toBeDisabled();
  await expect(app.login.feedbackPanel).toBeVisible();
});
