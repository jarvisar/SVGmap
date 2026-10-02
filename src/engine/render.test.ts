// Full render of one real tile (Canada Place, Vancouver) without the network.
import { readFileSync } from 'node:fs';
import type { Paths64 } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { type ComposeFonts, compose } from './compose.ts';
import { defaultRenderSettings } from './defaults.ts';
import { TILE_EXTENT, worldToLonLat } from './geo/mercator.ts';
import { computeLayout } from './layout/layout.ts';
import { insetShape, shapeContains } from './layout/shapes.ts';
import { planTiles, prepareArea } from './prepare.ts';
import type { OutputMode, RenderSettings } from './settings.ts';
import { toSvg } from './svg/writer.ts';
import { type HersheyFile, parseHershey } from './text/hershey.ts';
import { parseOutlineFont } from './text/loadFont.ts';
import { acceptPolygon } from './tiles/schema.ts';
import { areaMm2, intersectWith, makeFillTester, resolveSurfaces, toPath64, unionAll } from './fills.ts';
import type { OutputGroup, RenderResult } from './result.ts';
import { buildLabel } from './text/label.ts';
import { DEFAULT_MARK, type MapMark } from './marks/marks.ts';

const tile = new Uint8Array(readFileSync(new URL('./fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const font = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8')) as HersheyFile) };

function render(mode: OutputMode, patch: Partial<RenderSettings> = {}, fonts: ComposeFonts = { title: font, subtitle: font }) {
  const settings: RenderSettings = {
    ...defaultRenderSettings(mode),
    area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 },
    ...patch,
  };
  settings.label = { ...settings.label, text: 'VANCOUVER', font: 'hershey-sans' };
  const layout = computeLayout(settings.product, settings.border);
  const plan = planTiles(settings.area, layout, settings.source);
  const prepared = prepareArea(plan, layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
  const result = compose(settings, layout, prepared, fonts, new Map<string, Paths64>());
  return { settings, plan, prepared, result };
}

