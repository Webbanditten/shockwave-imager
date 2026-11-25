/**
 * Furni pictures from the game's own Shockwave furni casts (hof_furni/hh_furni_xx_<class>.cct), drawn the way the
 * client draws them in a room:
 *
 * - Floor furni (hh_furni_classes "Active Object Class"): layers a, b, c, ... named
 *   `<class>_<layer>_0_<width>_<length>_<direction>_<frame>`, taken until one is missing. `memberalias.index` maps a
 *   missing direction onto another one, `*` = mirrored (the client turns the sprite and moves it 64 px right). A
 *   direction without layer a moves on to the next one. `<class>.props` gives each layer its ink (default 8), blend
 *   (default 100), zshift per direction and locshift; `<class>.data` gives each layer's frames per state ("Active
 *   Object Extension Class"). Layer j is tinted with part colour j (items_definitions.colour: "#RRGGBB" or a palette
 *   index). The shadow `<class>_sd[_<direction>]` sits below everything at blend 20.
 * - Wall posters ("Item Object Class"): one member `leftwall poster <n>` / `rightwall poster <n>`, ink 8.
 * - Icons ("Preview Renderer Class"): `<class>_small`, its layers `<class>_small_<a..l>` tinted with ink 41.
 *
 * Sprite inks and colours follow DirPlayer (vm-rust/src/player/bitmap/drawing.rs, rendering.rs), which draws these
 * casts in the web client: inks 2/7/8/33/36/37/39/41 key out the background colour connected to the edges; indexed
 * layers under ink 0/8/9 and ink 41 map black to the foreColor (black) and white to the bgColor (the part colour),
 * per channel; 32-bit layers aren't tinted; ink 33 adds, with the sprite's bgColor transparent.
 */
import { MovieFile, MemberType, readTextChunk, fourCC, parseBitmapInfo, type Bitmap, type CastMemberSlot } from './director/index';
import { lingoValue, prop, type LingoValue } from './lingo-value';

const STXT = fourCC('STXT');

export interface FurniCast {
  file: MovieFile;
  /** lower-case name -> member, as the client's Resource Manager builds it: the cast's members, then
   *  memberalias.index line by line. A line copies its target's current entry (mirrored when it ends with *), later
   *  lines overwrite earlier ones, and a target that is itself mirrored is skipped (`if tNumber > 0`). */
  names: Map<string, { slot: CastMemberSlot; flip: boolean }>;
}

export function loadCast(data: Uint8Array): FurniCast {
  const file = new MovieFile(data);
  const names = new Map<string, { slot: CastMemberSlot; flip: boolean }>();
  for (const slot of file.members) {
    const name = slot.member.name;
    if (name) names.set(name.toLowerCase(), { slot, flip: false }); // a later duplicate wins, like pAllMemNumList
  }
  const cast: FurniCast = { file, names };
  const index = fieldText(cast, 'memberalias.index');
  for (const line of (index ?? '').split(/[\r\n]+/)) {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.length <= 2) continue;
    let target = line.slice(eq + 1).trim();
    const flip = target.endsWith('*');
    if (flip) target = target.slice(0, -1);
    const entry = names.get(target.toLowerCase());
    if (!entry || entry.flip) continue;
    names.set(line.slice(0, eq).trim().toLowerCase(), { slot: entry.slot, flip });
  }
  return cast;
}

export function fieldText(cast: FurniCast, name: string): string | undefined {
  const slot = cast.names.get(name.toLowerCase())?.slot;
  if (!slot || slot.member.memberType !== MemberType.Text) return undefined; // fields (STXT)
  const id = cast.file.mediaSectionId(slot, STXT);
  return id === undefined ? undefined : readTextChunk(cast.file.file.getChunkData(id)).text;
}

