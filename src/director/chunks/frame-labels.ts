/**
 * Frame labels chunk (VWLB). Always big-endian.
 * Ported from LibreShockwave FrameLabelsChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface FrameLabel {
  /** 1-based frame number */
  frameNum: number;
  label: string;
}

export interface FrameLabelsChunk {
  labels: FrameLabel[];
}

export function readFrameLabelsChunk(data: Uint8Array): FrameLabelsChunk {
  const reader = new BinaryReader(data, 'big');
  const labels: FrameLabel[] = [];
  if (reader.bytesLeft() < 2) return { labels };

  const labelsCount = reader.readU16();
  const frameNums: number[] = [];
  const labelOffsets: number[] = [];
  for (let i = 0; i < labelsCount; i++) {
    if (reader.bytesLeft() < 4) break;
    frameNums.push(reader.readU16());
    labelOffsets.push(reader.readU16());
  }

  if (reader.bytesLeft() < 4) return { labels };
  const labelsSize = reader.readI32();
  const stringData = reader.readBytes(Math.min(labelsSize, reader.bytesLeft()));

  const sortedIndices = frameNums.map((_, i) => i).sort((a, b) => labelOffsets[a]! - labelOffsets[b]!);

  for (let si = 0; si < sortedIndices.length; si++) {
    const idx = sortedIndices[si]!;
    const labelOffset = labelOffsets[idx]!;
    if (labelOffset < 0 || labelOffset >= stringData.length) continue;

    let labelEnd =
      si < sortedIndices.length - 1
        ? Math.min(labelOffsets[sortedIndices[si + 1]!]!, stringData.length)
        : stringData.length;
    while (labelEnd > labelOffset && stringData[labelEnd - 1] === 0) {
      labelEnd--;
    }

    if (labelEnd > labelOffset) {
      const label = new BinaryReader(stringData.subarray(labelOffset, labelEnd)).readStringMacRoman(
        labelEnd - labelOffset,
      );
      labels.push({ frameNum: Math.max(1, frameNums[idx]!), label });
    }
  }

  return { labels };
}

export function getFrameByLabel(chunk: FrameLabelsChunk, labelName: string): number {
  const lower = labelName.toLowerCase();
  for (const l of chunk.labels) {
    if (l.label.toLowerCase() === lower) return l.frameNum;
  }
  return -1;
}
