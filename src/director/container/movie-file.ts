/**
 * High-level typed view over a DirectorFile: config, cast members by slot,
 * scripts, score, labels. This is the surface the player consumes.
 */

import { DirectorFile } from './director-file';
import {
  FOURCC_CASp,
  FOURCC_CASt,
  FOURCC_KEYp,
  FOURCC_Lctx,
  FOURCC_LctX,
  FOURCC_Lnam,
  FOURCC_Lscr,
  FOURCC_MCsL,
  FOURCC_VWLB,
  FOURCC_VWSC,
  FOURCC_SCVW,
} from './chunk-types';
import { readConfigChunk, type ConfigChunk } from '../chunks/config';
import { readKeyTableChunk, type KeyTableChunk } from '../chunks/key-table';
import { readCastChunk } from '../chunks/cast';
import { readCastListChunk, type CastListChunk } from '../chunks/cast-list';
import { readCastMemberChunk, type CastMemberChunk } from '../chunks/cast-member';
import { readScriptContextChunk, type ScriptContextChunk } from '../chunks/script-context';
import { readScriptNamesChunk, type ScriptNamesChunk } from '../chunks/script-names';
import { readScriptChunk, type ScriptChunk } from '../chunks/script';
import { readScoreChunk, type ScoreChunk } from '../chunks/score';
import { readFrameLabelsChunk, type FrameLabelsChunk } from '../chunks/frame-labels';
import { readPaletteChunk } from '../chunks/palette';
import { FOURCC_BITD, FOURCC_CLUT } from './chunk-types';
import { MemberType } from '../cast/member-type';
import { parseBitmapInfo } from '../cast/bitmap-info';
import { builtinPalette, paletteFromClut, type Palette } from '../media/palette';
import { decodeBitmap } from '../media/bitmap-decoder';
import { type Bitmap } from '../media/bitmap';

export interface CastMemberSlot {
  /** Member slot number (CAS* index + minMember) */
  slot: number;
  /** CASt chunk section ID — the KEY* owner id for this member's media */
  castSectionId: number;
  member: CastMemberChunk;
}

export class MovieFile {
  readonly file: DirectorFile;
  readonly config: ConfigChunk | null;
  readonly keyTable: KeyTableChunk | null;
  readonly castList: CastListChunk | null;
  readonly scriptContext: ScriptContextChunk | null;
  readonly scriptNames: ScriptNamesChunk | null;
  readonly score: ScoreChunk | null;
  readonly frameLabels: FrameLabelsChunk | null;
  /** Cast members in slot order */
  readonly members: CastMemberSlot[];
  /** castSectionId -> member */
  readonly membersBySection: Map<number, CastMemberSlot>;
  /** slot -> member */
  readonly membersBySlot: Map<number, CastMemberSlot>;
  /** Lscr section id -> parsed script */
  readonly scripts: Map<number, ScriptChunk>;

  constructor(data: Uint8Array | ArrayBuffer) {
    const file = new DirectorFile(data);
    this.file = file;

    const configId = file.configChunkId();
    this.config = configId !== undefined ? readConfigChunk(file.getChunkData(configId)) : null;
    const version = this.config?.directorVersion ?? 0;

    const keyId = file.firstChunkId(FOURCC_KEYp);
    this.keyTable = keyId !== undefined ? readKeyTableChunk(file.chunkReader(keyId)) : null;

    const mcslId = file.firstChunkId(FOURCC_MCsL);
    this.castList = mcslId !== undefined ? readCastListChunk(file.getChunkData(mcslId)) : null;

    // Cast members: CAS* index i -> slot i + minMember
    this.members = [];
    this.membersBySection = new Map();
    this.membersBySlot = new Map();
    const casId = file.firstChunkId(FOURCC_CASp);
    if (casId !== undefined) {
      const cas = readCastChunk(file.getChunkData(casId));
      const minMember = this.castList?.entries[0]?.minMember ?? this.config?.minMember ?? 1;
      for (let i = 0; i < cas.memberIds.length; i++) {
        const castSectionId = cas.memberIds[i]!;
        if (castSectionId <= 0) continue;
        if (file.getChunkInfo(castSectionId)?.fourCC !== FOURCC_CASt) continue;
        try {
          const member = readCastMemberChunk(file.getChunkData(castSectionId), version || 0x4b1);
          const slot: CastMemberSlot = { slot: i + minMember, castSectionId, member };
          this.members.push(slot);
          this.membersBySection.set(castSectionId, slot);
          this.membersBySlot.set(slot.slot, slot);
        } catch {
          // skip unparseable members; corpus test counts these
        }
      }
    }

    // Scripts
    const lctxId = file.firstChunkId(FOURCC_LctX) ?? file.firstChunkId(FOURCC_Lctx);
    this.scriptContext =
      lctxId !== undefined ? readScriptContextChunk(file.getChunkData(lctxId)) : null;

    let lnamId = this.scriptContext?.lnamSectionId;
    if (!lnamId || file.getChunkInfo(lnamId)?.fourCC !== FOURCC_Lnam) {
      lnamId = file.firstChunkId(FOURCC_Lnam);
    }
    this.scriptNames = lnamId !== undefined ? readScriptNamesChunk(file.getChunkData(lnamId)) : null;

    this.scripts = new Map();
    for (const id of file.chunkIdsOf(FOURCC_Lscr)) {
      try {
        this.scripts.set(id, readScriptChunk(file.getChunkData(id), version || 0x4b1, file.capitalX));
      } catch {
        // skip unparseable scripts; corpus test counts these
      }
    }

    // Score + labels (movies only; external casts have neither)
    const scoreId = file.firstChunkId(FOURCC_VWSC) ?? file.firstChunkId(FOURCC_SCVW);
    this.score = scoreId !== undefined ? readScoreChunk(file.getChunkData(scoreId)) : null;

    const labelsId = file.firstChunkId(FOURCC_VWLB);
    this.frameLabels =
      labelsId !== undefined ? readFrameLabelsChunk(file.getChunkData(labelsId)) : null;
  }