/** A bitmap by name (getmemnum: a member or an alias; mirrored = the client's negative member number). */
function resolve(cast: FurniCast, name: string): { slot: CastMemberSlot; flip: boolean } | undefined {
  const entry = cast.names.get(name.toLowerCase());
  return entry && entry.slot.member.memberType === MemberType.Bitmap ? entry : undefined;
}

export interface Decoded {
  bitmap: Bitmap;
  regX: number;
  regY: number;
  palette: number[] | undefined;
}

const decodedCache = new WeakMap<CastMemberSlot, Decoded | null>();

/** A bitmap member's pixels and bitmap-local registration point. A palette reference to a member that isn't a
 *  palette uses the next palette in the cast (DirPlayer e4655a10: the catalogue's dyndeal badge). */
export function decode(cast: FurniCast, slot: CastMemberSlot): Decoded | null {
  if (decodedCache.has(slot)) return decodedCache.get(slot)!;
  const info = parseBitmapInfo(slot.member.specificData, cast.file.config?.directorVersion ?? 1200);
  let override;
  let paletteColors: number[] | undefined;
  if (info.bitDepth <= 8) {
    let paletteId = info.paletteId;
    if (paletteId >= 0) {
      const target = cast.file.membersBySlot.get(paletteId + 1);
      if (!target || target.member.memberType !== MemberType.Palette) {
        const next = cast.file.members.find((m: CastMemberSlot) => m.slot > paletteId + 1 && m.member.memberType === MemberType.Palette);
        if (next) paletteId = next.slot - 1;
      }
    }
    override = cast.file.paletteForBitmap({ paletteId });
    paletteColors = override.colors;
  }
  let bitmap: Bitmap | null = null;
  try {
    bitmap = cast.file.decodeBitmapMember(slot, override);
  } catch {
    bitmap = null;
  }
  // 1x1 members are placeholders for "nothing in this frame" (the room places them ~1500 px away, off screen).
  if (bitmap && bitmap.width <= 1 && bitmap.height <= 1) bitmap = null;
  const result = bitmap ? { bitmap, regX: info.regX - info.initialLeft, regY: info.regY - info.initialTop, palette: paletteColors } : null;
  decodedCache.set(slot, result);
  return result;
}

/** RGBA canvas with its origin (the furni's tile point) somewhere inside. */
export class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number, readonly originX: number, readonly originY: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

export interface Layer {
  name: string;
  decoded: Decoded;
  flip: boolean;
  ink: number;
  blend: number;
  /** 0xRRGGBB, or undefined when the sprite has no bgColor */
  bgColor: number | undefined;
  z: number;
  order: number;
  shiftX: number;
  shiftY: number;
  xFactor: number;
}

const MATTE_INKS = new Set([2, 7, 8, 33, 36, 37, 39, 41]);

/** Background pixels connected to the edges: palette index 0 for indexed bitmaps, white otherwise. */
function edgeMatte(b: Bitmap): Uint8Array {
  const { width: w, height: h } = b;
  const isBg = (i: number) => (b.paletteIndices ? b.paletteIndices[i] === 0 : (b.argb[i] & 0xffffff) === 0xffffff);
  const out = new Uint8Array(w * h); // 1 = transparent
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!out[i] && isBg(i)) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return out;
}

const matteCache = new WeakMap<Bitmap, Uint8Array>();

