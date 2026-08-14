import { PNG } from 'pngjs';
import type { Bounds } from '@astur-mobile/protocol';
import { AsturError } from './errors.js';

/**
 * The colour painted over masked regions. Magenta because nothing in a real UI
 * is this colour by accident, so a mask that lands in the wrong place is
 * obvious in the attached image rather than silently hiding a regression.
 */
export const MASK_COLOR = { r: 0xff, g: 0x00, b: 0xff };

export interface ImageSize {
  width: number;
  height: number;
}

export function decodePng(image: Buffer): PNG {
  return PNG.sync.read(image);
}

export function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

export function pngSize(image: Buffer): ImageSize {
  // The IHDR chunk is fixed-position, so this avoids decoding megabytes of
  // pixels just to read two numbers — but that also means a non-PNG buffer
  // reads as garbage or throws a bare RangeError, so check first and say what
  // is actually wrong.
  if (image.length < 24) {
    throw new AsturError(
      'INVALID_SCREENSHOT',
      `Expected a PNG screenshot but received ${image.length} bytes.`
    );
  }

  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

/**
 * How many screenshot pixels there are per unit of element bounds.
 *
 * The two are not always the same space. Android reports bounds in physical
 * pixels, so the factor is 1. iOS reports points while its screenshot is in
 * pixels, so a 3x device reports 393x852 against a 1178x2556 image.
 *
 * Derived from the height rather than an average of both axes: the width often
 * disagrees by a pixel (393 * 3 is 1179, but the image is 1178 wide) because
 * the screenshot is rounded, and averaging that in skews every crop slightly.
 */
export function screenshotScale(image: ImageSize, viewport: Bounds | ImageSize): number {
  if (!viewport.height) {
    return 1;
  }

  return image.height / viewport.height;
}

/**
 * Element bounds converted into screenshot pixels and clamped to the image.
 *
 * Clamping is not defensive tidying — it is required. Rounding means an element
 * flush against the right edge can compute one pixel wider than the screenshot,
 * and a crop past the edge throws or produces a torn image.
 */
export function toPixelRect(bounds: Bounds, scale: number, image: ImageSize): Bounds {
  const x = Math.max(0, Math.round(bounds.x * scale));
  const y = Math.max(0, Math.round(bounds.y * scale));
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);

  return {
    x,
    y,
    width: Math.max(1, Math.min(width, image.width - x)),
    height: Math.max(1, Math.min(height, image.height - y))
  };
}

export function cropPng(image: Buffer, rect: Bounds): Buffer {
  const source = decodePng(image);
  const clamped = toPixelRect(rect, 1, source);
  const target = new PNG({ width: clamped.width, height: clamped.height });

  PNG.bitblt(source, target, clamped.x, clamped.y, clamped.width, clamped.height, 0, 0);

  return encodePng(target);
}

export function maskPng(image: Buffer, rects: Bounds[]): Buffer {
  if (rects.length === 0) {
    return image;
  }

  const png = decodePng(image);

  for (const rect of rects) {
    const area = toPixelRect(rect, 1, png);
    for (let y = area.y; y < area.y + area.height; y += 1) {
      for (let x = area.x; x < area.x + area.width; x += 1) {
        const index = (png.width * y + x) << 2;
        png.data[index] = MASK_COLOR.r;
        png.data[index + 1] = MASK_COLOR.g;
        png.data[index + 2] = MASK_COLOR.b;
        png.data[index + 3] = 0xff;
      }
    }
  }

  return encodePng(png);
}
