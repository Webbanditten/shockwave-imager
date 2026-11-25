/**
 * The imager as a Node.js HTTP request handler: `createRenderer` (imager.ts) reading casts from a URL or a folder.
 *
 *   GET /furni?sprite=chair_norja*2&colors=%23FFFFFF,...&direction=2&state=0&shadow=1&small=1&icon=1&wall=rightwall
 *   GET /furni?sprite=poster20            (a wall poster; also "poster 20")
 *   GET /furni?sprite=hc_lmp&state=1&anim=1  (an animated PNG when the furni moves in that state, else the still one)
 *   GET /avatar?figure=1500118001275343000521525&sex=M&size=b&direction=2&head_direction=3&action=wav&gesture=sml&crr=5&frame=1&head=1
 *   GET /avatar?figure=...&dance=2      (dances 1-4, and action=wav|wlk|spk with anim=1: an animated PNG)
 *   format=gif on both: a GIF instead of the PNG / animated PNG (bg=RRGGBB draws it onto that colour)
 *   GET /health
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { PNG } from 'pngjs';
import { createRenderer, still, type ImagerOptions, type Picture, type ReadAsset } from './imager';

export { DEFAULTS } from './imager';

export interface ImagerConfig extends ImagerOptions {
  /** Where the casts are: an http(s) URL (your asset host) or a local folder. */
  assets: string;
}

/** Reads assets from an http(s) URL or from a folder (never outside it). */
export function assetReader(assets: string): ReadAsset {
  if (/^https?:\/\//i.test(assets)) {
    const base = assets.replace(/\/+$/, '');
    return async (path) => {
      const res = await fetch(`${base}/${path}`);
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
  }
  const base = resolve(assets.replace(/^file:\/\//i, ''));
  return async (path) => {
    const full = resolve(base, path);
    if (!full.startsWith(base + sep)) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
      throw e;
    }
  };
}

export function createImager(config: ImagerConfig) {
  const read = assetReader(config.assets);
  const renderer = createRenderer(async (path) => read(path), config);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`ok ${renderer.castCount()} casts`);
      return;
    }
    if (url.pathname === '/parts' && req.method === 'GET') {
      try {
        const result = await renderer.parts(url.searchParams);
        if (result === 'bad') return void res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad casts');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }).end(JSON.stringify(result));
      } catch (e) {
        console.error(url.pathname + url.search, (e as Error).message);
        res.writeHead(502, { 'Content-Type': 'text/plain' }).end('renderer error');
      }
      return;
    }
    if ((url.pathname !== '/furni' && url.pathname !== '/avatar') || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    try {
      const result = await renderer.render(url.pathname, url.searchParams);
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

  return { handle, castCount: renderer.castCount };
}

function encode(result: Picture, q: URLSearchParams): { body: Uint8Array; type: string } {
  if ('gif' in result) return { body: result.gif, type: 'image/gif' };
  if ('png' in result) return { body: result.png, type: 'image/png' };
  if (q.get('format') === 'gif') return { body: (still(result, q) as { gif: Buffer }).gif, type: 'image/gif' };
  const png = new PNG({ width: result.width, height: result.height });
  png.data.set(result.rgba);
  return { body: PNG.sync.write(png), type: 'image/png' };
}
