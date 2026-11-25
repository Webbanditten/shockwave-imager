/**
 * Animated PNG (APNG) writer. Frames are full RGBA canvases of one size; a frame that equals the one before only
 * lengthens it, and every other frame stores just the rectangle that changed (dispose none, blend source), so a puff
 * of smoke costs its own few pixels. The first frame is the normal PNG image, so viewers without APNG show it still.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function u32s(...values: number[]) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0));
  return out;
}

/** Filtered, deflated scanlines of a w x h region of an RGBA canvas (filter per row: the smallest sum wins). */
function imageData(rgba: Uint8ClampedArray, stride: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const row = w * 4;
  const raw = new Uint8Array((row + 1) * h);
  const prev = new Uint8Array(row);
  const cur = new Uint8Array(row);
  const candidate = new Uint8Array(row);
  const best = new Uint8Array(row);
  for (let y = 0; y < h; y++) {
    cur.set(rgba.subarray(((y0 + y) * stride + x0) * 4, ((y0 + y) * stride + x0 + w) * 4));
    let bestType = 0;
    let bestSum = Infinity;
    for (let type = 0; type < 5; type++) {
      let sum = 0;
      for (let i = 0; i < row; i++) {
        const a = i >= 4 ? cur[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        let v = cur[i];
        if (type === 1) v -= a;
        else if (type === 2) v -= b;
        else if (type === 3) v -= (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        candidate[i] = v & 255;
        sum += candidate[i] < 128 ? candidate[i] : 256 - candidate[i];
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (row + 1)] = bestType;
    raw.set(best, y * (row + 1) + 1);
    prev.set(cur);
  }
  return deflateSync(raw, { level: 9 });
}

export interface ApngFrame {
  rgba: Uint8ClampedArray;
  /** how long it shows, in 1/fps seconds */
  ticks: number;
}

/** An APNG of frames that all share width x height; plays = 0 loops forever. One distinct frame gives a plain PNG. */
export function encodeApng(width: number, height: number, input: ApngFrame[], fps: number, plays = 0): Buffer {
  // Merge frames equal to the one before.
  const frames: ApngFrame[] = [];
  for (const f of input) {
    const last = frames[frames.length - 1];
    if (last && equal(last.rgba, f.rgba)) last.ticks += f.ticks;
    else frames.push({ rgba: f.rgba, ticks: f.ticks });
  }
  const parts: Uint8Array[] = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)];
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA
  parts.push(chunk('IHDR', ihdr));
  const animated = frames.length > 1;
  if (animated) parts.push(chunk('acTL', u32s(frames.length, plays)));
  let seq = 0;
  frames.forEach((f, i) => {
    let x = 0, y = 0, w = width, h = height;
    if (i > 0) ({ x, y, w, h } = changed(frames[i - 1].rgba, f.rgba, width, height));
    if (animated) {
      const fctl = new Uint8Array(26);
      const v = new DataView(fctl.buffer);
      v.setUint32(0, seq++);
      v.setUint32(4, w);
      v.setUint32(8, h);
      v.setUint32(12, x);
      v.setUint32(16, y);
      v.setUint16(20, Math.min(65535, f.ticks));
      v.setUint16(22, fps);
      fctl[24] = 0; // dispose: none
      fctl[25] = 0; // blend: source
      parts.push(chunk('fcTL', fctl));
    }
    const data = imageData(f.rgba, width, x, y, w, h);
    if (i === 0) parts.push(chunk('IDAT', data));
    else {
      const fdat = new Uint8Array(4 + data.length);
      new DataView(fdat.buffer).setUint32(0, seq++);
      fdat.set(data, 4);
      parts.push(chunk('fdAT', fdat));
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

function equal(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The rectangle in which b differs from a (at least 1x1). */
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
