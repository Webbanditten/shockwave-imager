/**
 * Script bytecode chunk (Lscr): compiled Lingo for one script.
 * Always big-endian. Ported from LibreShockwave ScriptChunk.java
 * (ProjectorRays handler.cpp lineage). 92-byte header layout documented in
 * tools/director-cast-editor/DEVELOPMENT.md.
 */

import { BinaryReader } from '../io/binary-reader';
import { Opcode, opcodeFromRaw } from '../lingo/opcode';
import { ScriptType, scriptTypeFromCode } from './cast-member';

export interface Instruction {
  /** Byte offset within the handler's bytecode */
  offset: number;
  opcode: Opcode;
  rawOpcode: number;
  argument: number;
}

export interface Handler {
  nameId: number;
  handlerVectorPos: number;
  argNameIds: number[];
  localNameIds: number[];
  globalsCount: number;
  lineCount: number;
  instructions: Instruction[];
  /** bytecode offset -> instruction index, for jump targets */
  bytecodeIndexMap: Map<number, number>;
}

export type LiteralValue =
  | { kind: 'string'; value: string }
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'bytes'; value: Uint8Array };

export interface ScriptChunk {
  scriptType: ScriptType;
  behaviorFlags: number;
  /** Cast member slot association: castMemberAssoc = scriptNumber field */
  scriptNumber: number;
  handlers: Handler[];
  literals: LiteralValue[];
  /** Lnam name IDs of declared properties */
  propertyNameIds: number[];
  /** Lnam name IDs of declared globals */
  globalNameIds: number[];
}

