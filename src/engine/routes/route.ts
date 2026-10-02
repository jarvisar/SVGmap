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

const EARTH_RADIUS = 6371008.8;

// Douglas-Peucker without recursion, since tracks can have a lot of points.
// Marks the points to keep.
function keptPoints(path: Path, tolerance: number): Uint8Array {
  const n = path.length;
  const keep = new Uint8Array(n);
  if (n <= 2 || !(tolerance > 0)) return keep.fill(1);
  keep[0] = 1;
  keep[n - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    let worst = -1;
    let worstSq = toleranceSq;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistanceSq(path[i], path[a], path[b]);
      if (d > worstSq) {
        worstSq = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  return keep;
}

export function simplifyPath(path: Path, tolerance: number): Path {
  const keep = keptPoints(path, tolerance);
  return path.filter((_, i) => keep[i]);
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

export function simplifyRoute(lines: readonly LonLat[][]): LonLat[][] {
  const metres = toMetres(lines);
  let tolerance = TOLERANCE_M;
  for (;;) {
    const out = metres.map((path, i) => {
      const keep = keptPoints(path, tolerance);
      return lines[i].filter((_, j) => keep[j]);
    });
    const total = out.reduce((sum, line) => sum + line.length, 0);
    if (total <= MAX_ROUTE_POINTS || tolerance > 1e5) return out;
    tolerance *= 1.5;
  }
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
