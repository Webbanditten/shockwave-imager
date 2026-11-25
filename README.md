# shockwave-imager

Furni and Habbo pictures drawn from a hotel's own **Shockwave casts** (`.cct`), over HTTP. It works like
[Avatara](https://github.com/Quackster/Avatara) and Chroma, but where those draw from the Flash-era assets, this draws
from the casts the Shockwave client itself loads, the way the client draws them in a room:

- **Furni** (`/furni`): floor furni in every direction and state, part colours, shadows, the 32 px size and catalogue
  icons, wall items and posters, and **animated** furni as an animated PNG (lamps, fountains, the smoke machine).
- **Habbos** (`/avatar`): the 2006 client's 25-digit figures, in every direction, with actions (walk, sit, lay, wave,
  talk, carry, drink), gestures, the head alone, three sizes, and the four **dances** as animated PNGs.
- **GIF** output for both (`format=gif`), for chat apps and viewers that don't play animated PNGs.

**[Try it in your browser](https://webbanditten.github.io/shockwave-imager/)**: the demo page runs the service's own
drawing code on the sample casts, with a figure editor for Habbos and the request each picture answers to.

`/avatar` takes Avatara's query parameters, so a CMS can switch over by changing a URL.

It was built for [Habbo Danmark](https://habbo-danmark.com), which runs a 2007 Shockwave client. The Habbos were checked
pixel for pixel against that client running in the browser (through [DirPlayer](https://github.com/igorlira/dirplayer-rs)),
and the furni against the hotel's own casts in its rooms. Other client versions that keep the same cast layout should
work too.

## Bring your own casts

The service reads casts from your hotel's asset host (a URL) or from a folder. It contains **no Habbo graphics**: it
reads every bitmap, alias, ink and animation table from your casts at runtime.

`samples/` holds what the service needs to draw Habbos (the people casts, `hh_human` and the figure data) and three
furni casts (`chair_norja`, `hc_lmp`, `poster_20`), so `ASSETS=samples` works out of the box and the tests have something
to draw. The rest of the furni (your `hof_furni` folder) comes from your own hotel.

Paths, relative to `ASSETS` (each one can be changed, see [Configuration](#configuration)):

| What | Default path | Needed for |
|---|---|---|
| Furni casts | `hof_furni/hh_furni_xx_<class>.cct`, posters `hof_furni/hh_furni_xx_poster_<n>.cct` | `/furni` |
| Shared casts searched for classes without a cast of their own (e.g. pet items) | `dcr/hh_pets.cct` | optional |
| Habbo casts | `dcr/hh_people_1.cct`, `dcr/hh_people_2.cct`, `dcr/hh_people_small_1.cct`, `dcr/hh_people_small_2.cct` | `/avatar` |
| `hh_human` (hand items, dances) | `dcr/hh_human.cct` | `/avatar` |
| Figure part list (`external.figurepartlist.txt`) | `gamedata/figuredata.txt` | `/avatar` |

## Run it

With Docker (the image, built from `main`, includes the samples):

```sh
docker run --rm -p 8096:8096 -e ASSETS=/app/samples ghcr.io/webbanditten/shockwave-imager
# or build it yourself: docker build -t shockwave-imager .
# http://localhost:8096/furni?sprite=chair_norja&direction=4
# http://localhost:8096/furni?sprite=hc_lmp&anim=1
# http://localhost:8096/avatar?figure=1500118001275343000521525&dance=2
```

Against your asset host, or a folder of your casts mounted into the container:

```sh
docker run --rm -p 8096:8096 -e ASSETS=https://images.example.com shockwave-imager
docker run --rm -p 8096:8096 -v /srv/hotel/assets:/assets:ro -e ASSETS=/assets shockwave-imager
```

Or with Node.js 20 or newer:

```sh
npm ci
npm run build
ASSETS=./samples npm start
```

A `docker compose` service next to a CMS:

```yaml
  imager:
    image: ghcr.io/webbanditten/shockwave-imager:latest
    environment:
      ASSETS: http://assets            # your asset host, as the container sees it
    mem_limit: 256m
```

It keeps parsed casts in memory (25-40 MB in a busy hotel), so it needs nothing on disk. Pictures are sent with
`Cache-Control: public, max-age=86400`. Put a cache in front of it (your CMS, a reverse proxy or a CDN) and keep the
service itself internal.

## Endpoints

### `GET /furni`

| Parameter | Meaning |
|---|---|
| `sprite` | The furni class, optionally with its colour: `chair_norja`, `chair_norja*2`. Posters: `poster20` or `poster 20`. |
| `colors` | Part colours, comma separated, one per layer: `#RRGGBB` or a palette index (`items_definitions.colour` in Kepler-based servers). |
| `direction` | 0-7 (default 2). |
| `state` | The furni's state value minus 1 (0 = first state; a lamp: 0 off, 1 on). |
| `shadow=1` | Draw the shadow. |
| `small=1` | The 32 px room size. |
| `icon=1` | The catalogue/hand icon (falls back to the small picture when the cast has none). |
| `wall` | `leftwall` (default) or `rightwall`, for wall items and posters. |
| `anim=1` | An animated PNG when the furni moves in that state. Without `state`, the first of states 0 and 1 that keeps moving (a lamp lit). Still furni stay a PNG. |
| `format=gif`, `bg=RRGGBB` | A GIF instead. GIF has no partial transparency: a pixel shows when it is at least half opaque, or the picture is drawn onto `bg`. |

### `GET /avatar`

| Parameter | Meaning |
|---|---|
| `figure` | A 25-digit figure (five sets, each a 3-digit set id and a 2-digit colour). Anything else answers 404, so a CMS can fall back to another imager. |
| `sex` | `M` or `F`. Without it, the sex whose figure data knows more of the figure's sets. |
| `size` | `b` 64x110 (default), `s` 32x55 (the 32 px parts), `l` (b doubled). |
| `direction`, `head_direction` | 0-7. |
| `action` | `std`, `wlk`, `sit`, `lay`, `wav`, `spk`, `crr`, `drk`; several separated by commas. |
| `gesture` | `sml`, `sad`, `agr`, `srp`. |
| `crr`, `drk` | Hand item number (from hh_human's `handitem.right.<n>`). |
| `frame` | Animation frame, 1-based. |
| `head=1` | Only the head. |
| `dance` | 1-4: an animated PNG of that dance. |
| `anim=1` | With `wlk`, `wav` or `spk`: an animated PNG (12 frames a second, the client's rate). |
| `format=gif`, `bg=RRGGBB` | As for furni. |

### `GET /health`

`ok <n> casts`.

### Answers

`200` with the picture, `400` for a malformed `sprite` or a missing `figure`, `404` when there is nothing to draw (no
cast for that furni, or a figure it doesn't handle), `502` when a cast can't be fetched (the log says which).

## Configuration

| Variable | Default | |
|---|---|---|
| `ASSETS` | (required) | `https://...` for an asset host, or a folder. |
| `PORT` | `8096` | |
| `FURNI_PATH` | `hof_furni` | Folder of the furni casts. |
| `SHARED_CASTS` | `dcr/hh_pets.cct` | Comma separated. |
| `PEOPLE_CASTS` | `dcr/hh_people_1.cct,dcr/hh_people_2.cct,dcr/hh_people_small_1.cct,dcr/hh_people_small_2.cct` | Comma separated. |
| `HUMAN_CAST` | `dcr/hh_human.cct` | |
| `FIGURE_DATA` | `gamedata/figuredata.txt` | |
| `MAX_CASTS` | `400` | Parsed casts kept in memory (least recently used out). Missing casts are remembered for 10 minutes, the Habbo casts reloaded every hour. |

## How it draws

- **Furni** (`src/render.ts`, `src/animation.ts`): layers `<class>_<size>_<layer>_<w>_<h>_<direction>_<frame>` as the
  client's furni classes find them, the cast's `memberalias.index` (mirrored aliases included), `.props` (ink, blend,
  z-shift, location shift) and `.data` (states and frame lists). Inks and part colours follow the client's sprite
  drawing. Animations step the `.data` frame lists 24 times a second like the client (`delay`, `loop`, `sequences`,
  `random`, per-frame `blend`). Furni that animate in their own Lingo class are not, except the smoke machine.
- **Habbos** (`src/avatar.ts`): the figure against the figure part list, then the parts in the client's order for the
  direction and action, `<size>_<action>_<part>_<model>_<direction>_<frame>` members, ink 41 with the part colour, the
  mirrored canvas for directions 4-6, hand items and the dance tables from `hh_human`.
- **Casts** (`src/director/`): a reader for Director's afterburned (`.cct`/`.dcr`) and uncompressed files, written from
  the format knowledge in [ProjectorRays](https://github.com/ProjectorRays/ProjectorRays) and ScummVM's Director engine.
- **Encoders**: PNG (pngjs), animated PNG (`src/apng.ts`, only the changed rectangle per frame) and GIF
  (`src/gif.ts`, exact palette up to 255 colours, else a median cut).

## Development

```sh
npm ci
npm test            # renders the samples and checks their pixels
npm run typecheck
npm run build       # dist/shockwave-imager.cjs, one file with no dependencies
npm run build:demo  # the demo page into site/ (serve it with any static server)
```

The drawing core (`src/imager.ts`) does no I/O of its own: `createRenderer(readAsset)` takes a function that returns a
cast's bytes, so it runs in Node.js (`src/app.ts`) and in the browser (`demo/main.ts`).

## Legal

The code is MIT licensed (see `LICENSE`). The casts and the figure data in `samples/` are Sulake's and are not covered
by that licence; they are here only so the service can be tried and tested. Habbo is a trademark of Sulake Oy. This project is not
affiliated with or endorsed by Sulake.
