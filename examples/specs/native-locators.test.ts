import { expect, test } from './fixtures.js';

/**
 * `by.native({ ios, android })` — the raw native-selector escape hatch.
 *
 * For the rare element `by.label` / `by.id` / `by.text` / `by.role` / `by.type`
 * cannot express: most often a screen with no accessibility metadata, where the
 * only reliable match is by structure, or by combining several conditions at once.
 *
 *   ios      a raw XCUITest NSPredicate format string, applied via
 *            `app.descendants(matching: .any).matching(NSPredicate(format:))` —
 *            the same declarative grammar Apple's own APIs use. Data for a
 *            restricted query language, never executed as code.
 *   android  a structured chain built entirely from androidx.test.uiautomator's
 *            own `By`/`BySelector` fluent API — className, text(Contains|Matches),
 *            description(Contains|Matches), resourceId(Matches), packageName,
 *            hasChild, hasDescendant. Deliberately NOT an expression language:
 *            no eval, no parser, no runtime bytecode compilation.
 *   instance optional; picks the nth match, applied after every other constraint.
 *
 * The Home screen's "Native locator lab" card is built for this: its targets ship
 * no accessibility ids, and the lane buttons all share one visible text — so
 * `getById` has nothing to bind to and `getByText('+')` is ambiguous across all
 * three. Only the readout pills keep stable ids, which is what lets every test
 * below prove the *intended* element was hit rather than merely that something was.
 *
 * Requires the demo app build that contains the Native locator lab card, and a
 * connected native agent — `by.native()` cannot be resolved against a cached UI
 * tree, so a legacy/no-agent session throws NATIVE_SELECTOR_REQUIRES_AGENT rather
 * than silently matching nothing. (That guard, and the "selector missing this
 * platform's payload" error, are covered by the unit suite in
 * tests/android-agent-mode.test.ts and tests/ios-agent-mode.test.ts.)
 */

test('by.native() reaches an unlabeled control by position', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.revealLanes();
  await expect(app.nativeLab.card).toBeVisible();

  // Three identical "+" buttons, no ids, same text. `instance` is the only
  // thing that separates them — tap lane B (index 1).
  const before = await app.nativeLab.laneCounts();
  await app.nativeLab.laneButton(1).tap();

  // Poll rather than sleep: the counter re-renders asynchronously, so a fixed
  // wait is either slower than needed or too short under load. `expect.poll`
  // retries until the whole shape matches, then asserts once.
  await expect.poll(() => app.nativeLab.laneCounts()).toEqual({
    ...before,
    // The neighbours must be untouched — this is what proves the positional
    // selector resolved to lane B specifically, not just "some + button".
    b: before.b + 1
  });
});

test('by.native() reaches a row by the text nested inside it', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.revealRecords();

  // The rows carry no ids and no distinguishing text of their own — only the
  // record name *nested inside* them. React Native matches the row via
  // `hasDescendant`; Flutter and iOS match the row's merged accessibility
  // label, which already contains the nested text. Same intent, expressed
  // natively per platform. See NativeLabPage.recordRow().
  //
  // KNOWN FAILING on the Flutter Android build. The selector resolves correctly
  // when queried directly against a live session (verified: one match, right
  // bounds, visible), but the tap times out inside the suite. Unresolved — the
  // cause is NOT the reveal (the rows are on screen) and NOT the selector shape.
  // Passes on React Native Android.
  await app.nativeLab.recordRow('Beta record').tap();
  await expect.poll(() => app.nativeLab.selectedRecord()).toContain('Beta record');

  // Switching rows by the same strategy must move the readout — confirming the
  // match follows the requested descendant rather than the first row on screen.
  await app.nativeLab.recordRow('Gamma record').tap();
  await expect.poll(() => app.nativeLab.selectedRecord()).toContain('Gamma record');
});

test('by.native() combines several native conditions in one query', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.revealLanes();

  // Android combines className + text + packageName; iOS combines label +
  // enabled state. Every condition narrows the SAME match (logical AND), with
  // `instance` applied last. Tap lane C (index 2).
  const before = await app.nativeLab.laneCounts();
  await app.nativeLab.laneButtonByCompoundQuery(2).tap();

  await expect.poll(() => app.nativeLab.laneCounts()).toEqual({ ...before, c: before.c + 1 });
});

test('by.native() matches nested text by regex', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.revealRecords();

  // `textMatches` / `MATCHES` — a regex over the row's nested text instead of
  // an exact string.
  await app.nativeLab.recordRowMatching('Alpha|Beta').tap();

  await expect.poll(() => app.nativeLab.selectedRecord()).toMatch(/Alpha record|Beta record/);
});

test('by.native() addresses id-bearing nodes by id pattern', async ({ app }) => {
  await app.nav.open('home');
  await app.nativeLab.revealLanes();

  // by.native() is not limited to id-less nodes. `resourceIdMatches` (Android)
  // and an `identifier BEGINSWITH` predicate (iOS) address the readout pills by
  // an id *pattern* — the tool for ids with a stable prefix and an unstable
  // suffix, which plain getById() cannot express.
  await expect(app.nativeLab.lanePillByIdPattern('a')).toBeVisible();
  await expect(app.nativeLab.lanePillByIdPattern('b')).toBeVisible();
  await expect(app.nativeLab.lanePillByIdPattern('c')).toBeVisible();
});
