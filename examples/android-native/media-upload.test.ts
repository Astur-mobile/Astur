import { expect, test } from './fixtures.js';

test('forms upload selects a media asset from the native picker', async ({ app }) => {
  await app.nav.open('forms');

  await app.forms.chooseFirstVisibleMedia();

  await expect(app.forms.selectedAsset).toBeVisible();
  await expect(app.forms.selectedAssetMetadata).toBeVisible();
});
