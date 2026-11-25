// Builds the demo page into site/: the drawing core bundled for the browser, the page and the sample casts.
// The script and stylesheet are named after their content (demo.<hash>.js), so a page never pairs with an older
// file a CDN still holds (GitHub Pages caches each file for 10 minutes).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);

rmSync('site', { recursive: true, force: true });
mkdirSync('site');
await build({
  entryPoints: ['demo/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: 'site/demo.js',
  alias: { 'node:zlib': './demo/zlib-shim.ts' },
  inject: ['./demo/buffer-shim.ts'],
  logLevel: 'warning',
});
const js = `demo.${hash('site/demo.js')}.js`;
renameSync('site/demo.js', `site/${js}`);
const css = `style.${hash('demo/style.css')}.css`;
cpSync('demo/style.css', `site/${css}`);
const html = readFileSync('demo/index.html', 'utf8').replace('href="style.css"', `href="${css}"`).replace('src="demo.js"', `src="${js}"`);
if (!html.includes(js) || !html.includes(css)) throw new Error('index.html no longer references style.css / demo.js');
writeFileSync('site/index.html', html);
cpSync('samples', 'site/samples', { recursive: true });
console.log(`site/ built (${js}, ${css})`);