export function drawLayer(canvas: Canvas, layer: Layer) {
  const { bitmap: b, regX, regY } = layer.decoded;
  const matte = MATTE_INKS.has(layer.ink) ? (matteCache.get(b) ?? matteCache.set(b, edgeMatte(b)).get(b)!) : null;
  const indexed = b.bitDepth <= 8;
  const tints = indexed && layer.bgColor !== undefined && ([0, 8, 9].includes(layer.ink) || layer.ink === 41);
  const tint32 = !indexed && layer.ink === 41 && layer.bgColor !== undefined; // ink 41 remaps 32-bit too
  const bg = layer.bgColor ?? 0xffffff;
  const bgR = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bgB = bg & 255;
  const alphaBlend = Math.max(0, Math.min(100, layer.blend)) / 100;
  // Sprite position: the tile point, plus locshift; a mirrored sprite is turned around its registration point
  // and moved one tile width right, as the client does (rotation 180 + skew 180, locH + pXFactor).
  const locX = canvas.originX + layer.shiftX + (layer.flip ? layer.xFactor : 0);
  const locY = canvas.originY + layer.shiftY;
  const left = layer.flip ? locX - (b.width - regX) : locX - regX;
  const top = locY - regY;
  for (let y = 0; y < b.height; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= canvas.height) continue;
    for (let x = 0; x < b.width; x++) {
      const si = y * b.width + x;
      if (matte && matte[si]) continue;
      const argb = b.argb[si];
      let a = b.nativeAlpha ? ((argb >>> 24) & 255) / 255 : 1;
      if (a <= 0) continue;
      let r = (argb >> 16) & 255, g = (argb >> 8) & 255, bl = argb & 255;
      // Colour key: every pixel of the sprite's bgColor is transparent, also inside the furni (ink 36: the Norja
      // shelves' gaps between the shelves; ink 2 likewise; 33/35/37/39/40 skip it too).
      if (layer.ink === 2 || layer.ink === 36 || layer.ink === 33 || layer.ink === 35 || layer.ink === 37 || layer.ink === 39 || layer.ink === 40) {
        if ((argb & 0xffffff) === bg) continue;
        if (b.bitDepth === 1 && b.paletteIndices && b.paletteIndices[si] === 0) continue;
      }
      if (tints || tint32) {
        // black -> foreColor (black), white -> bgColor, per channel
        r = Math.round((r * bgR) / 255);
        g = Math.round((g * bgG) / 255);
        bl = Math.round((bl * bgB) / 255);
      }
      const dx = left + (layer.flip ? b.width - 1 - x : x);
      if (dx < 0 || dx >= canvas.width) continue;
      const di = (dy * canvas.width + dx) * 4;
      const d = canvas.data;
      const da = d[di + 3] / 255;
      if (layer.ink === 33) {
        // Add pin. Over drawn pixels the light is added. Over the transparent canvas there's nothing to add to, and a
        // PNG can't add: the light becomes its own colour at full brightness, as opaque as it was bright, so it
        // vanishes on white and glows on dark (a dim colour at that opacity made a grey smudge on white pages).
        const add = [Math.min(255, d[di] + r), Math.min(255, d[di + 1] + g), Math.min(255, d[di + 2] + bl)];
        const peak = Math.max(r, g, bl);
        if (peak === 0) continue;
        const lightA = (peak / 255) * a * alphaBlend;
        const outA = da + lightA * (1 - da);
        if (outA <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const over = ([r, g, bl][c] * 255) / peak;
          d[di + c] = Math.round((add[c] * da + over * lightA * (1 - da)) / outA);
        }
        d[di + 3] = Math.round(outA * 255);
        continue;
      }
      a *= alphaBlend;
      const outA = a + da * (1 - a);
      if (outA <= 0) continue;
      d[di] = Math.round((r * a + d[di] * da * (1 - a)) / outA);
      d[di + 1] = Math.round((g * a + d[di + 1] * da * (1 - a)) / outA);
      d[di + 2] = Math.round((bl * a + d[di + 2] * da * (1 - a)) / outA);
      d[di + 3] = Math.round(outA * 255);
    }
  }
}

/** Part colour -> 0xRRGGBB: "#RRGGBB", or a palette index into the member's palette ("0" = white). */
function partColor(spec: string | undefined, palette: number[] | undefined): number | undefined {
  if (spec === undefined) return undefined;
  const s = spec.trim();
  if (s.startsWith('#')) {
    const v = parseInt(s.slice(1), 16);
    return Number.isNaN(v) ? 0xffffff : v & 0xffffff;
  }
  const n = /^\d+$/.test(s) ? Number(s) : 0; // "*ffffff" padding: integer() is VOID -> index 0
  return palette ? palette[n & 255] : n === 0 ? 0xffffff : 0;
}

