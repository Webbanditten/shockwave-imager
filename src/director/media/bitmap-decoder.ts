/**
 * BITD bitmap decoder: PackBits RLE + per-depth pixel decode.
 *
 * Ported from tools/palette-extractor/src/bitd.ts, which was validated
 * against all 14,641 Habbo bitmaps (0 failures), cross-checked with
 * LibreShockwave BitmapDecoder.java. Adds the palette-index plane that
 * the render pipeline and imaging Lingo require.
 */

import { type Bitmap } from './bitmap';
import { type Palette, grayscalePalette } from './palette';
import { type BitmapInfo } from '../cast/bitmap-info';

/**
 * PackBits-style RLE. Data at or above the expected size is uncompressed.
 *   control < 0x80: literal run of control+1 bytes
 *   control == 0x80: no-op
 *   control > 0x80: repeat next byte 257-control times
 */
export function decompressBitd(data: Uint8Array, expectedSize: number): Uint8Array {
  if (data.length >= expectedSize) {
    return data.subarray(0, expectedSize);
  }

  const output = new Uint8Array(expectedSize);
  let srcPos = 0;
  let dstPos = 0;

  while (srcPos < data.length && dstPos < expectedSize) {
    const control = data[srcPos++]!;
    if (control < 0x80) {
      const count = control + 1;
      for (let i = 0; i < count && srcPos < data.length && dstPos < expectedSize; i++) {
        output[dstPos++] = data[srcPos++]!;
      }
    } else if (control === 0x80) {
      continue;
    } else {
      const count = 257 - control;
      if (srcPos >= data.length) break;
      const value = data[srcPos++]!;
      for (let i = 0; i < count && dstPos < expectedSize; i++) {
        output[dstPos++] = value;
      }
    }
  }

  return output;
}

/**
 * Row stride in bytes. CASt pitch wins when present; the computed fallback
 * rounds up to even (word alignment).
 */
export function calculatePitch(width: number, bitsPerPixel: number, castPitch: number): number {
  if (castPitch > 0) return castPitch;
  const raw = Math.ceil((width * bitsPerPixel) / 8);
  return raw + (raw & 1);
}

const OPAQUE = 0xff000000;

function decodeIndexed(
  data: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  bitDepth: 1 | 2 | 4 | 8,
  palette: Palette,
): Bitmap {
  const argb = new Uint32Array(width * height);
  const indices = new Uint8Array(width * height);
  const colors = palette.colors;
  const pixelsPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  // Sub-8-bit indices address the FULL 256-entry palette scaled across the
  // depth's value range (LibreShockwave BitmapDecoder.scaledIndex): a 4-bit
  // pixel of 15 is palette[255] (black in grayscale), NOT palette[15]
  // (near-white). Without this the entry-view clouds (cloud_0, 4-bit
  // grayscale, outline at index 15) lost their black outline -> f0f0f0. The
  // scaled value is stored in the index plane too so the palette-index matte
  // and copy paths stay consistent with the 256-entry palette. 8-bit is
  // identity; 1-bit keeps its black/white fast path (masks ignore the palette).
  //
  // EXCEPTION: a member whose palette is its OWN depth-sized CLUT (16 authored
  // entries for a 4-bit image) maps indices DIRECTLY — scaling would spread
  // index 1..15 into the black padding past the 16 real colours (rare_snowrug
  // rendered ~all black: only index 0 survived, everything else -> padding).
  // sourceCount is the authored CLUT length; scale only when the palette holds
  // more colours than the depth's own range.
  const authored = palette.sourceCount ?? colors.length;
  const needsScale = (bitDepth === 2 || bitDepth === 4) && authored > mask + 1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * pitch;
    for (let x = 0; x < width; x++) {
      const byteIndex = rowOffset + Math.floor(x / pixelsPerByte);
      const shift = 8 - bitDepth - (x % pixelsPerByte) * bitDepth;
      const rawIndex = ((data[byteIndex] ?? 0) >> shift) & mask;
      const px = y * width + x;
      if (bitDepth === 1) {
        // 1 = black, 0 = white
        indices[px] = rawIndex;
        argb[px] = rawIndex === 1 ? OPAQUE : 0xffffffff;
      } else {
        const index = needsScale ? Math.round((rawIndex / mask) * 255) : rawIndex;
        indices[px] = index;
        argb[px] = OPAQUE | (colors[index] ?? 0);
      }
    }
  }

  return { width, height, bitDepth, argb, paletteIndices: indices, nativeAlpha: false };
}

