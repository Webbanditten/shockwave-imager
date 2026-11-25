/** node:zlib's deflateSync for the browser build, from pako (a port of zlib). */
import { deflate } from 'pako';

export function deflateSync(data: Uint8Array, options: { level?: number } = {}): Uint8Array {
  return deflate(data, { level: (options.level ?? 6) as 6 });
}
