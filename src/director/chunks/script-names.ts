/**
 * Script names chunk (Lnam): the cast's Lingo symbol table.
 * Always big-endian. Ported from LibreShockwave ScriptNamesChunk.java.
 */

import { BinaryReader } from '../io/binary-reader';

export interface ScriptNamesChunk {
  names: string[];
}

export function readScriptNamesChunk(data: Uint8Array): ScriptNamesChunk {
  const reader = new BinaryReader(data, 'big');
  reader.readI32(); // unknown0
  reader.readI32(); // unknown1
  reader.readI32(); // len1
  reader.readI32(); // len2
  const namesOffset = reader.readU16();
  const namesCount = reader.readU16();

  const names: string[] = [];
  reader.seek(namesOffset);
  for (let i = 0; i < namesCount; i++) {
    const len = reader.readU8();
    names.push(reader.readStringMacRoman(len));
  }
  return { names };
}

export function getName(chunk: ScriptNamesChunk, index: number): string {
  return chunk.names[index] ?? `<unknown:${index}>`;
}

/**
 * Lazily-built lowercase name -> first index map. findName is on the VM's
 * hottest path (every method dispatch resolves the handler name through it),
 * and the names table runs to hundreds of entries, so a per-call linear scan
 * with per-entry toLowerCase dominated object-heavy room loads. The chunk is
 * immutable after parsing, so the index is safe to cache on it.
 */
const nameIndexCache = new WeakMap<ScriptNamesChunk, Map<string, number>>();

export function findName(chunk: ScriptNamesChunk, name: string): number {
  let index = nameIndexCache.get(chunk);
  if (!index) {
    index = new Map();
    for (let i = 0; i < chunk.names.length; i++) {
      const k = chunk.names[i]!.toLowerCase();
      if (!index.has(k)) index.set(k, i); // first match, matching findIndex
    }
    nameIndexCache.set(chunk, index);
  }
  const hit = index.get(name.toLowerCase());
  return hit === undefined ? -1 : hit;
}
