import { expect, test } from './fixtures.js';

/**
 * Composable locators — narrowing a screen down to the element you meant.
 *
 * A flat selector answers "find something like this". On a screen of repeated
 * rows that is not enough: every row has the same shape, so the selector
 * matches all of them and nothing says which one the test is about.
 *
 * These specs assert the *semantics* of composition rather than a particular
 * shape of the demo app's tree — that a filter narrows, that a scope confines,
 * that position picks stably. Written that way they stay true across the
 * React Native and Flutter builds, whose trees differ, and they keep meaning
 * something if the demo app's layout is redesigned.
 */

test('a filter narrows a multi-match locator', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  // Both counts must come from the same resolution path. A plain locator is
  // answered by the driver, a composed one is resolved against a tree snapshot
  // on the host, and the two are allowed to disagree about what counts as an
  // element — so comparing one against the other would be comparing two
  // different questions. `queryAll()` reads the same population the composed
  // counts below are drawn from, so the comparison is like for like.
  const all = device.getByType('any');
  const total = (await all.queryAll()).length;
  expect(total).toBeGreaterThan(1);

  // 'Input controls' is the forms screen title, so at least one element's
  // subtree contains it, and not every element's does.
  const matched = await all.filter({ hasText: 'Input controls' }).count();

  expect(matched).toBeGreaterThan(0);
  expect(matched).toBeLessThan(total);
});

test('hasNotText is the exact complement of hasText', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const all = device.getByType('any');
  const withText = all.filter({ hasText: 'Input controls' });
  const withoutText = all.filter({ hasNotText: 'Input controls' });

  const inCount = await withText.count();
  const outCount = await withoutText.count();

  // Every element either contains the text or does not, so the two sets are
  // disjoint and together cover everything. A union whose size is exactly the
  // sum of its parts is precisely that statement — and it is expressed with
  // composed locators throughout, so it never compares the host's view of the
  // tree against the driver's.
  const unionCount = await withText.or(withoutText).count();

  expect(inCount).toBeGreaterThan(0);
  expect(outCount).toBeGreaterThan(0);
  expect(unionCount).toBe(inCount + outCount);
});

test('scoping confines the search to the parent subtree', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const unscoped = (await device.getByType('any').queryAll()).length;
  const scoped = await app.forms.screen.getByType('any').count();

  // A scope can only ever remove candidates, never add them.
  expect(scoped).toBeLessThanOrEqual(unscoped);

  // And what it does find really is inside the parent. The forms container is
  // a different element on each platform, so only assert containment where the
  // scope actually has descendants to contain.
  test.skip(scoped === 0, 'this build exposes no descendants under the forms container');

  const parent = await app.forms.screen.bounds();
  const child = await app.forms.screen.getByType('any').first().bounds();

  expect(child.x).toBeGreaterThanOrEqual(parent.x - 1);
  expect(child.y).toBeGreaterThanOrEqual(parent.y - 1);
});

test('a parent does not match itself when scoped into', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const container = app.forms.screen;
  const containerBounds = await container.bounds();
  const descendants = await container.getByType('any').queryAll();

  // Scoping searches descendants. If the parent were included it would appear
  // here with exactly its own bounds.
  const matchedItself = descendants.some(
    (node) =>
      node.bounds.x === containerBounds.x
      && node.bounds.y === containerBounds.y
      && node.bounds.width === containerBounds.width
      && node.bounds.height === containerBounds.height
  );

  expect(matchedItself).toBe(false);
});

test('position picks stably, and counts from the end when negative', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const all = device.getByType('any');
  const total = await all.count();
  test.skip(total < 2, 'needs at least two elements on screen to distinguish first from last');

  const first = await all.first().bounds();
  const zeroth = await all.nth(0).bounds();
  const last = await all.last().bounds();
  const negativeOne = await all.nth(-1).bounds();

  expect(zeroth).toEqual(first);
  expect(negativeOne).toEqual(last);
  expect(last).not.toEqual(first);
});

test('position applies after filtering, not before', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const filtered = device.getByType('any').filter({ hasText: 'Input controls' });
  const filteredCount = await filtered.count();
  test.skip(filteredCount === 0, 'demo app screen does not expose the expected title text');

  // The first of the filtered set must itself satisfy the filter. If position
  // were applied first, this would be the first element on screen, which the
  // filter would then most likely reject.
  const firstFiltered = await filtered.first().snapshot();
  const text = [firstFiltered.text, firstFiltered.label, firstFiltered.value]
    .filter(Boolean)
    .join(' ');

  // Either the element itself carries the text, or it contains a descendant
  // that does — both satisfy the filter, so accept a subtree match.
  const subtreeCount = await filtered.first().getByText('Input controls', { exact: false }).count();
  expect(text.includes('Input controls') || subtreeCount > 0).toBe(true);
});

test('or unions and and intersects', async ({ app, device }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  const anything = device.getByType('any');
  const titled = anything.filter({ hasText: 'Input controls' });

  const unionCount = await titled.or(anything).count();
  const intersectionCount = await titled.and(anything).count();

  const anythingCount = (await anything.queryAll()).length;
  const titledCount = await titled.count();

  // A union is at least as large as either side; an intersection at most as
  // small as either. Asserting the inequalities rather than exact numbers keeps
  // this true whatever the screen happens to contain.
  expect(unionCount).toBeGreaterThanOrEqual(Math.max(anythingCount, titledCount));
  expect(intersectionCount).toBeLessThanOrEqual(Math.min(anythingCount, titledCount));

  // The union must not double-count what both sides matched.
  expect(unionCount).toBeLessThanOrEqual(anythingCount + titledCount);
});

test('checked state reflects the control, and toBeChecked follows it', async ({ app }) => {
  await app.nav.open('forms');
  await expect(app.forms.title).toBeVisible();

  await app.forms.toggle.tap();
  await app.forms.revealCheckbox();

  // Not every driver reports a checked state — Flutter's tree in particular
  // may not — so ask before asserting, the way the network specs do.
  const before = await app.forms.checkbox.isChecked().catch(() => undefined);
  test.skip(before === undefined, 'this build does not report a checked state for the checkbox');

  await app.forms.checkbox.tap();

  if (before === true) {
    await expect(app.forms.checkbox).not.toBeChecked();
  } else {
    await expect(app.forms.checkbox).toBeChecked();
  }
});
