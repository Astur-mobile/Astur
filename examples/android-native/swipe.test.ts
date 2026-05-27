import { expect, test } from './fixtures.js';

test('swipe moves the carousel and scrolls to vertical content', async ({ app }) => {
  await app.nav.open('swipe');

  await expect(app.swipe.title).toBeVisible();
  await expect(app.swipe.introCard).toBeVisible();

  await app.swipe.swipeCarouselLeft();
  await expect(app.swipe.hybridCard).toBeVisible();

  await app.swipe.scrollToVerticalCard();
  await expect(app.swipe.verticalCard).toBeVisible();
});
