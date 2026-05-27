import { expect, test } from './fixtures.js';

test('forms slider responds to swipe gestures', async ({ app, device }) => {
  await app.nav.open('forms');
  await app.forms.revealSlider();

  await expect(app.forms.sliderLabel).toBeVisible();

  const target = 80;

  await app.forms.setSliderPercent(target);
  await expect(app.forms.sliderLabel).toBeVisible();
  await expect(app.forms.sliderMinLabel).toBeVisible();
  await expect(app.forms.sliderMaxLabel).toBeVisible();

  if (device.deviceInfo.platform === 'android') {
    const updated = await app.forms.sliderPercent();
    expect(updated).toBeGreaterThanOrEqual(target - 15);
    expect(updated).toBeLessThanOrEqual(target + 15);
  }
});
