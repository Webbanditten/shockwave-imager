/**
 * shockwave-imager: furni and Habbo pictures from a hotel's own Shockwave casts, over HTTP.
 * Configuration is read from the environment (see README.md).
 */
import { createServer } from 'node:http';
import { DEFAULTS, createImager } from './app';

const list = (v: string | undefined) => v?.split(',').map((s) => s.trim()).filter(Boolean);

const assets = process.env.ASSETS;
if (!assets) {
  console.error('Set ASSETS to your asset host (https://...) or a folder of casts, e.g. ASSETS=./samples');
  process.exit(1);
}

const imager = createImager({
  assets,
  furniPath: process.env.FURNI_PATH,
  sharedCasts: list(process.env.SHARED_CASTS),
  peopleCasts: list(process.env.PEOPLE_CASTS),
  humanCast: process.env.HUMAN_CAST,
  figureData: process.env.FIGURE_DATA,
  maxCasts: process.env.MAX_CASTS ? Number(process.env.MAX_CASTS) : undefined,
});

const port = Number(process.env.PORT ?? 8096);
createServer((req, res) => void imager.handle(req, res)).listen(port, () =>
  console.log(`shockwave-imager on :${port}, assets ${assets} (furni in ${process.env.FURNI_PATH ?? DEFAULTS.furniPath})`),
);
