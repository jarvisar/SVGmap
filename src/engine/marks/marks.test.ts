import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeTransform } from '../geo/transform.ts';
import { makeShape, shapeCentre } from '../layout/shapes.ts';
import { parseOutlineFont } from '../text/loadFont.ts';
import { DEFAULT_MARK, type MapMark, layoutMark, markPlacedAt, markPoint, sanitizeMarks, wrapDegrees } from './marks.ts';
import { MARK_SHAPES, SHAPE_ORDER } from './shapes.ts';

const buffer = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
const font = parseOutlineFont(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
const mark = (patch: Partial<MapMark> = {}): MapMark => ({ ...DEFAULT_MARK, id: 'a1', ...patch });

describe('mark shapes', () => {
  it('are one unit tall', () => {
    for (const id of SHAPE_ORDER) {
      if (id === 'none') continue;
      const ys = MARK_SHAPES[id].fill.flat().map((p) => p[1]);
      expect(Math.max(...ys) - Math.min(...ys), id).toBeCloseTo(1, 1);
    }
  });
});

describe('laying out a mark', () => {
  it('puts the tip of a pin on its spot', () => {
    const art = layoutMark(mark({ shape: 'pin', size: 10 }), null);
    expect(art.box[3]).toBeCloseTo(0, 6);
    expect(art.box[1]).toBeCloseTo(-10, 6);
    expect(art.holes).toHaveLength(1);
  });

  it('sets text beside the shape at the cap height asked for', () => {
    const art = layoutMark(mark({ shape: 'dot', size: 6, text: 'HILT', textSize: 4, side: 'right' }), font);
    const xs = art.text.rings.flat().map((p) => p[0]);
    const ys = art.text.rings.flat().map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThan(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 1);
    // Centred on the dot.
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(0, 1);
  });

  it('stacks lines and centres text under the shape', () => {
    const one = layoutMark(mark({ shape: 'heart', text: 'WE MET', side: 'below' }), font);
    const two = layoutMark(mark({ shape: 'heart', text: 'WE MET\nHERE', side: 'below' }), font);
    expect(Math.min(...one.text.rings.flat().map((p) => p[1]))).toBeGreaterThan(one.box[1] + 7);
    expect(two.box[3]).toBeGreaterThan(one.box[3] + 3);
    const xs = one.text.rings.flat().map((p) => p[0]);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 1);
  });

  it('shrinks text inside a shape to fit, and drops the hole for it', () => {
    const art = layoutMark(mark({ shape: 'pin', size: 10, text: 'A LONG NAME', side: 'inside' }), font);
    expect(art.inside).toBe(true);
    expect(art.holes).toEqual([]);
    const xs = art.text.rings.flat().map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(MARK_SHAPES.pin.room[0] * 10 + 1e-6);
  });

  it('turns everything around the spot', () => {
    const straight = layoutMark(mark({ shape: 'arrow', size: 10 }), null);
    const turned = layoutMark(mark({ shape: 'arrow', size: 10, rotation: 90 }), null);
    expect(turned.box).toEqual(straight.box);
    const xs = turned.fill.flat().map((p) => p[0]);
    // The arrow points up from its tip, so turned clockwise it lies to the left of it.
    expect(Math.min(...xs)).toBeCloseTo(-10, 6);
  });

  it('spreads the letters and lines as asked, and lines them up on any side', () => {
    const width = (m: MapMark) => {
      const xs = layoutMark(m, font).text.rings.flat().map((p) => p[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    const height = (m: MapMark) => {
      const ys = layoutMark(m, font).text.rings.flat().map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    const two = mark({ shape: 'none', text: 'WIDE LINE\nI', textSize: 4 });
    expect(width({ ...two, letterSpacing: 1.5 })).toBeGreaterThan(width(two) * 1.3);
    expect(height({ ...two, lineSpacing: 2 })).toBeCloseTo(height(two) + 4 * 1.6, 1);
    const minX = (m: MapMark) => {
      const art = layoutMark(m, font);
      // The I is the last few rings, on the second line.
      return Math.min(...art.text.rings.slice(-1).flat().map((p) => p[0]));
    };
    expect(minX({ ...two, align: 'left' })).toBeLessThan(minX(two) - 5);
  });

  it('keeps the gap to the text asked for', () => {
    const left = (m: MapMark) => Math.min(...layoutMark(m, font).text.rings.flat().map((p) => p[0]));
    const dot = mark({ shape: 'dot', size: 6, text: 'HI', textSize: 4, side: 'right' });
    expect(left({ ...dot, textGap: 1 }) - left({ ...dot, textGap: 0 })).toBeCloseTo(4, 3);
  });

  it('is empty with no shape and no text', () => {
    expect(layoutMark(mark({ shape: 'none', text: '  ' }), font).empty).toBe(true);
  });
});

describe('placing a mark', () => {
  const window = makeShape('rect', 10, 10, 160, 100);
  const area = { lon: -87.63, lat: 41.88, bearing: 30, widthM: 3000 };
  const transform = makeTransform(area, 14, shapeCentre(window), window.w);

  it('finds the spot again from a point on the map', () => {
    const at = markPoint(mark({ lon: -87.62, lat: 41.885 }), transform, window);
    const back = markPlacedAt(at, transform, window);
    expect(back.lon).toBeCloseTo(-87.62, 6);
    expect(back.lat).toBeCloseTo(41.885, 6);
    expect(markPoint(mark({ anchor: 'page', x: back.x, y: back.y }), transform, window)[0]).toBeCloseTo(at[0], 3);
  });

  it('puts the map centre in the middle of the window', () => {
    const [x, y] = markPoint(mark({ lon: area.lon, lat: area.lat }), transform, window);
    expect(x).toBeCloseTo(90, 6);
    expect(y).toBeCloseTo(60, 6);
  });
});

describe('saved marks', () => {
  it('drop what is broken and fill in what is missing', () => {
    const marks = sanitizeMarks([
      { id: 'ok1', shape: 'heart', text: 'a\nb\nc\nd\ne', size: 1000, color: '#ff0000', rotation: 270 },
      { id: 'ok1', shape: 'star' },
      { id: 'bad id', shape: 'star' },
      { id: 'ok2', shape: 'unicorn', color: 'red"/>', font: 'comic', lat: 95, fill: 'sparkly' },
      'nothing',
    ]);
    expect(marks.map((m) => m.id)).toEqual(['ok1', 'ok2']);
    expect(marks[0]).toMatchObject({ shape: 'heart', text: 'a\nb\nc\nd', size: 150, color: '#FF0000', rotation: -90, side: 'right', clear: true });
    expect(marks[1]).toMatchObject({ shape: DEFAULT_MARK.shape, color: '', font: '', lat: 0, fill: 'fill' });
    expect(sanitizeMarks('nope')).toEqual([]);
    expect(marks[1]).toMatchObject({ hatch: DEFAULT_MARK.hatch, textFill: '', letterSpacing: 1, lineSpacing: 1, align: 'auto' });
    const tuned = sanitizeMarks([{ id: 'a', hatch: { spacing: 0, angle: 270, cross: 'yes' }, textFill: 'outline', letterSpacing: 9, align: 'justify' }])[0];
    expect(tuned).toMatchObject({ hatch: { spacing: 0.1, angle: -90, cross: false }, textFill: 'outline', letterSpacing: 2, align: 'auto' });
  });

  it('wrap angles into -180 to 180', () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(720)).toBe(0);
  });
});
