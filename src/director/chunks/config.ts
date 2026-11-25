/**
 * Director configuration chunk (DRCF/VWCF).
 * Ported from LibreShockwave ConfigChunk.java. Always big-endian.
 */

import { BinaryReader } from '../io/binary-reader';

export interface ConfigChunk {
  directorVersion: number;
  fileVersion: number;
  stageTop: number;
  stageLeft: number;
  stageBottom: number;
  stageRight: number;
  minMember: number;
  maxMember: number;
  tempo: number;
  /** bit depth field (historically named bgColor) */
  bgColor: number;
  /** raw stage color value */
  stageColor: number;
  /** resolved 0xRRGGBB, or -1 when it needs palette resolution (pre-D7 palette index) */
  stageColorRGB: number;
  /** pre-D7 / non-RGB D7 palette index needing Mac system palette lookup, or -1 */
  stageColorPaletteIndex: number;
  commentFont: number;
  commentSize: number;
  commentStyle: number;
  defaultPaletteCastLib: number;
  defaultPaletteMember: number;
  platform: number;
}

export function readConfigChunk(data: Uint8Array): ConfigChunk {
  const reader = new BinaryReader(data, 'big');

  // directorVersion at offset 36 determines the format
  reader.seek(36);
  const directorVersion = reader.readU16();
  const isD7Plus = directorVersion >= 0x208;

  reader.seek(0);
  /*  0 */ reader.readU16(); // len
  /*  2 */ const fileVersion = reader.readU16();
  /*  4 */ const stageTop = reader.readI16();
  /*  6 */ const stageLeft = reader.readI16();
  /*  8 */ const stageBottom = reader.readI16();
  /* 10 */ const stageRight = reader.readI16();
  /* 12 */ const minMember = reader.readI16();
  /* 14 */ const maxMember = reader.readI16();
  /* 16 */ reader.skip(2);

  let d7StageColorG = 0;
  let d7StageColorB = 0;
  if (isD7Plus) {
    /* 18 */ d7StageColorG = reader.readU8();
    /* 19 */ d7StageColorB = reader.readU8();
  } else {
    /* 18 */ reader.skip(2);
  }

  /* 20 */ const commentFont = reader.readI16();
  /* 22 */ const commentSize = reader.readI16();
  /* 24 */ const commentStyle = reader.readU16();

  let stageColor: number;
  let stageColorRGB = -1;
  let stageColorPaletteIndex = -1;
  if (isD7Plus) {
    const d7IsRgb = reader.readU8(); // offset 26
    const d7StageColorR = reader.readU8(); // offset 27
    stageColor = (d7IsRgb << 8) | d7StageColorR;
    if (d7IsRgb !== 0) {
      stageColorRGB = (d7StageColorR << 16) | (d7StageColorG << 8) | d7StageColorB;
    } else {
      stageColorPaletteIndex = d7StageColorR;
    }
  } else {
    /* 26 */ stageColor = reader.readI16();
    stageColorPaletteIndex = stageColor & 0xff;
  }

  /* 28 */ const bgColor = reader.readI16();
  /* 30 */ reader.skip(2);
  /* 32 */ reader.skip(4);
  /* 36 */ reader.skip(2); // directorVersion (already read)
  /* 38 */ reader.skip(2);
  /* 40 */ reader.skip(4);
  /* 44 */ reader.skip(4);
  /* 48 */ reader.skip(4);
  /* 52 */ reader.skip(2);
  /* 54 */ const tempo = reader.readI16();
  /* 56 */ const platform = reader.readI16();

  let defaultPaletteCastLib = 0;
  let defaultPaletteMember = 0;
  if (reader.bytesLeft() >= 22) {
    reader.skip(18); // offsets 58-75
    /* 76 */ defaultPaletteCastLib = reader.readI16();
    /* 78 */ defaultPaletteMember = reader.readI16();
  }

  return {
    directorVersion,
    fileVersion,
    stageTop,
    stageLeft,
    stageBottom,
    stageRight,
    minMember,
    maxMember,
    tempo,
    bgColor,
    stageColor,
    stageColorRGB,
    stageColorPaletteIndex,
    commentFont,
    commentSize,
    commentStyle,
    defaultPaletteCastLib,
    defaultPaletteMember,
    platform,
  };
}
