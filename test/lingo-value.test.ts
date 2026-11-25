import { describe, expect, it } from 'vitest';
import { lingoValue, prop } from '../src/lingo-value';

// The furni .props / .data members are Lingo literals; these are the shapes they use.
describe('lingoValue', () => {
  it('reads numbers, strings and symbols', () => {
    expect(lingoValue('12')).toBe(12);
    expect(lingoValue('-3.5')).toBe(-3.5);
    expect(lingoValue('"hello"')).toBe('hello');
  });

  it('reads lists and property lists', () => {
    expect(lingoValue('[1, 2, 3]')).toEqual([1, 2, 3]);
    const v = lingoValue('[#a: [#ink: 33, #blend: 50], #b: [1, 2]]');
    expect(prop(prop(v, 'a'), 'ink')).toBe(33);
    expect(prop(prop(v, 'a'), 'blend')).toBe(50);
    expect(prop(v, 'b')).toEqual([1, 2]);
  });

  it('reads points', () => {
    expect(lingoValue('point(3, -4)')).toEqual({ point: [3, -4] });
  });
});
