/**
 * Score chunk (VWSC): the movie timeline. Delta-compressed per-frame channel
 * data plus behavior attachment intervals. Always big-endian.
 * Ported from LibreShockwave ScoreChunk.java (dirplayer-rs score.rs lineage).
 */

import { BinaryReader } from '../io/binary-reader';

export interface ChannelData {
  spriteType: number;
  ink: number;
  trails: number;
  stretch: number;
  foreColor: number;
  backColor: number;
  castLib: number;
  castMember: number;
  posY: number;
  posX: number;
  height: number;
  width: number;
  colorFlag: number;
  blendByte: number;
  thicknessFlags: number;
  foreColorG: number;
  backColorG: number;
  foreColorB: number;
  backColorB: number;
}

export interface FrameChannelEntry {
  /** 0-based frame index */
  frameIndex: number;
  channelIndex: number;
  data: ChannelData;
}

export interface TempoChannelData {
  frameIndex: number;
  tempo: number;
}

export interface PaletteChannelData {
  frameIndex: number;
  castLib: number;
  castMember: number;
}

export interface FrameIntervalPrimary {
  startFrame: number;
  endFrame: number;
  channelIndex: number;
}

export interface FrameIntervalSecondary {
  castLib: number;
  castMember: number;
}

export interface FrameInterval {
  primary: FrameIntervalPrimary;
  secondary: FrameIntervalSecondary | null;
}

export interface ScoreChunk {
  frameCount: number;
  numChannels: number;
  spriteRecordSize: number;
  framesVersion: number;
  frameChannelData: FrameChannelEntry[];
  tempoChannelData: TempoChannelData[];
  paletteChannelData: PaletteChannelData[];
  frameIntervals: FrameInterval[];
}

const EMPTY_SCORE: ScoreChunk = {
  frameCount: 0,
  numChannels: 0,
  spriteRecordSize: 0,
  framesVersion: 0,
  frameChannelData: [],
  tempoChannelData: [],
  paletteChannelData: [],
  frameIntervals: [],
};

function readChannelData(reader: BinaryReader, spriteRecordSize: number): ChannelData {
  const spriteType = reader.readU8();
  // D7: ink is bits 0-5; bit 6 = trails, bit 7 = stretch
  const inkByte = reader.readU8();
  const ink = inkByte & 0x3f;
  const trails = (inkByte >> 6) & 0x1;
  const stretch = (inkByte >> 7) & 0x1;
  const foreColor = reader.readU8();
  const backColor = reader.readU8();
  const castLib = reader.readU16();
  const castMember = reader.readU16();
  reader.readU16(); // unk1
  reader.readU16(); // unk2
  const posY = reader.readI16();
  const posX = reader.readI16();
  const height = reader.readU16();
  const width = reader.readU16();
  // 20 bytes read

  let colorFlag = 0;
  let blendByte = 0;
  let thicknessFlags = 0;
  let foreColorG = 0;
  let backColorG = 0;
  let foreColorB = 0;
  let backColorB = 0;

  if (spriteRecordSize >= 24) {
    const unk3 = reader.readU8();
    colorFlag = (unk3 & 0xf0) >> 4;
    blendByte = reader.readU8(); // blend 0-255
    thicknessFlags = reader.readU8(); // thickness + flip flags
    reader.readU8();
  }
  if (spriteRecordSize >= 28) {
    foreColorG = reader.readU8();
    backColorG = reader.readU8();
    foreColorB = reader.readU8();
    backColorB = reader.readU8();
  }

  return {
    spriteType,
    ink,
    trails,
    stretch,
    foreColor,
    backColor,
    castLib,
    castMember,
    posY,
    posX,
    height,
    width,
    colorFlag,
    blendByte,
    thicknessFlags,
    foreColorG,
    backColorG,
    foreColorB,
    backColorB,
  };
}

function isEmptyChannel(d: ChannelData): boolean {
  return (
    d.spriteType === 0 &&
    d.ink === 0 &&
    d.foreColor === 0 &&
    d.backColor === 0 &&
    d.castLib === 0 &&
    d.castMember === 0 &&
    d.posY === 0 &&
    d.posX === 0 &&
    d.height === 0 &&
    d.width === 0
  );
}

export function isFlipH(d: ChannelData): boolean {
  return (d.thicknessFlags & 0x20) !== 0;
}

