import { expect, test } from './fixtures.js';

test('drag and drop places all puzzle tiles', async ({ app }) => {
  await app.nav.open('drag');

  await expect(app.drag.title).toBeVisible();
  await app.drag.reset.tap();
  await expect(app.drag.tileCount(0)).toBeVisible();

  await app.drag.solvePuzzle();

  await expect(app.drag.solved).toBeVisible();
});
