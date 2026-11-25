/**
 * Habbo avatars from the game's own Shockwave casts, drawn the way the 2006 client draws a Habbo in a room:
 *
 * - The figure (hh_shared "Figure System Class"): the old 25-digit figure is five 3-digit set ids, each with a 2-digit
 *   colour number. `gamedata/figuredata.txt` (the client's `external.figurepartlist.txt`) gives, per sex and main part
 *   (hr, hd, ch, lg, sh), the sets: their parts (`"p"`: part -> model) and colours (`"c"`; an entry can be a list, one
 *   colour per part). Missing parts come from the first set of their main part (`checkAndFixFigure`). A colour brighter
 *   than 238 per channel on average becomes #EEEEEE (white is the canvas's transparent colour).
 * - The drawing (hh_human "Human Class EX", "Bodypart Class EX"): parts `li lh ls bd sh lg ch hd fc ey hr ri rh rs`
 *   (`human.parts.h`), reordered per direction and action (`arrangeParts`), each the member
 *   `<size>_<action>_<part>_<model>_<direction>_<frame>` copied into the canvas with its matte, ink 41 and the part colour as
 *   bgColor (eyes ink 36, hand items ink 8), at (-regX, canvasHeight - regY - 10) + the location fix. Directions 4-6
 *   use 2-0 and the whole canvas is mirrored (`pFlipList`); with a mirrored body the head direction is remapped like
 *   `resetValues` does. Head parts (hd fc ey hr) use the head direction.
 * - Actions: std, wlk (frames 0-3), sit, lay, wav (left hand, frames 0-1), spk (talking: head, face, hair), crr / drk
 *   with a hand item (`handitem.right.<n>` in hh_human's variable.index), gestures sml / sad / agr / srp on eyes and face.
 * - Dances 1-4 (`dance.<n>` in hh_human, "Bodypart Class EX" animate): per part and frame an action, frame, x/y offset
 *   and direction offset; the offsets are turned per direction (a 32 px Habbo moves 0.7 as far), a head turned from 3
 *   to 4 (or 7 to 0) is drawn mirrored, and a dancing Habbo's head follows the body.
 * - Animations (`renderAvatarFrames`): the client steps its animation counter and dance frames 12 times a second
 *   (measured in the web client: frame tempo 24, prepare and render take turns).
 *
 * Members are looked up like the Resource Manager: hh_people_1, hh_people_2 (64 px, "h") and hh_people_small_1/2
 * (32 px, "sh"), later casts over earlier ones, each cast's memberalias.index after its members (`*` = mirrored).
 */
import { MemberType, systemWinPalette, type CastMemberSlot } from './director/index';
import { Canvas, decode, drawLayer, fieldText, loadCast, type Decoded, type FurniCast, type Layer } from './render';
import { lingoValue, type LingoValue } from './lingo-value';

export type Sex = 'M' | 'F';

interface SetData {
  s: number;
  /** part -> model, in figuredata order */
  p: [string, string][];
  /** colour list; an entry is one colour (hex) or one per part */
  c: (string | string[])[];
}

export interface FigureData {
  /** sex -> main part -> sets */
  parts: Record<Sex, Map<string, SetData[]>>;
  /** sex -> set id -> [main part, index in that part's sets] */
  sets: Record<Sex, Map<number, [string, number]>>;
}

function asMap(v: LingoValue): Map<string, LingoValue> | undefined {
  return v instanceof Map ? v : undefined;
}

export function parseFigureData(text: string): FigureData {
  const root = asMap(lingoValue(text));
  const parts = { M: new Map(), F: new Map() } as FigureData['parts'];
  const sets = { M: new Map(), F: new Map() } as FigureData['sets'];
  for (const sex of ['M', 'F'] as Sex[]) {
    const bySex = asMap(root?.get(sex));
    if (!bySex) continue;
    for (const [main, list] of bySex) {
      if (!Array.isArray(list)) continue;
      const out: SetData[] = [];
      for (const entry of list) {
        const m = asMap(entry);
        if (!m) continue;
        const p = asMap(m.get('p'));
        const c = m.get('c');
        const set: SetData = {
          s: Number(m.get('s')),
          p: p ? [...p].map(([k, v]) => [k, String(v)]) : [],
          c: Array.isArray(c) ? c.map((x) => (Array.isArray(x) ? x.map(String) : String(x))) : [],
        };
        out.push(set);
        if (!sets[sex].has(set.s)) sets[sex].set(set.s, [main, out.length - 1]);
      }
      parts[sex].set(main, out);
    }
  }
  return { parts, sets };
}

