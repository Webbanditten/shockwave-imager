/**
 * The demo page: the service's own drawing core (src/imager.ts) running in the browser, reading the casts in samples/.
 * Every picture is what the service answers for the request shown under it.
 */
import { createRenderer, still, type Picture } from '../src/imager';
import type { FigureData, Sex } from '../src/avatar';

const SAMPLES = new URL('samples/', document.baseURI);

const renderer = createRenderer(async (path) => {
  const res = await fetch(new URL(path, SAMPLES));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
});

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- pictures ----------------------------------------------------------------------------------------------------

/** An object URL for what the renderer drew (null when there is nothing to show). */
async function pictureUrl(picture: Picture | null | 'bad', q: URLSearchParams): Promise<string | null> {
  if (!picture || picture === 'bad') return null;
  // As the service does: a still picture asked for as a GIF is written as one (format=gif, bg=).
  if (!('png' in picture) && !('gif' in picture) && q.get('format') === 'gif' && picture.width && picture.height) picture = still(picture, q);
  if ('png' in picture) return URL.createObjectURL(new Blob([picture.png as BlobPart], { type: 'image/png' }));
  if ('gif' in picture) return URL.createObjectURL(new Blob([picture.gif as BlobPart], { type: 'image/gif' }));
  if (!picture.width || !picture.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

const zoom: Record<string, number> = { 'habbo-img': 2, 'furni-img': 2 };

function sizeImage(img: HTMLImageElement) {
  const z = zoom[img.id] ?? 1;
  img.style.width = `${img.naturalWidth * z}px`;
  img.style.height = `${img.naturalHeight * z}px`;
}

/** Draw a request into an <img>; only the latest request per image wins. */
const latest = new Map<HTMLImageElement, number>();
async function show(img: HTMLImageElement, pathname: string, params: URLSearchParams) {
  const ticket = (latest.get(img) ?? 0) + 1;
  latest.set(img, ticket);
  let url: string | null = null;
  let error = '';
  try {
    url = await pictureUrl(await renderer.render(pathname, params), params);
  } catch (e) {
    error = (e as Error).message;
  }
  if (latest.get(img) !== ticket) {
    if (url) URL.revokeObjectURL(url);
    return;
  }
  const stage = img.parentElement!;
  stage.querySelector('.note')?.remove();
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  if (!url) {
    img.removeAttribute('src');
    img.hidden = true;
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = error ? `Could not draw it: ${error}` : 'Nothing to draw for this combination (the service answers 404).';
    stage.append(note);
    return;
  }
  img.hidden = false;
  img.onload = () => sizeImage(img);
  img.src = url;
}

for (const box of document.querySelectorAll<HTMLElement>('.zoom')) {
  const img = $<HTMLImageElement>(box.dataset.for!);
  for (const z of [1, 2, 3, 4]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${z}×`;
    b.setAttribute('aria-pressed', String(zoom[img.id] === z));
    b.onclick = () => {
      zoom[img.id] = z;
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (img.naturalWidth) sizeImage(img);
    };
    box.append(b);
  }
}

/** A segmented control: keeps one button pressed and calls back with its value. */
function segmented(id: string, initial: string, onChange: (v: string) => void) {
  const el = $(id);
  const set = (v: string) => el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  set(initial);
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.v) return;
    set(b.dataset.v);
    onChange(b.dataset.v);
  });
  return set;
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.copy')) {
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText($(b.dataset.copy!).textContent ?? '');
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Select it';
    }
    setTimeout(() => (b.textContent = 'Copy'), 1200);
  };
}

const requestLine = (pathname: string, params: URLSearchParams) => `GET ${pathname}?${params.toString().replace(/%2C/g, ',')}`;

// ---- Habbos ------------------------------------------------------------------------------------------------------

type MainPart = 'hr' | 'hd' | 'ch' | 'lg' | 'sh';
const PARTS: [MainPart, string][] = [['hr', 'Hair'], ['hd', 'Skin'], ['ch', 'Top'], ['lg', 'Bottoms'], ['sh', 'Shoes']];
const FIGURE_ORDER: MainPart[] = ['hr', 'hd', 'lg', 'sh', 'ch'];

let figureData: FigureData;
const habbo = {
  sex: 'M' as Sex,
  picks: {} as Record<MainPart, { set: number; color: number }>,
  direction: 2,
  head: 2,
  action: 'std',
  item: 1,
  gesture: '',
  dance: '',
  anim: false,
  headOnly: false,
  size: 'b',
  format: 'png',
};

const setsOf = (sex: Sex, part: MainPart) => figureData.parts[sex].get(part) ?? [];
const colourOf = (c: string | string[] | undefined) => `#${(Array.isArray(c) ? c[0] : c) ?? 'EEEEEE'}`;
const randomIndex = (n: number) => Math.floor(Math.random() * n);

function figureOf(sex: Sex, picks: Record<MainPart, { set: number; color: number }>) {
  return FIGURE_ORDER.map((part) => {
    const set = setsOf(sex, part)[picks[part].set];
    return set ? String(set.s).padStart(3, '0') + String(picks[part].color).padStart(2, '0') : '';
  }).join('');
}

function randomPicks(sex: Sex) {
  const picks = {} as Record<MainPart, { set: number; color: number }>;
  for (const [part] of PARTS) {
    const sets = setsOf(sex, part);
    const set = randomIndex(sets.length);
    picks[part] = { set, color: 1 + randomIndex(Math.max(1, sets[set]?.c.length ?? 1)) };
  }
  return picks;
}

function picksFromFigure(sex: Sex, figure: string) {
  const picks = randomPicks(sex);
  for (let i = 0; i + 5 <= figure.length; i += 5) {
    const where = figureData.sets[sex].get(Number(figure.slice(i, i + 3)));
    if (where && PARTS.some(([p]) => p === where[0])) picks[where[0] as MainPart] = { set: where[1], color: Number(figure.slice(i + 3, i + 5)) || 1 };
  }
  return picks;
}

function buildPartRows() {
  const box = $('parts');
  box.replaceChildren();
  for (const [part, name] of PARTS) {
    const sets = setsOf(habbo.sex, part);
    const pick = habbo.picks[part];
    const row = document.createElement('div');
    row.className = 'part';
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const nav = document.createElement('span');
    nav.className = 'pick';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'icon';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', `Previous ${name.toLowerCase()}`);
    const count = document.createElement('span');
    count.textContent = `${pick.set + 1}/${sets.length}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'icon';
    next.textContent = '›';
    next.setAttribute('aria-label', `Next ${name.toLowerCase()}`);
    const step = (d: number) => {
      pick.set = (pick.set + d + sets.length) % sets.length;
      pick.color = Math.min(pick.color, sets[pick.set]?.c.length || 1);
      buildPartRows();
      drawHabbo();
    };
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    nav.append(prev, count, next);
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    (sets[pick.set]?.c ?? []).forEach((c, i) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'swatch';
      s.style.background = colourOf(c);
      s.setAttribute('aria-label', `${name} colour ${i + 1}`);
      s.setAttribute('aria-pressed', String(pick.color === i + 1));
      s.onclick = () => {
        pick.color = i + 1;
        buildPartRows();
        drawHabbo();
      };
      swatches.append(s);
    });
    row.append(label, nav, swatches);
    box.append(row);
  }
}

function habboParams() {
  const q = new URLSearchParams({ figure: figureOf(habbo.sex, habbo.picks), sex: habbo.sex, size: habbo.size, direction: String(habbo.direction) });
  if (habbo.head !== habbo.direction) q.set('head_direction', String(habbo.head));
  if (habbo.action !== 'std') q.set('action', habbo.action);
  if (habbo.action === 'crr') q.set('crr', String(habbo.item));
  if (habbo.action === 'drk') q.set('drk', String(habbo.item));
  if (habbo.gesture) q.set('gesture', habbo.gesture);
  if (habbo.dance) q.set('dance', habbo.dance);
  if (habbo.anim && !habbo.dance) q.set('anim', '1');
  if (habbo.headOnly) q.set('head', '1');
  if (habbo.format === 'gif') q.set('format', 'gif');
  return q;
}

function drawHabbo() {
  const q = habboParams();
  $('habbo-url').textContent = requestLine('/avatar', q);
  void show($<HTMLImageElement>('habbo-img'), '/avatar', q);
}

const setSex = segmented('sex', 'M', (v) => {
  habbo.sex = v as Sex;
  habbo.picks = randomPicks(habbo.sex);
  buildPartRows();
  drawHabbo();
});
$('random').onclick = () => {
  habbo.picks = randomPicks(habbo.sex);
  buildPartRows();
  drawHabbo();
};
const turn = (d: number) => (d + 8) % 8;
$('body-left').onclick = () => ((habbo.direction = turn(habbo.direction + 1)), (habbo.head = habbo.direction), drawHabbo());
$('body-right').onclick = () => ((habbo.direction = turn(habbo.direction - 1)), (habbo.head = habbo.direction), drawHabbo());
$('head-left').onclick = () => ((habbo.head = turn(habbo.head + 1)), drawHabbo());
$('head-right').onclick = () => ((habbo.head = turn(habbo.head - 1)), drawHabbo());
$<HTMLSelectElement>('action').onchange = (e) => {
  habbo.action = (e.target as HTMLSelectElement).value;
  $('item-wrap').hidden = habbo.action !== 'crr' && habbo.action !== 'drk';
  drawHabbo();
};
$<HTMLInputElement>('item').oninput = (e) => ((habbo.item = Math.max(1, Number((e.target as HTMLInputElement).value) || 1)), drawHabbo());
$<HTMLSelectElement>('gesture').onchange = (e) => ((habbo.gesture = (e.target as HTMLSelectElement).value), drawHabbo());
$<HTMLSelectElement>('dance').onchange = (e) => ((habbo.dance = (e.target as HTMLSelectElement).value), drawHabbo());
$<HTMLInputElement>('habbo-anim').onchange = (e) => ((habbo.anim = (e.target as HTMLInputElement).checked), drawHabbo());
$<HTMLInputElement>('head-only').onchange = (e) => ((habbo.headOnly = (e.target as HTMLInputElement).checked), drawHabbo());
segmented('size', 'b', (v) => ((habbo.size = v), drawHabbo()));
segmented('habbo-format', 'png', (v) => ((habbo.format = v), drawHabbo()));

// ---- furni -------------------------------------------------------------------------------------------------------

const furni = { sprite: 'chair_norja', direction: 2, wall: 'leftwall', state: '1', useColour: false, colour: '#d33a2c', shadow: false, small: false, icon: false, anim: true, format: 'png' };

function furniParams() {
  const q = new URLSearchParams({ sprite: furni.sprite });
  const poster = furni.sprite.startsWith('poster');
  if (poster) {
    if (furni.wall !== 'leftwall') q.set('wall', furni.wall);
  } else q.set('direction', String(furni.direction));
  if (furni.sprite === 'hc_lmp') q.set('state', furni.state);
  if (furni.useColour && furni.sprite === 'chair_norja') q.set('colors', furni.colour.toUpperCase());
  if (furni.shadow && !poster) q.set('shadow', '1');
  if (furni.small) q.set('small', '1');
  if (furni.icon) q.set('icon', '1');
  if (furni.anim && furni.sprite === 'hc_lmp') q.set('anim', '1');
  if (furni.format === 'gif') q.set('format', 'gif');
  return q;
}

function drawFurni() {
  const poster = furni.sprite.startsWith('poster');
  $('furni-dir-row').hidden = poster;
  $('wall-row').hidden = !poster;
  $('state-row').hidden = furni.sprite !== 'hc_lmp';
  $('colour-row').hidden = furni.sprite !== 'chair_norja';
  const q = furniParams();
  $('furni-url').textContent = requestLine('/furni', q);
  void show($<HTMLImageElement>('furni-img'), '/furni', q);
}

segmented('furni', furni.sprite, (v) => ((furni.sprite = v), drawFurni()));
segmented('wall', furni.wall, (v) => ((furni.wall = v), drawFurni()));
segmented('state', furni.state, (v) => ((furni.state = v), drawFurni()));
segmented('furni-format', 'png', (v) => ((furni.format = v), drawFurni()));
$('furni-left').onclick = () => ((furni.direction = turn(furni.direction + 2)), drawFurni());
$('furni-right').onclick = () => ((furni.direction = turn(furni.direction - 2)), drawFurni());
$<HTMLInputElement>('use-colour').onchange = (e) => ((furni.useColour = (e.target as HTMLInputElement).checked), drawFurni());
$<HTMLInputElement>('colour').oninput = (e) => ((furni.colour = (e.target as HTMLInputElement).value), (furni.useColour = true), (($<HTMLInputElement>('use-colour')).checked = true), drawFurni());
for (const key of ['shadow', 'small', 'icon'] as const) $<HTMLInputElement>(key).onchange = (e) => ((furni[key] = (e.target as HTMLInputElement).checked), drawFurni());
$<HTMLInputElement>('furni-anim').onchange = (e) => ((furni.anim = (e.target as HTMLInputElement).checked), drawFurni());

// ---- showcase ----------------------------------------------------------------------------------------------------

async function showcase() {
  const strip = $('strip');
  const items: [string, URLSearchParams][] = [];
  for (const dance of [1, 2, 3, 4]) {
    const sex: Sex = Math.random() < 0.5 ? 'M' : 'F';
    items.push(['/avatar', new URLSearchParams({ figure: figureOf(sex, randomPicks(sex)), sex, dance: String(dance), direction: String([2, 3, 4, 2][dance - 1]) })]);
  }
  items.push(['/furni', new URLSearchParams({ sprite: 'hc_lmp', state: '1', anim: '1' })]);
  const sex: Sex = Math.random() < 0.5 ? 'M' : 'F';
  items.push(['/avatar', new URLSearchParams({ figure: figureOf(sex, randomPicks(sex)), sex, action: 'wav', anim: '1', direction: '4' })]);
  items.push(['/furni', new URLSearchParams({ sprite: 'chair_norja', direction: '4', colors: '#3B7AC0' })]);
  const urls = await Promise.all(items.map(async ([path, q]) => [await pictureUrl(await renderer.render(path, q), q), requestLine(path, q)] as const));
  strip.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  strip.replaceChildren();
  for (const [url, title] of urls) {
    if (!url) continue;
    const img = new Image();
    img.title = title;
    img.alt = title;
    img.onload = () => {
      img.style.width = `${img.naturalWidth * 2}px`;
      img.style.height = `${img.naturalHeight * 2}px`;
    };
    img.src = url;
    strip.append(img);
  }
}
$('shuffle').onclick = () => void showcase();

// ---- start -------------------------------------------------------------------------------------------------------

(async () => {
  try {
    figureData = await renderer.figureData();
  } catch (e) {
    $('strip').replaceChildren(Object.assign(document.createElement('p'), { className: 'loading', textContent: `Could not load the casts: ${(e as Error).message}` }));
    return;
  }
  habbo.picks = picksFromFigure('M', '1500118001275343000521525');
  setSex('M');
  buildPartRows();
  drawHabbo();
  drawFurni();
  await showcase();
})();
