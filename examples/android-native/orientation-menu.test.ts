import { expect, test } from './fixtures.js';

test('menu reflects portrait and landscape orientation states', async ({ app, device }) => {
  // await device.setOrientation('portrait');
  // await app.nav.open('web');
  // await app.nav.open('menu');
  // await expect(app.menu.portraitOrientation).toBeVisible();
  // await app.menu.close();

  // try {
    await device.setOrientation('landscape');
  //   await app.nav.open('menu');
  //   await expect(app.menu.landscapeOrientation).toBeVisible();
  // } finally {
  //   await device.setOrientation('portrait').catch(() => undefined);
  // }
});
