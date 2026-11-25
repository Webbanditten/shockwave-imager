import { describe, expect, it } from 'vitest';
import { parseBotFigure } from '../src/avatar';

// The client's Figure System Class, parseFigure with class "bot".
describe('parseBotFigure', () => {
  it('reads part=model/colour, with r,g,b colours', () => {
    const f = parseBotFigure('hr=010/224,186,120&ch=202/139,24,32')!;
    expect(f.get('hr')).toEqual({ model: '010', color: 0xe0ba78 });
    expect(f.get('ch')).toEqual({ model: '202', color: 0x8b1820 });
  });

  it('makes too-bright, missing and 0 colours EEEEEE, and fills the parts the client always draws', () => {
    const f = parseBotFigure('sh=001/255,255,255&lg=201&ey=001/0')!;
    expect(f.get('sh')!.color).toBe(0xeeeeee);
    expect(f.get('lg')).toEqual({ model: '201', color: 0xeeeeee });
    expect(f.get('ey')!.color).toBe(0xeeeeee);
    expect(f.get('hd')).toEqual({ model: '001', color: 0xeeeeee });
  });

  it('reads a single number as a palette index', () => {
    expect(parseBotFigure('sh=001/36')!.get('sh')!.color).not.toBe(0xeeeeee);
  });

  it('is not a 25-digit figure', () => {
    expect(parseBotFigure('1500118001275343000521525')).toBeNull();
  });
});
