import { expect, test } from './fixtures.js';

/**
 * `device.keyboard.type()` — typing at the *focus*, not at an element.
 *
 * `fill()` remains the right tool whenever the field is addressable: it resolves
 * the element, clears it, and verifies the value landed. None of that is
 * possible here, so this API is deliberately the fallback, not the default.
 *
 * It exists for controls the accessibility tree never describes — a multi-box
 * OTP field being the usual one, where the visible boxes are plain views and the
 * real input is off-tree entirely, so `getByType('textField')` finds nothing and
 * `fill()` has no target to aim at.
 *
 * The demo app has no such control, so these specs use the ordinary form input
 * and drive it the hard way on purpose: tap to move focus, then type without
 * ever naming a target. That is the exact code path an OTP field needs, and it
 * is the same call on both platforms — XCUITest types into the focused
 * responder, Android delivers to the focused view.
 */

test('keyboard.type sends text to whatever holds focus', async ({ app, device }) => {
  await app.nav.open('forms');

  // Tapping is what makes this work — the text never names a target, so the tap
  // is the only thing deciding where it lands.
  await app.forms.revealTextInput();
  await app.forms.textInput.tap();

  // A space is the interesting character: Android delivers this through
  // `input text`, where an unquoted space would silently truncate to "Astur".
  await device.keyboard.type('Astur 123456');

  await expect(app.forms.textInput).toHaveValue('Astur 123456');
});

test('pressKey types a single character on both platforms', async ({ app, device }) => {
  await app.nav.open('forms');

  await app.forms.revealTextInput();
  await app.forms.textInput.tap();

  // The digit-by-digit shape an OTP flow usually takes. It needs no platform
  // branch: iOS accepts a printable character the same way Android maps it to
  // KEYCODE_2.
  for (const digit of '2468') {
    await device.pressKey(digit);
  }

  await expect(app.forms.textInput).toHaveValue('2468');
});
