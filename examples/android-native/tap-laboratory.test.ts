import { expect, test } from './fixtures.js';

test('home Tap Laboratory tracks single tap, double tap, and long press', async ({ app }) => {
  await app.nav.open('home');
  await app.home.revealTapLaboratory();

  await expect(app.home.tapLabCard).toBeVisible();

  const initial = await app.home.tapLabCounters();

  await app.home.tapTarget.tap();
  await app.home.tapTarget.doubleTap({ intervalMs: 60 });
  await app.home.tapTarget.longPress({ durationMs: 900 });

  const final = await app.home.tapLabCounters();
  expect(final.singleTaps).toBeGreaterThanOrEqual(initial.singleTaps + 1);
  expect(final.doubleTaps).toBe(initial.doubleTaps + 1);
  expect(final.longPresses).toBe(initial.longPresses + 1);
});
