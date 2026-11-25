// Builds the demo page into site/: the drawing core bundled for the browser, the page and the sample casts.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('site', { recursive: true, force: true });
mkdirSync('site');
await build({
  entryPoints: ['demo/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  outfile: 'site/demo.js',
  alias: { 'node:zlib': './demo/zlib-shim.ts' },
  inject: ['./demo/buffer-shim.ts'],
  logLevel: 'warning',
});
cpSync('demo/index.html', 'site/index.html');
cpSync('demo/style.css', 'site/style.css');
cpSync('samples', 'site/samples', { recursive: true });
console.log('site/ built');