function parseColors(colors: string | undefined): string[] {
  const list = (colors && colors.trim() ? colors : '0,0,0').split(',').map((c) => c.trim());
  while (list.length <= 4) list.push('*ffffff');
  return list;
}

export interface RenderOptions {
  direction?: number;
  /** 0-based index into the .data states */
  state?: number;
  /** items_definitions.colour */
  colors?: string;
  shadow?: boolean;
  /** 32 px ("s_" members) instead of 64 px */
  small?: boolean;
}

export interface Rendered {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  layers: string[];
  direction: number;
}

export function layerData(data: LingoValue, letter: string): LingoValue {
  const layers = prop(data, 'layers');
  if (!(layers instanceof Map)) return undefined;
  for (const [key, value] of layers) {
    if (key.toLowerCase().includes(letter)) return value; // "ab": [...] is shared by a and b
  }
  return undefined;
}

/** The first frame layer `letter` shows in state `state` (0 without .data). */
function frameFor(data: LingoValue, letter: string, state: number): number {
  const states = layerData(data, letter);
  if (!Array.isArray(states) || states.length === 0) return 0;
  const entry = states[state < states.length ? state : 0]; // getFrameList: a state beyond the list uses the first
  const frames = prop(entry, 'frames') ?? (Array.isArray(prop(entry, 'sequences')) ? (prop(entry, 'sequences') as LingoValue[])[0] : undefined);
  if (Array.isArray(frames) && typeof frames[0] === 'number') return Math.max(0, frames[0]);
  return 0;
}

function numberList(v: LingoValue): number[] | undefined {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : Number(x) || 0)) : undefined;
}

/** A layer's frame (and blend, for data with per-frame blends) at one moment of an animation. */
export type FrameChoice = (letter: string) => { frame: number; blend?: number } | undefined;

export interface FloorSetup {
  cls: string;
  props: LingoValue;
  data: LingoValue;
  direction: number;
  /** the layer letters the furni has (as found for its first frame), in order */
  letters: string[];
  layersAt: (choice?: FrameChoice) => Layer[];
}

/** Floor furni as in a room: the class is the sprite without its "*n" colour suffix. */
export function renderFloorFurni(cast: FurniCast, sprite: string, options: RenderOptions = {}): Rendered | null {
  const setup = floorSetup(cast, sprite, options);
  return setup ? compose(setup.layersAt(), setup.direction) : null;
}

