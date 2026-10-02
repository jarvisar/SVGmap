// Frames the map around routes: the centre, the map width and, if asked, the
// rotation that shows them biggest. The title's box is kept clear when there's
// room to put the route beside it instead.
import { clipPolylineInside } from '../geo/clip.ts';
import { lonLatToWorld, metresPerUnit, worldToLonLat } from '../geo/mercator.ts';
import type { AreaSpec } from '../geo/transform.ts';
import { type Shape, shapeCentre, shapePolygon } from '../layout/shapes.ts';
import type { Path, Point } from '../lines/geometry.ts';
import type { LonLat } from './polyline.ts';

export interface FitOptions {
  window: Shape;
  // The title's box, [x, y, w, h].
  avoid: [number, number, number, number] | null;
  bearing: number;
  // Try every rotation from -90 to 90 degrees too.
  rotate: boolean;
  // Kept clear inside the window edge, mm.
  margin: number;
  // Keep this map width, for a locked scale, and only move the map.
  widthM?: number;
}

const MIN_WIDTH_M = 100;
// Turning the map off north up has to show the route this much bigger.
const ROTATE_GAIN = 1.1;
// Then the straightest angle this close to the best one wins.
const ROTATE_SLACK = 1.03;

interface Region {
  centre: Point;
  // Inside is n · p >= c.
  edges: { n: Point; c: number }[];
  // The whole window, not a part of it beside the title.
  whole: boolean;
}

// Andrew's monotone chain. Rotation doesn't change the hull, so the fit only
// has to test its corners.
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Keeps the part of a convex polygon where n · p >= c.
function clipConvex(poly: Path, n: Point, c: number): Path {
  const out: Path = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = n[0] * a[0] + n[1] * a[1] - c;
    const db = n[0] * b[0] + n[1] * b[1] - c;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// The polygon's edges moved in by margin.
function region(poly: Path, margin: number, whole: boolean): Region | null {
  if (poly.length < 3) return null;
  const mid: Point = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  const edges: Region['edges'] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    let n: Point = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
    if (n[0] * (mid[0] - a[0]) + n[1] * (mid[1] - a[1]) < 0) n = [-n[0], -n[1]];
    edges.push({ n, c: n[0] * a[0] + n[1] * a[1] + margin });
  }
  let inner: Path = poly;
  for (const e of edges) inner = clipConvex(inner, e.n, e.c);
  if (inner.length < 3) return null;
  const xs = inner.map((p) => p[0]);
  const ys = inner.map((p) => p[1]);
  const centre: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return { centre, edges, whole };
}

function regions(options: FitOptions): Region[] {
  const window = shapePolygon(options.window, 0.05);
  const out = [region(window, options.margin, true)];
  if (options.avoid) {
    const [x, y, w, h] = options.avoid;
    // Above, below, left and right of the title.
    out.push(
      region(clipConvex(window, [0, -1], -y), options.margin, false),
      region(clipConvex(window, [0, 1], y + h), options.margin, false),
      region(clipConvex(window, [-1, 0], -x), options.margin, false),
      region(clipConvex(window, [1, 0], x + w), options.margin, false),
    );
  }
  return out.filter((r): r is Region => r !== null);
}

// The biggest mm per world unit that keeps every corner inside.
function largestScale(corners: Point[], centre: Point, r: Region): number {
  let k = Infinity;
  for (const { n, c } of r.edges) {
    const slack = n[0] * r.centre[0] + n[1] * r.centre[1] - c;
    let worst = 0;
    for (const p of corners) worst = Math.min(worst, n[0] * (p[0] - centre[0]) + n[1] * (p[1] - centre[1]));
    if (worst < 0) k = Math.min(k, Math.max(0, slack) / -worst);
  }
  return k;
}

const rotate = ([x, y]: Point, cos: number, sin: number): Point => [x * cos + y * sin, y * cos - x * sin];

interface Placement {
  bearing: number;
  k: number;
  region: Region;
  // The route's centre, rotated.
  centre: Point;
}

