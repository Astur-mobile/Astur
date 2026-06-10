import { expect, test } from './fixtures.js';

test('home Tap Laboratory tracks single tap, double tap, and long press', async ({ app }) => {
  await app.nav.open('home');
  await app.home.revealTapLaboratory();

  await expect(app.home.tapLabCard).toBeVisible();

  const initial = await app.home.tapLabCounters();

  if (app.platform === 'ios') {
    await app.home.tapTarget.doubleTap();
    await delay(700);
    await app.home.tapTarget.tap();
  } else {
    await app.home.tapTarget.doubleTap({ intervalMs: 60 });
    await app.home.tapTarget.tap();
  }
  if (app.platform === 'ios') {
    await delay(700);
  }
  await app.home.tapTarget.longPress({ durationMs: 900 });

  const final = await app.home.tapLabCounters();

  // Both platforms must register one real double tap (not two single taps). On
  // iOS this relies on the XCUITest agent using the native double-tap gesture so
  // both touches land inside the OS double-tap recognition window.
  expect(final.singleTaps).toBeGreaterThanOrEqual(initial.singleTaps + 1);
  expect(final.doubleTaps).toBe(initial.doubleTaps + 1);
  expect(final.longPresses).toBe(initial.longPresses + 1);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