export function isFlipV(d: ChannelData): boolean {
  return (d.thicknessFlags & 0x40) !== 0;
}

/** foreColor as 0xRRGGBB when colorFlag bit 0 is set, otherwise the palette index. */
export function resolvedForeColor(d: ChannelData): number {
  if ((d.colorFlag & 0x1) !== 0) {
    return (d.foreColor << 16) | (d.foreColorG << 8) | d.foreColorB;
  }
  return d.foreColor;
}

export function resolvedBackColor(d: ChannelData): number {
  if ((d.colorFlag & 0x2) !== 0) {
    return (d.backColor << 16) | (d.backColorG << 8) | d.backColorB;
  }
  return d.backColor;
}

export function readScoreChunk(data: Uint8Array): ScoreChunk {
  const reader = new BinaryReader(data, 'big');
  if (reader.bytesLeft() < 24) return EMPTY_SCORE;

  // 24-byte header
  reader.readI32(); // total length
  reader.readI32(); // unk1
  reader.readI32(); // unk2
  const entryCount = reader.readI32();
  reader.readI32(); // unk3
  reader.readI32(); // entry size sum

  const offsets: number[] = [];
  for (let i = 0; i <= entryCount; i++) {
    if (reader.bytesLeft() < 4) break;
    offsets.push(reader.readI32());
  }
  if (offsets.length !== entryCount + 1) return EMPTY_SCORE;
  for (let j = 0; j < offsets.length - 1; j++) {
    if (offsets[j]! > offsets[j + 1]!) return EMPTY_SCORE;
  }

  const entries: Uint8Array[] = [];
  for (let i = 0; i < entryCount; i++) {
    const length = offsets[i + 1]! - offsets[i]!;
    if (length > 0 && reader.bytesLeft() >= length) {
      entries.push(reader.readBytes(length));
    } else {
      entries.push(new Uint8Array(0));
    }
  }

  const frameData =
    entries.length > 0 && entries[0]!.length > 0 ? parseFrameData(entries[0]!) : null;
  const frameIntervals = parseFrameIntervals(entries);

  if (!frameData) {
    return { ...EMPTY_SCORE, frameIntervals };
  }
  return { ...frameData, frameIntervals };
}

