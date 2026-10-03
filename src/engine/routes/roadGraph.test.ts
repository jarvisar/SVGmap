import { describe, expect, it } from 'vitest';
import type { Point } from '../lines/geometry.ts';
import { PICK_LAYERS, type PickLines } from './picks.ts';
import { buildRoadGraph, lengthOf, matchToRoads, nearestRoad, removeSpurs, routeBetween, routesFrom } from './roadGraph.ts';

interface TestLine {
  points: Point[];
  layer?: 'roads' | 'paths' | 'railways';
  level?: number;
}

// World units are mm and mm are metres, so the tolerances read as metres.
function pickOf(lines: TestLine[]): PickLines {
  const starts = new Uint32Array(lines.length + 1);
  let total = 0;
  lines.forEach((l, i) => {
    starts[i] = total;
    total += l.points.length;
  });
  starts[lines.length] = total;
  const points = new Float32Array(lines.flatMap((l) => l.points.flat()));
  return {
    layers: Uint8Array.from(lines, (l) => PICK_LAYERS.indexOf(l.layer ?? 'roads')),
    owners: new Int8Array(lines.length).fill(-2),
    classes: lines.map(() => 'minor'),
    levels: Uint8Array.from(lines, (l) => l.level ?? 0),
    starts,
    points,
    transform: { zoom: 14, cx: 0, cy: 0, wx: 0, wy: 0, cos: 1, sin: 0, mmPerUnit: 1 },
  };
}

const graphOf = (lines: TestLine[]) => buildRoadGraph(pickOf(lines), (x, y) => [x, y], 1);

const route = (graph: ReturnType<typeof graphOf>, a: Point, b: Point) => {
  const from = nearestRoad(graph, a, 5);
  const to = nearestRoad(graph, b, 5);
  if (!from || !to) throw new Error('not near a road');
  return routeBetween(graph, from, to);
};

// Streets that cross without sharing a point, like long merged tile lines.
const GRID: TestLine[] = [
  { points: [[0, 0], [100, 0]] },
  { points: [[0, 50], [100, 50]] },
  { points: [[25, -10], [25, 60]] },
  { points: [[75, -10], [75, 60]] },
];

describe('road graph', () => {
  it('finds junctions where lines cross without a shared point', () => {
    const way = route(graphOf(GRID), [0, 0], [100, 50]);
    expect(way).not.toBeNull();
    expect(lengthOf(way!)).toBeCloseTo(150, 5);
  });

  it("doesn't join a bridge to the road under it", () => {
    const graph = graphOf([{ points: [[0, 0], [100, 0]] }, { points: [[50, -50], [50, 50]], level: 1 }]);
    expect(route(graph, [50, -50], [0, 0])).toBeNull();
  });

  it('still joins a bridge where it shares a point with a road', () => {
    const graph = graphOf([{ points: [[0, 0], [50, 0], [100, 0]] }, { points: [[50, 0], [50, 50]], level: 1 }]);
    expect(lengthOf(route(graph, [50, 50], [0, 0])!)).toBeCloseTo(100, 5);
  });

  it('joins a street that stops just short of another', () => {
    const graph = graphOf([{ points: [[0, 0], [100, 0]] }, { points: [[50, 3], [50, 60]] }]);
    const way = route(graph, [50, 60], [0, 0]);
    expect(way).not.toBeNull();
    // 57 down the side street, 3 across the gap, 50 along the road.
    expect(lengthOf(way!)).toBeCloseTo(110, 3);
  });

  it('leaves railways out', () => {
    const graph = graphOf([{ points: [[0, 0], [100, 0]], layer: 'railways' }]);
    expect(nearestRoad(graph, [50, 1], 5)).toBeNull();
  });

  it('finds the way to several spots in one search', () => {
    const graph = graphOf(GRID);
    const from = nearestRoad(graph, [0, 0], 5)!;
    const targets = [nearestRoad(graph, [100, 50], 5)!, nearestRoad(graph, [25, 40], 5)!, nearestRoad(graph, [10, 0], 5)!];
    const ways = routesFrom(graph, from, targets, Infinity);
    expect(ways.map((w) => lengthOf(w!))).toEqual(targets.map((to) => expect.closeTo(lengthOf(routeBetween(graph, from, to)!), 5)));
    expect(routesFrom(graph, from, targets, 60).map((w) => w !== null)).toEqual([false, false, true]);
  });

  it('gives up past maxCost', () => {
    const graph = graphOf(GRID);
    const from = nearestRoad(graph, [0, 0], 5)!;
    const to = nearestRoad(graph, [100, 50], 5)!;
    expect(routeBetween(graph, from, to, 120)).toBeNull();
  });
});