describe('rendering a real tile', () => {
  const laser = render('laser');

  it('needs only the one tile', () => {
    expect(laser.plan.tiles).toEqual([{ z: 14, x: 2589, y: 5606 }]);
  });

  it('draws every layer the tile has', () => {
    const ids = laser.result.groups.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['water', 'buildings', 'roads', 'paths', 'text', 'frame', 'band', 'border', 'cut']));
    expect(laser.result.warnings).toEqual([]);
  });

  it('cuts the piers and the buildings on them out of the ocean', () => {
    const { prepared, settings } = laser;
    const union = (layer: string) =>
      unionAll(prepared.polygons.filter((p) => p.layer === layer && acceptPolygon(p, settings.filters)).flatMap((p) => p.rings));
    const water = union('water');
    const decks = union('decks');
    const buildings = union('buildings');
    const out = resolveSurfaces(
      { buildings, decks, water, aeroways: [], rocks: [], sand: [], greens: union('greens'), waterGaps: [] },
      { waterHalo: settings.water.halo },
    );
    const piersOverWater = areaMm2(intersectWith(decks, water));
    expect(piersOverWater).toBeGreaterThan(1);
    expect(areaMm2(water) - areaMm2(out.water)).toBeGreaterThan(piersOverWater);
    expect(areaMm2(intersectWith(out.water, unionAll([...buildings, ...decks])))).toBeCloseTo(0, 6);
    const layers = [out.water, out.buildings, out.decks, out.greens];
    const sum = layers.reduce((a, l) => a + areaMm2(l), 0);
    // Only micron-grid rounding separates the two.
    expect(Math.abs(areaMm2(unionAll(layers.flat())) - sum)).toBeLessThan(sum * 1e-6);
  });

  it('writes a millimetre-sized SVG with one layer per group', () => {
    const svg = toSvg(laser.result);
    expect(svg).toContain('width="177.8mm" height="127mm" viewBox="0 0 177.8 127"');
    expect(svg.match(/inkscape:groupmode="layer"/g)?.length).toBe(laser.result.groups.length);
  });

  it('groups plotter output into numbered pen layers', () => {
    const { result } = render('plotter');
    expect(result.groups.every((g) => g.kind === 'stroke')).toBe(true);
    const svg = toSvg(result);
    const pens = new Set(result.groups.map((g) => g.color)).size;
    expect(svg.match(/inkscape:label="\d+ - pen /g)?.length).toBe(pens);
    expect(result.stats.plotter!.penUpMm).toBeLessThan(result.stats.plotter!.penUpUnorderedMm);
  });

  it('reports the pen travel of the file as written', () => {
    // Travel between subpaths in document order, from the origin.
    const travelIn = (svg: string) => {
      let here = [0, 0];
      let travel = 0;
      for (const [, d] of svg.matchAll(/ d="([^"]+)"/g)) {
        for (const sub of d.split('M').slice(1)) {
          const points = sub.split('L').map((p) => p.split(',').map(Number));
          travel += Math.hypot(points[0][0] - here[0], points[0][1] - here[1]);
          here = points[points.length - 1];
        }
      }
      return travel;
    };
    const style = defaultRenderSettings('plotter').style;
    // Pens that take turns in draw order.
    const colors = { ...style.colors, water: '#0000FF', buildings: '#000000', roads: '#0000FF', paths: '#000000' };
    for (const optimize of [true, false]) {
      const { result } = render('plotter', { plotter: { penWidth: 0.3, optimize }, style: { ...style, colors } });
      expect(result.stats.plotter!.pens).toBe(new Set(result.groups.map((g) => g.color)).size);
      expect(travelIn(toSvg(result))).toBeCloseTo(result.stats.plotter!.penUpMm, 0);
    }
  });

  it('gives an outline title and a single-line subtitle their own groups', () => {
    const bytes = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
    const montserrat = parseOutlineFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const defaults = defaultRenderSettings('laser');
    const { result } = render('laser', { label: { ...defaults.label, style: 'band', subtitle: '49.2826° N' } }, { title: montserrat, subtitle: font });
    const ids = result.groups.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['text', 'text-lines']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finishes with a pen width of zero', () => {
    const { result } = render('plotter', { plotter: { penWidth: 0, optimize: true } });
    expect(result.groups.find((g) => g.id === 'band')!.strokeWidth).toBe(0.05);
  });

  it('scores and cuts at the laser line width', () => {
    const { result } = render('laser', { laser: { lineWidth: 0.0254 } });
    const svg = toSvg(result);
    for (const id of ['roads', 'cut']) expect(result.groups.find((g) => g.id === id)!.strokeWidth).toBe(0.0254);
    expect(svg).toContain('id="cut" inkscape:groupmode="layer" inkscape:label="Cut line" fill="none" stroke="#E31A1C" stroke-width="0.025"');
  });

  it('copes with very fine hatching and zero cleanup tolerances', () => {
    const plotter = defaultRenderSettings('plotter');
    const hatch = { ...plotter.style.hatch, buildings: { spacing: 0, angle: 45, cross: true } };
    const fine = render('plotter', { style: { ...plotter.style, hatch } });
    expect(fine.result.groups.find((g) => g.id === 'buildings')!.subpaths).toBeGreaterThan(1000);
    const loose = render('laser', { cleanup: { ...plotter.cleanup, lineSpacing: -1, weldTolerance: 0, snapGap: 0 } });
    expect(loose.result.groups.some((g) => g.id === 'roads')).toBe(true);
  });

  it('refuses a map width of zero', () => {
    const settings = defaultRenderSettings('laser');
    const layout = computeLayout(settings.product, settings.border);
    expect(() => planTiles({ ...settings.area, widthM: 0 }, layout, settings.source)).toThrow(/more than zero/);
  });

  it('keeps both sides of a map that crosses the antimeridian', () => {
    const settings = defaultRenderSettings('laser');
    const layout = computeLayout(settings.product, settings.border);
    const plan = planTiles({ lon: 179.995, lat: 49.28, bearing: 0, widthM: 3000 }, layout, settings.source);
    expect(plan.tiles.some((t) => t.x === 0)).toBe(true);
    // Any real tile will do. Only where its lines end up matters.
    const data = new Map(plan.tiles.map((t) => [`${t.z}/${t.x}/${t.y}`, tile.buffer.slice(0)] as const));
    const prepared = prepareArea(plan, layout, data);
    const centreX = layout.window.x + layout.window.w / 2;
    const xs = prepared.lines.flatMap((l) => l.path.map(([x]) => x));
    expect(xs.some((x) => x > centreX + 20)).toBe(true);
    expect(xs.some((x) => x < centreX - 20)).toBe(true);
  });

  it('never plans more tiles than the hard limit', () => {
    const settings = defaultRenderSettings('laser');
    const layout = computeLayout(settings.product, settings.border);
    const plan = planTiles({ lon: 0, lat: 45, bearing: 0, widthM: 400_000 }, layout, { ...settings.source, maxTiles: 1e9 });
    expect(plan.tiles.length).toBeLessThanOrEqual(2000);
    expect(plan.zoom).toBeLessThan(14);
    expect(plan.warnings).toHaveLength(1);
  });

  it('keeps everything inside a hexagonal piece', () => {
    const piece = render('plotter', {
      product: { shape: 'hexagon', width: 120, height: 120, cornerRadius: 0, margins: { top: 2, right: 2, bottom: 2, left: 2 } },
    });
    const layout = computeLayout(piece.settings.product, piece.settings.border);
    const edge = insetShape(layout.canvas, -0.001);
    for (const group of piece.result.groups) {
      for (const p of group.paths) {
        for (const [, x, y] of p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) expect(shapeContains(edge, [Number(x), Number(y)])).toBe(true);
      }
    }
    expect(piece.result.groups.map((g) => g.id)).toEqual(expect.arrayContaining(['buildings', 'roads', 'band', 'border']));
  });

  it('keeps everything inside a round piece', () => {
    const coaster = render('laser', {
      product: { shape: 'circle', width: 100, height: 100, cornerRadius: 0, margins: { top: 2, right: 2, bottom: 2, left: 2 } },
    });
    for (const group of coaster.result.groups) {
      for (const p of group.paths) {
        for (const [, x, y] of p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
          expect(Math.hypot(Number(x) - 50, Number(y) - 50)).toBeLessThanOrEqual(50.001);
        }
      }
    }
  });
});

