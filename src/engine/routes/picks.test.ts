// Picked roads on the real Canada Place tile: road routes and roads left out.
import { readFileSync } from 'node:fs';
import type { Paths64 } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { compose } from '../compose.ts';
import { defaultRenderSettings } from '../defaults.ts';
import { TILE_EXTENT, worldToLonLat } from '../geo/mercator.ts';
import { computeLayout } from '../layout/layout.ts';
import { planTiles, prepareArea } from '../prepare.ts';
import type { OutputMode, RenderSettings } from '../settings.ts';
import { toSvg } from '../svg/writer.ts';
import { type HersheyFile, parseHershey } from '../text/hershey.ts';
import {
  type LonLatLine,
  MAX_PICKED_POINTS,
  PICK_LAYERS,
  type PickLines,
  type RoadRoute,
  pickLonLat,
  sameLine,
  sanitizeLines,
  sanitizeRoutes,
  withoutLines,
} from './picks.ts';
import { encodePolyline } from './polyline.ts';

const tile = new Uint8Array(readFileSync(new URL('../fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const font = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8')) as HersheyFile) };

function render(mode: OutputMode, patch: Partial<RenderSettings> = {}) {
  const settings: RenderSettings = { ...defaultRenderSettings(mode), area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 }, ...patch };
  settings.label = { ...settings.label, text: 'VANCOUVER', font: 'hershey-sans' };
  const layout = computeLayout(settings.product, settings.border);
  const plan = planTiles(settings.area, layout, settings.source);
  const prepared = prepareArea(plan, layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
  return compose(settings, layout, prepared, { title: font, subtitle: font }, new Map<string, Paths64>());
}

/** The longest road the preview could pick, in lon/lat. */
function longestRoad(pick: PickLines): { line: number; lonLat: LonLatLine } {
  let best = -1;
  let bestLength = 0;
  for (let line = 0; line < pick.starts.length - 1; line++) {
    if (PICK_LAYERS[pick.layers[line]] !== 'roads') continue;
    let length = 0;
    for (let p = pick.starts[line] + 1; p < pick.starts[line + 1]; p++) {
      length += Math.hypot(pick.points[p * 2] - pick.points[p * 2 - 2], pick.points[p * 2 + 1] - pick.points[p * 2 - 1]);
    }
    if (length > bestLength) {
      bestLength = length;
      best = line;
    }
  }
  return { line: best, lonLat: pickLonLat(pick, best) };
}

const route = (lines: LonLatLine[], patch: Partial<RoadRoute> = {}): RoadRoute => ({ id: 'r1', name: 'Race course', color: '#E4002B', width: 0.8, lines, ...patch });