export function readScriptChunk(data: Uint8Array, version: number, capitalX: boolean): ScriptChunk {
  const reader = new BinaryReader(data, 'big');

  reader.seek(8);
  reader.readI32(); // total length
  reader.readI32(); // total length 2
  reader.readU16(); // header length
  const scriptNumber = reader.readU16();

  reader.seek(38);
  const behaviorFlags = reader.readI32();
  let scriptTypeCode = behaviorFlags & 0x0f;
  if (scriptTypeCode === 0) {
    scriptTypeCode = scriptNumber;
  }

  reader.seek(50);
  reader.readU16(); // handler vectors count
  reader.readI32(); // handler vectors offset
  reader.readI32(); // handler vectors size
  const propertyCount = reader.readU16();
  const propertiesOffset = reader.readI32();
  const globalCount = reader.readU16();
  const globalsOffset = reader.readI32();
  const handlerInfoCount = reader.readU16();
  const handlersOffset = reader.readI32();
  const literalCount = reader.readU16();
  const literalsOffset = reader.readI32();
  reader.readI32(); // literal data length
  const literalDataOffset = reader.readI32();

  const propertyNameIds: number[] = [];
  if (propertyCount > 0 && propertiesOffset > 0) {
    reader.seek(propertiesOffset);
    for (let i = 0; i < propertyCount; i++) {
      propertyNameIds.push(reader.readI16());
    }
  }

  const globalNameIds: number[] = [];
  if (globalCount > 0 && globalsOffset > 0) {
    reader.seek(globalsOffset);
    for (let i = 0; i < globalCount; i++) {
      globalNameIds.push(reader.readI16());
    }
  }

  const literals: LiteralValue[] = [];
  if (literalCount > 0 && literalsOffset > 0) {
    reader.seek(literalsOffset);
    const literalInfo: Array<[number, number]> = [];
    for (let i = 0; i < literalCount; i++) {
      // Pre-D5 literal type is u16; D5+ is u32
      const type = version < 0x4b1 ? reader.readU16() : reader.readI32();
      const offset = reader.readI32();
      literalInfo.push([type, offset]);
    }

    for (const [type, offset] of literalInfo) {
      switch (type) {
        case 1: {
          // String (length includes null terminator)
          reader.seek(literalDataOffset + offset);
          const dataLen = reader.readI32();
          let s = reader.readStringMacRoman(dataLen);
          if (s.endsWith('\0')) s = s.slice(0, -1);
          literals.push({ kind: 'string', value: s });
          break;
        }
        case 4:
          // D5+ integer literals are stored inline in the offset field
          literals.push({ kind: 'int', value: offset });
          break;
        case 9: {
          reader.seek(literalDataOffset + offset);
          const dataLen = reader.readI32();
          // Float width is carried by the literal's data length, not fixed at 4
          // bytes. Director MX 2004 (D10) stores Lingo float literals as 8-byte
          // IEEE doubles; older movies use the 10-byte Apple SANE extended
          // format. Always reading F32 grabbed the high 4 bytes of a double,
          // decoding e.g. 0.9 as 1.85 — which silently corrupted every scripted
          // float constant (chat-bubble colour darkening `c.red * 0.9` blew past
          // 255 and clamped to white).
          let value: number;
          if (dataLen >= 10) value = reader.readAppleFloat80();
          else if (dataLen === 8) value = reader.readF64();
          else value = reader.readF32();
          literals.push({ kind: 'float', value });
          break;
        }
        default: {
          reader.seek(literalDataOffset + offset);
          const dataLen = reader.readI32();
          literals.push({ kind: 'bytes', value: reader.readBytes(dataLen) });
        }
      }
    }
  }

  const handlers: Handler[] = [];
  if (handlerInfoCount > 0 && handlersOffset > 0) {
    reader.seek(handlersOffset);
    for (let i = 0; i < handlerInfoCount; i++) {
      const nameId = reader.readI16();
      const handlerVectorPos = reader.readU16();
      const bytecodeLen = reader.readI32();
      const bytecodeOffset = reader.readI32();
      const argCount = reader.readU16();
      const argOffset = reader.readI32();
      const localCount = reader.readU16();
      const localOffset = reader.readI32();
      const globalsCount = reader.readU16();
      reader.readI32(); // handler globals offset
      reader.readI32(); // unknown1
      reader.readU16(); // unknown2
      const lineCount = reader.readU16();
      reader.readI32(); // line offset
      if (capitalX) {
        reader.readI32(); // stack height (LctX only)
      }

      const savedPos = reader.position;

      const argNameIds: number[] = [];
      if (argCount > 0 && argOffset > 0) {
        reader.seek(argOffset);
        for (let j = 0; j < argCount; j++) {
          argNameIds.push(reader.readU16());
        }
      }

      const localNameIds: number[] = [];
      if (localCount > 0 && localOffset > 0) {
        reader.seek(localOffset);
        for (let j = 0; j < localCount; j++) {
          localNameIds.push(reader.readU16());
        }
      }

      const instructions: Instruction[] = [];
      const bytecodeIndexMap = new Map<number, number>();
      if (bytecodeLen > 0 && bytecodeOffset > 0) {
        reader.seek(bytecodeOffset);
        const bytecodeEnd = bytecodeOffset + bytecodeLen;
        while (reader.position < bytecodeEnd) {
          const instrOffset = reader.position - bytecodeOffset;
          const raw = reader.readU8();
          const opcode = opcodeFromRaw(raw);

          // Argument width comes from the RAW byte's range, not the opcode
          let argument = 0;
          if (raw >= 0xc0) {
            argument = reader.readI32();
          } else if (raw >= 0x80) {
            argument =
              opcode === Opcode.PushInt16 || opcode === Opcode.PushInt8
                ? reader.readI16()
                : reader.readU16();
          } else if (raw >= 0x40) {
            argument = opcode === Opcode.PushInt8 ? reader.readI8() : reader.readU8();
          }

          bytecodeIndexMap.set(instrOffset, instructions.length);
          instructions.push({ offset: instrOffset, opcode, rawOpcode: raw, argument });
        }
      }

      reader.seek(savedPos);
      handlers.push({
        nameId,
        handlerVectorPos,
        argNameIds,
        localNameIds,
        globalsCount,
        lineCount,
        instructions,
        bytecodeIndexMap,
      });
    }
  }

  return {
    scriptType: scriptTypeFromCode(scriptTypeCode),
    behaviorFlags,
    scriptNumber,
    handlers,
    literals,
    propertyNameIds,
    globalNameIds,
  };
}
