import { expect, test } from './fixtures.js';

/**
 * `toHaveScreenshot()` — comparing what the screen looks like against a stored
 * baseline.
 *
 * Playwright's own `toHaveScreenshot` needs a `Page`, which a native session
 * does not have, so this is the native equivalent: Astur captures the screen,
 * paints over whatever is allowed to change, and compares against one baseline
 * per device.
 *
 * Baselines live beside this file and are committed. They are keyed by
 * platform, UI engine, and screen size, because a React Native and a Flutter
 * build of the same screen do not render identically even on the same emulator
 * — comparing across them produces a diff that looks like a regression when it
 * is really a mismatch.
 *
 * Two habits keep visual tests from becoming the flakiest thing you own:
 *
 * - **Prefer an element to the whole screen.** A full-screen baseline includes
 *   the system status bar, whose clock changes every minute and which no
 *   application locator can mask, so it fails for reasons nobody cares about.
 * - **Mask what is genuinely dynamic** rather than loosening the threshold. A
 *   wide threshold hides real regressions everywhere; a mask hides one region
 *   deliberately.
 */

/**
 * Measured, not guessed: re-rendering the same card after a scroll or a
 * keyboard change moves ~0.2% of its pixels, because text lands on slightly
 * different sub-pixel positions. Zero tolerance is the default and is right for
 * a screen that does not move, but a card reached by scrolling needs a budget.
 *
 * A budget stays far tighter than loosening `threshold`: any real change to
 * this card — colour, copy, spacing — moves well over 1% of it.
 */
const RENDER_BUDGET = { maxDiffPixelRatio: 0.01 };

test('an element matches its baseline', async ({ app }) => {
  await app.nav.open('home');

  // The hero card is static content that needs no scrolling to reach, which is
  // what makes it a good subject: it compares at zero tolerance.
  await expect(app.home.heroCard).toHaveScreenshot('home-hero-card.png');
});

test('a masked region is allowed to change', async ({ app, device }) => {
  await app.nav.open('forms');
  await app.forms.revealTextInput();

  // The input and the mirror below it both echo whatever is typed. Everything
  // else on this card is meant to stay put.
  const echoes = [app.forms.textInput, app.forms.mirror];
  const card = device.getById('forms-fields-card');

  await expect(card).toHaveScreenshot('forms-fields-card.png', { mask: echoes, ...RENDER_BUDGET });

  await app.forms.typeText('Astur visual check');
  await device.keyboard.dismiss();
  await app.forms.revealTextInput();

  // The same baseline still matches even though the field now holds text. That
  // is a real assertion, not a demonstration: without the mask the changed
  // characters would fail it.
  await expect(card).toHaveScreenshot('forms-fields-card.png', { mask: echoes, ...RENDER_BUDGET });
});
