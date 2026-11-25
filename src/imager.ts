/**
 * The drawing core, without any I/O of its own: give it a function that reads an asset (a URL fetch, a file read, a
 * browser fetch) and it answers /furni and /avatar queries with a picture. `app.ts` puts it behind HTTP; the demo
 * page runs it in the browser.
 *
 * Casts: `<furniPath>/hh_furni_xx_<class>.cct`, posters `<furniPath>/hh_furni_xx_poster_<n>.cct`; a class without its
 * own cast is looked up in `sharedCasts` (e.g. the pet items in hh_pets). Parsed casts stay in memory (`maxCasts`,
 * least recently used out), missing ones are remembered for 10 minutes. Habbos need the people casts, hh_human and the
 * figure data (`peopleCasts`, `humanCast`, `figureData`), reloaded every hour.
 */
import { loadCast, renderFloorFurni, renderIcon, renderPoster, renderWallItem, type FurniCast, type Rendered } from './render';
import { renderAnimation } from './animation';
import { PeopleAssets, guessSex, parseFigure, parseFigureData, websiteAvatar, websiteAvatarFrames, type FigureData } from './avatar';
import { encodeApng } from './apng';
import { encodeGif } from './gif';
import { avatarOptions } from './avatar-query';

/** An asset's bytes, or null when it doesn't exist (throw for other failures). */
export type ReadAsset = (path: string) => Promise<Uint8Array | null>;

export interface ImagerOptions {
  /** Folder of the furni casts. */
  furniPath?: string;
  /** Casts searched for classes that have no cast of their own (e.g. pet items in hh_pets). */
  sharedCasts?: string[];
  /** The Habbo casts the client loads: hh_people_1, hh_people_2 and the small ones. */
  peopleCasts?: string[];
  /** hh_human (its variable index lists the hand items and dances). */
  humanCast?: string;
  /** The figure part list (external.figurepartlist.txt / figuredata.txt). */
  figureData?: string;
  /** How many parsed casts to keep in memory. */
  maxCasts?: number;
}

export const DEFAULTS: Required<ImagerOptions> = {
  furniPath: 'hof_furni',
  sharedCasts: ['dcr/hh_pets.cct'],
  peopleCasts: ['dcr/hh_people_1.cct', 'dcr/hh_people_2.cct', 'dcr/hh_people_small_1.cct', 'dcr/hh_people_small_2.cct'],
  humanCast: 'dcr/hh_human.cct',
  figureData: 'gamedata/figuredata.txt',
  maxCasts: 400,
};

const MISSING_MS = 10 * 60 * 1000;
const PEOPLE_MS = 60 * 60 * 1000;

/** RGBA for a still picture (encode it yourself), or the finished bytes of an animated PNG or a GIF. */
export type Picture = Rendered | { png: Uint8Array } | { gif: Uint8Array };

