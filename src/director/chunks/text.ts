/**
 * Styled text chunk (STXT) — field member content. Always big-endian.
 * Ported from LibreShockwave TextChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface TextRun {
  startOffset: number;
  endOffset: number;
  fontId: number;
  fontSize: number;
  fontStyle: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

export interface TextChunk {
  text: string;
  runs: TextRun[];
}

export function readTextChunk(data: Uint8Array, directorVersion = 0): TextChunk {
  const reader = new BinaryReader(data, 'big');
  const headerLen = reader.readI32();
  const textLen = reader.readI32();
  reader.skip(headerLen - 8);

  const text = reader.readStringMacRoman(textLen);

  const runs: TextRun[] = [];
  if (reader.bytesLeft() >= 4) {
    const runCount = reader.readI16();
    reader.skip(2);

    const legacyRunLayout = directorVersion > 0 && directorVersion <= 1600;
    for (let i = 0; i < runCount && reader.bytesLeft() >= 16; i++) {
      const startOffset = reader.readI32();
      const fontId = reader.readI16();
      const fontStyle = reader.readU8();
      let fontSize: number;
      if (legacyRunLayout) {
        reader.skip(3);
        fontSize = reader.readI16();
      } else {
        reader.skip(1);
        fontSize = reader.readI16();
        reader.skip(2);
      }
      const colorR = reader.readU8();
      const colorG = reader.readU8();
      const colorB = reader.readU8();
      reader.skip(1);

      runs.push({ startOffset, endOffset: textLen, fontId, fontSize, fontStyle, colorR, colorG, colorB });
    }
  }

  return { text, runs };
}
