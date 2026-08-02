import { delay } from '@astur-mobile/test';
import { expect, test } from './fixtures.js';

/**
 * Separation between the double tap and the single tap that follows it.
 *
 * This is a real constraint, not a guess at how fast the app updates: it has to
 * exceed the platform's double-tap recognition window, or the next touch is
 * folded into the previous gesture and the counters disagree. iOS's window is
 * the longer of the two. Polling cannot replace this — the wait has to happen
 * *before* the gesture, not while waiting for its result.
 */
const GESTURE_SEPARATION_MS = { ios: 700, android: 500 };

test('home Tap Laboratory tracks single tap, double tap, and long press', async ({ app }) => {
  await app.nav.open('home');
  await app.home.revealTapLaboratory();

  await expect(app.home.tapLabCard).toBeVisible();

  const initial = await app.home.tapLabCounters();
  const separation = app.platform === 'ios' ? GESTURE_SEPARATION_MS.ios : GESTURE_SEPARATION_MS.android;

  // Drive the locator, not a cached coordinate. Registering a gesture makes the
  // app add a readout row, which reflows the card and moves the target — so a
  // point captured up front is stale by the second gesture, and on Flutter an
  // element pushed off screen leaves the tree entirely. Each call here
  // re-resolves the element immediately before acting on it.
  await app.home.tapTarget.doubleTap();
  await delay(separation);
  await app.home.tapTarget.tap();
  await delay(separation);
  await app.home.tapTarget.longPress({ durationMs: 900 });

  await app.home.revealTapLaboratory();

  // Both platforms must register one real double tap (not two single taps). On
  // iOS this relies on the XCUITest agent using the native double-tap gesture so
  // both touches land inside the OS double-tap recognition window; on Android it
  // relies on the agent injecting MotionEvents rather than shelling out per tap.
  await expect.poll(() => app.home.tapLabCounters()).toEqual(
    expect.objectContaining({
      doubleTaps: initial.doubleTaps + 1,
      longPresses: initial.longPresses + 1
    })
  );

  // A double tap may additionally bump the single-tap counter depending on the
  // platform's recognizer, so assert "at least one" here. The two exact counts
  // above are what actually discriminate the three gestures.
  const final = await app.home.tapLabCounters();
  expect(final.singleTaps).toBeGreaterThanOrEqual(initial.singleTaps + 1);
});
