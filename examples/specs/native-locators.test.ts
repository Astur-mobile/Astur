import { expect, test } from './fixtures.js';

/**
 * `by.native()` — the raw native-selector escape hatch.
 *
 * The Home screen's "Native locator lab" card ships targets with NO accessibility
 * ids, where the lane buttons additionally all share the same visible text. That
 * makes them unreachable by the normal strategies: `getById` has nothing to bind
 * to, and `getByText('+')` is ambiguous across all three lanes.
 *
 * Both assertions below check the *unselected* targets stayed put, so a passing run
 * proves the native selector hit the intended element — not merely that something
 * was tapped.
 *
 * Requires a demo-app build that includes the Native locator lab card
 * (astur-demoApp: `main` for React Native, `flutter` for Flutter).
 */
test('native locators reach id-less targets by position and by structure', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.reveal();

  await expect(app.nativeLab.card).toBeVisible();

  // ── Position: three identical, unlabeled "+" buttons ──────────────────────
  // Only `instance` separates them. Tap lane B (index 1).
  const before = await app.nativeLab.laneCounts();

  await app.nativeLab.laneButton(1).tap();

  const afterLane = await app.nativeLab.laneCounts();
  expect(afterLane.b).toBe(before.b + 1);
  // The neighbours must be untouched — this is what proves the positional
  // selector resolved to lane B specifically.
  expect(afterLane.a).toBe(before.a);
  expect(afterLane.c).toBe(before.c);

  // ── Structure: a row identifiable only by the text nested inside it ────────
  await app.nativeLab.recordRow('Beta record').tap();
  await expect(app.nativeLab.selectedRecordPill).toContainText('Beta record');

  // Selecting a different row by the same structural strategy must move the
  // readout — confirming the match follows the requested descendant, not just
  // the first row on screen.
  await app.nativeLab.recordRow('Gamma record').tap();
  await expect(app.nativeLab.selectedRecordPill).toContainText('Gamma record');
});
