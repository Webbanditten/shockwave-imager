/**
 * The imager as an HTTP request handler: furni and Habbo pictures drawn from a hotel's Shockwave casts.
 *
 *   GET /furni?sprite=chair_norja*2&colors=%23FFFFFF,...&direction=2&state=0&shadow=1&small=1&icon=1&wall=rightwall
 *   GET /furni?sprite=poster20            (a wall poster; also "poster 20")
 *   GET /furni?sprite=hc_lmp&state=1&anim=1  (an animated PNG when the furni moves in that state, else the still one)
 *   GET /avatar?figure=1500118001275343000521525&sex=M&size=b&direction=2&head_direction=3&action=wav&gesture=sml&crr=5&frame=1&head=1
 *   GET /avatar?figure=...&dance=2      (dances 1-4, and action=wav|wlk|spk with anim=1: an animated PNG)
 *   format=gif on both: a GIF instead of the PNG / animated PNG (bg=RRGGBB draws it onto that colour)
 *   GET /health
 *
 * Casts come from `assets` (a URL or a folder): `<furniPath>/hh_furni_xx_<class>.cct`, posters
 * `<furniPath>/hh_furni_xx_poster_<n>.cct`; a class without its own cast is looked up in `sharedCasts` (e.g. the pet
 * items in hh_pets). Parsed casts stay in memory (`maxCasts`, least recently used out), missing ones are remembered for
 * 10 minutes. Habbos need the people casts, hh_human and the figure data (`peopleCasts`, `humanCast`, `figureData`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { PNG } from 'pngjs';
import { loadCast, renderFloorFurni, renderIcon, renderPoster, renderWallItem, type FurniCast, type Rendered } from './render';
import { renderAnimation } from './animation';
import { PeopleAssets, guessSex, parseFigure, parseFigureData, websiteAvatar, websiteAvatarFrames, type FigureData } from './avatar';
import { encodeApng } from './apng';
import { encodeGif } from './gif';
import { avatarOptions } from './avatar-query';

export interface ImagerConfig {
  /** Where the casts are: an http(s) URL (your asset host) or a local folder. */
  assets: string;
  /** Folder of the furni casts, relative to `assets`. */
  furniPath?: string;
  /** Casts searched for classes that have no cast of their own (e.g. pet items in hh_pets). */
  sharedCasts?: string[];
  /** The Habbo casts the client loads: hh_people_1, hh_people_2 and the small ones. */
  peopleCasts?: string[];
  /** hh_human (its variable index lists the hand items). */
  humanCast?: string;
  /** The figure part list (external.figurepartlist.txt / figuredata.txt). */
  figureData?: string;
  /** How many parsed casts to keep in memory. */
  maxCasts?: number;
}

export const DEFAULTS = {
  furniPath: 'hof_furni',
  sharedCasts: ['dcr/hh_pets.cct'],
  peopleCasts: ['dcr/hh_people_1.cct', 'dcr/hh_people_2.cct', 'dcr/hh_people_small_1.cct', 'dcr/hh_people_small_2.cct'],
  humanCast: 'dcr/hh_human.cct',
  figureData: 'gamedata/figuredata.txt',
  maxCasts: 400,
};

const MISSING_MS = 10 * 60 * 1000;
const PEOPLE_MS = 60 * 60 * 1000;

type Picture = Rendered | { png: Buffer } | { gif: Buffer };

export function createImager(config: ImagerConfig) {
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) } as Required<ImagerConfig>;
  const remote = /^https?:\/\//i.test(c.assets);
  const base = remote ? c.assets.replace(/\/+$/, '') : resolve(c.assets.replace(/^file:\/\//i, ''));
  const furniPath = c.furniPath.replace(/^\/+|\/+$/g, '');

  /** An asset's bytes, or null when it doesn't exist. */
  async function readAsset(path: string): Promise<Uint8Array | null> {
    if (remote) {
      const res = await fetch(`${base}/${path}`);
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    const full = resolve(base, path);
    if (!full.startsWith(base + sep)) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
      throw e;
    }
  }

  async function requireAsset(path: string): Promise<Uint8Array> {
    const bytes = await readAsset(path);
    if (!bytes) throw new Error(`${path}: not found in ${c.assets}`);
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
    while (casts.size > c.maxCasts) casts.delete(casts.keys().next().value!);
    return cast;
  }

  /** The class's own cast, else the first shared cast that has its members. */
  async function castFor(cls: string): Promise<FurniCast | null> {
    const own = await getCast(`${furniPath}/hh_furni_xx_${cls}.cct`);
    if (own) return own;
    const lower = cls.toLowerCase();
    for (const path of c.sharedCasts) {
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
      const [peopleCasts, human, figureData] = await Promise.all([Promise.all(c.peopleCasts.map(requireAsset)), requireAsset(c.humanCast), requireAsset(c.figureData)]);
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

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`ok ${casts.size} casts`);
      return;
    }
    if ((url.pathname !== '/furni' && url.pathname !== '/avatar') || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    try {
      const result = url.pathname === '/avatar' ? await renderHabbo(url.searchParams) : await renderFurni(url.searchParams);
      if (result === 'bad') {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(url.pathname === '/avatar' ? 'bad figure' : 'bad sprite');
        return;
      }
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nothing to draw');
        return;
      }
      const { body, type } = encode(result, url.searchParams);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' }).end(body);
    } catch (e) {
      console.error(url.pathname + url.search, (e as Error).message);
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end('renderer error');
    }
  }

  return { handle, castCount: () => casts.size };
}

function flag(v: string | null) {
  return v === '1' || v === 'true';
}

function bgOf(q: URLSearchParams): number | undefined {
  const bg = (q.get('bg') ?? '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(bg) ? parseInt(bg, 16) : undefined;
}

/** A still picture as asked: the RGBA (written as a PNG), or a GIF with format=gif. */
function still(img: { width: number; height: number; rgba: Uint8ClampedArray }, q: URLSearchParams): Picture {
  if (q.get('format') === 'gif') return { gif: encodeGif(img.width, img.height, [{ rgba: img.rgba, ticks: 1 }], 1, { bg: bgOf(q) }) };
  return { width: img.width, height: img.height, rgba: img.rgba, layers: [], direction: 0 } as Rendered;
}

/** An animation as asked: an animated PNG, or an animated GIF with format=gif. */
function moving(width: number, height: number, frames: { rgba: Uint8ClampedArray; ticks: number }[], fps: number, plays: number, q: URLSearchParams, png?: Buffer): Picture {
  if (q.get('format') === 'gif') return { gif: encodeGif(width, height, frames, fps, { bg: bgOf(q), plays }) };
  return { png: png ?? encodeApng(width, height, frames, fps, plays) };
}

function encode(result: Picture, q: URLSearchParams): { body: Buffer; type: string } {
  if ('gif' in result) return { body: result.gif, type: 'image/gif' };
  if ('png' in result) return { body: result.png, type: 'image/png' };
  if (q.get('format') === 'gif') return { body: (still(result, q) as { gif: Buffer }).gif, type: 'image/gif' };
  const png = new PNG({ width: result.width, height: result.height });
  png.data.set(result.rgba);
  return { body: PNG.sync.write(png), type: 'image/png' };
}
