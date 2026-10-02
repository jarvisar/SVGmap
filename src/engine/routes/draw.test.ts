// Routes on a real tile (Canada Place, Vancouver), rendered without the network.
import { readFileSync } from 'node:fs';
import type { Paths64 } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { compose } from '../compose.ts';
import { defaultRenderSettings } from '../defaults.ts';
import { TILE_EXTENT, lonLatToWorld, worldToLonLat } from '../geo/mercator.ts';
import { computeLayout } from '../layout/layout.ts';
import { type Path, type Point, pathLength, pointSegmentDistanceSq } from '../lines/geometry.ts';
import { type Prepared, planTiles, prepareArea } from '../prepare.ts';
import type { RenderResult } from '../result.ts';
import { type OutputMode, PLOTTER_STYLE, type RenderSettings, type RouteData } from '../settings.ts';
import { toSvg } from '../svg/writer.ts';
import { type HersheyFile, parseHershey } from '../text/hershey.ts';
import type { LonLat } from './polyline.ts';
import { decodeRoute, encodeRoute } from './route.ts';

const tile = new Uint8Array(readFileSync(new URL('../fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
const font = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8')) as HersheyFile) };
const area = { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 };

function baseSettings(mode: OutputMode): RenderSettings {
  const settings: RenderSettings = { ...defaultRenderSettings(mode), area };
  settings.label = { ...settings.label, text: 'VANCOUVER', font: 'hershey-sans' };
  return settings;
}

function prepare(settings: RenderSettings): Prepared {
  const layout = computeLayout(settings.product, settings.border);
  return prepareArea(planTiles(settings.area, layout, settings.source), layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
}

const prepared = prepare(baseSettings('laser'));
const toLonLat = ([x, y]: Point): LonLat => {
  const ll = worldToLonLat(...prepared.transform.toWorld(x, y), prepared.zoom);
  return [ll.lon, ll.lat];
};
const toCanvas = ([lon, lat]: LonLat): Point => prepared.transform.toCanvas(...lonLatToWorld(lon, lat, prepared.zoom));

// One route along the longest road in the tile, so there's a road right under
// it, and one straight across the middle of the map.
const longestRoad = prepared.lines.filter((l) => l.layer === 'roads').sort((a, b) => pathLength(b.path) - pathLength(a.path))[0].path;
const along: LonLat[] = longestRoad.map(toLonLat);
const [cx, cy] = prepared.transform.toCanvas(prepared.transform.cx, prepared.transform.cy);
const across: LonLat[] = [toLonLat([cx - 70, cy + 8]), toLonLat([cx + 40, cy + 12])];
const route = (id: string, lines: LonLat[][]): RouteData => ({ id, name: id, visible: true, lines: encodeRoute(lines) });
const ROUTES = [route('along', [along]), route('across', [across])];
// As stored, after the import simplified them.
const centrelines: Path[] = ROUTES.flatMap((r) => decodeRoute(r).map((line) => line.map(toCanvas)));

function render(mode: OutputMode, patch: (s: RenderSettings) => void = () => {}): RenderResult {
  const settings = baseSettings(mode);
  settings.routes = { ...settings.routes, items: ROUTES };
  patch(settings);
  const layout = computeLayout(settings.product, settings.border);
  return compose(settings, layout, prepare(settings), { title: font, subtitle: font }, new Map<string, Paths64>());
}

// Subpaths of a group's path data, closed ones repeating their first point.
function subpaths(result: RenderResult, id: string): Path[] {
  const group = result.groups.find((g) => g.id === id);
  const out: Path[] = [];
  for (const { d } of group?.paths ?? []) {
    for (const part of d.split('M').filter(Boolean)) {
      const points = [...part.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m): Point => [Number(m[1]), Number(m[2])]);
      if (part.endsWith('Z')) points.push(points[0]);
      out.push(points);
    }
  }
  return out;
}

const distanceToRoute = (p: Point) =>
  Math.sqrt(Math.min(...centrelines.flatMap((line) => line.slice(1).map((b, i) => pointSegmentDistanceSq(p, line[i], b)))));

// The closest any part of these paths gets to a route centreline.
function closest(paths: Path[]): number {
  let best = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      for (let t = 0; t <= 1; t += 0.25) {
        best = Math.min(best, distanceToRoute([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]));
      }
    }
  }
  return best;
}

describe('routes on a real tile', () => {
  const laser = render('laser');
  // Arcs are flattened to within 1% of the offset, so the edge sits a hair inside.
  const reach = defaultRenderSettings('laser').routes.width / 2 + defaultRenderSettings('laser').routes.gap - 0.02;

  it('crosses roads and buildings in the test tile', () => {
    expect(closest(prepared.lines.filter((l) => l.layer === 'roads').map((l) => l.path))).toBeLessThan(0.01);
  });

  it('draws the route as its own engraved layer for a laser', () => {
    const group = laser.groups.find((g) => g.id === 'route')!;
    expect(group).toMatchObject({ element: 'route', kind: 'fill', color: '#6200EA', label: 'Route' });
    // Above the map's lines and under the title.
    const ids = laser.groups.map((g) => g.id);
    expect(ids.indexOf('route')).toBeGreaterThan(ids.indexOf('roads'));
    expect(ids.indexOf('route')).toBeLessThan(ids.indexOf('text'));
    expect(laser.warnings).toEqual([]);
  });

  it('keeps every map line out of the gap around the route', () => {
    for (const id of ['roads', 'paths', 'railways', 'waterways']) {
      expect(closest(subpaths(laser, id)), id).toBeGreaterThanOrEqual(reach);
    }
  });

  it('keeps every filled area out of the gap', () => {
    for (const id of ['buildings', 'water', 'greens', 'decks']) {
      const paths = subpaths(laser, id);
      if (paths.length) expect(closest(paths), id).toBeGreaterThanOrEqual(reach);
    }
  });

  it('leaves no short stubs or slivers at the edge of the gap', () => {
    for (const id of ['roads', 'paths', 'railways']) {
      for (const piece of subpaths(laser, id)) {
        const touching = Math.min(distanceToRoute(piece[0]), distanceToRoute(piece[piece.length - 1])) < reach + 0.05;
        if (touching) expect(pathLength(piece), id).toBeGreaterThan(0.55);
      }
    }
  });

  it('never runs the route through the line cleanup', () => {
    const asLine = (preset: Partial<RenderSettings['cleanup']>) =>
      render('laser', (s) => {
        s.style = { ...s.style, routeDraw: 'line' };
        s.cleanup = { ...s.cleanup, ...preset };
      }).groups.find((g) => g.id === 'route')!;
    const off = asLine({ enabled: false });
    const strong = asLine({ lineSpacing: 0.6, pruneStubs: 3, denseLimit: 1 });
    expect(strong.lengthMm).toBeCloseTo(off.lengthMm, 6);
    expect(strong.kind).toBe('stroke');
    expect(strong.strokeWidth).toBe(0.05);
  });

  it("doesn't count the roads under the route against the cleanup", () => {
    const without = render('laser', (s) => {
      s.routes = { ...s.routes, items: [] };
    });
    expect(laser.stats.coverage).toBe(without.stats.coverage);
    expect(without.groups.some((g) => g.id === 'route')).toBe(false);
  });

  it('gives the plotter a solid route in its own pen', () => {
    const result = render('plotter');
    const group = result.groups.find((g) => g.id === 'route')!;
    expect(group).toMatchObject({ kind: 'stroke', color: PLOTTER_STYLE.colors.route });
    // Passes along the band, not hundreds of short hatch lines across it.
    expect(group.lengthMm / group.subpaths).toBeGreaterThan(20);
    expect(toSvg(result)).toMatch(new RegExp(`inkscape:label="\\d - pen ${PLOTTER_STYLE.colors.route}"`));
  });

  it('strokes the route for print, with filled markers', () => {
    const result = render('print');
    const line = result.groups.find((g) => g.id === 'route')!;
    expect(line).toMatchObject({ kind: 'stroke', strokeWidth: 1 });
    expect(result.groups.find((g) => g.id === 'route-markers')).toMatchObject({ kind: 'fill', color: line.color });
  });

  it('outlines the markers of a scored laser route, keeping it one process', () => {
    const result = render('laser', (s) => {
      s.style = { ...s.style, routeDraw: 'line' };
    });
    expect(result.groups.filter((g) => g.element === 'route').map((g) => g.kind)).toEqual(['stroke']);
  });

  it('leaves out hidden routes and markers when asked', () => {
    const hidden = render('laser', (s) => {
      s.routes = { ...s.routes, items: ROUTES.map((r) => ({ ...r, visible: false })) };
    });
    expect(hidden.groups.some((g) => g.element === 'route')).toBe(false);
    const plain = render('laser', (s) => {
      s.routes = { ...s.routes, markers: false };
    });
    expect(plain.groups.find((g) => g.id === 'route')!.areaMm2).toBeLessThan(laser.groups.find((g) => g.id === 'route')!.areaMm2);
  });

  it('warns when the route is off the map or under the title', () => {
    const away = render('laser', (s) => {
      s.routes = { ...s.routes, items: [route('away', [[[-100, 40], [-100.01, 40]]])] };
    });
    expect(away.warnings).toEqual([expect.stringContaining('outside the map')]);
    // Straight into the bottom right corner, where the title box is.
    const corner = render('laser', (s) => {
      s.routes = { ...s.routes, items: [route('corner', [[toLonLat([cx, cy]), toLonLat([cx + 200, cy + 200])]])] };
    });
    expect(corner.warnings).toEqual([expect.stringContaining('under the title')]);
  });
});
