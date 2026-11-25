/**
 * Bitmap-specific cast member data parsed from CASt specificData.
 * Ported from LibreShockwave BitmapInfo.java. D6+ layout only (Habbo is D10);
 * the D4/D5 branch is implemented for completeness since external casts may
 * predate the movie version.
 */

import { BinaryReader } from '../io/binary-reader';

export interface BitmapInfo {
  width: number;
  height: number;
  /** Registration point in canvas space (bitmap-local = regX - initialLeft) */
  regX: number;
  regY: number;
  initialLeft: number;
  initialTop: number;
  bitDepth: number;
  /** Palette member id minus 1; negative values are built-in palettes */
  paletteId: number;
  paletteCastLib: number;
  pitch: number;
  alphaThreshold: number;
  useAlpha: boolean;
}

export function parseBitmapInfo(data: Uint8Array, directorVersion = 1200): BitmapInfo {
  const empty: BitmapInfo = {
    width: 0,
    height: 0,
    regX: 0,
    regY: 0,
    initialLeft: 0,
    initialTop: 0,
    bitDepth: 1,
    paletteId: 0,
    paletteCastLib: 0,
    pitch: 0,
    alphaThreshold: 0,
    useAlpha: false,
  };
  if (data.length < 10) return empty;

  const reader = new BinaryReader(data, 'big');
  const rawPitch = reader.readU16();
  const top = reader.readI16();
  const left = reader.readI16();
  const bottom = reader.readI16();
  const right = reader.readI16();

  let regX = 0;
  let regY = 0;
  let bitDepth = 1;
  let paletteId = 0;
  let paletteCastLib = 0;
  let pitch = 0;
  let alphaThreshold = 0;
  let useAlpha = false;

  if (directorVersion < 1200) {
    // D4/D5 layout
    if (reader.bytesLeft() >= 8) reader.skip(8); // boundingRect
    if (reader.bytesLeft() >= 2) regY = reader.readI16();
    if (reader.bytesLeft() >= 2) regX = reader.readI16();
    if (reader.bytesLeft() >= 1) reader.skip(1); // padding
    if (reader.bytesLeft() >= 1) {
      bitDepth = reader.readU8();
      if (directorVersion >= 1100 && reader.bytesLeft() >= 2) {
        paletteCastLib = reader.readI16();
      }
      if (reader.bytesLeft() >= 2) {
        paletteId = reader.readI16() - 1;
      }
    }
    pitch = rawPitch & 0x0fff;
    if (bitDepth === 0) bitDepth = 1;
  } else {
    // D6+ layout
    if (reader.bytesLeft() >= 1) {
      alphaThreshold = reader.readU8(); // byte 10
    }
    if (reader.bytesLeft() >= 7) reader.skip(7); // padding/editVersion/scrollPoint
    if (reader.bytesLeft() >= 2) regY = reader.readI16(); // bytes 18-19
    if (reader.bytesLeft() >= 2) regX = reader.readI16(); // bytes 20-21
    if (reader.bytesLeft() >= 1) {
      const updateFlags = reader.readU8(); // byte 22
      useAlpha = (updateFlags & 0x10) !== 0;
    }
    if ((rawPitch & 0x8000) !== 0) {
      // color image flag
      pitch = rawPitch & 0x3fff;
      if (reader.bytesLeft() >= 1) bitDepth = reader.readU8(); // byte 23
      if (reader.bytesLeft() >= 2) paletteCastLib = reader.readI16();
      if (reader.bytesLeft() >= 2) paletteId = reader.readI16() - 1;
    } else {
      bitDepth = 1;
      pitch = rawPitch & 0x3fff;
    }
  }

  return {
    width: right - left,
    height: bottom - top,
    regX,
    regY,
    initialLeft: left,
    initialTop: top,
    bitDepth,
    paletteId,
    paletteCastLib,
    pitch,
    alphaThreshold,
    useAlpha,
  };
}
