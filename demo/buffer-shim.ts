/** The two Buffer calls the encoders make, for the browser build (they only build plain byte arrays). */
export const Buffer = {
  concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  },
  from(bytes: ArrayLike<number>): Uint8Array {
    return Uint8Array.from(bytes);
  },
};