export function createRenderer(readAsset: ReadAsset, options: ImagerOptions = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as Required<ImagerOptions>;
  const furniPath = o.furniPath.replace(/^\/+|\/+$/g, '');

  async function requireAsset(path: string): Promise<Uint8Array> {
    const bytes = await readAsset(path);
    if (!bytes) throw new Error(`${path}: not found`);
    return bytes;
  }

  const casts = new Map<string, { cast: FurniCast | null; at: number }>();
  const loading = new Map<string, Promise<FurniCast | null>>();

  async function getCast(path: string): Promise<FurniCast | null> {
    const hit = casts.get(path);
    if (hit && (hit.cast || Date.now() - hit.at < MISSING_MS)) {
      casts.delete(path); // most recently used last
      casts.set(path, hit);
      return hit.cast;
    }
    let pending = loading.get(path);
    if (!pending) {
      pending = (async () => {
        const bytes = await readAsset(path);
        if (!bytes) return null;
        try {
          return loadCast(bytes);
        } catch (e) {
          console.error(`${path}: unreadable cast (${(e as Error).message})`);
          return null;
        }
      })().finally(() => loading.delete(path));
      loading.set(path, pending);
    }
    const cast = await pending;
    casts.set(path, { cast, at: Date.now() });
    while (casts.size > o.maxCasts) casts.delete(casts.keys().next().value!);
    return cast;
  }

  /** The class's own cast, else the first shared cast that has its members. */
  async function castFor(cls: string): Promise<FurniCast | null> {
    const own = await getCast(`${furniPath}/hh_furni_xx_${cls}.cct`);
    if (own) return own;
    const lower = cls.toLowerCase();
    for (const path of o.sharedCasts) {
      const shared = await getCast(path);
      if (!shared) continue;
      if (shared.names.has(lower + '.props') || shared.names.has(lower + '_small') || [...shared.names.keys()].some((n) => n.startsWith(lower + '_a_0_'))) return shared;
    }
    return null;
  }

  // The Habbo casts, hh_human's variable index (hand items) and the figure part list. Reloaded every hour.
  let people: { assets: PeopleAssets; data: FigureData; at: number } | null = null;
  let peopleLoading: Promise<{ assets: PeopleAssets; data: FigureData; at: number }> | null = null;

  async function getPeople() {
    if (people && Date.now() - people.at < PEOPLE_MS) return people;
    peopleLoading ??= (async () => {
      const [peopleCasts, human, figureData] = await Promise.all([Promise.all(o.peopleCasts.map(requireAsset)), requireAsset(o.humanCast), requireAsset(o.figureData)]);
      const loaded = { assets: new PeopleAssets(peopleCasts, human), data: parseFigureData(new TextDecoder('latin1').decode(figureData)), at: Date.now() };
      people = loaded;
      return loaded;
    })().finally(() => (peopleLoading = null));
    try {
      return await peopleLoading;
    } catch (e) {
      if (people) return people; // keep serving the last good copy
      throw e;
    }
  }

  async function renderHabbo(q: URLSearchParams): Promise<Picture | null | 'bad'> {
    const figure = (q.get('figure') ?? '').trim();
    if (!/^\d{25}$/.test(figure)) return figure ? null : 'bad'; // only the 2006 client's 25-digit figures
    const { assets, data } = await getPeople();
    const sexParam = (q.get('sex') ?? '').toUpperCase();
    const sex = sexParam.startsWith('F') ? 'F' : sexParam.startsWith('M') ? 'M' : guessSex(data, figure);
    const parsed = parseFigure(data, figure, sex);
    if (!parsed || parsed.size === 0) return null;
    const options = avatarOptions(q);
    if (options.dance || options.anim) {
      // an animated PNG at the client's 12 steps a second (a still picture when nothing moves)
      const a = websiteAvatarFrames(assets, parsed, options);
      return moving(a.width, a.height, a.frames.map((rgba) => ({ rgba, ticks: 1 })), a.fps, 0, q);
    }
    return still(websiteAvatar(assets, parsed, options), q);
  }

  async function renderFurni(q: URLSearchParams): Promise<Picture | null | 'bad'> {
    const sprite = (q.get('sprite') ?? '').trim();
    if (!sprite || sprite.length > 100 || !/^[A-Za-z0-9_.* -]+$/.test(sprite)) return 'bad';
    const icon = flag(q.get('icon'));
    const small = flag(q.get('small')) || flag(q.get('s'));
    const wall = q.get('wall') === 'rightwall' ? 'rightwall' : 'leftwall';
    const state = Math.max(0, Math.min(50, Number(q.get('state') ?? 0) || 0));
    const poster = /^poster ?(\d+)$/i.exec(sprite);
    if (poster) {
      const cast = await getCast(`${furniPath}/hh_furni_xx_poster_${poster[1]}.cct`);
      if (!cast) return null;
      // An icon the cast doesn't have falls back to the small picture, as for furni below.
      return (icon && renderIcon(cast, `poster ${poster[1]}`)) || renderPoster(cast, poster[1], { wall, small: small || icon });
    }
    const cast = await castFor(sprite.split('*')[0]!);
    if (!cast) return null;
    const colors = q.get('colors') ?? undefined;
    if (icon) {
      // No <class>_small icon member (some posters and newer furni): the small room picture instead, still.
      const drawn = renderIcon(cast, sprite, colors);
      if (drawn) return drawn;
    }
    const direction = Math.max(0, Math.min(7, Number(q.get('direction') ?? 2) || 0));
    if (flag(q.get('anim')) && !icon) {
      // Without a state: the first of the first two states (off/on) that keeps moving: a lamp lit, the smoke machine on,
      // a fountain. A door's one-off opening doesn't count, nor a teleporter's flashing third state. None: still, state 0.
      const auto = !q.has('state');
      for (const s of auto ? [0, 1] : [state]) {
        const animated = renderAnimation(cast, sprite, { direction, state: s, colors, shadow: flag(q.get('shadow')), small, wall });
        if (animated && (animated.loops || !auto)) return moving(animated.width, animated.height, animated.rgbaFrames, animated.fps, animated.plays, q, animated.png);
      }
    }
    const smallPicture = small || icon;
    return (
      renderFloorFurni(cast, sprite, { direction, state, colors, shadow: flag(q.get('shadow')), small: smallPicture }) ??
      renderWallItem(cast, sprite, { wall, state, small: smallPicture }) ??
      renderWallItem(cast, sprite, { wall: wall === 'leftwall' ? 'rightwall' : 'leftwall', state, small: smallPicture })
    );
  }

  /** Draw what a /furni or /avatar query asks for: a picture, null (nothing to draw) or 'bad' (a malformed query). */
  function render(pathname: string, q: URLSearchParams): Promise<Picture | null | 'bad'> {
    return pathname === '/avatar' ? renderHabbo(q) : renderFurni(q);
  }

  return { render, castCount: () => casts.size, figureData: async () => (await getPeople()).data };
}

function flag(v: string | null) {
  return v === '1' || v === 'true';
}

function bgOf(q: URLSearchParams): number | undefined {
  const bg = (q.get('bg') ?? '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(bg) ? parseInt(bg, 16) : undefined;
}

/** A still picture as asked: the RGBA (written as a PNG), or a GIF with format=gif. */
export function still(img: { width: number; height: number; rgba: Uint8ClampedArray }, q: URLSearchParams): Picture {
  if (q.get('format') === 'gif') return { gif: encodeGif(img.width, img.height, [{ rgba: img.rgba, ticks: 1 }], 1, { bg: bgOf(q) }) };
  return { width: img.width, height: img.height, rgba: img.rgba, layers: [], direction: 0 } as Rendered;
}

/** An animation as asked: an animated PNG, or an animated GIF with format=gif. */
function moving(width: number, height: number, frames: { rgba: Uint8ClampedArray; ticks: number }[], fps: number, plays: number, q: URLSearchParams, png?: Buffer): Picture {
  if (q.get('format') === 'gif') return { gif: encodeGif(width, height, frames, fps, { bg: bgOf(q), plays }) };
  return { png: png ?? encodeApng(width, height, frames, fps, plays) };
}

