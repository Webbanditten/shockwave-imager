import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PNG } from 'pngjs';
import { createImager } from '../src/app';

// The service over the casts in samples/ (three furni and the Habbo casts).
let server: Server;
let base: string;

beforeAll(async () => {
  const imager = createImager({ assets: 'samples' });
  server = createServer((req, res) => void imager.handle(req, res)).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

async function get(path: string) {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
}

/** Width, height and a hash of the pixels, so an encoder change doesn't count but a drawing change does. */
function pixels(body: Buffer) {
  const png = PNG.sync.read(body);
  return [png.width, png.height, createHash('sha1').update(png.data).digest('hex').slice(0, 16)];
}

describe('furni', () => {
  // Pixel hashes of the pictures as drawn when this repository was made (identical to the renderer it came from).
  it.each([
    ['sprite=chair_norja', 47, 61, '243433b1812797c1'],
    ['sprite=chair_norja&colors=%23FF0000&direction=4&shadow=1', 54, 63, '28402bf344b87058'],
    ['sprite=chair_norja&icon=1', 23, 30, '25ab568a0305fe0b'],
    ['sprite=hc_lmp&state=1', 62, 94, '022f8d16cdedc763'],
    ['sprite=poster20&wall=rightwall', 52, 89, 'd124d93f370e298a'],
  ])('%s', async (query, width, height, hash) => {
    const res = await get(`/furni?${query}`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('image/png');
    expect(pixels(res.body)).toEqual([width, height, hash]);
  });

  it('part colours change the picture', async () => {
    const plain = await get('/furni?sprite=chair_norja');
    const red = await get('/furni?sprite=chair_norja&colors=%23FF0000');
    expect(pixels(red.body)[2]).not.toBe(pixels(plain.body)[2]);
  });

  it('a lit lamp is an animated PNG', async () => {
    const res = await get('/furni?sprite=hc_lmp&anim=1');
    expect(res.status).toBe(200);
    expect(res.body.subarray(1, 4).toString()).toBe('PNG');
    expect(res.body.includes(Buffer.from('acTL'))).toBe(true);
  });

  it('format=gif gives a GIF', async () => {
    const still = await get('/furni?sprite=poster20&format=gif&bg=FFFFFF');
    expect(still.type).toBe('image/gif');
    expect(still.body.subarray(0, 6).toString()).toBe('GIF89a');
    const moving = await get('/furni?sprite=hc_lmp&anim=1&format=gif');
    expect(moving.body.subarray(0, 6).toString()).toBe('GIF89a');
  });

  it('answers 404 for furni it has no cast for, 400 for names that are not furni names', async () => {
    expect((await get('/furni?sprite=throne')).status).toBe(404);
    expect((await get('/furni?sprite=poster999')).status).toBe(404);
    expect((await get('/furni?sprite=../../etc/passwd')).status).toBe(400);
    expect((await get('/furni')).status).toBe(400);
  });
});

describe('service', () => {
  it('reports health', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toMatch(/^ok \d+ casts$/);
  });

  it('answers 404 for other paths', async () => {
    expect((await get('/nope')).status).toBe(404);
  });

  it('answers 502 when a cast can not be read', async () => {
    const imager = createImager({ assets: 'samples', peopleCasts: ['dcr/missing.cct'] });
    const broken = createServer((req, res) => void imager.handle(req, res)).listen(0, '127.0.0.1');
    await new Promise((resolve) => broken.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${(broken.address() as AddressInfo).port}/avatar?figure=1500118001275343000521525`);
    broken.close();
    expect(res.status).toBe(502);
  });
});

describe('avatar', () => {
  const figure = '1500118001275343000521525';

  it.each([
    [`figure=${figure}`, 64, 110, '7b7af2a70b79a9b1'],
    [`figure=${figure}&size=s&direction=4&action=wav&gesture=sml`, 32, 55, 'f731496ecf0c4efb'],
    [`figure=${figure}&head=1&size=l`, 66, 70, '0881743e678773eb'],
    [`figure=${figure}&crr=5&action=crr&direction=3`, 64, 110, 'f11360b5a237b775'],
  ])('%s', async (query, width, height, hash) => {
    const res = await get(`/avatar?${query}`);
    expect(res.status).toBe(200);
    expect(pixels(res.body)).toEqual([width, height, hash]);
  });

  it('dances as an animated PNG', async () => {
    const res = await get(`/avatar?figure=${figure}&dance=2`);
    expect(res.status).toBe(200);
    expect(res.body.includes(Buffer.from('acTL'))).toBe(true);
  });

  it('answers 400 without a figure, 404 for figures it does not draw', async () => {
    expect((await get('/avatar')).status).toBe(400);
    expect((await get('/avatar?figure=hd-180-1.ch-210-66')).status).toBe(404); // not a 2006 figure
  });
});