/** Everything about a floor furni that doesn't change between frames, and its layers for any frame. */
export function floorSetup(cast: FurniCast, sprite: string, options: RenderOptions = {}): FloorSetup | null {
  const cls = (options.small ? 's_' : '') + sprite.split('*')[0];
  const xFactor = options.small ? 32 : 64;
  const props = lingoValue(fieldText(cast, cls + '.props') ?? '[:]');
  const data = lingoValue((fieldText(cast, cls + '.data') ?? '').replace(/[\r\n]/g, ''));
  const state = options.state ?? 0;
  const prefix = (cls + '_a_0_').toLowerCase();
  const dims = [...cast.names.keys()]
    .map((n) => (n.startsWith(prefix) ? /^(\d+)_(\d+)_\d+_\d+$/.exec(n.slice(prefix.length)) : null))
    .find((m) => m);
  const base = (letter: string) => `${cls}_${letter}_0` + (dims ? `_${dims[1]}_${dims[2]}` : '');
  const memberFor = (letter: string, dir: number, frame = frameFor(data, letter, state)) =>
    resolve(cast, `${base(letter)}_${dir}_${frame}`) ?? resolve(cast, `${base(letter)}_0_${frame}`);

  // Base layers (Active Object Class solveMembers): a, b, c, ... with frame 0 (its pAnimFrame) until one is missing;
  // no layer a in this direction -> the next direction (then round). Furni whose a has no frame 0 use the state's frame.
  const wanted = options.direction ?? 2;
  let direction = -1;
  for (const frame0 of [true, false]) {
    for (let k = 0; k < 8 && direction < 0; k++) {
      const d = (wanted + k) % 8;
      if (frame0 ? memberFor('a', d, 0) : memberFor('a', d)) direction = d;
    }
    if (direction >= 0) break;
  }
  if (direction < 0) return null;
  const baseLetters: string[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    if (!memberFor(letter, direction, 0) && !(i === 0 && memberFor(letter, direction))) break;
    baseLetters.push(letter);
  }
  // With .data (Active Object Extension Class solveMembers): sprite slot i shows the i-th data layer (keys sorted, "ab"
  // counts for a and b) in its frame for the state, and is hidden when that member is missing, without stopping; slots
  // past the data keep their base layer in frame 0. A slot keeps its base layer's stacking and part colour.
  const dataLayers = prop(data, 'layers');
  const dataKeys = dataLayers instanceof Map ? [...new Set([...dataLayers.keys()].flatMap((k) => k.toLowerCase().split('')))].sort() : [];
  const slots: { letter: string; base: string; data: boolean }[] = [];
  for (let i = 0; i < Math.max(baseLetters.length, dataKeys.length); i++) {
    if (i < dataKeys.length) slots.push({ letter: dataKeys[i], base: baseLetters[i] ?? dataKeys[i], data: true });
    else slots.push({ letter: baseLetters[i], base: baseLetters[i], data: false });
  }
  const letters = slots.map((s) => s.letter);

  const colors = parseColors(options.colors);
  const layersAt = (choice?: FrameChoice): Layer[] => {
  const layers: Layer[] = [];
  slots.forEach((slot, i) => {
    const letter = slot.letter;
    const chosen = slot.data ? choice?.(letter) : undefined;
    const member = chosen ? memberFor(letter, direction, chosen.frame) : slot.data ? memberFor(letter, direction) : memberFor(letter, direction, 0);
    if (!member) return;
    const decoded = decode(cast, member.slot);
    if (!decoded) return;
    const lp = prop(props, letter);
    const bp = prop(props, slot.base);
    const zshift = numberList(prop(bp, 'zshift'));
    const z = (zshift ? zshift[zshift.length > direction ? direction : 0] : 0) - 5 + i;
    const shift = prop(bp, 'locshift');
    const shiftValue = Array.isArray(shift) ? shift[direction] : undefined;
    const point = typeof shiftValue === 'string' ? lingoValue(shiftValue) : shiftValue;
    const [sx, sy] = point && typeof point === 'object' && 'point' in point ? point.point : [0, 0];
    layers.push({
      name: member.slot.member.name ?? letter,
      decoded,
      flip: member.flip,
      ink: Number(prop(lp, 'ink') ?? 8),
      blend: chosen?.blend ?? Number(prop(lp, 'blend') ?? 100),
      bgColor: partColor(colors[i], decoded.palette),
      z,
      order: i,
      shiftX: sx,
      shiftY: sy,
      xFactor,
    });
  });
  if (options.shadow) {
    const sd = resolve(cast, `${cls}_sd_${direction}`) ?? resolve(cast, `${cls}_sd`);
    const decoded = sd && decode(cast, sd.slot);
    if (sd && decoded) {
      const lp = prop(props, 'sd');
      let blend = Number(prop(lp, 'blend') ?? 100);
      if (blend === 100) blend = 20;
      layers.push({ name: sd.slot.member.name ?? 'sd', decoded, flip: sd.flip, ink: Number(prop(lp, 'ink') ?? 8), blend, bgColor: undefined, z: -4000, order: -1, shiftX: 0, shiftY: 0, xFactor });
    }
  }
  return layers;
  };
  return { cls, props, data, direction, letters, layersAt };
}

