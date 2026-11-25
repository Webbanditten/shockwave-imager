/**
 * Director binary container parser (.dcr / .cct / .cst / .dir).
 * Supports afterburned (FGDM/FGDC) and uncompressed (MV93/MC95) formats.
 *
 * Container logic validated against the Habbo corpus by
 * tools/palette-extractor/src/director-file.ts (ProjectorRays lineage);
 * chunk dispatch and structure ported from LibreShockwave's DirectorFile.java.
 */

import { inflate } from 'pako';
import { BinaryReader, fourCCToString, type ByteOrder } from '../io/binary-reader';
import {
  FOURCC_RIFX,
  FOURCC_XFIR,
  FOURCC_FGDC,
  FOURCC_FGDM,
  FOURCC_MV93,
  FOURCC_MC95,
  FOURCC_Fver,
  FOURCC_Fcdr,
  FOURCC_ABMP,
  FOURCC_FGEI,
  FOURCC_free,
  FOURCC_junk,
  FOURCC_DRCF,
  FOURCC_VWCF,
  FOURCC_LctX,
} from './chunk-types';

/** 16-byte MoaID GUID identifying an Afterburner compression type. */
export type MoaID = string; // hex string form for cheap comparison

function readMoaID(reader: BinaryReader): MoaID {
  const data1 = reader.readU32();
  const data2 = reader.readU16();
  const data3 = reader.readU16();
  let hex =
    data1.toString(16).padStart(8, '0') +
    data2.toString(16).padStart(4, '0') +
    data3.toString(16).padStart(4, '0');
  for (let i = 0; i < 8; i++) {
    hex += reader.readU8().toString(16).padStart(2, '0');
  }
  return hex;
}

export const MOA_NULL_COMPRESSION: MoaID = 'ac99982e005d0d500000080007377a34';
export const MOA_ZLIB_COMPRESSION: MoaID = 'ac99e90400700b360000080007377a34';

export interface ChunkInfo {
  /** Section/resource ID */
  id: number;
  fourCC: number;
  /** Stored (possibly compressed) length */
  len: number;
  uncompressedLen: number;
  /** Afterburner: offset relative to ILS body; uncompressed: absolute file offset of chunk data */
  offset: number;
  compressionID: MoaID;
}

export class DirectorFile {
  readonly byteOrder: ByteOrder;
  readonly afterburned: boolean;
  /** Codec fourCC: FGDM/FGDC/MV93/MC95 */
  readonly codec: number;
  /** True if the file uses LctX (capital X) script context format */
  readonly capitalX: boolean;

  private readonly raw: Uint8Array;
  private readonly chunkInfoById = new Map<number, ChunkInfo>();
  private readonly chunkIdsByFourCC = new Map<number, number[]>();
  private readonly cachedChunkData = new Map<number, Uint8Array>();
  private ilsBodyOffset = 0;

  constructor(data: Uint8Array | ArrayBuffer) {
    this.raw = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const reader = new BinaryReader(this.raw);

    const signature = reader.readFourCC();
    if (signature === FOURCC_XFIR) {
      reader.order = 'little';
    } else if (signature !== FOURCC_RIFX) {
      throw new Error(`Unknown file signature: ${fourCCToString(signature)}`);
    }
    this.byteOrder = reader.order;

    reader.readU32(); // file length

    // FourCCs inside the container are byte-swapped in little-endian files
    const codec = reader.readU32();
    this.codec = codec;
    if (codec === FOURCC_FGDC || codec === FOURCC_FGDM) {
      this.afterburned = true;
      this.readAfterburnerMap(reader);
    } else if (codec === FOURCC_MV93 || codec === FOURCC_MC95) {
      this.afterburned = false;
      this.readMemoryMap(reader);
    } else {
      throw new Error(`Unknown codec: ${fourCCToString(codec)}`);
    }

    this.capitalX = this.chunkIdsByFourCC.has(FOURCC_LctX);
  }

  // --- chunk registry ---

  private addChunkInfo(info: ChunkInfo): void {
    this.chunkInfoById.set(info.id, info);
    let ids = this.chunkIdsByFourCC.get(info.fourCC);
    if (!ids) {
      ids = [];
      this.chunkIdsByFourCC.set(info.fourCC, ids);
    }
    ids.push(info.id);
  }

  allChunks(): ChunkInfo[] {
    return [...this.chunkInfoById.values()];
  }

  getChunkInfo(sectionId: number): ChunkInfo | undefined {
    return this.chunkInfoById.get(sectionId);
  }

  chunkIdsOf(fourCC: number): number[] {
    return this.chunkIdsByFourCC.get(fourCC) ?? [];
  }

  firstChunkId(fourCC: number): number | undefined {
    return this.chunkIdsByFourCC.get(fourCC)?.[0];
  }

  /** Config chunk id, whichever of DRCF/VWCF is present. */
  configChunkId(): number | undefined {
    return this.firstChunkId(FOURCC_DRCF) ?? this.firstChunkId(FOURCC_VWCF);
  }

  // --- afterburner path ---