export function fitArea(lines: readonly LonLat[][], options: FitOptions): AreaSpec | null {
  const world = lines.flatMap((line) => line.map(([lon, lat]) => lonLatToWorld(lon, lat, 0)));
  if (world.length === 0) return null;
  const corners = hull(world);
  const parts = regions(options);
  if (parts.length === 0) return null;
  const windowCentre = shapeCentre(options.window);
  const avoid: Path | null = options.avoid
    ? [
        [options.avoid[0], options.avoid[1]],
        [options.avoid[0] + options.avoid[2], options.avoid[1]],
        [options.avoid[0] + options.avoid[2], options.avoid[1] + options.avoid[3]],
        [options.avoid[0], options.avoid[1] + options.avoid[3]],
      ]
    : null;

  const ys = world.map((p) => p[1]);
  const midLat = worldToLonLat(0, (Math.min(...ys) + Math.max(...ys)) / 2, 0).lat;
  const fixedK = options.widthM ? metresPerUnit(midLat, 0) / (options.widthM / options.window.w) : null;

  const underTitle = (p: Placement, k: number) => {
    if (!avoid) return false;
    const cos = Math.cos((p.bearing * Math.PI) / 180);
    const sin = Math.sin((p.bearing * Math.PI) / 180);
    const toCanvas = (q: Point): Point => {
      const [u, v] = rotate(q, cos, sin);
      return [p.region.centre[0] + k * (u - p.centre[0]), p.region.centre[1] + k * (v - p.centre[1])];
    };
    return lines.some((line) => clipPolylineInside(line.map(([lon, lat]) => toCanvas(lonLatToWorld(lon, lat, 0))), avoid).length > 0);
  };

  const place = (bearing: number): Placement | null => {
    const cos = Math.cos((bearing * Math.PI) / 180);
    const sin = Math.sin((bearing * Math.PI) / 180);
    const turned = corners.map((p) => rotate(p, cos, sin));
    const us = turned.map((p) => p[0]);
    const vs = turned.map((p) => p[1]);
    const centre: Point = [(Math.min(...us) + Math.max(...us)) / 2, (Math.min(...vs) + Math.max(...vs)) / 2];
    const tried = parts
      .map((r) => ({ bearing, region: r, centre, k: largestScale(turned, centre, r) }))
      .sort((a, b) => b.k - a.k);
    // The whole window only counts if the route stays out of the title there.
    for (const p of tried) {
      if (fixedK !== null && p.k < fixedK) continue;
      if (p.region.whole && underTitle(p, fixedK ?? p.k)) continue;
      return p;
    }
    return tried.find((p) => p.region.whole) ?? tried[0] ?? null;
  };

  let best: Placement | null = null;
  if (options.rotate) {
    const tried: Placement[] = [];
    for (let bearing = -90; bearing <= 90; bearing++) {
      const p = place(bearing);
      if (p) tried.push(p);
    }
    const top = Math.max(...tried.map((p) => p.k));
    const northUp = tried.find((p) => p.bearing === 0);
    best =
      northUp && top < northUp.k * ROTATE_GAIN
        ? northUp
        : (tried.filter((p) => p.k >= top / ROTATE_SLACK).sort((a, b) => Math.abs(a.bearing) - Math.abs(b.bearing))[0] ?? null);
  } else {
    best = place(options.bearing);
  }
  if (!best) return null;

  const cos = Math.cos((best.bearing * Math.PI) / 180);
  const sin = Math.sin((best.bearing * Math.PI) / 180);
  const solve = (k: number) => {
    // The window centre in rotated route units, turned back to world units.
    const u = best.centre[0] + (windowCentre[0] - best.region.centre[0]) / k;
    const v = best.centre[1] + (windowCentre[1] - best.region.centre[1]) / k;
    const centre = worldToLonLat(u * cos - v * sin, u * sin + v * cos, 0);
    return { centre, widthM: (metresPerUnit(centre.lat, 0) / k) * options.window.w };
  };
  let k = fixedK ?? (Number.isFinite(best.k) && best.k > 0 ? best.k : metresPerUnit(midLat, 0) / (MIN_WIDTH_M / options.window.w));
  let { centre, widthM } = solve(k);
  if (fixedK === null && widthM < MIN_WIDTH_M) {
    k *= widthM / MIN_WIDTH_M;
    ({ centre, widthM } = solve(k));
  }
  return { lon: centre.lon, lat: centre.lat, bearing: best.bearing, widthM: options.widthM ?? widthM };
}