/** A sprite the furni class adds by code (the smoke machine's puffs): a member drawn at the tile point + (x, y). */
export function extraLayer(cast: FurniCast, name: string, x: number, y: number, blend: number, z: number): Layer | null {
  const found = resolve(cast, name);
  const decoded = found && decode(cast, found.slot);
  if (!found || !decoded) return null;
  return { name, decoded, flip: false, ink: 8, blend, bgColor: undefined, z, order: 100, shiftX: x, shiftY: y, xFactor: 64 };
}

/** A wall poster: `leftwall poster <n>` (the catalogue item's number), ink 8. */
export function renderPoster(cast: FurniCast, posterId: string, options: { wall?: 'leftwall' | 'rightwall'; small?: boolean } = {}): Rendered | null {
  const name = `${options.small ? 's_' : ''}${options.wall ?? 'leftwall'} poster ${posterId}`;
  const member = resolve(cast, name);
  const decoded = member && decode(cast, member.slot);
  if (!member || !decoded) return null;
  return compose([{ name, decoded, flip: member.flip, ink: 8, blend: 100, bgColor: undefined, z: 0, order: 0, shiftX: 0, shiftY: 0, xFactor: options.small ? 32 : 64 }], 0);
}

/**
 * Other wall items ("Item Object Extension Class": windows, mirrors, dimmers, wall lamps): one member
 * `<wall> <class>`, or with `<class>.data` one per layer in the data's order, `<wall> <class>_<layer>_<frame>`.
 * Ink (default 8), blend, zshift[1] and locshift[1] come from `<class>.props`; layers stack by zshift + layer number.
 * The wall masks (`..._mask`, which cut the wall for windows) aren't layers.
 */
export function renderWallItem(cast: FurniCast, sprite: string, options: { wall?: 'leftwall' | 'rightwall'; state?: number; small?: boolean } = {}): Rendered | null {
  const setup = wallSetup(cast, sprite, options);
  return setup ? compose(setup.layersAt(), 0) : null;
}

export function wallSetup(cast: FurniCast, sprite: string, options: { wall?: 'leftwall' | 'rightwall'; state?: number; small?: boolean } = {}): FloorSetup | null {
  const cls = sprite.split('*')[0];
  const base = (options.small ? 's_' : '') + cls;
  const wall = (options.small ? 's_' : '') + (options.wall ?? 'leftwall');
  const props = lingoValue(fieldText(cast, base + '.props') ?? '[:]');
  const data = lingoValue((fieldText(cast, base + '.data') ?? '').replace(/[\r\n]/g, ''));
  const layerList = prop(data, 'layers');
  const hasLayers = layerList instanceof Map && layerList.size > 0;
  const letters = hasLayers ? [...(layerList as Map<string, LingoValue>).keys()] : ['a'];
  const memberName = (letter: string, frame?: number) =>
    hasLayers ? `${wall} ${cls}_${letter}_${frame ?? frameFor(data, letter, options.state ?? 0)}` : `${wall} ${cls}`;
  if (!resolve(cast, memberName(letters[0]))) return null;
  const layersAt = (choice?: FrameChoice): Layer[] => {
  const layers: Layer[] = [];
  letters.forEach((letter, i) => {
    const chosen = choice?.(letter);
    const member = memberName(letter, chosen?.frame);
    const found = resolve(cast, member);
    const decoded = found && decode(cast, found.slot);
    if (!found || !decoded) return;
    const lp = prop(props, letter);
    const zshift = numberList(prop(lp, 'zshift'));
    const shift = prop(lp, 'locshift');
    const shiftValue = Array.isArray(shift) ? shift[0] : undefined;
    const point = typeof shiftValue === 'string' ? lingoValue(shiftValue) : shiftValue;
    const [sx, sy] = point && typeof point === 'object' && 'point' in point ? point.point : [0, 0];
    layers.push({
      name: found.slot.member.name ?? member, decoded, flip: found.flip,
      ink: Number(prop(lp, 'ink') ?? 8), blend: chosen?.blend ?? Number(prop(lp, 'blend') ?? 100), bgColor: undefined,
      z: (zshift ? zshift[0] : props instanceof Map ? 0 : i + 1) + i + 1, order: i, shiftX: sx, shiftY: sy, xFactor: 0,
    });
  });
  return layers;
  };
  return { cls: base, props, data, direction: 0, letters, layersAt };
}

