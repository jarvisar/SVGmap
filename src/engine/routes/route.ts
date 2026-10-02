// Route data between the file and the settings. Routes are simplified when
// they're imported, to within a metre. GPS noise is bigger than that, and a
// marathon recorded every second goes from about 14,000 points to a few thousand.
import { type Path, pointSegmentDistanceSq } from '../lines/geometry.ts';
import type { RouteData } from '../settings.ts';
import { type LonLat, decodePolyline, encodePolyline } from './polyline.ts';

const TOLERANCE_M = 1;
// Per route, after simplifying. A noisy or very long track gets a coarser
// tolerance until it fits, so saved settings and links stay a sensible size.
export const MAX_ROUTE_POINTS = 10_000;
// Every line keeps both its ends, so this still leaves most of the points for
// the shape.
export const MAX_ROUTE_LINES = 1_000;
// Douglas-Peucker gets slow on long noisy tracks, so anything bigger is thinned
// out to about this many points first. That's still well over the cap.
const THIN_TO = 50_000;

const EARTH_RADIUS = 6371008.8;

// Douglas-Peucker without recursion, since tracks can have a lot of points.
// Gives each point the biggest squared tolerance that still keeps it, or 0
// when floor already drops it. A point is only reached when every split above
// it was kept, so it can't outlast them, and keeping everything over a
// tolerance is the same as running it again at that tolerance.
function keepScores(path: Path, floor: number): Float64Array {
  const n = path.length;
  const out = new Float64Array(n);
  if (n <= 2) return out.fill(Infinity);
  out[0] = Infinity;
  out[n - 1] = Infinity;
  const stack: number[] = [0, n - 1, Infinity];
  while (stack.length > 0) {
    const limit = stack.pop()!;
    const b = stack.pop()!;
    const a = stack.pop()!;
    let worst = -1;
    let worstSq = floor * floor;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistanceSq(path[i], path[a], path[b]);
      if (d > worstSq) {
        worstSq = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      const score = Math.min(limit, worstSq);
      out[worst] = score;
      stack.push(a, worst, score, worst, b, score);
    }
  }
  return out;
}

export function simplifyPath(path: Path, tolerance: number): Path {
  if (!(tolerance > 0)) return [...path];
  const scores = keepScores(path, tolerance);
  return path.filter((_, i) => scores[i] > tolerance * tolerance);
}

// Indexes of points at least step apart, and both ends.
function spaced(path: Path, step: number): number[] {
  if (path.length <= 2) return path.map((_, i) => i);
  const out = [0];
  let [x, y] = path[0];
  for (let i = 1; i < path.length - 1; i++) {
    if ((path[i][0] - x) ** 2 + (path[i][1] - y) ** 2 >= step * step) {
      out.push(i);
      [x, y] = path[i];
    }
  }
  out.push(path.length - 1);
  return out;
}

// Only for routes that didn't come from an import, like an edited link.
function longestLines(lines: readonly LonLat[][], count: number): LonLat[][] {
  const lengths = lines.map((line) => routeLengthM([line]));
  return lines
    .map((_, i) => i)
    .sort((a, b) => lengths[b] - lengths[a])
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((i) => lines[i]);
}

// Flat metres around the route's middle latitude, which is close enough for
// simplifying anything a map could show.
function toMetres(lines: readonly LonLat[][]): Path[] {
  let sum = 0;
  let count = 0;
  for (const line of lines) {
    for (const [, lat] of line) {
      sum += lat;
      count++;
    }
  }
  const lat0 = count ? sum / count : 0;
  const ky = (Math.PI / 180) * EARTH_RADIUS;
  const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  return lines.map((line) => line.map(([lon, lat]) => [lon * kx, lat * ky]));
}

export function simplifyRoute(input: readonly LonLat[][]): LonLat[][] {
  let lines = input.length > MAX_ROUTE_LINES ? longestLines(input, MAX_ROUTE_LINES) : input;
  let metres = toMetres(lines);
  const total = metres.reduce((sum, path) => sum + path.length, 0);
  if (total > THIN_TO) {
    let length = 0;
    for (const path of metres) {
      for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    const picks = metres.map((path) => spaced(path, length / THIN_TO));
    lines = lines.map((line, i) => picks[i].map((j) => line[j]));
    metres = metres.map((path, i) => picks[i].map((j) => path[j]));
  }

  // When the points within a metre are over the cap, the tolerance goes up
  // just far enough to fit.
  const scores = metres.map((path) => keepScores(path, TOLERANCE_M));
  const middles: number[] = [];
  let ends = 0;
  for (const list of scores) {
    for (const score of list) {
      if (score === Infinity) ends++;
      else if (score > 0) middles.push(score);
    }
  }
  const room = MAX_ROUTE_POINTS - ends;
  const cutoff = middles.length > room ? Float64Array.from(middles).sort()[middles.length - room - 1] : 0;
  return lines.map((line, i) => line.filter((_, j) => scores[i][j] > cutoff));
}

export function encodeRoute(lines: readonly LonLat[][]): string[] {
  return simplifyRoute(lines).map(encodePolyline);
}

// Drops anything off the globe, which a hand-edited link could hold.
export function decodeRoute(route: Pick<RouteData, 'lines'>): LonLat[][] {
  const out: LonLat[][] = [];
  for (const text of route.lines) {
    if (typeof text !== 'string') continue;
    const line = decodePolyline(text).filter(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
    if (line.length >= 2) out.push(line);
  }
  return out;
}

export function distanceM(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeLengthM(lines: readonly LonLat[][]): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) total += distanceM(line[i - 1], line[i]);
  }
  return total;
}