describe('title styles in a render', () => {
  const bytes = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
  const montserrat = parseOutlineFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const fonts = { title: montserrat, subtitle: montserrat };
  const withLabel = (mode: OutputMode, label: Partial<RenderSettings['label']>) =>
    render(mode, { label: { ...defaultRenderSettings(mode).label, ...label } }, fonts).result;
  const group = (result: RenderResult, id: string) => result.groups.find((g) => g.id === id);
  const points = (g: OutputGroup | undefined) =>
    (g?.paths ?? []).flatMap((p) => [...p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]): [number, number] => [Number(x), Number(y)]));

  it('leaves the letters bare on a solid box', () => {
    const outlined = group(withLabel('laser', { style: 'box' }), 'text')!;
    const solid = group(withLabel('laser', { style: 'box', solid: true }), 'text')!;
    const frame = group(withLabel('laser', { style: 'box', solid: true }), 'frame');
    expect(frame).toBeUndefined();
    // The plate minus the letters is much more than the letters alone.
    expect(solid.areaMm2).toBeGreaterThan(outlined.areaMm2 * 1.5);
  });

  it('keeps the map out of the big letters and the gap around them', () => {
    const result = withLabel('laser', { style: 'letters', lettersGap: 1 });
    const letters = group(result, 'text')!;
    expect(letters.areaMm2).toBeGreaterThan(500);
    const layout = computeLayout(defaultRenderSettings('laser').product, defaultRenderSettings('laser').border);
    const { artwork } = buildLabel(layout, { ...defaultRenderSettings('laser').label, text: 'VANCOUVER', style: 'letters', lettersGap: 1 }, montserrat, montserrat);
    const inside = makeFillTester([unionAll(artwork!.clear.map(toPath64))])!;
    expect(points(group(result, 'roads')).filter((p) => inside(p))).toEqual([]);
  });

  it('only draws the map inside the letters when asked', () => {
    const around = withLabel('laser', { style: 'letters' });
    const within = withLabel('laser', { style: 'letters', lettersMode: 'window' });
    expect(group(within, 'buildings')!.areaMm2).toBeLessThan(group(around, 'buildings')!.areaMm2 * 0.6);
    expect(group(within, 'text')).toBeUndefined();
    expect(group(within, 'frame')!.label).toBe('Letter outlines');
  });

  it('breaks the border lines around an in-border title', () => {
    for (const mode of ['laser', 'plotter'] as const) {
      const plain = withLabel(mode, { style: 'box' });
      const broken = withLabel(mode, { style: 'inset' });
      // One loop for the plain border, cut into pieces around the title and subtitle.
      expect(group(broken, 'border')!.subpaths).toBeGreaterThan(group(plain, 'border')!.subpaths);
      expect(group(broken, 'band')).toBeDefined();
    }
  });
});

