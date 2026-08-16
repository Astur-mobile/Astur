import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface ScreenshotCompareOptions {
  /**
   * Per-pixel colour tolerance, 0 to 1. Defaults to Playwright's `0.2`, which
   * absorbs the antialiasing differences two renders of the same screen produce
   * without hiding a real change.
   */
  threshold?: number;
  /** Allowed number of differing pixels. */
  maxDiffPixels?: number;
  /** Allowed proportion of differing pixels, 0 to 1. */
  maxDiffPixelRatio?: number;
}

export type ScreenshotCompareResult =
  | { pass: true; diffPixels: number; diffRatio: number }
  | { pass: false; diffPixels: number; diffRatio: number; diff?: Buffer; sizeMismatch?: string };

export const DEFAULT_THRESHOLD = 0.2;

/** Playwright's `--update-snapshots` modes, as they reach `config.updateSnapshots`. */
export type SnapshotUpdateMode = 'all' | 'changed' | 'missing' | 'none';

export type SnapshotAction =
  /** No baseline, and this mode may write one — write it, but do not pass. */
  | 'write-missing'
  /** Rewrite the baseline and pass; the run was told the change is intended. */
  | 'rewrite'
  /** No baseline and this mode forbids writing one. */
  | 'fail-missing'
  /** Compare against the baseline as normal. */
  | 'compare';

/**
 * Decides what a run should do with a baseline, given the update mode.
 *
 * Worth spelling out because the flag's spellings do not mean what they look
 * like: a bare `--update-snapshots` presets to **`changed`**, not `all`, so
 * treating only `all` as "update" makes the documented way to accept a change
 * silently do nothing. The four modes, per Playwright:
 *
 * - `all` — rewrite every baseline, matching or not.
 * - `changed` — rewrite only the ones that differ. The bare-flag default.
 * - `missing` — write only absent baselines. The default with no flag.
 * - `none` — never write; an absent baseline is a failure.
 */
export function resolveSnapshotAction(
  hasBaseline: boolean,
  updateMode: SnapshotUpdateMode | undefined,
  matches: boolean
): SnapshotAction {
  const mode = updateMode ?? 'missing';

  if (!hasBaseline) {
    return mode === 'none' ? 'fail-missing' : 'write-missing';
  }
  if (mode === 'all') {
    return 'rewrite';
  }
  if (mode === 'changed' && !matches) {
    return 'rewrite';
  }
  return 'compare';
}

/**
 * Compares two PNGs and reports how far apart they are.
 *
 * A size mismatch is reported separately rather than as a huge pixel count,
 * because the cause is almost never a visual regression — it is a baseline
 * recorded on a different device, and "1.2M pixels differ" sends people looking
 * for the wrong thing.
 */
export function comparePng(
  expected: Buffer,
  actual: Buffer,
  options: ScreenshotCompareOptions = {}
): ScreenshotCompareResult {
  const before = PNG.sync.read(expected);
  const after = PNG.sync.read(actual);

  if (before.width !== after.width || before.height !== after.height) {
    return {
      pass: false,
      diffPixels: Number.NaN,
      diffRatio: Number.NaN,
      sizeMismatch: `baseline is ${before.width}x${before.height}, this run captured ${after.width}x${after.height}`
    };
  }

  const diff = new PNG({ width: before.width, height: before.height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
    threshold: options.threshold ?? DEFAULT_THRESHOLD
  });

  const total = before.width * before.height;
  const diffRatio = total === 0 ? 0 : diffPixels / total;

  if (withinTolerance(diffPixels, diffRatio, options)) {
    return { pass: true, diffPixels, diffRatio };
  }

  return { pass: false, diffPixels, diffRatio, diff: PNG.sync.write(diff) };
}

/**
 * With neither budget set, any differing pixel fails — the same rule Playwright
 * applies. `threshold` has already forgiven per-pixel noise by this point, so a
 * pixel counted here genuinely changed.
 */
function withinTolerance(
  diffPixels: number,
  diffRatio: number,
  options: ScreenshotCompareOptions
): boolean {
  const { maxDiffPixels, maxDiffPixelRatio } = options;

  if (maxDiffPixels === undefined && maxDiffPixelRatio === undefined) {
    return diffPixels === 0;
  }

  // Both budgets set means both must hold: the stricter one wins, so raising
  // one cannot silently widen the other.
  if (maxDiffPixels !== undefined && diffPixels > maxDiffPixels) {
    return false;
  }

  return maxDiffPixelRatio === undefined || diffRatio <= maxDiffPixelRatio;
}

export function describeDifference(result: ScreenshotCompareResult): string {
  if (result.pass) {
    return 'images match';
  }

  if (result.sizeMismatch) {
    return `screenshot size does not match the baseline — ${result.sizeMismatch}. `
      + 'This usually means the baseline was recorded on a different device rather than that the UI changed.';
  }

  return `${result.diffPixels} pixels differ (${(result.diffRatio * 100).toFixed(2)}% of the image)`;
}
