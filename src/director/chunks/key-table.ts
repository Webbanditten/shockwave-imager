/**
 * Key table chunk (KEY*). Maps resource section IDs to their owning cast
 * member's CASt section ID. Read in the FILE's byte order (not forced BE).
 * Ported from LibreShockwave KeyTableChunk.java.
 */

import type { BinaryReader } from '../io/binary-reader';

export interface KeyTableEntry {
  /** Resource chunk section ID (BITD, CLUT, snd , Lscr, ...) */
  sectionId: number;
  /** Owner: usually the CASt chunk's section ID */
  castId: number;
  fourCC: number;
}

export interface KeyTableChunk {
  entries: KeyTableEntry[];
  entriesByOwner: Map<number, KeyTableEntry[]>;
  ownerBySectionId: Map<number, number>;
}

export function readKeyTableChunk(reader: BinaryReader): KeyTableChunk {
  reader.readU16(); // header size
  reader.readU16(); // entry size (always 12)
  reader.readI32(); // total count
  const usedCount = reader.readI32();

  const entries: KeyTableEntry[] = [];
  const entriesByOwner = new Map<number, KeyTableEntry[]>();
  const ownerBySectionId = new Map<number, number>();

  for (let i = 0; i < usedCount; i++) {
    const sectionId = Math.max(0, reader.readI32());
    const castId = Math.max(0, reader.readI32());
    const fourCC = (reader.readI32() >>> 0);

    const entry: KeyTableEntry = { sectionId, castId, fourCC };
    entries.push(entry);
    let owned = entriesByOwner.get(castId);
    if (!owned) {
      owned = [];
      entriesByOwner.set(castId, owned);
    }
    owned.push(entry);
    ownerBySectionId.set(sectionId, castId);
  }

  return { entries, entriesByOwner, ownerBySectionId };
}

export function findKeyEntry(
  table: KeyTableChunk,
  ownerId: number,
  fourCC: number,
): KeyTableEntry | undefined {
  return table.entriesByOwner.get(ownerId)?.find((e) => e.fourCC === fourCC);
}
