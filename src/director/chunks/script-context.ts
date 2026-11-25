/**
 * Script context chunk (Lctx/LctX): maps script numbers to Lscr section IDs
 * and names the cast's Lnam. Always big-endian.
 * Ported from LibreShockwave ScriptContextChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface ScriptContextEntry {
  unknown: number;
  /** Lscr section ID; 0 = free slot */
  sectionId: number;
  flags: number;
}

export interface ScriptContextChunk {
  entryCount: number;
  lnamSectionId: number;
  validCount: number;
  flags: number;
  entries: ScriptContextEntry[];
}

export function readScriptContextChunk(data: Uint8Array): ScriptContextChunk {
  const reader = new BinaryReader(data, 'big');
  reader.readI32(); // unknown1
  reader.readI32(); // unknown2
  const entryCount = reader.readI32();
  reader.readI32(); // entryCount2
  const entriesOffset = reader.readU16();
  reader.skip(2); // unknown
  reader.skip(4);
  reader.skip(4);
  reader.skip(4);
  const lnamSectionId = Math.max(0, reader.readI32());
  const validCount = reader.readU16();
  const flags = reader.readU16();
  reader.readI16(); // free pointer

  const entries: ScriptContextEntry[] = [];
  if (entriesOffset > 0 && entriesOffset < reader.length) {
    reader.seek(entriesOffset);
    for (let i = 0; i < entryCount; i++) {
      const unknown = reader.readI32();
      const sectionId = Math.max(0, reader.readI32());
      const entryFlags = reader.readU16();
      reader.readI16(); // link
      entries.push({ unknown, sectionId, flags: entryFlags });
    }
  }

  return { entryCount, lnamSectionId, validCount, flags, entries };
}