describe('picked roads', () => {
  const plain = render('laser');
  const { line, lonLat } = longestRoad(plain.pick!);

  it('are offered to the preview with how to find them again', () => {
    const pick = plain.pick!;
    expect(pick.starts.length - 1).toBeGreaterThan(20);
    expect(pick.owners.every((owner) => owner === -2)).toBe(true);
    expect(line).toBeGreaterThanOrEqual(0);
    // Back to lon/lat and the same road.
    expect(sameLine(lonLat, lonLat)).toBe(true);
  });

  it('go into a group of their own, over the roads, in their colour', () => {
    const result = render('laser', { roadRoutes: [route([lonLat])] });
    const ids = result.groups.map((g) => g.id);
    expect(ids).toContain('road-route-1');
    expect(ids.indexOf('road-route-1')).toBeGreaterThan(ids.indexOf('roads'));
    const group = result.groups.find((g) => g.id === 'road-route-1')!;
    expect(group.color).toBe('#E4002B');
    expect(group.label).toBe('Race course');
    expect(result.pick!.owners[line]).toBe(0);
    // Taken out of the roads, not drawn twice.
    const roads = (r: typeof result) => r.groups.find((g) => g.id === 'roads')!.lengthMm;
    expect(roads(result)).toBeLessThan(roads(plain) - group.lengthMm * 0.5);
    expect(toSvg(result)).toContain('id="road-route-1"');
  });

  it('take the road route width in print and the pen in the plotter', () => {
    expect(render('print', { roadRoutes: [route([lonLat], { width: 1.1 })] }).groups.find((g) => g.id === 'road-route-1')!.strokeWidth).toBe(1.1);
    const plotter = render('plotter', { roadRoutes: [route([lonLat])] });
    const group = plotter.groups.find((g) => g.id === 'road-route-1')!;
    expect(group.strokeWidth).toBe(plotter.groups.find((g) => g.id === 'roads')!.strokeWidth);
    // Its own pen.
    expect(toSvg(plotter)).toContain('#E4002B');
  });

  it('can be left out', () => {
    const result = render('laser', { hiddenLines: [lonLat] });
    expect(result.pick!.owners[line]).toBe(-1);
    const roads = (r: typeof result) => r.groups.find((g) => g.id === 'roads')!.lengthMm;
    expect(roads(result)).toBeLessThan(roads(plain));
    expect(result.groups.some((g) => g.id.startsWith('road-route-'))).toBe(false);
  });

  it("don't take in roads that only cross them", () => {
    const result = render('laser', { roadRoutes: [route([lonLat])] });
    const taken = [...result.pick!.owners].filter((owner) => owner === 0).length;
    // The road itself, and at most its continuation cut at a tile edge.
    expect(taken).toBeGreaterThanOrEqual(1);
    expect(taken).toBeLessThanOrEqual(3);
  });

  it('change nothing when there are none', () => {
    expect(toSvg(render('laser', { roadRoutes: [], hiddenLines: [] }))).toBe(toSvg(plain));
    expect(plain.missingPicks).toBeUndefined();
  });

  it('say which picks nothing on the map matched', () => {
    // A road across the harbour, well away from anything drawn.
    const away: LonLatLine = [
      [centre.lon + 0.03, centre.lat + 0.03],
      [centre.lon + 0.031, centre.lat + 0.03],
    ];
    const result = render('laser', { roadRoutes: [route([lonLat, away])] });
    expect(result.missingPicks).toEqual([away]);
    expect(result.pick!.owners[line]).toBe(0);
  });

  it('count a short pick lying along another as on the map', () => {
    // Picked first, so the whole road picked after wins every sample they share.
    const piece = lonLat.slice(0, 2);
    const result = render('laser', { roadRoutes: [route([piece, lonLat])] });
    expect(result.pick!.owners[line]).toBe(0);
    expect(result.missingPicks).toBeUndefined();
  });

  it('match a long pick at a large scale without filling its whole box', () => {
    // A road picked on a regional map: one segment tens of kilometres long,
    // here on a map 120 m across. Its box was millions of 2 mm cells.
    const regional: LonLatLine = [
      [centre.lon - 0.3, centre.lat - 0.2],
      [centre.lon + 0.3, centre.lat + 0.2],
    ];
    const big = render('laser', { area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 120 }, roadRoutes: [route([regional, lonLat])] });
    expect(big.groups.some((g) => g.id === 'road-route-1')).toBe(true);
  });

  it('keep the gap around an imported route', () => {
    // An imported route along the same road, so the road route under it is cleared away.
    const routes = { ...defaultRenderSettings('laser').routes, items: [{ id: 'g', name: 'Ride', visible: true, lines: [encodePolyline(lonLat)] }] };
    const alone = render('laser', { roadRoutes: [route([lonLat])] });
    const under = render('laser', { roadRoutes: [route([lonLat])], routes });
    const length = (r: typeof alone) => r.groups.find((g) => g.id === 'road-route-1')?.lengthMm ?? 0;
    expect(length(alone)).toBeGreaterThan(0);
    expect(length(under)).toBeLessThan(length(alone) * 0.2);
  });
});