/** One drawn part: model (3 digits) and colour 0xRRGGBB. */
export interface PartModel {
  model: string;
  color: number;
}

function rgb(hex: string | undefined): number {
  const v = parseInt((hex ?? '').replace('#', ''), 16);
  return Number.isFinite(v) ? v & 0xffffff : 0xeeeeee;
}

function model3(m: string) {
  return m.length === 1 ? '00' + m : m.length === 2 ? '0' + m : m;
}

const BOT_PARTS = ['hr', 'hd', 'ey', 'fc', 'bd', 'lh', 'rh', 'ch', 'ls', 'rs', 'lg', 'sh'];

/** A bot's colour as the client reads it: "r,g,b" (anything brighter than 238 a channel on average is EEEEEE), a palette
 *  number (paletteIndex, the Windows system palette), or nothing / 0 = EEEEEE. */
function botColor(text: string): number {
  const items = text.split(',').map((x) => x.trim());
  if (items.length === 1) {
    const n = parseInt(items[0], 10);
    if (!n) return 0xeeeeee;
    return systemWinPalette().colors[n & 255] ?? 0xeeeeee;
  }
  if (items.length !== 3) return 0xeeeeee;
  const [r, g, b] = items.map((x) => Number(x));
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return 0xeeeeee;
  if (r + g + b > 238 * 3) return 0xeeeeee;
  return (r << 16) | (g << 8) | b;
}

/** A bot's figure (Figure System Class parseFigure, class "bot"): `part=model/colour` joined with `&`, e.g.
 *  `sd=001/0&hr=010/224,186,120&hd=002/255,204,153&...`. Every part the client draws gets model 001 and EEEEEE when the
 *  figure leaves it out. Null when it isn't a bot figure. */
export function parseBotFigure(figure: string): Map<string, PartModel> | null {
  if (!figure.includes('=')) return null;
  const out = new Map<string, PartModel>();
  for (const item of figure.split('&')) {
    const eq = item.indexOf('=');
    if (eq <= 0) continue;
    const part = item.slice(0, eq).trim().toLowerCase();
    const [model = '', colour = ''] = item.slice(eq + 1).split('/');
    out.set(part, { model: model.trim(), color: botColor(colour.split(/\r?\n/)[0]) });
  }
  for (const part of BOT_PARTS) if (!out.has(part) || !out.get(part)!.model) out.set(part, { model: '001', color: out.get(part)?.color ?? 0xeeeeee });
  return out;
}

/** The zoom a room's casts draw people at: its .room layout's #factorx (32 for most public rooms), else undefined. */
export function roomZoom(casts: FurniCast[]): 32 | 64 | undefined {
  for (const cast of casts) {
    for (const name of cast.names.keys()) {
      if (!name.endsWith('.room')) continue;
      const m = /#factorx\s*:\s*(\d+)/i.exec(fieldText(cast, name) ?? '');
      if (m) return Number(m[1]) === 32 ? 32 : 64;
    }
  }
  return undefined;
}

