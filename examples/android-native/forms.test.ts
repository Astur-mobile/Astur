import { expect, test } from './fixtures.js';

test('forms update text input, switch, checkbox, and button state', async ({ app }) => {
  await app.nav.open('forms');

  await expect(app.forms.title).toBeVisible();

  await app.forms.typeText('Astur native form automation');
  await expect(app.forms.textInput).toHaveValue('Astur native form automation');

  await app.forms.toggle.tap();
  await app.forms.checkbox.tap();
  await app.forms.revealActionButtons();
  await expect(app.forms.activeButton).toBeEnabled();

  await app.forms.activeButton.tap();
  await expect(app.forms.activeButton).toBeVisible();
});