describe('pins and text in a render', () => {
  const bytes = readFileSync('public/fonts/Montserrat-SemiBold.ttf');
  const montserrat = parseOutlineFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const fonts = { title: font, subtitle: font, marks: new Map([['montserrat', montserrat], ['hershey-sans', font]]) };
  const at = { lon: centre.lon, lat: centre.lat };
  const withMarks = (mode: OutputMode, marks: Partial<MapMark>[]) =>
    render(mode, { marks: marks.map((m, i) => ({ ...DEFAULT_MARK, id: `m${i}`, ...at, ...m })) }, fonts).result;
  const group = (result: RenderResult, id: string) => result.groups.find((g) => g.id === id);
  const points = (g: OutputGroup | undefined) =>
    (g?.paths ?? []).flatMap((p) => [...p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]): [number, number] => [Number(x), Number(y)]));
  const window = computeLayout(defaultRenderSettings('laser').product, defaultRenderSettings('laser').border).window;
  const middle = [window.x + window.w / 2, window.y + window.h / 2];

  it('gives each mark a layer of its own, in the title colour unless it has its own', () => {
    const result = withMarks('laser', [
      { shape: 'heart', text: 'HOME', font: 'montserrat' },
      { shape: 'star', color: '#123456', lon: centre.lon + 0.002 },
    ]);
    expect(group(result, 'mark-m0')).toMatchObject({ label: 'Heart: HOME', kind: 'fill', color: defaultRenderSettings('laser').style.colors.text });
    expect(group(result, 'mark-m1')).toMatchObject({ label: 'Star', color: '#123456' });
    expect(toSvg(result)).toContain('inkscape:label="Heart: HOME" fill="#000000"');
  });

  it('leaves the map out under a mark and the gap around it', () => {
    const plain = render('laser').result;
    const result = withMarks('laser', [{ shape: 'dot', size: 12, gap: 1 }]);
    const near = (p: [number, number]) => Math.hypot(p[0] - middle[0], p[1] - middle[1]) < 6.9;
    // The middle of this map has streets and the harbour.
    expect(['roads', 'water'].every((id) => points(group(plain, id)).some(near))).toBe(true);
    for (const id of ['roads', 'paths', 'buildings', 'water']) expect(points(group(result, id)).filter(near), id).toEqual([]);
    expect(withMarks('laser', [{ shape: 'dot', size: 12, clear: false }]).groups.find((g) => g.id === 'roads')!.subpaths).toBe(group(plain, 'roads')!.subpaths);
  });

  it('draws single-line text as strokes and fills as pen passes on a plotter', () => {
    const result = withMarks('plotter', [{ shape: 'pin', text: 'HI', font: 'hershey-sans' }]);
    expect(group(result, 'mark-m0')).toMatchObject({ kind: 'stroke' });
    expect(group(result, 'mark-m0-lines')).toMatchObject({ kind: 'stroke', label: 'Pin: HI' });
  });

  it('warns about a mark off the map', () => {
    const result = withMarks('laser', [{ shape: 'pin', text: 'FAR', lon: centre.lon + 1 }]);
    expect(group(result, 'mark-m0')).toBeUndefined();
    expect(result.warnings).toContain('“FAR” is outside the map. Move it or the map to show it.');
  });
});

describe('tiles that are not vector tiles', () => {
  const settings = { ...defaultRenderSettings('laser'), area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 4000 } };
  const layout = computeLayout(settings.product, settings.border);
  const plan = planTiles(settings.area, layout, settings.source);
  // A web page served with a 200 where the tile should be.
  const picture = new TextEncoder().encode('<!DOCTYPE html><html><head><title>Not found</title></head><body>Sorry</body></html>').buffer;

  it('count as missing parts of the map, with a warning', () => {
    expect(plan.tiles.length).toBeGreaterThan(1);
    const data = new Map(plan.tiles.map((t) => [`${t.z}/${t.x}/${t.y}`, t.x === 2589 && t.y === 5606 ? tile.buffer.slice(0) : picture.slice(0)]));
    const prepared = prepareArea(plan, layout, data);
    expect(prepared.lines.length).toBeGreaterThan(0);
    expect(prepared.warnings.some((w) => w.includes("weren't vector tiles"))).toBe(true);
  });

  it('say what is wrong when none of them are', () => {
    const data = new Map(plan.tiles.map((t) => [`${t.z}/${t.x}/${t.y}`, picture.slice(0)]));
    expect(() => prepareArea(plan, layout, data)).toThrow(/didn't send vector tiles/);
  });
});