function decode16bit(
  data: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  wasCompressed: boolean,
): Bitmap {
  const argb = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * pitch;
    for (let x = 0; x < width; x++) {
      let hi: number;
      let lo: number;
      if (wasCompressed) {
        // RLE rows are planar: high bytes first, then low bytes
        const halfPitch = Math.floor(pitch / 2);
        hi = data[rowOffset + x] ?? 0;
        lo = data[rowOffset + halfPitch + x] ?? 0;
      } else {
        hi = data[rowOffset + x * 2] ?? 0;
        lo = data[rowOffset + x * 2 + 1] ?? 0;
      }
      const pixel = (hi << 8) | lo;
      // RGB555: 0RRRRRGGGGGBBBBB
      const r = Math.round((((pixel >> 10) & 0x1f) * 255) / 31);
      const g = Math.round((((pixel >> 5) & 0x1f) * 255) / 31);
      const b = Math.round(((pixel & 0x1f) * 255) / 31);
      argb[y * width + x] = OPAQUE | (r << 16) | (g << 8) | b;
    }
  }
  return { width, height, bitDepth: 16, argb, paletteIndices: null, nativeAlpha: false };
}

function decode32bit(
  data: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  wasCompressed: boolean,
  useAlpha: boolean,
): Bitmap {
  const argb = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * pitch;
    for (let x = 0; x < width; x++) {
      let a: number;
      let r: number;
      let g: number;
      let b: number;
      if (wasCompressed) {
        // RLE rows are channel-planar: [A...][R...][G...][B...]
        a = data[rowOffset + x] ?? 0;
        r = data[rowOffset + width + x] ?? 0;
        g = data[rowOffset + width * 2 + x] ?? 0;
        b = data[rowOffset + width * 3 + x] ?? 0;
      } else {
        a = data[rowOffset + x * 4] ?? 0;
        r = data[rowOffset + x * 4 + 1] ?? 0;
        g = data[rowOffset + x * 4 + 2] ?? 0;
        b = data[rowOffset + x * 4 + 3] ?? 0;
      }
      // The authored alpha byte is ALWAYS preserved (LibreShockwave
      // decode32Bit does the same and the frame renderer skips alpha-0
      // pixels): the pool rooms' ClickArea walk targets are 1x1 32-bit
      // members with alpha 0 and useAlpha OFF — forcing them opaque drew
      // black boxes over the pool ladders. useAlpha only drives the
      // nativeAlpha flag consumed by the ink heuristics.
      argb[y * width + x] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }
  }
  return { width, height, bitDepth: 32, argb, paletteIndices: null, nativeAlpha: useAlpha };
}

/**
 * Decode a BITD chunk into a Bitmap using the member's BitmapInfo and
 * resolved palette (indexed depths only).
 */
export function decodeBitmap(
  bitdData: Uint8Array,
  info: BitmapInfo,
  palette?: Palette,
): Bitmap | null {
  const { width, height, bitDepth } = info;
  if (width <= 0 || height <= 0) return null;
  if (![1, 2, 4, 8, 16, 32].includes(bitDepth)) return null;

  const pitch = calculatePitch(width, bitDepth, info.pitch);
  const expectedSize = pitch * height;
  if (expectedSize === 0) return null;

  const wasCompressed = bitdData.length < expectedSize;
  const data = decompressBitd(bitdData, expectedSize);
  const pal = palette ?? grayscalePalette();

  switch (bitDepth) {
    case 1:
    case 2:
    case 4:
    case 8:
      return decodeIndexed(data, width, height, pitch, bitDepth, pal);
    case 16:
      return decode16bit(data, width, height, pitch, wasCompressed);
    case 32:
      return decode32bit(data, width, height, pitch, wasCompressed, info.useAlpha);
    default:
      return null;
  }
}
