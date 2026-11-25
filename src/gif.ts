/**
 * GIF writer (GIF89a) for the renderer's pictures and animations, for places that don't play animated PNGs (chat apps,
 * some image viewers). One global palette: exact when the frames use at most 255 colours (Habbos and most furni), else
 * a median cut to 255. Index 0 is transparent: GIF has no partial transparency, so a pixel is drawn when it is at least
 * half opaque (faint shadows and glows drop out); `bg` flattens the picture onto a colour instead. Frames are full
 * canvases (disposal: restore to background), equal neighbours merge, delays in hundredths of a second spread so the
 * average stays the requested rate (12 fps: 8, 8, 9, ...).
 */

export interface GifFrame {
  rgba: Uint8ClampedArray;
  /** how long it shows, in 1/fps seconds */
  ticks: number;
}

export interface GifOptions {
  /** 0xRRGGBB: draw onto this colour, no transparency */
  bg?: number;
  /** 0 = loop forever */
  plays?: number;
}

function equal(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Straight-alpha RGBA -> 0xRRGGBB per pixel, -1 = transparent. */
function pixels(rgba: Uint8ClampedArray, bg: number | undefined): Int32Array {
  const out = new Int32Array(rgba.length / 4);
  const bgR = ((bg ?? 0) >> 16) & 255, bgG = ((bg ?? 0) >> 8) & 255, bgB = (bg ?? 0) & 255;
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (bg !== undefined) {
      const t = a / 255;
      out[i] = (Math.round(r * t + bgR * (1 - t)) << 16) | (Math.round(g * t + bgG * (1 - t)) << 8) | Math.round(b * t + bgB * (1 - t));
    } else {
      out[i] = a >= 128 ? (r << 16) | (g << 8) | b : -1;
    }
  }
  return out;
}

/** Median cut of the colours (weighted by use) into at most `max` colours. */
function medianCut(counts: Map<number, number>, max: number): number[] {
  type Box = { colors: [number, number][] };
  const boxes: Box[] = [{ colors: [...counts] }];
  const channel = (c: number, ch: number) => (c >> (16 - ch * 8)) & 255;
  while (boxes.length < max) {
    // split the box with the widest channel range (that has more than one colour)
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.colors.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const [c] of box.colors) {
          const v = channel(c, ch);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    box.colors.sort((a, b) => channel(a[0], bestCh) - channel(b[0], bestCh));
    const total = box.colors.reduce((s, [, n]) => s + n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.colors.length - 1; i++) {
      acc += box.colors[i][1];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    boxes.splice(best, 1, { colors: box.colors.slice(0, cut) }, { colors: box.colors.slice(cut) });
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [c, w] of box.colors) {
      r += ((c >> 16) & 255) * w;
      g += ((c >> 8) & 255) * w;
      b += (c & 255) * w;
      n += w;
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
}

/** GIF LZW: variable code size from minCodeSize + 1 to 12 bits, a clear code when the table is full. */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  const out: number[] = [];
  let cur = 0, bits = 0;
  const emit = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return Uint8Array.from(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

export function encodeGif(width: number, height: number, input: GifFrame[], fps: number, options: GifOptions = {}): Buffer {
  const frames: GifFrame[] = [];
  for (const f of input) {
    const last = frames[frames.length - 1];
    if (last && equal(last.rgba, f.rgba)) last.ticks += f.ticks;
    else frames.push({ rgba: f.rgba, ticks: f.ticks });
  }
  const px = frames.map((f) => pixels(f.rgba, options.bg));
  const counts = new Map<number, number>();
  for (const p of px) for (const c of p) if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  const palette = counts.size <= 255 ? [...counts.keys()] : medianCut(counts, 255);
  const index = new Map<number, number>();
  if (counts.size <= 255) palette.forEach((c, i) => index.set(c, i + 1));
  const lookup = (c: number) => {
    let i = index.get(c);
    if (i !== undefined) return i;
    let best = 0, bestD = Infinity;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    palette.forEach((p, j) => {
      const d = (((p >> 16) & 255) - r) ** 2 + (((p >> 8) & 255) - g) ** 2 + ((p & 255) - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j + 1;
      }
    });
    index.set(c, best);
    return best;
  };

  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
  const str = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
  str('GIF89a');
  u16(width);
  u16(height);
  bytes.push(0xf7, 0, 0); // global colour table of 256, background index 0
  for (let i = 0; i < 256; i++) {
    const c = i === 0 ? options.bg ?? 0 : palette[i - 1] ?? 0;
    bytes.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  if (frames.length > 1) {
    str('\x21\xff\x0bNETSCAPE2.0');
    bytes.push(3, 1);
    u16(options.plays ?? 0);
    bytes.push(0);
  }
  const transparent = options.bg === undefined;
  let shown = 0, elapsed = 0; // in ticks and hundredths, so the rounding doesn't drift
  for (let f = 0; f < frames.length; f++) {
    shown += frames[f].ticks;
    const until = Math.round((shown * 100) / fps);
    const delay = Math.max(2, until - elapsed);
    elapsed = until;
    // graphic control: disposal 2 (restore to background), transparency on index 0
    bytes.push(0x21, 0xf9, 4, (2 << 2) | (transparent ? 1 : 0));
    u16(frames.length > 1 ? delay : 0);
    bytes.push(0, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    bytes.push(0);
    const indices = new Uint8Array(width * height);
    const p = px[f];
    for (let i = 0; i < p.length; i++) indices[i] = p[i] < 0 ? 0 : lookup(p[i]);
    bytes.push(8);
    const data = lzw(indices, 8);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      bytes.push(n);
      for (let j = 0; j < n; j++) bytes.push(data[i + j]);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
