/**
 * Animated furni, stepped like the client steps them. The room's prepare runs once per movie frame (24 a second,
 * Fuse's system.tempo) and calls update on every furni:
 *
 * - Furni with `.data` frame lists ("Active Object Extension Class" / "Item Object Extension Class" update): every layer
 *   counts updates and moves to its next frame every `delay` of them (default 1). `loop: 0` repeats forever, `loop: n`
 *   plays n times, no `loop` plays once and stays on the last frame. `sequences` picks another sequence at random at the
 *   end of one, `random` picks frames at random, a negative frame -n is random(n). A `blend` list sets the layer's blend
 *   per frame. A state beyond a layer's list uses its first.
 * - The smoke machine ("Furniture Scifirocket Class", sprite scifirocket): no frame lists; while it's on, its code moves
 *   four extra smoke sprites every third update: a puff that grows (tiny, small, med, big) while it rises, then fades,
 *   while three small puffs drift up, shrink and fade; 66 steps, then it starts again after a random pause (here its
 *   average, 7 steps).
 *
 * Randomness uses a fixed seed, so a furni always gets the same animation (and the CMS's cache stays valid).
 */
import { Canvas, bounds, drawLayers, extraLayer, fieldText, floorSetup, layerData, wallSetup, type FloorSetup, type FurniCast, type Layer, type RenderOptions } from './render';
import { prop, type LingoValue } from './lingo-value';
import { encodeApng, type ApngFrame } from './apng';

export const FPS = 24;
const MAX_TICKS = 240; // 10 s
const RANDOM_TICKS = 96; // 4 s for animations that never repeat exactly

/** Lingo's random(n), 1..n, from a seeded generator. */
function randomFrom(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return 1 + Math.floor(r * Math.max(1, n));
  };
}

function numbers(v: LingoValue): number[] | null {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : Number(x) || 0)) : null;
}

interface LayerAnim {
  frames: number[] | null;
  sequences: number[][] | null;
  delay: number;
  random: boolean;
  blend: number[] | null;
  loopCount: number;
  frameNumber: number;
  frameNumber2: number;
  repeat: number;
  animating: boolean;
  seq: number;
}

function layerAnim(data: LingoValue, letter: string, state: number): LayerAnim | null {
  const states = layerData(data, letter);
  if (!Array.isArray(states) || states.length === 0) return null;
  const entry = states[state < states.length ? state : 0];
  const frames = numbers(prop(entry, 'frames'));
  const seqList = prop(entry, 'sequences');
  const sequences = Array.isArray(seqList) ? seqList.map((s) => numbers(s) ?? [0]) : null;
  if (!frames && !sequences) return null;
  const delay = Number(prop(entry, 'delay') ?? 1);
  const loop = prop(entry, 'loop');
  return {
    frames,
    sequences,
    delay: Number.isFinite(delay) && delay >= 1 ? Math.floor(delay) : 1,
    random: prop(entry, 'random') !== undefined,
    blend: numbers(prop(entry, 'blend')),
    loopCount: loop !== undefined ? Number(loop) - 1 : 1,
    frameNumber: 1,
    frameNumber2: 1,
    repeat: 1,
    animating: true,
    seq: 1,
  };
}

/** One update of a layer (the client's update handler). */
function step(l: LayerAnim, random: (n: number) => number) {
  if (!l.animating) return;
  if (l.repeat >= l.delay) {
    let loop = 1;
    const list = l.frames ?? l.sequences?.[l.seq - 1] ?? [];
    const count = list.length;
    const seqCount = l.frames ? 0 : (l.sequences?.length ?? 0);
    if (count > 0) {
      if (l.frameNumber === count) {
        if (l.loopCount > 0) l.loopCount--;
        loop = l.loopCount;
        if (l.loopCount === 0) l.animating = false;
      }
      if (l.frameNumber < count || loop) {
        if (seqCount > 0 && l.frameNumber === count) {
          l.seq = random(seqCount);
          l.frameNumber = 1;
        } else {
          l.frameNumber = (l.frameNumber % count) + 1;
        }
        if (l.random && count > 1) {
          let v = random(count);
          if (v === l.frameNumber2) v = (l.frameNumber2 % count) + 1;
          l.frameNumber2 = v;
        } else {
          l.frameNumber2 = l.frameNumber;
        }
      }
    }
    l.repeat = 1;
    return;
  }
  l.repeat++;
}

