/**
 * Cast chunk (CAS*): array of CASt section IDs indexed by member slot.
 * Slot for index i = i + minMember. Always big-endian.
 */

import { BinaryReader } from '../io/binary-reader';

export interface CastChunk {
  /** CASt section ID per slot index; 0 = empty slot */
  memberIds: number[];
}

export function readCastChunk(data: Uint8Array): CastChunk {
  const reader = new BinaryReader(data, 'big');
  const memberIds: number[] = [];
  while (reader.bytesLeft() >= 4) {
    memberIds.push(reader.readI32());
  }
  return { memberIds };
}
