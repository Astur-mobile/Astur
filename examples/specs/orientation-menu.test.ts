import { test } from './fixtures.js';

test('orientation changes do not leak into the next test', async ({ device }) => {
  try {
    await device.setOrientation('landscape');
  } finally {
    // Orientation is global device state, not app state. Restore it in the
    // owning test so the next fixture does not have to rotate and launch the
    // app concurrently.
    await device.setOrientation('portrait').catch(() => undefined);
  }
});