function shown(l: LayerAnim, random: (n: number) => number) {
  const list = l.frames ?? l.sequences?.[l.seq - 1] ?? [0];
  let frame = list[l.frameNumber2 - 1] ?? 0;
  if (frame < 0) frame = random(-frame);
  const blend = l.blend && l.blend.length >= l.frameNumber2 ? l.blend[l.frameNumber2 - 1] : undefined;
  return { frame, blend };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** The layer frames of every tick of one loop of a `.data` animation; null when nothing moves. */
function dataTicks(setup: FloorSetup, state: number) {
  const random = randomFrom(0x48616262);
  const anims = new Map<string, LayerAnim>();
  for (const letter of setup.letters) {
    const a = layerAnim(setup.data, letter, state);
    const moving = a && ((a.frames && a.frames.length > 1) || (a.sequences && (a.sequences.length > 1 || a.sequences[0].length > 1)));
    if (a && moving) anims.set(letter, a);
  }
  if (anims.size === 0) return null;
  const random_ = [...anims.values()].some((a) => a.random || a.sequences || (a.frames ?? []).some((f) => f < 0));
  const forever = [...anims.values()].every((a) => a.loopCount < 0);
  let ticks = RANDOM_TICKS;
  if (!random_ && forever) {
    ticks = [...anims.values()].reduce((acc, a) => {
      const period = (a.frames?.length ?? 1) * a.delay;
      return (acc * period) / gcd(acc, period);
    }, 1);
    ticks = Math.min(ticks, MAX_TICKS);
  } else if (!forever) {
    ticks = MAX_TICKS;
  }
  const out: Map<string, { frame: number; blend?: number }>[] = [];
  for (let t = 0; t < ticks; t++) {
    const frame = new Map<string, { frame: number; blend?: number }>();
    for (const [letter, a] of anims) frame.set(letter, shown(a, random));
    out.push(frame);
    if (!forever && [...anims.values()].every((a) => !a.animating)) break;
    for (const a of anims.values()) step(a, random);
  }
  return { ticks: out, plays: forever ? 0 : 1 };
}

interface Sprite {
  member: string;
  x: number;
  y: number;
  blend: number;
  visible: boolean;
}

/** The smoke machine's code while it's on: one loop (the pause before it, then its 66 steps), as extra sprites. */
function smokeTicks(cast: FurniCast, setup: FloorSetup) {
  const random = randomFrom(0x536d6f6b);
  const d = setup.layersAt().find((l) => l.name.toLowerCase().includes('_d_0_'));
  const z = (d?.z ?? 0) + 1;
  const start = { x: 28 + (d?.shiftX ?? 0), y: -60 + (d?.shiftY ?? 0) };
  const sprites: Sprite[] = [0, 1, 2, 3].map(() => ({ member: 'scifirocket_sm_tiny', x: start.x, y: start.y, blend: 100, visible: false }));
  const initialize = () => {
    Object.assign(sprites[0], { member: 'scifirocket_sm_tiny', x: start.x, y: start.y, blend: 100, visible: false });
    for (let i = 1; i < 4; i++) {
      Object.assign(sprites[i], {
        x: start.x - 3 + random(6),
        y: start.y - 21 + random(4),
        blend: 100,
        visible: false,
        member: random(3) === 1 ? 'scifirocket_sm_tiny' : 'scifirocket_sm_small',
      });
    }
  };
  initialize();
  let animFrame = 1;
  let timer = 0;
  const steps: Sprite[][] = [];
  // Before each puff the client waits until random(8) = 2: 7 steps on average, which the loop uses as its pause.
  let pause = 7;
  for (let guard = 0; guard < 400; guard++) {
    timer += 7.5; // the timer (1/60 s) advances 7.5 per step of 3 frames at 24 fps
    if (animFrame === 1 && pause > 0) {
      pause--;
      steps.push(sprites.map((s) => ({ ...s })));
      continue;
    }
    const big = sprites[0];
    if (animFrame <= 23) {
      if (animFrame === 4) big.member = 'scifirocket_sm_small';
      if (animFrame === 9) big.member = 'scifirocket_sm_med';
      if (animFrame === 14) big.member = 'scifirocket_sm_big';
      big.y -= 0.9;
      big.visible = true;
    } else {
      big.blend -= 20;
      if (animFrame > 52) for (let i = 1; i < 4; i++) if (random(5) === 2) sprites[i].member = 'scifirocket_sm_tiny';
      if (animFrame > 60) for (let i = 1; i < 4; i++) sprites[i].blend -= 15;
      if (big.blend < 20) big.visible = false;
      for (let i = 1; i < 4; i++) {
        sprites[i].y -= 0.7 - random(6) / 12;
        sprites[i].x += Math.sin(Math.floor(timer));
        sprites[i].visible = true;
      }
    }
    steps.push(sprites.map((s) => ({ ...s })));
    animFrame++;
    if (animFrame > 66) break; // the next one starts the loop again
  }
  // Each step lasts 3 updates.
  const ticks: Layer[][] = [];
  for (const spriteSet of steps) {
    const extras: Layer[] = [];
    spriteSet.forEach((s, i) => {
      if (!s.visible || s.blend <= 0) return;
      const layer = extraLayer(cast, s.member, Math.round(s.x), Math.round(s.y), s.blend, z + (i === 0 ? 1 : 0));
      if (layer) extras.push(layer);
    });
    for (let k = 0; k < 3; k++) ticks.push(extras);
  }
  return ticks;
}

export interface AnimationOptions extends RenderOptions {
  wall?: 'leftwall' | 'rightwall';
}

/**
 * The furni as an animated PNG, or null when it doesn't move in this state (the caller then draws it still).
 * Floor furni first, then wall items.
 */
export interface RenderedAnimation {
  png: Buffer;
  width: number;
  height: number;
  frames: number;
  loops: boolean;
  /** the frames themselves (for other formats), at `fps` */
  rgbaFrames: ApngFrame[];
  fps: number;
  plays: number;
}

export function renderAnimation(cast: FurniCast, sprite: string, options: AnimationOptions = {}): RenderedAnimation | null {
  const state = options.state ?? 0;
  const setup = floorSetup(cast, sprite, options) ?? wallSetup(cast, sprite, { wall: options.wall, state, small: options.small });
  if (!setup) return null;
  const isSmoke = /Furniture Scifirocket Class/.test(fieldText(cast, 'asset.index') ?? '') || setup.cls.replace(/^s_/, '') === 'scifirocket';
  let frames: Layer[][];
  let plays = 0;
  if (isSmoke) {
    if (state < 1) return null; // off: no smoke, no light
    const light = (letter: string) => (letter === 'b' ? { frame: 0, blend: 100 } : undefined);
    const base = setup.layersAt(light);
    frames = smokeTicks(cast, setup).map((extras) => [...base, ...extras]);
  } else {
    const data = dataTicks(setup, state);
    if (!data) return null;
    plays = data.plays;
    frames = data.ticks.map((choice) => setup.layersAt((letter) => choice.get(letter)));
  }
  if (frames.length < 2) return null;

  // One canvas for all frames, then cropped to what any frame drew.
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const layers of frames) {
    const b = bounds(layers);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const w = maxX - minX + 2, h = maxY - minY + 2;
  const canvases = frames.map((layers) => {
    const c = new Canvas(w, h, -minX + 1, -minY + 1);
    drawLayers(c, layers);
    return c;
  });
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (const c of canvases) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (c.data[(y * w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const apngFrames: ApngFrame[] = canvases.map((c) => {
    const rgba = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) rgba.set(c.data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4);
    return { rgba, ticks: 1 };
  });
  return { png: encodeApng(cw, ch, apngFrames, FPS, plays), width: cw, height: ch, frames: frames.length, loops: plays === 0, rgbaFrames: apngFrames, fps: FPS, plays };
}
