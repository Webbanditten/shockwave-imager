/**
 * Software bitmap: ARGB pixels plus an optional palette-index plane.
 *
 * Per LibreShockwave's rendering rules, indexed images must keep their
 * palette indices alongside rendered ARGB pixels — matte detection and
 * imaging-Lingo copies depend on them.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** Original bit depth (1/2/4/8/16/32) */
  bitDepth: number;
  /** 0xAARRGGBB per pixel, row-major */
  argb: Uint32Array;
  /** Palette index per pixel for depth <= 8 sources, else null */
  paletteIndices: Uint8Array | null;
  /** True if the source carries a real alpha channel (32-bit + ALFA/useAlpha) */
  nativeAlpha: boolean;
}

export function createBitmap(
  width: number,
  height: number,
  bitDepth: number,
  fill = 0xffffffff,
): Bitmap {
  const argb = new Uint32Array(width * height);
  argb.fill(fill);
  return {
    width,
    height,
    bitDepth,
    argb,
    paletteIndices: bitDepth <= 8 ? new Uint8Array(width * height) : null,
    nativeAlpha: false,
  };
}
