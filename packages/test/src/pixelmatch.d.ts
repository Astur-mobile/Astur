/**
 * pixelmatch v6 ships no types, and `@types/pixelmatch` only describes v5 — so
 * declaring the one function we call is more accurate than depending on types
 * for a different major version.
 */
declare module 'pixelmatch' {
  interface PixelmatchOptions {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
    aaColor?: [number, number, number];
    diffColor?: [number, number, number];
    diffColorAlt?: [number, number, number];
    diffMask?: boolean;
  }

  /** Returns the number of pixels that differ. */
  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray,
    img2: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray | null,
    width: number,
    height: number,
    options?: PixelmatchOptions
  ): number;
}
