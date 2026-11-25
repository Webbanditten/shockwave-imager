/**
 * Endian-aware binary reader for Director file formats.
 * Supports both big-endian (Macintosh) and little-endian (Windows) byte orders.
 *
 * API modeled on LibreShockwave's sdk BinaryReader.java, backed by DataView so it
 * runs in both browser and Node without Buffer.
 */

export type ByteOrder = 'big' | 'little';

// Director strings are MacRoman. The WHATWG Encoding Standard's "macintosh" label
// covers it; fall back to latin1 if a runtime lacks it.
const macRomanDecoder: TextDecoder = (() => {
  try {
    return new TextDecoder('macintosh');
  } catch {
    return new TextDecoder('latin1');
  }
})();

const asciiDecoder = new TextDecoder('latin1');
const utf8Decoder = new TextDecoder('utf-8');

/** Convert a 4-character string to a FourCC integer (big-endian). */
export function fourCC(s: string): number {
  if (s.length !== 4) {
    throw new Error('FourCC must be exactly 4 characters');
  }
  return (
    ((s.charCodeAt(0) << 24) |
      (s.charCodeAt(1) << 16) |
      (s.charCodeAt(2) << 8) |
      s.charCodeAt(3)) >>>
    0
  );
}

/** Convert a FourCC integer back to its 4-character string. */
export function fourCCToString(n: number): string {
  return String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export class BinaryReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;
  private little: boolean;

  constructor(data: Uint8Array | ArrayBuffer, order: ByteOrder = 'big') {
    this.bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.little = order === 'little';
  }

  // Endian control

  get order(): ByteOrder {
    return this.little ? 'little' : 'big';
  }

  set order(order: ByteOrder) {
    this.little = order === 'little';
  }

  isBigEndian(): boolean {
    return !this.little;
  }

  isLittleEndian(): boolean {
    return this.little;
  }

  // Position control

  get position(): number {
    return this.pos;
  }

  set position(value: number) {
    this.pos = value;
  }

  seek(offset: number): void {
    this.pos = offset;
  }

  skip(bytes: number): void {
    this.pos += bytes;
  }

  get length(): number {
    return this.bytes.length;
  }

  bytesLeft(): number {
    return Math.max(0, this.bytes.length - this.pos);
  }

  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  private check(length: number): void {
    if (length < 0 || length > this.bytes.length - this.pos) {
      throw new RangeError(
        `Cannot read ${length} bytes at position ${this.pos} ` +
          `(data length: ${this.bytes.length}, remaining: ${this.bytes.length - this.pos})`,
      );
    }
  }

  // Primitive reads

  readI8(): number {
    this.check(1);
    return this.view.getInt8(this.pos++);
  }

  readU8(): number {
    this.check(1);
    return this.view.getUint8(this.pos++);
  }

  readI16(): number {
    this.check(2);
    const v = this.view.getInt16(this.pos, this.little);
    this.pos += 2;
    return v;
  }

  readU16(): number {
    this.check(2);
    const v = this.view.getUint16(this.pos, this.little);
    this.pos += 2;
    return v;
  }

  readI32(): number {
    this.check(4);
    const v = this.view.getInt32(this.pos, this.little);
    this.pos += 4;
    return v;
  }

  readU32(): number {
    this.check(4);
    const v = this.view.getUint32(this.pos, this.little);
    this.pos += 4;
    return v;
  }

  readI64(): bigint {
    this.check(8);
    const v = this.view.getBigInt64(this.pos, this.little);
    this.pos += 8;
    return v;
  }

  readF32(): number {
    this.check(4);
    const v = this.view.getFloat32(this.pos, this.little);
    this.pos += 4;
    return v;
  }

  readF64(): number {
    this.check(8);
    const v = this.view.getFloat64(this.pos, this.little);
    this.pos += 8;
    return v;
  }

  // Byte array reads — returned views alias the underlying buffer; copy if you mutate.

  readBytes(length: number): Uint8Array {
    this.check(length);
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  peekBytes(length: number): Uint8Array {
    this.check(length);
    return this.bytes.subarray(this.pos, this.pos + length);
  }

  // FourCC reads (always big-endian regardless of reader byte order)

  readFourCC(): number {
    this.check(4);
    const b = this.bytes;
    const p = this.pos;
    this.pos += 4;
    return (((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0);
  }

  readFourCCString(): string {
    return fourCCToString(this.readFourCC());
  }

  // String reads

  readString(length: number): string {
    return utf8Decoder.decode(this.readBytes(length));
  }

  readStringAscii(length: number): string {
    return asciiDecoder.decode(this.readBytes(length));
  }

  readStringMacRoman(length: number): string {
    return macRomanDecoder.decode(this.readBytes(length));
  }

  /** 8-bit length-prefixed MacRoman string. */
  readPascalString(): string {
    const length = this.readU8();
    return this.readStringMacRoman(length);
  }

  /** 16-bit length-prefixed string. */
  readPString16(): string {
    const length = this.readU16();
    if (length === 0) return '';
    return this.readString(length);
  }

  readNullTerminatedString(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0) {
      this.pos++;
    }
    const result = utf8Decoder.decode(this.bytes.subarray(start, this.pos));
    if (this.pos < this.bytes.length) {
      this.pos++; // skip null terminator
    }
    return result;
  }

  // Variable-length integer (used in Afterburner format).
  // High bit = continuation flag, 7 data bits per byte.

  readVarInt(): number {
    let value = 0;
    let b: number;
    do {
      if (this.pos >= this.bytes.length) return value;
      b = this.bytes[this.pos++]!;
      value = (value << 7) | (b & 0x7f);
    } while ((b & 0x80) !== 0);
    return value >>> 0;
  }

  // Apple 80-bit extended float (SANE format), used in Lingo float literals.

  readAppleFloat80(): number {
    const b = this.readBytes(10);

    let exponent = (b[0]! << 8) | b[1]!;
    const sign = (exponent & 0x8000) !== 0 ? 1n : 0n;
    exponent &= 0x7fff;

    let fraction = 0n;
    for (let i = 2; i < 10; i++) {
      fraction = (fraction << 8n) | BigInt(b[i]!);
    }
    fraction &= 0x7fffffffffffffffn;

    let f64exp: bigint;
    if (exponent === 0) {
      f64exp = 0n;
    } else if (exponent === 0x7fff) {
      f64exp = 0x7ffn;
    } else {
      const normexp = exponent - 0x3fff;
      if (normexp < -0x3fe || normexp >= 0x3ff) {
        return 0; // Exponent out of range for double
      }
      f64exp = BigInt(normexp + 0x3ff);
    }

    const f64bits = (sign << 63n) | (f64exp << 52n) | (fraction >> 11n);
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigUint64(0, f64bits);
    return buf.getFloat64(0);
  }

  // Slicing

  sliceReader(length: number): BinaryReader {
    return new BinaryReader(this.readBytes(length), this.order);
  }

  sliceReaderAt(offset: number, length: number): BinaryReader {
    if (offset < 0 || offset + length > this.bytes.length) {
      throw new RangeError(
        `Cannot slice ${length} bytes at offset ${offset} (data length: ${this.bytes.length})`,
      );
    }
    return new BinaryReader(this.bytes.subarray(offset, offset + length), this.order);
  }
}