describe('matching to roads', () => {
  const options = { spacing: 10, reach: 15, sigma: 5, spur: 20 };

  it('moves a noisy track onto the street it runs along and round the corner', () => {
    const graph = graphOf(GRID);
    // Along y = 0 to the corner at x = 25, then up to y = 50, a few metres off.
    const track: Point[] = [];
    for (let x = 0; x <= 25; x += 2.5) track.push([x, 3 + Math.sin(x) * 1.5]);
    for (let y = 2.5; y <= 50; y += 2.5) track.push([22 + Math.cos(y) * 1.5, y]);
    const matched = matchToRoads(graph, track, options);
    for (const [x, y] of matched) {
      const onRoad = Math.abs(y) < 1e-6 || Math.abs(x - 25) < 1e-6 || Math.abs(y - 50) < 1e-6;
      expect(onRoad).toBe(true);
    }
    expect(lengthOf(matched)).toBeGreaterThan(70);
    expect(lengthOf(matched)).toBeLessThan(80);
  });

  it('only pulls in a track as far as the reach', () => {
    const graph = graphOf([{ points: [[0, 0], [100, 0]] }]);
    // 12 m beside the road the whole way.
    const track: Point[] = Array.from({ length: 11 }, (_, i) => [i * 10, 12]);
    expect(matchToRoads(graph, track, { ...options, reach: 5 })).toEqual(track);
    expect(matchToRoads(graph, track, { ...options, reach: 30, sigma: 10 }).every(([, y]) => y === 0)).toBe(true);
  });

  it('keeps stretches away from any road as they were', () => {
    const graph = graphOf([{ points: [[0, 0], [100, 0]] }]);
    const track: Point[] = [[0, 2], [30, 2], [40, 60], [50, 80], [60, 60], [70, 2], [100, 2]];
    const matched = matchToRoads(graph, track, options);
    expect(matched).toContainEqual([50, 80]);
    expect(matched.some(([, y]) => y === 0)).toBe(true);
  });
});

describe('removeSpurs', () => {
  it('drops a short spike back on itself', () => {
    const out = removeSpurs([[0, 0], [10, 0], [12, 0], [10.5, 0], [20, 0]], 5);
    expect(out).not.toContainEqual([12, 0]);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });

  it('keeps a long out-and-back', () => {
    const path: Point[] = [[0, 0], [100, 0], [0, 0.5]];
    expect(removeSpurs(path, 5)).toEqual(path);
  });
});

describe('on a real tile', () => {
  it('matches a jittery copy of a real street back onto the streets', async () => {
    const { readFileSync } = await import('node:fs');
    const { compose } = await import('../compose.ts');
    const { defaultRenderSettings } = await import('../defaults.ts');
    const { TILE_EXTENT, worldToLonLat } = await import('../geo/mercator.ts');
    const { computeLayout } = await import('../layout/layout.ts');
    const { planTiles, prepareArea } = await import('../prepare.ts');
    const { parseHershey } = await import('../text/hershey.ts');
    const tile = new Uint8Array(readFileSync(new URL('../fixtures/vancouver-14-2589-5606.pbf', import.meta.url)));
    const centre = worldToLonLat(2589.5 * TILE_EXTENT, 5606.5 * TILE_EXTENT, 14);
    const settings = { ...defaultRenderSettings('laser'), area: { lon: centre.lon, lat: centre.lat, bearing: 0, widthM: 1200 } };
    const font = { kind: 'stroke' as const, font: parseHershey(JSON.parse(readFileSync('public/fonts/hershey/futural.json', 'utf8'))) };
    const layout = computeLayout(settings.product, settings.border);
    const prepared = prepareArea(planTiles(settings.area, layout, settings.source), layout, new Map([['14/2589/5606', tile.buffer.slice(0)]]));
    const pick = compose(settings, layout, prepared, { title: font, subtitle: font }, new Map()).pick!;
    const t = pick.transform;
    const toMm = (x: number, y: number): Point => {
      const dx = x - t.cx;
      const dy = y - t.cy;
      return [t.wx + t.mmPerUnit * (dx * t.cos + dy * t.sin), t.wy + t.mmPerUnit * (dy * t.cos - dx * t.sin)];
    };
    const metresPerMm = settings.area.widthM / layout.window.w;
    let started = performance.now();
    const graph = buildRoadGraph(pick, toMm, metresPerMm);
    const buildMs = performance.now() - started;

    // The longest road, a few metres off to one side with some wobble.
    let best = -1;
    let bestLength = 0;
    for (let line = 0; line < pick.starts.length - 1; line++) {
      if (PICK_LAYERS[pick.layers[line]] !== 'roads') continue;
      const length = pick.starts[line + 1] - pick.starts[line];
      if (length > bestLength) {
        bestLength = length;
        best = line;
      }
    }
    const road: Point[] = [];
    for (let p = pick.starts[best]; p < pick.starts[best + 1]; p++) road.push([pick.points[p * 2], pick.points[p * 2 + 1]]);
    const off = 3 / metresPerMm;
    const track = road.map(([x, y], i): Point => [x + off * 0.6 + Math.sin(i) * off * 0.3, y + off * 0.6 + Math.cos(i * 1.7) * off * 0.3]);
    const mm = (metres: number) => metres / metresPerMm;
    started = performance.now();
    const matched = matchToRoads(graph, track, { spacing: mm(20), reach: mm(35), sigma: mm(10), spur: mm(40) });
    const matchMs = performance.now() - started;
    console.log(`graph ${graph.nodes} nodes in ${buildMs.toFixed(0)} ms, matched ${track.length} points in ${matchMs.toFixed(0)} ms`);
    for (const p of matched) expect(nearestRoad(graph, p, mm(0.5))).not.toBeNull();
    expect(lengthOf(matched)).toBeLessThan(lengthOf(road) * 1.2);
  });
});