/** The hand/catalogue icon: `<sprite>_small` (or `<class>_small`) and its colour layers, like the Preview Renderer. */
export function renderIcon(cast: FurniCast, sprite: string, colors?: string): Rendered | null {
  const cls = sprite.split('*')[0];
  const memName = resolve(cast, sprite + '_small') ? sprite + '_small' : cls + '_small';
  const main = resolve(cast, memName);
  const decoded = main && decode(cast, main.slot);
  if (!main || !decoded) return null;
  const parts = parseColors(colors);
  const layers: Layer[] = [{ name: memName, decoded, flip: false, ink: 8, blend: 100, bgColor: undefined, z: 0, order: 0, shiftX: 0, shiftY: 0, xFactor: 64 }];
  'abcdefghijkl'.split('').forEach((letter, i) => {
    const part = resolve(cast, `${memName}_${letter}`);
    const pd = part && decode(cast, part.slot);
    if (!part || !pd) return;
    const color = parts[i] && parts[i].startsWith('#') ? partColor(parts[i], pd.palette) : 0xffffff;
    // Its own regPoint relative to the main icon's.
    layers.push({ name: part.slot.member.name ?? letter, decoded: pd, flip: false, ink: 41, blend: 100, bgColor: color, z: i + 1, order: i + 1, shiftX: 0, shiftY: 0, xFactor: 64 });
  });
  return compose(layers, 0);
}

/** Where a set of layers draws, around the tile point. */
export function bounds(layers: Layer[]) {
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const l of layers) {
    const { bitmap: b, regX, regY } = l.decoded;
    const locX = l.shiftX + (l.flip ? l.xFactor : 0);
    const left = l.flip ? locX - (b.width - regX) : locX - regX;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + b.width);
    minY = Math.min(minY, l.shiftY - regY);
    maxY = Math.max(maxY, l.shiftY - regY + b.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Draws layers (in stacking order) on a canvas whose tile point is at (originX, originY). */
export function drawLayers(canvas: Canvas, layers: Layer[]) {
  [...layers].sort((a, b) => a.z - b.z || a.order - b.order).forEach((l) => drawLayer(canvas, l));
}

function compose(layers: Layer[], direction: number): Rendered | null {
  if (layers.length === 0) return null;
  layers.sort((a, b) => a.z - b.z || a.order - b.order);
  // Room enough for everything around the origin, then trimmed to what was drawn.
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const l of layers) {
    const { bitmap: b, regX, regY } = l.decoded;
    const locX = l.shiftX + (l.flip ? l.xFactor : 0);
    const left = l.flip ? locX - (b.width - regX) : locX - regX;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + b.width);
    minY = Math.min(minY, l.shiftY - regY);
    maxY = Math.max(maxY, l.shiftY - regY + b.height);
  }
  const canvas = new Canvas(maxX - minX + 2, maxY - minY + 2, -minX + 1, -minY + 1);
  for (const l of layers) drawLayer(canvas, l);
  return trim(canvas, layers.map((l) => l.name), direction);
}

function trim(c: Canvas, names: string[], direction: number): Rendered | null {
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.data[(y * c.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(c.data.subarray(((y0 + y) * c.width + x0) * 4, ((y0 + y) * c.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba, layers: names, direction };
}