  /** Resolve the section ID of a media chunk owned by a member (e.g. BITD, CLUT, snd ). */
  mediaSectionId(member: CastMemberSlot, fourCC: number): number | undefined {
    if (!this.keyTable) return undefined;
    return this.keyTable.entriesByOwner
      .get(member.castSectionId)
      ?.find((e) => e.fourCC === fourCC)?.sectionId;
  }

  /**
   * Resolve a member's Lingo script. The CASt info header's scriptId is a
   * 1-based index into the Lctx entry table, whose entry names the Lscr section.
   */
  scriptForMember(member: CastMemberSlot): ScriptChunk | undefined {
    const scriptId = member.member.scriptId;
    if (scriptId <= 0 || !this.scriptContext) return undefined;
    const entry = this.scriptContext.entries[scriptId - 1];
    if (!entry || entry.sectionId <= 0) return undefined;
    return this.scripts.get(entry.sectionId);
  }

  /**
   * Resolve the palette for a bitmap member within this cast.
   * paletteId >= 0 is the slot of a palette member minus 1 offset already
   * applied (BitmapInfo stores clutId-1); negative IDs are built-ins.
   * Cross-cast palette references resolve through the player's cast manager,
   * not here.
   */
  paletteForBitmap(info: { paletteId: number }): Palette {
    if (info.paletteId < 0) {
      return builtinPalette(info.paletteId);
    }
    // paletteId + 1 = palette member slot in this cast
    const slot = this.membersBySlot.get(info.paletteId + 1);
    if (slot && slot.member.memberType === MemberType.Palette) {
      const clutId = this.mediaSectionId(slot, FOURCC_CLUT);
      if (clutId !== undefined && this.file.hasChunk(clutId)) {
        const clut = readPaletteChunk(this.file.getChunkData(clutId));
        return paletteFromClut(slot.member.name || `palette_${slot.slot}`, clut.colors);
      }
    }
    return builtinPalette(-1);
  }

  /** Decode a bitmap member's pixels, resolving its palette within this cast.
   *  paletteOverride wins when given (stale authoring palette refs are
   *  corrected by the player's PALETTE_OVERRIDES table). */
  decodeBitmapMember(member: CastMemberSlot, paletteOverride?: Palette): Bitmap | null {
    if (member.member.memberType !== MemberType.Bitmap) return null;
    const info = parseBitmapInfo(
      member.member.specificData,
      this.config?.directorVersion ?? 1200,
    );
    const bitdId = this.mediaSectionId(member, FOURCC_BITD);
    // A member can carry a bitd section id that is not present in this cast
    // (dangling/external media reference). Decode nothing rather than letting
    // getChunkData throw and crash the caller (a mouseUp/render dispatch).
    if (bitdId === undefined || !this.file.hasChunk(bitdId)) return null;
    const palette =
      info.bitDepth <= 8 ? (paletteOverride ?? this.paletteForBitmap(info)) : undefined;
    return decodeBitmap(this.file.getChunkData(bitdId), info, palette);
  }
}
