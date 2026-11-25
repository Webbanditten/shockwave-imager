/**
 * Cast member definition chunk (CASt). Always big-endian.
 * Ported from LibreShockwave CastMemberChunk.java (D5+ and D4 layouts).
 */

import { BinaryReader } from '../io/binary-reader';
import { MemberType, memberTypeFromCode } from '../cast/member-type';
import { parseBitmapInfo } from '../cast/bitmap-info';

export interface CastMemberChunk {
  memberType: MemberType;
  info: Uint8Array;
  specificData: Uint8Array;
  name: string;
  scriptId: number;
  regPointX: number;
  regPointY: number;
}

/** Script member sub-types stored in the first u16 of a script member's specificData. */
export enum ScriptType {
  Score = 1,
  Behavior = 2,
  Movie = 3,
  Parent = 7,
  Unknown = -1,
}

export function scriptTypeFromCode(code: number): ScriptType {
  switch (code) {
    case 1:
      return ScriptType.Score;
    case 2:
      return ScriptType.Behavior;
    case 3:
      return ScriptType.Movie;
    case 7:
      return ScriptType.Parent;
    default:
      return ScriptType.Unknown;
  }
}

/** Script sub-type of a script cast member, or Unknown for non-scripts. */
export function getMemberScriptType(member: CastMemberChunk): ScriptType {
  if (member.memberType !== MemberType.Script || member.specificData.length < 2) {
    return ScriptType.Unknown;
  }
  const code = (member.specificData[0]! << 8) | member.specificData[1]!;
  return scriptTypeFromCode(code);
}

export function readCastMemberChunk(data: Uint8Array, version: number): CastMemberChunk {
  const reader = new BinaryReader(data, 'big');

  let memberType: MemberType;
  let info: Uint8Array = new Uint8Array(0);
  let specificData: Uint8Array = new Uint8Array(0);

  if (version >= 0x4b1) {
    // D5+: type(u32), infoLen(u32), specificDataLen(u32), info, specificData
    memberType = memberTypeFromCode(reader.readI32());
    const infoLen = reader.readI32();
    const dataLen = reader.readI32();
    if (infoLen > 0 && reader.bytesLeft() >= infoLen) {
      info = reader.readBytes(infoLen);
    }
    if (dataLen > 0 && reader.bytesLeft() >= dataLen) {
      specificData = reader.readBytes(dataLen);
    }
  } else {
    // D4: specificDataLen(u16), infoLen(u32), type(u8), [flags(u8)], specificData, info
    const specificDataLen = reader.readU16();
    const infoLen = reader.readI32();
    memberType = memberTypeFromCode(reader.readU8());
    let specificDataLeft = specificDataLen - 1;
    if (specificDataLeft > 0 && reader.bytesLeft() > 0) {
      reader.skip(1); // flags byte
      specificDataLeft -= 1;
    }
    if (specificDataLeft > 0 && reader.bytesLeft() >= specificDataLeft) {
      specificData = reader.readBytes(specificDataLeft);
    }
    if (infoLen > 0 && reader.bytesLeft() >= infoLen) {
      info = reader.readBytes(infoLen);
    }
  }

  let regPointX = 0;
  let regPointY = 0;
  if (memberType === MemberType.Bitmap && specificData.length >= 22) {
    const bi = parseBitmapInfo(specificData, version >= 0x4b1 ? 1200 : 1100);
    regPointX = bi.regX;
    regPointY = bi.regY;
  }

  // CastInfoChunk (ListChunk): name at item index 1, scriptId in header
  let name = '';
  let scriptId = 0;
  if (info.length >= 20) {
    const infoReader = new BinaryReader(info, 'big');
    const dataOffset = infoReader.readI32();
    infoReader.readI32(); // unk1
    infoReader.readI32(); // unk2
    infoReader.readI32(); // flags
    scriptId = infoReader.readI32();

    if (dataOffset > 0 && dataOffset < info.length) {
      infoReader.seek(dataOffset);
      const offsetTableLen = infoReader.readU16();
      if (offsetTableLen > 0 && infoReader.bytesLeft() >= offsetTableLen * 4 + 4) {
        const offsets: number[] = [];
        for (let i = 0; i < offsetTableLen; i++) {
          offsets.push(infoReader.readI32());
        }
        const itemsLen = infoReader.readI32();
        const itemsStart = infoReader.position;

        if (offsetTableLen > 1) {
          const nameOffset = offsets[1]!;
          const nameEnd = offsetTableLen > 2 ? offsets[2]! : itemsLen;
          const nameLen = nameEnd - nameOffset;
          if (nameLen > 0 && itemsStart + nameOffset < info.length) {
            infoReader.seek(itemsStart + nameOffset);
            const pascalLen = infoReader.readU8();
            if (pascalLen > 0 && infoReader.bytesLeft() >= pascalLen) {
              name = infoReader.readStringMacRoman(pascalLen);
            }
          }
        }
      }
    }
  }

  return { memberType, info, specificData, name, scriptId, regPointX, regPointY };
}
