/**
 * Lingo `value()` for the literals furni casts carry in their .props and .data fields:
 * lists `[1, 2]`, property lists `["a": [#ink: 41]]` / `[states: [1, 2]]` (bare words before a colon are symbol
 * keys, as Lingo reads them), strings, #symbols, integers and floats, point(x, y) and rgb(...). Property lists come
 * back as Map (keys keep their order, symbols and strings both as plain strings); anything unreadable is undefined.
 */

export type LingoValue = number | string | LingoValue[] | Map<string, LingoValue> | { point: [number, number] } | undefined;

export function lingoValue(text: string): LingoValue {
  const p = new Parser(text.replace(/[\r\n]/g, ' '));
  try {
    const v = p.value();
    return v;
  } catch {
    return undefined;
  }
}

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private peek() {
    this.ws();
    return this.s[this.i];
  }

  value(): LingoValue {
    const c = this.peek();
    if (c === '[') return this.list();
    if (c === '"') return this.str();
    if (c === '#') {
      this.i++;
      return this.word();
    }
    if (c === '-' || c === '+' || /[0-9.]/.test(c ?? '')) return this.num();
    const w = this.word();
    const lower = w.toLowerCase();
    if (this.peek() === '(') {
      const args = this.args();
      if (lower === 'point' && args.length === 2) return { point: [Number(args[0]), Number(args[1])] };
      return undefined;
    }
    if (lower === 'void') return undefined;
    if (lower === 'true') return 1;
    if (lower === 'false') return 0;
    return w;
  }

  private args(): LingoValue[] {
    this.i++; // (
    const out: LingoValue[] = [];
    while (this.peek() !== ')' && this.i < this.s.length) {
      out.push(this.value());
      if (this.peek() === ',') this.i++;
    }
    this.i++;
    return out;
  }

  private word(): string {
    this.ws();
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z0-9_.]/.test(this.s[this.i])) this.i++;
    if (start === this.i) throw new Error('word expected at ' + this.i);
    return this.s.slice(start, this.i);
  }

  private str(): string {
    this.i++; // "
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i] !== '"') this.i++;
    const out = this.s.slice(start, this.i);
    this.i++;
    return out;
  }

  private num(): number {
    this.ws();
    const m = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(this.s.slice(this.i));
    if (!m) throw new Error('number expected at ' + this.i);
    this.i += m[0].length;
    return Number(m[0]);
  }

  private list(): LingoValue[] | Map<string, LingoValue> {
    this.i++; // [
    if (this.peek() === ':') {
      this.i++;
      this.peek();
      this.i++; // ]
      return new Map();
    }
    const items: LingoValue[] = [];
    let map: Map<string, LingoValue> | null = null;
    while (this.peek() !== ']') {
      if (this.i >= this.s.length) throw new Error('unclosed list');
      const v = this.value();
      if (this.peek() === ':') {
        this.i++;
        map ??= new Map();
        // A repeated property keeps its first value: getaProp finds the first (shelves_norja: [#ink: 41, #ink: 36]).
        const key = String(v);
        const value = this.value();
        if (!map.has(key)) map.set(key, value);
      } else {
        items.push(v);
      }
      if (this.peek() === ',') this.i++;
    }
    this.i++; // ]
    return map ?? items;
  }
}

/** A property of a property list by key (Lingo property lists match symbols case-insensitively). */
export function prop(v: LingoValue, key: string): LingoValue {
  if (!(v instanceof Map)) return undefined;
  if (v.has(key)) return v.get(key);
  const lower = key.toLowerCase();
  for (const [k, value] of v) if (k.toLowerCase() === lower) return value;
  return undefined;
}
