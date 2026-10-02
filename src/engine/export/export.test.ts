import { describe, expect, it } from 'vitest';
import { makeShape, shapePathD } from '../layout/shapes.ts';
import type { OutputGroup, RenderResult } from '../result.ts';
import { kmlFromKmz } from '../routes/zip.ts';
import { toSvg } from '../svg/writer.ts';
import { aciColours, toDxf } from './dxf.ts';
import { layerFiles, mirrorResult } from './files.ts';
import { toHpgl } from './hpgl.ts';
import { flatten, mirrorPath, parsePath } from './paths.ts';
import { zipFiles } from './zip.ts';

const group = (id: string, color: string, d: string, kind: 'fill' | 'stroke' = 'stroke'): OutputGroup => ({
  id,
  element: 'roads',
  label: id === 'cut' ? 'Cut line' : `Layer ${id}`,
  kind,
  color,
  strokeWidth: 0.05,
  paths: [{ d }],
  subpaths: 1,
  lengthMm: 0,
  areaMm2: 0,
});

const result = (groups: OutputGroup[], mode: RenderResult['mode'] = 'laser'): RenderResult =>
  ({ width: 100, height: 50, outline: shapePathD(makeShape('rect', 0, 0, 100, 50)), mode, background: null, groups, meta: { title: 'Test', centre: { lon: 0, lat: 0 }, bearing: 0, widthM: 1000, heightM: 500, scale: 10000, attribution: 'x', generated: '' } }) as RenderResult;

describe('reading path data back', () => {
  it('follows arcs to within the tolerance', () => {
    const circle = shapePathD(makeShape('circle', 10, 10, 40, 40));
    const [sub] = parsePath(circle);
    expect(sub.closed).toBe(true);
    const points = flatten(sub, 0.01);
    expect(points.length).toBeGreaterThan(40);
    for (const [x, y] of points) expect(Math.hypot(x - 30, y - 30)).toBeCloseTo(20, 1);
  });

  it('reads H and V as lines', () => {
    const [sub] = parsePath('M1,2H5V7H1Z');
    expect(flatten(sub)).toEqual([[1, 2], [5, 2], [5, 7], [1, 7], [1, 2]]);
  });

  it('mirrors a rounded rectangle onto itself, arcs and all', () => {
    const d = shapePathD(makeShape('rounded', 10, 5, 80, 40, 8));
    const back = flatten(parsePath(mirrorPath(d, 100))[0]);
    for (const [x, y] of back) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(90 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(y).toBeLessThanOrEqual(45 + 1e-6);
    }
    // An L-shape flipped puts its foot on the other side.
    expect(mirrorPath('M10,10L10,40L30,40', 100)).toBe('M90,10L90,40L70,40');
  });

  it('mirrors the whole file', () => {
    const svg = toSvg(mirrorResult(result([group('a', '#000000', 'M10,10L20,10')])));
    expect(svg).toContain('d="M90,10L80,10"');
  });
});

describe('DXF', () => {
  it('matches colours to indexed colours, never two to one', () => {
    const map = aciColours(['#000000', '#FF0000', '#FE0000', '#0000FF']);
    expect(map.get('#000000')).toBe(7);
    expect(map.get('#FF0000')).toBe(1);
    expect(map.get('#FE0000')).not.toBe(1);
    expect(map.get('#0000FF')).toBe(5);
  });

  it('puts each group on a layer, in mm with y up', () => {
    const dxf = toDxf(
      result([group('a', '#FF0000', 'M10,10L20,10'), group('b', '#0000FF', 'M0,0H10V10H0Z', 'fill'), group('cut', '#00FF00', shapePathD(makeShape('circle', 0, 0, 50, 50)))]),
    );
    const lines = dxf.trim().split('\n');
    expect(lines.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
    expect(lines.slice(-2)).toEqual(['0', 'EOF']);
    expect(dxf).toContain('AC1009');
    for (const name of ['LAYER_A', 'LAYER_B', 'CUT_LINE']) expect(dxf).toContain(`\n2\n${name}\n`);
    // A two-point stroke is a LINE, flipped: y 10 becomes 40.
    expect(dxf).toMatch(/LINE\n8\nLAYER_A\n10\n10\n20\n40\n30\n0\n11\n20\n21\n40/);
    // The filled square is a closed polyline of four vertices.
    const square = dxf.slice(dxf.indexOf('POLYLINE\n8\nLAYER_B'));
    expect(square.slice(0, square.indexOf('SEQEND')).match(/VERTEX/g)).toHaveLength(4);
    expect(square).toMatch(/^POLYLINE\n8\nLAYER_B\n66\n1\n10\n0\n20\n0\n30\n0\n70\n1/);
  });

  it('mirrors', () => {
    const dxf = toDxf(result([group('a', '#FF0000', 'M10,10L20,10')]), { mirror: true });
    expect(dxf).toMatch(/LINE\n8\nLAYER_A\n10\n90\n20\n40/);
  });
});

describe('HPGL', () => {
  it('draws each colour with its own pen, in plotter units with y up', () => {
    const hpgl = toHpgl(result([group('a', '#000000', 'M10,10L20,10L20,20'), group('b', '#FF0000', 'M0,0L1,1'), group('c', '#000000', 'M5,5L6,5')]));
    expect(hpgl).toBe(['IN;', 'SP1;', 'PU400,1600;', 'PD800,1600,800,1200;', 'PU200,1800;', 'PD240,1800;', 'PU;', 'SP2;', 'PU0,2000;', 'PD40,1960;', 'PU;', 'SP0;', ''].join('\n'));
  });
});

describe('one file per layer', () => {
  it('splits a laser file by layer and a plotter file by pen', () => {
    const groups = [group('a', '#000000', 'M1,1L2,2'), group('b', '#000000', 'M3,3L4,4'), group('cut', '#FF0000', 'M0,0L5,5')];
    expect(layerFiles(result(groups)).map((f) => f.name)).toEqual(['1-layer-a.svg', '2-layer-b.svg', '3-cut-line.svg']);
    const pens = layerFiles(result(groups, 'plotter'));
    expect(pens.map((f) => f.name)).toEqual(['1-pen-000000.svg', '2-pen-ff0000.svg']);
    expect(pens[0].svg).toContain('d="M3,3L4,4"');
    expect(pens[0].svg).not.toContain('#FF0000');
  });

  it('zips them so any unzip tool can read them', async () => {
    const kml = '<kml><Document><name>Zipped é</name></Document></kml>';
    const zip = zipFiles([
      { name: 'a.svg', data: new TextEncoder().encode('<svg/>') },
      { name: 'doc.kml', data: new TextEncoder().encode(kml) },
    ]);
    expect(await kmlFromKmz(zip.buffer as ArrayBuffer)).toBe(kml);
  });
});