function parseFrameData(data: Uint8Array): Omit<ScoreChunk, 'frameIntervals'> | null {
  const reader = new BinaryReader(data, 'big');
  if (reader.bytesLeft() < 20) return null;

  reader.readI32(); // actual length
  reader.readI32(); // unk1
  const frameCount = reader.readI32();
  const framesVersion = reader.readU16();
  const spriteRecordSize = reader.readU16();
  const numChannels = reader.readU16();
  reader.skip(2); // numChannelsDisplayed

  const frameSize = numChannels * spriteRecordSize;
  const totalSize = frameCount * frameSize;
  if (totalSize <= 0 || totalSize > 50_000_000) return null;
  const channelData = new Uint8Array(totalSize);

  // Decode delta-compressed frames: each frame record is (length u16) then
  // (channelSize u16, channelOffset u16, bytes) deltas applied over the
  // carried-forward previous frame.
  let frameIndex = 0;
  while (!reader.eof() && frameIndex < frameCount) {
    if (reader.bytesLeft() < 2) break;
    const length = reader.readU16();
    if (length === 0) break;

    if (frameIndex > 0) {
      channelData.copyWithin(frameIndex * frameSize, (frameIndex - 1) * frameSize, frameIndex * frameSize);
    }

    const frameLength = length - 2;
    if (frameLength > 0 && reader.bytesLeft() >= frameLength) {
      const frameReader = new BinaryReader(reader.readBytes(frameLength), 'big');
      while (!frameReader.eof() && frameReader.bytesLeft() >= 4) {
        const channelSize = frameReader.readU16();
        const channelOffset = frameReader.readU16();
        if (channelSize > 0 && frameReader.bytesLeft() >= channelSize) {
          const delta = frameReader.readBytes(channelSize);
          const destOffset = frameIndex * frameSize + channelOffset;
          if (destOffset + channelSize <= channelData.length) {
            channelData.set(delta, destOffset);
          }
        } else {
          break;
        }
      }
    }
    frameIndex++;
  }

  // D5 (framesVersion <= 7): first 48 bytes per frame are packed main channels.
  // D6+: uniform channels; channel 4 = tempo, channel 5 = palette.
  const mainChannelsSize = framesVersion <= 7 ? 48 : 0;
  const isD5 = mainChannelsSize > 0;

  const frameChannelData: FrameChannelEntry[] = [];
  const tempoChannelData: TempoChannelData[] = [];
  const paletteChannelData: PaletteChannelData[] = [];

  const channelReader = new BinaryReader(channelData, 'big');

  for (let f = 0; f < frameCount; f++) {
    const frameStart = f * frameSize;

    if (isD5) {
      if (frameStart + 22 <= channelData.length) {
        const tempoVal = channelData[frameStart + 21]!;
        if (tempoVal > 0) tempoChannelData.push({ frameIndex: f, tempo: tempoVal });
      }
      const numSprites = Math.floor((frameSize - mainChannelsSize) / spriteRecordSize);
      for (let s = 0; s < numSprites; s++) {
        const pos = frameStart + mainChannelsSize + s * spriteRecordSize;
        if (pos + 24 > channelData.length) break;
        channelReader.seek(pos);
        const cd = readChannelData(channelReader, spriteRecordSize);
        if (!isEmptyChannel(cd)) {
          frameChannelData.push({ frameIndex: f, channelIndex: s + 6, data: cd });
        }
      }
    } else {
      for (let c = 0; c < numChannels; c++) {
        const pos = frameStart + c * spriteRecordSize;
        if (pos + spriteRecordSize > channelData.length) break;

        if (c === 4) {
          // Tempo channel: FPS at byte 6
          const tempoVal = channelData[pos + 6]!;
          if (tempoVal > 0 && tempoVal <= 120) {
            tempoChannelData.push({ frameIndex: f, tempo: tempoVal });
          }
        } else if (c === 5) {
          // Palette channel: castLib i16 at 0, member i16 at 2
          const view = new BinaryReader(channelData.subarray(pos, pos + 4), 'big');
          const palCastLib = view.readI16();
          const palMember = view.readI16();
          if (palMember !== 0) {
            paletteChannelData.push({ frameIndex: f, castLib: palCastLib, castMember: palMember });
          }
        } else if (pos + 24 <= channelData.length) {
          channelReader.seek(pos);
          const cd = readChannelData(channelReader, spriteRecordSize);
          if (!isEmptyChannel(cd)) {
            frameChannelData.push({ frameIndex: f, channelIndex: c, data: cd });
          }
        }
      }
    }
  }

  return {
    frameCount,
    numChannels,
    spriteRecordSize,
    framesVersion,
    frameChannelData,
    tempoChannelData,
    paletteChannelData,
  };
}

function parseFrameIntervals(entries: Uint8Array[]): FrameInterval[] {
  const results: FrameInterval[] = [];
  let i = 2; // entries 0 (frame data) and 1 are skipped

  while (i < entries.length) {
    const entryBytes = entries[i]!;
    if (entryBytes.length === 0) {
      i++;
      continue;
    }

    if (entryBytes.length >= 44 && entryBytes.length <= 48) {
      // Primary interval (44 bytes, sometimes 4 trailing bytes)
      const reader = new BinaryReader(entryBytes, 'big');
      const startFrame = reader.readI32();
      const endFrame = reader.readI32();
      reader.readI32(); // unk0
      reader.readI32(); // unk1
      const channelIndex = reader.readI32();
      const primary: FrameIntervalPrimary = { startFrame, endFrame, channelIndex };

      // Following 8-byte-multiple entries are behavior attachments
      const secondaries: FrameIntervalSecondary[] = [];
      let j = i + 1;
      while (j < entries.length) {
        const next = entries[j]!;
        if (next.length >= 8 && next.length % 8 === 0) {
          const secReader = new BinaryReader(next, 'big');
          let foundValidBehavior = false;
          for (let b = 0; b < next.length / 8; b++) {
            const castLib = secReader.readU16();
            const castMember = secReader.readU16();
            secReader.readI32();
            if (castLib > 0 && castMember > 0) {
              secondaries.push({ castLib, castMember });
              foundValidBehavior = true;
            }
          }
          if (foundValidBehavior) {
            j++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      if (secondaries.length === 0) {
        results.push({ primary, secondary: null });
      } else {
        for (const secondary of secondaries) {
          results.push({ primary, secondary });
        }
      }
      i = j;
      continue;
    }
    i++;
  }

  return results;
}