/** A room layout's lift per floor height level in pixels (#factorh of its .room field: 8, 12, 16 or 32), else undefined. */
export function roomHeightFactor(casts: FurniCast[]): number | undefined {
  for (const cast of casts) {
    for (const name of cast.names.keys()) {
      if (!name.endsWith('.room')) continue;
      const m = /#factorh\s*:\s*(\d+)/i.exec(fieldText(cast, name) ?? '');
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

export interface PartChoice {
  model: string;
  /** only in the room's casts (not in the people casts) */
  room: boolean;
  /** in the figure data: players can wear it */
  players: boolean;
  /** the colours the figure data offers for it ('#RRGGBB'; none for a part players don't have) */
  colours: string[];
}

/** Every part model the assets can draw standing at a zoom (h = 64 px, sh = 32 px), per part: what a bot in that room
 *  can wear. `roomCasts` marks the room's own; the figure data marks the players'. */
export function partChoices(people: PeopleAssets, roomCasts: FurniCast[], data: FigureData | null, small: boolean): Record<string, PartChoice[]> {
  const prefix = small ? 'sh' : 'h';
  const re = new RegExp(`^${prefix}_std_([a-z]{2,3})_(\\d{3})_`);
  const roomNames = new Set<string>();
  for (const cast of roomCasts) for (const n of cast.names.keys()) roomNames.add(n);
  const players = new Set<string>();
  const palettes = new Map<string, string[]>();
  if (data)
    for (const sex of ['M', 'F'] as Sex[])
      for (const [, sets] of data.parts[sex])
        for (const set of sets)
          for (const [part, model] of set.p) {
            const key = `${part}=${model3(model)}`;
            players.add(key);
            const list = palettes.get(key) ?? [];
            for (const c of set.c) {
              const hex = '#' + String(Array.isArray(c) ? c[0] : c).toUpperCase();
              if (/^#[0-9A-F]{6}$/.test(hex) && !list.includes(hex)) list.push(hex);
            }
            palettes.set(key, list);
          }
  const found = new Map<string, Map<string, PartChoice>>();
  for (const name of people.names.keys()) {
    const m = re.exec(name);
    if (!m) continue;
    const [, part, model] = m;
    let models = found.get(part);
    if (!models) found.set(part, (models = new Map()));
    const room = roomNames.has(name);
    const prev = models.get(model);
    models.set(model, { model, room: (prev?.room ?? true) && room, players: players.has(`${part}=${model}`), colours: palettes.get(`${part}=${model}`) ?? [] });
  }
  const out: Record<string, PartChoice[]> = {};
  for (const [part, models] of found) out[part] = [...models.values()].sort((a, b) => Number(b.room) - Number(a.room) || a.model.localeCompare(b.model));
  return out;
}

/** The sex whose figure data knows more of the figure's sets (the CMS's URLs carry only the figure). */
export function guessSex(data: FigureData, figure: string): Sex {
  let m = 0, f = 0;
  for (let i = 0; i + 5 <= figure.length; i += 5) {
    const id = Number(figure.slice(i, i + 3));
    if (data.sets.M.has(id)) m++;
    if (data.sets.F.has(id)) f++;
  }
  return f > m ? 'F' : 'M';
}

/** Figure System Class parseFigure + parseNewTypeFigure + checkAndFixFigure. Null when it isn't a 25-digit figure. */
export function parseFigure(data: FigureData, figure: string, sex: Sex): Map<string, PartModel> | null {
  if (!/^\d{25}$/.test(figure)) return null;
  const main = new Map<string, { set: SetData; colorId: number }>();
  for (let i = 0; i < 25; i += 5) {
    const id = Number(figure.slice(i, i + 3));
    let colorId = Number(figure.slice(i + 3, i + 5));
    const where = data.sets[sex].get(id);
    if (!where) continue;
    const set = data.parts[sex].get(where[0])?.[where[1]];
    if (!set) continue;
    if (!colorId) colorId = 1;
    main.set(where[0], { set, colorId });
  }
  const out = new Map<string, PartModel>();
  for (const mainPart of ['hr', 'hd', 'lg', 'sh', 'ch']) {
    const entry = main.get(mainPart);
    if (!entry) continue;
    let colorId = entry.colorId < 1 ? 1 : entry.colorId;
    const colors = entry.set.c;
    if (colorId > colors.length) colorId = 1;
    const c = colors[colorId - 1];
    entry.set.p.forEach(([part, model], i) => {
      const hex = Array.isArray(c) ? (c.length > i ? c[i] : c[0]) : c;
      out.set(part, { model: model3(model), color: c === undefined ? 0xeeeeee : rgb(hex) });
    });
  }
  // checkAndFixFigure: every part, from the first set of its main part when missing.
  for (const part of ['hr', 'hd', 'ey', 'fc', 'bd', 'lh', 'rh', 'ch', 'ls', 'rs', 'lg', 'sh']) {
    if (out.has(part)) continue;
    const mainPart = ['ls', 'ch', 'rs'].includes(part) ? 'ch' : ['hd', 'ey', 'fc', 'bd', 'lh', 'rh'].includes(part) ? 'hd' : part;
    const first = data.parts[sex].get(mainPart)?.[0];
    if (!first) continue;
    const idx = first.p.findIndex(([p]) => p === part);
    const model = idx >= 0 ? first.p[idx][1] : undefined;
    if (model === undefined) continue;
    const c0 = first.c[0];
    const list = Array.isArray(c0) ? c0 : [c0];
    const colorId = idx >= 0 ? idx + 1 : 1;
    out.set(part, { model: model3(model), color: rgb(list.length >= colorId ? list[colorId - 1] : list[0]) });
  }
  return out;
}

interface Entry {
  cast: FurniCast;
  slot: CastMemberSlot;
  flip: boolean;
}

/** The people casts with one name table, as the Resource Manager builds it. */
export class PeopleAssets {
  readonly names = new Map<string, Entry>();
  readonly variables = new Map<string, string>();
  /** dance number -> part -> frames */
  readonly dances = new Map<number, Map<string, DanceFrame[]>>();

  constructor(casts: Uint8Array[], humanCast?: Uint8Array) {
    for (const bytes of casts) this.index(loadCast(bytes));
    if (humanCast) {
      const human = loadCast(humanCast);
      for (const line of (fieldText(human, 'variable.index') ?? '').split(/[\r\n]+/)) {
        const m = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) this.variables.set(m[1], m[2]);
      }
      for (let n = 1; n <= 4; n++) {
        const dance = parseDance(fieldText(human, `dance.${n}`));
        if (dance.size) this.dances.set(n, dance);
      }
    }
  }

  /** These assets plus a room's casts, indexed after the people casts as the client loads them when it enters the
   *  room (a public room's bots wear the room's own parts: the kitchen's hair 799, the Space Cafe's 888, ...). */
  withCasts(casts: FurniCast[]): PeopleAssets {
    const out = Object.create(PeopleAssets.prototype) as PeopleAssets;
    Object.assign(out, { names: new Map(this.names), variables: this.variables, dances: this.dances });
    for (const cast of casts) out.index(cast);
    return out;
  }

  private index(cast: FurniCast) {
    {
      for (const slot of cast.file.members) {
        const name = slot.member.name;
        if (name) this.names.set(name.toLowerCase(), { cast, slot, flip: false });
      }
      for (const line of (fieldText(cast, 'memberalias.index') ?? '').split(/[\r\n]+/)) {
        const eq = line.indexOf('=');
        if (eq <= 0 || line.length <= 2) continue;
        let target = line.slice(eq + 1).trim();
        const flip = target.endsWith('*');
        if (flip) target = target.slice(0, -1);
        const entry = this.names.get(target.toLowerCase());
        if (!entry || entry.flip) continue;
        this.names.set(line.slice(0, eq).trim().toLowerCase(), { ...entry, flip });
      }
    }
  }

  bitmap(name: string): Entry | undefined {
    const e = this.names.get(name.toLowerCase());
    return e && e.slot.member.memberType === MemberType.Bitmap ? e : undefined;
  }
}

export interface DanceFrame {
  act: string;
  frm: number;
  offX: number;
  offY: number;
  offD: number;
}

/** "lh/[#act:[...], #frm:[...], #OffX:[...], #OffY:[...], #OffD:[...]]" per line (Human Class EX startAnimation). */
function parseDance(text: string | undefined): Map<string, DanceFrame[]> {
  const out = new Map<string, DanceFrame[]>();
  for (const line of (text ?? '').split(/[\r\n]+/)) {
    const slash = line.indexOf('/');
    if (slash <= 0) continue;
    const v = lingoValue(line.slice(slash + 1));
    if (!(v instanceof Map)) continue;
    const list = (k: string) => {
      const x = v.get(k);
      return Array.isArray(x) ? x : [];
    };
    const act = list('act');
    out.set(line.slice(0, slash).trim(), act.map((a, i) => ({
      act: String(a),
      frm: Number(list('frm')[i] ?? 0),
      offX: Number(list('OffX')[i] ?? 0),
      offY: Number(list('OffY')[i] ?? 0),
      offD: Number(list('OffD')[i] ?? 0),
    })));
  }
  return out;
}

export interface AvatarOptions {
  /** 64 px ("h", default) or 32 px ("sh") */
  small?: boolean;
  direction?: number;
  headDirection?: number;
  /** std, wlk, sit, lay */
  action?: string;
  wave?: boolean;
  talk?: boolean;
  /** hand item id (crr) or drink id (drk): Odin's CARRYITEM numbers */
  carry?: number;
  drink?: number;
  /** sml, sad, agr, srp */
  gesture?: string;
  /** animation step 0-3 (walking, waving, talking) */
  frame?: number;
  /** only the head parts (hd fc ey hr) */
  headOnly?: boolean;
  /** dance 1-4 and its frame (0-based) */
  dance?: number;
  danceFrame?: number;
  /** an animated picture (website): dances always, otherwise walking, waving and talking with anim */
  anim?: boolean;
}

export interface AvatarImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const FLIP = [0, 1, 2, 3, 2, 1, 0, 7];
const PARTS = ['li', 'lh', 'ls', 'bd', 'sh', 'lg', 'ch', 'hd', 'fc', 'ey', 'hr', 'ri', 'rh', 'rs'];
const HEAD_PARTS = ['hd', 'fc', 'ey', 'hr'];

interface Part {
  part: string;
  model: string;
  color: number;
  dir: number;
  action: string;
  actionLh?: string;
  actionRh?: string;
}

/**
 * Human Class EX arrangeParts. The client rearranges its part list in place, so the order depends on what came before:
 * this is a Habbo that turned to `dir` (the full arrangement) and then, when dancing, started to dance there (one more
 * pass without the direction change: facing 3, the right arm then goes in at 7-9 of that list).
 */
function arrange(parts: Part[], dir: number, mainAction: string, dancing = false): Part[] {
  const turned = arrangeOnce([...parts], dir, mainAction, false, true);
  return dancing ? arrangeOnce(turned, dir, mainAction, true, false) : turned;
}

function arrangeOnce(list: Part[], dir: number, mainAction: string, dancing: boolean, turned: boolean): Part[] {
  const idx = (p: string) => list.findIndex((x) => x.part === p);
  const lg = list[idx('lg')], sh = list[idx('sh')];
  const i1 = Math.min(idx('lg'), idx('sh')), i2 = Math.max(idx('lg'), idx('sh'));
  if ((mainAction === 'sit' || mainAction === 'lay') && FLIP[dir] !== 0) {
    list[i1] = lg;
    list[i2] = sh;
  } else {
    list[i1] = sh;
    list[i2] = lg;
  }
  const take = (p: string) => list.splice(idx(p), 1)[0];
  const rs = take('rs'), rh = take('rh'), ri = take('ri');
  if (rh.actionRh === 'drk' && (dir === 0 || dir === 6)) {
    list.unshift(ri);
    list.push(rh, rs);
  } else if (dir === 7) {
    list.unshift(ri, rh, rs);
  } else if (dir === 3 && dancing) {
    list.splice(6, 0, ri, rh, rs);
  } else {
    list.push(ri, rh, rs);
  }
  if (!turned) return list;
  const ls = take('ls'), lh = take('lh'), li = take('li');
  if (dir === 3) list.splice(7, 0, li, lh, ls);
  else list.unshift(li, lh, ls);
  return list;
}

/** Bodypart Class EX update: the member name and the extra offset of one part. */
function memberFor(p: Part, size: string, counter: number, o: { talking: boolean; carrying: boolean }) {
  let action = p.action;
  let part = p.part;
  let dir = FLIP[p.dir];
  let frame = 0;
  let xFix = 0, yFix = 0;
  switch (p.part) {
    case 'bd':
    case 'lg':
    case 'sh':
      if (p.action === 'wlk') frame = counter;
      break;
    case 'lh':
    case 'ls': {
      const own = p.dir === dir ? p.actionLh : p.actionRh;
      if (own !== undefined) action = own;
      if (action === 'wlk') frame = counter;
      else if (action === 'wav') frame = counter % 2;
      else if (['crr', 'drk', 'ohd'].includes(action)) {
        if (p.dir >= 4) {
          xFix = -40;
          part = 'r' + p.part[1];
        }
        dir = p.dir;
      }
      break;
    }
    case 'rh':
    case 'rs': {
      const own = p.dir === dir ? p.actionRh : p.actionLh;
      if (own !== undefined) action = own;
      if (action === 'wlk') frame = counter;
      else if (action === 'wav') {
        frame = counter % 2;
        part = 'l' + p.part[1];
        dir = p.dir;
      }
      break;
    }
    case 'hd':
    case 'fc':
      if (o.talking) {
        action = p.action === 'lay' ? 'lsp' : 'spk';
        frame = counter % 2;
      }
      break;
    case 'ey':
      if (o.talking && p.action !== 'lay' && counter % 2 === 0) yFix = -1;
      break;
    case 'hr':
      if (o.talking && counter % 2 === 0 && p.action !== 'lay') action = 'spk';
      break;
    case 'ri':
      if (!o.carrying) return null;
      action = p.actionRh ?? '';
      dir = p.dir;
      break;
    case 'li':
      action = p.actionLh ?? '';
      dir = p.dir;
      break;
  }
  return { name: `${size}_${action}_${part}_${p.model}_${dir}_${frame}`, xFix, yFix };
}

const trunc = Math.trunc;

/** Bodypart Class EX animate + the offset turn in update. */
function danceMemberFor(p: Part, f: DanceFrame, size: string) {
  let dir = p.dir + f.offD;
  if (dir > 7) dir = Math.min(dir - 8, 7);
  else if (dir < 0) dir = Math.max(7 + dir + 1, 0);
  const flipH = HEAD_PARTS.includes(p.part) && ((dir === 4 && p.dir === 3) || (dir === 0 && p.dir === 7));
  let x = f.offX, y = f.offY;
  switch (p.dir) {
    case 0: y = y + trunc(x / 2); x = trunc(x / 2); break;
    case 1: y = y + x; x = 0; break;
    case 2: y = y - trunc(x / 2); x = trunc(x / 2); break;
    case 4: y = y + trunc(x / 2); x = trunc(-x / 2); break;
    case 5: y = y - x; x = 0; break;
    case 6: y = y - trunc(x / 2); x = trunc(-x / 2); break;
    case 7: x = -x; break;
  }
  if (size === 'sh') {
    x *= 0.7;
    y *= 0.7;
  }
  return { name: `${size}_${f.act}_${p.part}_${p.model}_${FLIP[dir]}_${f.frm}`, xFix: x, yFix: y, flipH };
}

// flipHorizontal copies a mirrored part into image(w, h, 8): the movie's default palette (habbo.dcr is a Windows movie:
// System-Win), each pixel the nearest colour there (squared distance, as DirPlayer and Director match colours). The greys
// of hair and skin shading change with it, which shows on a dancing Habbo's turned head (System-Mac doesn't match).
const FLIP_PALETTE = systemWinPalette().colors;
const remapCache = new WeakMap<object, Map<number[], Decoded>>();

function nearest(rgb: number, palette: number[]) {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  let best = 0, bestD = Infinity;
  for (const c of palette) {
    const d = (((c >> 16) & 255) - r) ** 2 + (((c >> 8) & 255) - g) ** 2 + ((c & 255) - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
      if (d === 0) break;
    }
  }
  return best;
}

function remapped(d: Decoded, palette: number[]): Decoded {
  let byPalette = remapCache.get(d.bitmap);
  if (!byPalette) remapCache.set(d.bitmap, (byPalette = new Map()));
  const hit = byPalette.get(palette);
  if (hit) return hit;
  const argb = new Uint32Array(d.bitmap.argb.length);
  const seen = new Map<number, number>();
  for (let i = 0; i < argb.length; i++) {
    const rgb = d.bitmap.argb[i] & 0xffffff;
    let m = seen.get(rgb);
    if (m === undefined) seen.set(rgb, (m = nearest(rgb, palette)));
    argb[i] = (0xff000000 | m) >>> 0;
  }
  const out: Decoded = { ...d, bitmap: { ...d.bitmap, argb, paletteIndices: null, bitDepth: 32, nativeAlpha: false }, palette: undefined };
  byPalette.set(palette, out);
  return out;
}

function inkFor(part: string) {
  return part === 'ey' ? 36 : part === 'ri' || part === 'li' ? 8 : 41;
}

/** Draw one Habbo: the client's canvas (64x106 standing, 89x70 lying; half for 32 px), transparent background. */
export function renderAvatar(assets: PeopleAssets, figure: Map<string, PartModel>, o: AvatarOptions = {}): AvatarImage {
  const size = o.small ? 'sh' : 'h';
  let dir = Math.max(0, Math.min(7, o.direction ?? 2));
  let head = Math.max(0, Math.min(7, o.headDirection ?? dir));
  const mainAction = o.action === 'lay' ? 'lay' : o.action === 'sit' ? 'sit' : o.action === 'wlk' ? 'wlk' : 'std';
  const counter = Math.max(0, Math.floor(o.frame ?? 0)) % 4;
  // resetValues: with a mirrored body the head is drawn in the mirrored canvas too.
  if (dir !== FLIP[dir] && dir !== head) head = ({ 4: 2, 5: 1, 6: 4, 7: 5 } as Record<number, number>)[head] ?? head;
  const dance = mainAction === 'lay' || mainAction === 'sit' ? undefined : o.dance ? assets.dances.get(o.dance) : undefined;
  if (mainAction === 'lay' || dance) {
    if (mainAction === 'lay' && dir === 0) dir = 4;
    head = dir;
  }
  const carryItem = o.carry ?? o.drink;
  const carrying = carryItem !== undefined && carryItem > 0 && mainAction !== 'lay' && !dance;
  const parts: Part[] = PARTS.map((part) => {
    const fig = figure.get(part);
    let model = fig?.model ?? '001';
    if (part === 'fc' && model !== '001' && o.small) model = '001';
    let color = fig?.color ?? 0xeeeeee;
    const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
    if (r + g + b > 238 * 3) color = 0xeeeeee;
    return { part, model, color, dir: HEAD_PARTS.includes(part) ? head : dir, action: 'std' };
  });
  const byPart = (p: string) => parts.find((x) => x.part === p)!;
  const defineAct = (act: string, list: string[]) => {
    for (const p of parts) if (list.includes(p.part) && p.action === 'std') p.action = act;
  };
  if (mainAction === 'wlk') defineAct('wlk', ['bd', 'lg', 'lh', 'rh', 'ls', 'rs', 'sh']);
  if (mainAction === 'sit') defineAct('sit', ['bd', 'lg', 'sh']);
  if (mainAction === 'lay') for (const p of parts) p.action = 'lay';
  if (carrying) {
    for (const p of parts) p.actionRh = o.drink !== undefined ? 'drk' : 'crr';
    byPart('ri').model = assets.variables.get(`handitem.right.${carryItem}`) ?? '001';
  }
  if (o.wave && mainAction !== 'lay') for (const p of parts) p.actionLh = 'wav';
  if (o.gesture && !o.small) {
    let g = o.gesture === 'spr' ? 'srp' : o.gesture;
    if (mainAction === 'lay') g = 'l' + g.slice(0, 2);
    defineAct(g, ['ey', 'fc']);
  }
  const talking = !!o.talk && !(mainAction === 'lay' && o.small);
  // prepare(): while talking the head, hair and face keep switching to spk (lsp lying), 2 updates in 3
  if (talking) defineAct(mainAction === 'lay' ? 'lsp' : 'spk', ['hd', 'hr', 'fc']);
  const canvasSize = o.small ? (mainAction === 'lay' ? [62, 40] : [32, 62]) : mainAction === 'lay' ? [89, 70] : [64, 106];
  const canvas = new Canvas(canvasSize[0], canvasSize[1], 0, canvasSize[1] - 10);
  const locFix = mainAction === 'lay' ? (o.small ? [35, -5] : [30, -10]) : [-1, 2];
  const ordered = o.headOnly ? parts.filter((p) => HEAD_PARTS.includes(p.part)) : arrange(parts, dir, mainAction, !!dance);
  for (const p of ordered) {
    let m: { name: string; xFix: number; yFix: number; flipH?: boolean } | null;
    if (dance) {
      // animate(): a part without frames (the hand items) isn't drawn while dancing
      const frames = dance.get(p.part);
      if (!frames?.length) continue;
      m = danceMemberFor(p, frames[(o.danceFrame ?? 0) % frames.length], size);
    } else {
      m = memberFor(p, size, counter, { talking, carrying });
    }
    if (!m) continue;
    // getmemnum gives a mirrored alias a negative number, and Bodypart Class EX draws only `tMemNum > 0`.
    const entry = assets.bitmap(m.name);
    if (!entry || entry.flip) continue;
    let decoded = decode(entry.cast, entry.slot);
    if (!decoded) continue;
    if (m.flipH) decoded = remapped(decoded, FLIP_PALETTE);
    const ink = inkFor(p.part);
    // A mirrored part (pFlipH) turns around the canvas centre, with the location fix mirrored too. A 32 px dancer's
    // offsets are fractions (0.7 of the 64 px ones); the part lands where its rect rounds to.
    const bufW = canvasSize[0];
    const snap = Math.trunc; // rect coordinates drop the fraction (matches the web client at 32 px)
    const left = m.flipH ? bufW - decoded.bitmap.width + decoded.regX + m.xFix - locFix[0] - (o.small ? 2 : 0) : -decoded.regX + m.xFix + locFix[0];
    const top = canvasSize[1] - 10 - decoded.regY + m.yFix + locFix[1];
    const flipShift = snap(left) + decoded.bitmap.width - decoded.regX;
    const layer: Layer = {
      name: m.name,
      decoded,
      flip: !!m.flipH,
      ink,
      blend: 100,
      // setColor gives ink 36 white and the others the part colour; copyPixels tints only under ink 41 (a hand item's
      // ink 8 copy stays as drawn, as in the web client)
      bgColor: ink === 36 ? 0xffffff : ink === 41 ? p.color : undefined,
      z: 0,
      order: 0,
      shiftX: m.flipH ? flipShift : snap(left) + decoded.regX,
      shiftY: snap(top) - (canvasSize[1] - 10) + decoded.regY,
      xFactor: 0,
    };
    drawLayer(canvas, layer);
  }
  const mirror = FLIP[dir] !== dir || (dir === 3 && head === 4) || (dir === 7 && head === 6);
  const { width: w, height: h, data } = canvas;
  if (mirror) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w >> 1; x++) {
        const a = (y * w + x) * 4, b = (y * w + (w - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) {
          const t = data[a + c];
          data[a + c] = data[b + c];
          data[b + c] = t;
        }
      }
    }
  }
  return { width: w, height: h, rgba: data };
}

export interface AvatarFrames {
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
  /** frames per second */
  fps: number;
}

/** The client's frames of one loop: a dance's frames, or the four steps of the animation counter. */
export function websiteAvatarFrames(assets: PeopleAssets, figure: Map<string, PartModel>, o: AvatarOptions & { size?: string }): AvatarFrames {
  const dance = o.dance ? assets.dances.get(o.dance) : undefined;
  const count = dance ? Math.max(...[...dance.values()].map((f) => f.length)) : 4;
  const step = (i: number): AvatarOptions & { size?: string } => (dance ? { ...o, danceFrame: i } : { ...o, frame: i });
  let images: AvatarImage[];
  if (o.headOnly) {
    // one crop for every frame: the box around all of them
    const raw = Array.from({ length: count }, (_, i) => renderAvatar(assets, figure, { ...step(i), small: o.size === 's' }));
    const boxes = raw.map(contentBox).filter((b): b is number[] => !!b);
    const box = boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : [0, 0, raw[0].width - 1, raw[0].height - 1];
    images = raw.map((img) => place(img, box[2] - box[0] + 3, box[3] - box[1] + 3, 1 - box[0], 1 - box[1]));
    if (o.size === 'l') images = images.map(double);
  } else {
    images = Array.from({ length: count }, (_, i) => websiteAvatar(assets, figure, step(i)));
  }
  const { width, height } = images[0];
  return { width, height, frames: images.filter((i) => i.width === width && i.height === height).map((i) => i.rgba), fps: 12 };
}

/** The picture the website wants: Avatara's sizes (b 64x110, s 32x55, l = b doubled; head only cropped to the head). */
export function websiteAvatar(assets: PeopleAssets, figure: Map<string, PartModel>, o: AvatarOptions & { size?: string }): AvatarImage {
  const small = o.size === 's';
  const img = renderAvatar(assets, figure, { ...o, small });
  let out: AvatarImage = img;
  if (o.headOnly) {
    out = crop(img, 1);
  } else if (o.action !== 'lay') {
    const [w, h] = small ? [32, 55] : [64, 110];
    out = place(img, w, h, w - img.width, h - img.height);
  }
  if (o.size === 'l') out = double(out);
  return out;
}

function place(img: AvatarImage, w: number, h: number, dx: number, dy: number): AvatarImage {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < img.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= h) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= w) continue;
      rgba.set(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (ty * w + tx) * 4);
    }
  }
  return { width: w, height: h, rgba };
}

/** [x0, y0, x1, y1] of the drawn pixels, or null. */
function contentBox(img: AvatarImage): number[] | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.rgba[(y * img.width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function crop(img: AvatarImage, margin: number): AvatarImage {
  const b = contentBox(img);
  if (!b) return img;
  return place(img, b[2] - b[0] + 1 + margin * 2, b[3] - b[1] + 1 + margin * 2, margin - b[0], margin - b[1]);
}

function double(img: AvatarImage): AvatarImage {
  const w = img.width * 2, h = img.height * 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      rgba.set(img.rgba.subarray((((y >> 1) * img.width) + (x >> 1)) * 4, (((y >> 1) * img.width) + (x >> 1)) * 4 + 4), (y * w + x) * 4);
  return { width: w, height: h, rgba };
}
