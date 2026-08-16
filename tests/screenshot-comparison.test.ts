import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  cropPng,
  maskPng,
  pngSize,
  screenshotScale,
  toPixelRect,
  MASK_COLOR
} from '@astur-mobile/core';
import { comparePng, describeDifference, resolveSnapshotAction } from '../packages/test/src/screenshot.js';

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const at = i << 2;
    png.data[at] = rgb[0];
    png.data[at + 1] = rgb[1];
    png.data[at + 2] = rgb[2];
    png.data[at + 3] = 0xff;
  }

  return PNG.sync.write(png);
}

function pixelAt(image: Buffer, x: number, y: number): [number, number, number] {
  const png = PNG.sync.read(image);
  const at = (png.width * y + x) << 2;
  return [png.data[at], png.data[at + 1], png.data[at + 2]];
}

describe('screenshot geometry', () => {
  it('reads dimensions without decoding the pixels', () => {
    expect(pngSize(solidPng(40, 25, [0, 0, 0]))).toEqual({ width: 40, height: 25 });
  });

  it('scales 1:1 on Android, where bounds are already physical pixels', () => {
    // Measured on a Pixel 9 emulator: screenshot and tree bounds both 1080x2424,
    // for React Native and Flutter alike.
    expect(screenshotScale({ width: 1080, height: 2424 }, { width: 1080, height: 2424 })).toBe(1);
  });

  it('scales by the device pixel ratio on iOS, where bounds are points', () => {
    // Measured on an iPhone 16 simulator: a 1178x2556 image against 393x852 points.
    expect(screenshotScale({ width: 1178, height: 2556 }, { width: 393, height: 852 })).toBe(3);
  });

  it('clamps a crop that rounds past the right edge', () => {
    // The real iOS case: 393 points * 3 is 1179, but the screenshot is 1178
    // wide. Trusting bounds * scale asks for a pixel that does not exist.
    const rect = toPixelRect(
      { x: 0, y: 0, width: 393, height: 852 },
      3,
      { width: 1178, height: 2556 }
    );

    expect(rect).toEqual({ x: 0, y: 0, width: 1178, height: 2556 });
  });

  it('never produces a zero-width crop', () => {
    const rect = toPixelRect({ x: 99, y: 0, width: 10, height: 10 }, 1, { width: 100, height: 100 });
    expect(rect.width).toBeGreaterThan(0);
  });

  it('crops to the requested region', () => {
    const cropped = cropPng(solidPng(100, 80, [10, 20, 30]), { x: 10, y: 10, width: 30, height: 20 });
    expect(pngSize(cropped)).toEqual({ width: 30, height: 20 });
  });

  it('paints masked regions and leaves the rest untouched', () => {
    const masked = maskPng(solidPng(50, 50, [10, 20, 30]), [{ x: 0, y: 0, width: 10, height: 10 }]);

    expect(pixelAt(masked, 5, 5)).toEqual([MASK_COLOR.r, MASK_COLOR.g, MASK_COLOR.b]);
    expect(pixelAt(masked, 20, 20)).toEqual([10, 20, 30]);
  });

  it('returns the original image when there is nothing to mask', () => {
    const image = solidPng(10, 10, [1, 2, 3]);
    expect(maskPng(image, [])).toBe(image);
  });
});

describe('screenshot comparison', () => {
  it('passes for identical images', () => {
    const image = solidPng(20, 20, [120, 130, 140]);
    expect(comparePng(image, image)).toMatchObject({ pass: true, diffPixels: 0 });
  });

  it('reports a size mismatch as a device problem, not a pixel count', () => {
    // A baseline recorded on another device is the usual cause. Reporting it as
    // "1.2M pixels differ" sends people hunting for a visual regression that is
    // not there.
    const result = comparePng(solidPng(10, 10, [0, 0, 0]), solidPng(20, 20, [0, 0, 0]));

    expect(result.pass).toBe(false);
    expect(describeDifference(result)).toContain('recorded on a different device');
    expect(describeDifference(result)).toContain('10x10');
  });

  it('fails on any differing pixel when no budget is set', () => {
    const result = comparePng(solidPng(10, 10, [0, 0, 0]), solidPng(10, 10, [255, 255, 255]));

    expect(result.pass).toBe(false);
    expect(result.diffPixels).toBe(100);
    expect(result).toHaveProperty('diff');
  });

  it('accepts a difference inside maxDiffPixels', () => {
    const before = solidPng(10, 10, [0, 0, 0]);
    const after = PNG.sync.read(before);
    after.data[0] = 255;
    after.data[1] = 255;
    after.data[2] = 255;

    const result = comparePng(before, PNG.sync.write(after), { maxDiffPixels: 5 });
    expect(result).toMatchObject({ pass: true, diffPixels: 1 });
  });

  it('applies the stricter budget when both are set', () => {
    const before = solidPng(10, 10, [0, 0, 0]);
    const after = PNG.sync.read(before);
    for (let i = 0; i < 4; i += 1) {
      const at = i << 2;
      after.data[at] = 255;
      after.data[at + 1] = 255;
      after.data[at + 2] = 255;
    }

    // 4 pixels of 100 is 4%: inside the pixel budget, outside the ratio budget.
    // Raising one budget must not quietly widen the other.
    const result = comparePng(PNG.sync.write(after), before, {
      maxDiffPixels: 10,
      maxDiffPixelRatio: 0.01
    });

    expect(result.pass).toBe(false);
  });
});

describe('--update-snapshots modes', () => {
  // The flag's spellings do not mean what they look like: a bare
  // `--update-snapshots` presets to "changed", not "all". Treating only "all"
  // as an update made the documented way to accept a change silently do
  // nothing -- the baseline stayed put and the test kept failing.
  it('rewrites a differing baseline on a bare --update-snapshots', () => {
    expect(resolveSnapshotAction(true, 'changed', false)).toBe('rewrite');
  });

  it('leaves a matching baseline alone in changed mode', () => {
    expect(resolveSnapshotAction(true, 'changed', true)).toBe('compare');
  });

  it('rewrites even a matching baseline in all mode', () => {
    expect(resolveSnapshotAction(true, 'all', true)).toBe('rewrite');
  });

  it('compares by default, without any flag', () => {
    expect(resolveSnapshotAction(true, undefined, true)).toBe('compare');
    expect(resolveSnapshotAction(true, 'missing', false)).toBe('compare');
  });

  it('never rewrites an existing baseline in none mode', () => {
    expect(resolveSnapshotAction(true, 'none', false)).toBe('compare');
  });

  it('writes an absent baseline in every mode that permits writing', () => {
    for (const mode of ['all', 'changed', 'missing', undefined] as const) {
      expect(resolveSnapshotAction(false, mode, false)).toBe('write-missing');
    }
  });

  it('refuses to write an absent baseline in none mode', () => {
    // Meant for CI: a missing baseline should fail the run, not be created by
    // it, or the job that was supposed to catch the drift records it instead.
    expect(resolveSnapshotAction(false, 'none', false)).toBe('fail-missing');
  });
});