  private readAfterburnerMap(reader: BinaryReader): void {
    // Fver (file version) — skipped
    const fverFourCC = reader.readU32();
    if (fverFourCC !== FOURCC_Fver) {
      throw new Error(`Expected Fver, got ${fourCCToString(fverFourCC)}`);
    }
    reader.skip(reader.readVarInt());

    // Fcdr (zlib-compressed compression directory of MoaIDs)
    const fcdrFourCC = reader.readU32();
    if (fcdrFourCC !== FOURCC_Fcdr) {
      throw new Error(`Expected Fcdr, got ${fourCCToString(fcdrFourCC)}`);
    }
    const fcdrLen = reader.readVarInt();
    const fcdr = new BinaryReader(inflate(reader.readBytes(fcdrLen)), this.byteOrder);
    const compressionTypeCount = fcdr.readU16();
    const compressionIDs: MoaID[] = [];
    for (let i = 0; i < compressionTypeCount; i++) {
      compressionIDs.push(readMoaID(fcdr));
    }
    // (compression description cStrings follow; not needed)

    // ABMP (afterburner resource map)
    const abmpFourCC = reader.readU32();
    if (abmpFourCC !== FOURCC_ABMP) {
      throw new Error(`Expected ABMP, got ${fourCCToString(abmpFourCC)}`);
    }
    const abmpLen = reader.readVarInt();
    const abmpEnd = reader.position + abmpLen;
    reader.readVarInt(); // compression type
    reader.readVarInt(); // uncompressed length
    const abmp = new BinaryReader(
      inflate(reader.readBytes(abmpEnd - reader.position)),
      this.byteOrder,
    );

    abmp.readVarInt(); // unknown
    abmp.readVarInt(); // unknown
    const resCount = abmp.readVarInt();
    for (let i = 0; i < resCount; i++) {
      const id = abmp.readVarInt();
      const offset = abmp.readVarInt();
      const compSize = abmp.readVarInt();
      const uncompSize = abmp.readVarInt();
      const compressionType = abmp.readVarInt();
      const tag = abmp.readU32();
      this.addChunkInfo({
        id,
        fourCC: tag,
        len: compSize,
        uncompressedLen: uncompSize,
        offset,
        compressionID: compressionIDs[compressionType] ?? MOA_NULL_COMPRESSION,
      });
    }

    // FGEI — Initial Load Segment. Section 2 is the ILS body; chunks inside it
    // are stored back-to-back and cached eagerly. All other chunk offsets are
    // relative to the ILS body start.
    const fgeiFourCC = reader.readU32();
    if (fgeiFourCC !== FOURCC_FGEI) {
      throw new Error(`Expected FGEI, got ${fourCCToString(fgeiFourCC)}`);
    }
    const ilsInfo = this.chunkInfoById.get(2);
    if (!ilsInfo) {
      throw new Error('Afterburner map has no ILS chunk (section 2)');
    }
    reader.readVarInt(); // unknown
    this.ilsBodyOffset = reader.position;

    const ilsCompressed = reader.readBytes(ilsInfo.len);
    try {
      const ils = new BinaryReader(inflate(ilsCompressed), this.byteOrder);
      while (!ils.eof()) {
        const resId = ils.readVarInt();
        const info = this.chunkInfoById.get(resId);
        if (!info) break;
        const chunkData = ils.readBytes(info.len);
        if (info.compressionID === MOA_ZLIB_COMPRESSION) {
          try {
            this.cachedChunkData.set(resId, inflate(chunkData));
          } catch {
            this.cachedChunkData.set(resId, chunkData);
          }
        } else {
          this.cachedChunkData.set(resId, chunkData);
        }
      }
    } catch {
      // ILS decompression failed — chunks will be read from file offsets
    }
  }

  // --- uncompressed path (imap/mmap) ---

  private readMemoryMap(reader: BinaryReader): void {
    reader.readU32(); // imap fourCC
    reader.readU32(); // imap length
    reader.readU32(); // mmap count
    const mmapOffset = reader.readU32();

    reader.seek(mmapOffset);
    reader.readU32(); // mmap fourCC
    reader.readU32(); // mmap length
    reader.readU16(); // header size
    const entrySize = reader.readU16();
    reader.readI32(); // chunk count max
    const chunkCountUsed = reader.readI32();
    reader.readI32(); // junk entry id
    reader.readI32(); // unknown
    reader.readI32(); // free head

    for (let i = 0; i < chunkCountUsed; i++) {
      const fourCCValue = reader.readU32();
      const length = reader.readU32();
      const offset = reader.readU32();
      reader.skip(entrySize - 12);

      if (fourCCValue === FOURCC_free || fourCCValue === FOURCC_junk) continue;

      this.addChunkInfo({
        id: i,
        fourCC: fourCCValue,
        len: length,
        uncompressedLen: length,
        offset: offset + 8, // skip the chunk's own fourCC + length header
        compressionID: MOA_NULL_COMPRESSION,
      });
    }
  }

  // --- chunk data access ---

  /** Whether a chunk section exists — lets media decoders skip a dangling
   *  reference (a member whose bitd/clut section id is not present in this
   *  cast) instead of throwing and crashing the caller. */
  hasChunk(sectionId: number): boolean {
    return this.cachedChunkData.has(sectionId) || this.chunkInfoById.has(sectionId);
  }

  /** Raw (decompressed) bytes of a chunk by section ID. */
  getChunkData(sectionId: number): Uint8Array {
    const cached = this.cachedChunkData.get(sectionId);
    if (cached) return cached;

    const info = this.chunkInfoById.get(sectionId);
    if (!info) {
      throw new Error(`Chunk section ${sectionId} not found`);
    }

    let data: Uint8Array;
    if (this.afterburned) {
      const start = this.ilsBodyOffset + info.offset;
      data = this.raw.subarray(start, start + info.len);
      if (info.compressionID === MOA_ZLIB_COMPRESSION && info.len > 0) {
        try {
          data = inflate(data);
        } catch {
          // keep raw bytes
        }
      }
    } else {
      data = this.raw.subarray(info.offset, info.offset + info.len);
    }
    this.cachedChunkData.set(sectionId, data);
    return data;
  }

  /** A BinaryReader over a chunk's data, in the file's byte order. */
  chunkReader(sectionId: number): BinaryReader {
    return new BinaryReader(this.getChunkData(sectionId), this.byteOrder);
  }
}
