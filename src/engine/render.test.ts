// Full render of one real tile (Canada Place, Vancouver) without the network.
import { readFileSync } from 'node:fs';
import type { Paths64 } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { compose } from './compose.ts';
import { defaultRenderSettings } from './defaults.ts';
import { TILE_EXTENT, worldToLonLat } from './geo/mercator.ts';
import { computeLayout } from './layout/layout.ts';
import { planTiles, prepareArea } from './prepare.ts';
import type { OutputMode, RenderSettings } from './settings.ts';
import { toSvg } from './svg/writer.ts';
import { type HersheyFile, parseHershey } from './text/hershey.ts';
import { acceptPolygon } from './tiles/schema.ts';
import { areaMm2, intersectWith, resolveSurfaces, unionAll } from './fills.ts';

const tile = new Uint8Array(readFileSync('src/engine/fixtures/vancouver-14-2589-5606.pbf'));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const font = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8')) as HersheyFile) };

function render(mode: OutputMode, patch: Partial<RenderSettings> = {}) {
  const settings: RenderSettings = {
    ...defaultRenderSettings(mode),
    area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 },
    ...patch,
  };
  settings.label = { ...settings.label, text: 'VANCOUVER', font: 'hershey-sans' };
  const layout = computeLayout(settings.product, settings.border);
  const plan = planTiles(settings.area, layout, settings.source);
  const prepared = prepareArea(plan, layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
  const result = compose(settings, layout, prepared, { title: font, subtitle: font }, new Map<string, Paths64>());
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