describe('sanitizing picks', () => {
  it('keeps good road routes and drops the rest', () => {
    const routes = sanitizeRoutes([
      { id: 'a', name: ' Home ', color: '#ff0000', width: 99, lines: [[[1, 2], [1.001, 2.001]], [[1, 2]], 'x'] },
      { id: 'a', name: 'Duplicate', color: '#00ff00', lines: [] },
      { id: 'b', name: 'Bad colour', color: 'red', lines: [] },
      null,
    ]);
    expect(routes).toEqual([{ id: 'a', name: 'Home', color: '#FF0000', width: 5, lines: [[[1, 2], [1.001, 2.001]]] }]);
    expect(sanitizeRoutes('routes')).toEqual([]);
  });

  it('keeps the picks to a total number of points', () => {
    const line: LonLatLine = Array.from({ length: 1000 }, (_, i) => [i / 1e4, 0]);
    const lines = sanitizeLines(Array.from({ length: 80 }, () => line));
    expect(lines.length * 1000).toBeLessThanOrEqual(MAX_PICKED_POINTS);
    expect(lines.length).toBe(Math.floor(MAX_PICKED_POINTS / 1000));
    // Road routes share one allowance.
    const routes = sanitizeRoutes([
      { id: 'a', color: '#FF0000', lines: Array.from({ length: 30 }, () => line) },
      { id: 'b', color: '#00FF00', lines: Array.from({ length: 30 }, () => line) },
    ]);
    expect(routes.reduce((n, r) => n + r.lines.length, 0) * 1000).toBeLessThanOrEqual(MAX_PICKED_POINTS);
  });

  it('drops lines that are not lon/lat', () => {
    expect(sanitizeLines([[[1, 2], [3, 4]], [[1, 2], [400, 4]], [[1, 2], [3, 95]], [[1, 2], ['a', 4]], 7])).toEqual([[[1, 2], [3, 4]]]);
  });

  it('keeps picks made past the antimeridian in their own frame', () => {
    // On a map centred at 179.999, the roads east of the line are at 180 and a bit.
    const across: LonLatLine = [
      [179.998, -16.79],
      [180.002, -16.79],
    ];
    expect(sanitizeLines([across])).toEqual([across]);
  });

  it('tells the same road picked twice', () => {
    const a: LonLatLine = [[0, 0], [0.001, 0], [0.002, 0]];
    const b: LonLatLine = [[0.0000001, 0.00001], [0.002, 0.00001]];
    const c: LonLatLine = [[0.001, -0.001], [0.001, 0.001]];
    expect(sameLine(a, b)).toBe(true);
    expect(sameLine(a, c)).toBe(false);
  });
});

describe('withoutLines', () => {
  it('takes out the same roads as comparing every pair, and a line too long to index', () => {
    let seed = 9;
    const random = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0;
      return ((seed >>> 0) % 1e6) / 1e6;
    };
    const m = 1 / 111_320;
    const street = (): LonLatLine => {
      const x = random() * 3000;
      const y = random() * 3000;
      const across = random() < 0.5;
      const out: LonLatLine = [];
      for (let d = 0; d <= 200; d += 20) out.push([-87.6 + (across ? x + d : x) * m * 1.35, 41.88 + (across ? y : y + d) * m]);
      return out;
    };
    const stored = Array.from({ length: 300 }, street);
    // A road across the whole city, whose box covers too many cells to index.
    const long: LonLatLine = Array.from({ length: 200 }, (_, i) => [-87.6 + i * 100 * m * 1.35, 41.88 + 1500 * m]);
    stored.push(long);
    const picked = [...Array.from({ length: 300 }, (_, i) => (i % 3 ? street() : stored[i].map(([lon, lat]) => [lon + m, lat] as [number, number]))), long];
    const expected = stored.filter((line) => !picked.some((p) => sameLine(line, p)));
    const kept = withoutLines(stored, picked);
    expect(kept).toEqual(expected);
    expect(kept).not.toContain(long);
    expect(stored.length - kept.length).toBeGreaterThan(100);
  });
});
