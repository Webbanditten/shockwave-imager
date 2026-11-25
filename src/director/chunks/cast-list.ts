/**
 * Cast list chunk (MCsL): the movie's cast libraries, including external
 * cast paths. Always big-endian. Ported from LibreShockwave CastListChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface CastListEntry {
  name: string;
  path: string;
  preloadSettings: number;
  minMember: number;
  maxMember: number;
  memberCount: number;
  id: number;
}

export interface CastListChunk {
  entries: CastListEntry[];
}

export function readCastListChunk(data: Uint8Array): CastListChunk {
  const reader = new BinaryReader(data, 'big');

  const dataOffset = reader.readI32();
  reader.readU16(); // unk0
  const castCount = reader.readU16();
  const itemsPerCast = reader.readU16();
  reader.readU16(); // unk1

  if (dataOffset < 0 || dataOffset >= reader.length || castCount > 1000) {
    return { entries: [] };
  }

  reader.seek(dataOffset);
  const offsetTableLen = reader.readU16();
  if (offsetTableLen > 10000) {
    return { entries: [] };
  }

  const offsets: number[] = [];
  for (let i = 0; i < offsetTableLen; i++) {
    offsets.push(reader.readI32());
  }
  const itemsLen = reader.readI32();
  const listOffset = reader.position;

  const items: Uint8Array[] = [];
  for (let i = 0; i < offsetTableLen; i++) {
    const offset = offsets[i]!;
    const nextOffset = i === offsetTableLen - 1 ? itemsLen : offsets[i + 1]!;
    const itemLen = nextOffset - offset;
    if (itemLen > 0 && itemLen < 10000 && listOffset + offset + itemLen <= reader.length) {
      reader.seek(listOffset + offset);
      items.push(reader.readBytes(itemLen));
    } else {
      items.push(new Uint8Array(0));
    }
  }

  const readPascal = (bytes: Uint8Array | undefined): string => {
    if (!bytes || bytes.length === 0) return '';
    const len = bytes[0]!;
    if (len > bytes.length - 1) return '';
    return new BinaryReader(bytes.subarray(1, 1 + len)).readStringMacRoman(len);
  };

  const entries: CastListEntry[] = [];
  for (let c = 0; c < castCount; c++) {
    const name = itemsPerCast >= 1 ? readPascal(items[c * itemsPerCast + 1]) : '';
    const path = itemsPerCast >= 2 ? readPascal(items[c * itemsPerCast + 2]) : '';

    let preloadSettings = 0;
    if (itemsPerCast >= 3) {
      const preload = items[c * itemsPerCast + 3];
      if (preload && preload.length >= 2) {
        preloadSettings = (preload[0]! << 8) | preload[1]!;
      }
    }

    let minMember = 0;
    let maxMember = 0;
    let id = c + 1;
    if (itemsPerCast >= 4) {
      const memberData = items[c * itemsPerCast + 4];
      if (memberData && memberData.length >= 8) {
        const itemReader = new BinaryReader(memberData, 'big');
        minMember = itemReader.readU16();
        maxMember = itemReader.readU16();
        id = itemReader.readI32();
      }
    }

    const memberCount = maxMember >= minMember ? maxMember - minMember + 1 : 0;
    entries.push({ name, path, preloadSettings, minMember, maxMember, memberCount, id });
  }

  return { entries };
}
