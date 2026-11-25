/**
 * Palette/CLUT chunk: color lookup table, 6 bytes per color (16-bit RGB,
 * high byte used). Ported from LibreShockwave PaletteChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface PaletteChunk {
  /** 0xRRGGBB per entry */
  colors: number[];
}

export function readPaletteChunk(data: Uint8Array): PaletteChunk {
  const reader = new BinaryReader(data, 'big');
  const colorCount = Math.floor(reader.bytesLeft() / 6);
  const colors: number[] = new Array(colorCount);
  for (let i = 0; i < colorCount; i++) {
    const r = reader.readU8();
    reader.skip(1);
    const g = reader.readU8();
    reader.skip(1);
    const b = reader.readU8();
    reader.skip(1);
    colors[i] = (r << 16) | (g << 8) | b;
  }
  return { colors };
}
