// Sidewalks and crossings, taken from Overture's road segments. The map tiles
// keep OSM's highway=footway but drop footway=sidewalk and footway=crossing,
// so a sidewalk comes through as a plain footpath. Overture has those tags as
// the segment's subclass, from the same OSM ways, so the stretches of the
// tiles' paths lying along its sidewalks and crossings are left out. Park
// paths, trails and footbridges have other subclasses and stay.
import type { OvertureFeature, Position } from './data/features.ts';
import { lonLatToWorld } from './geo/mercator.ts';
import type { MapTransform } from './geo/transform.ts';
import { type Path, type Point, SegmentGrid, pathLength, pointSegmentDistanceSq, unit } from './lines/geometry.ts';
import type { PreparedLine } from './prepare.ts';

export const SIDEPATH_SUBCLASSES = new Set(['sidewalk', 'crosswalk', 'cycle_crossing']);

// How far a tile path can be from the segment and still be the same way. Tile
// coordinates are rounded to about half a metre at zoom 14, and twice that
// for each zoom below.
const TOLERANCE_M = 3;
// A tile path has to run along the segment, not just cross it, to be left out.
const MAX_ANGLE_DEG = 30;

interface Rule {
  value?: unknown;
  between?: unknown;
}

function rules(value: unknown): Rule[] {
  return Array.isArray(value) ? value.filter((rule): rule is Rule => typeof rule === 'object' && rule !== null) : [];
}

// The share of the segment a rule covers, or null for all of it.
function between(rule: Rule): [number, number] | null {
  const b = rule.between;
  if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== 'number' || typeof b[1] !== 'number') return null;
  return [Math.max(0, Math.min(b[0], b[1])), Math.min(1, Math.max(b[0], b[1]))];
}

/** Whether a segment is, or has a stretch that is, a sidewalk or crossing. */
export function isSidepath(props: Record<string, unknown>): boolean {
  if (props.subtype !== 'road') return false;
  return SIDEPATH_SUBCLASSES.has(String(props.subclass ?? '')) || rules(props.subclass_rules).some((rule) => SIDEPATH_SUBCLASSES.has(String(rule.value ?? '')));
}

/**
 * The stretches of a segment that are sidewalks or crossings, as shares of
 * its length. A scoped rule's value stands in for the segment's own subclass
 * along its stretch.
 */
export function sidepathParts(props: Record<string, unknown>): [number, number][] {
  if (props.subtype !== 'road') return [];
  const scoped = rules(props.subclass_rules);
  const cuts = new Set([0, 1]);
  for (const rule of scoped) {
    const b = between(rule);
    if (b) cuts.add(b[0]).add(b[1]);
  }
  const ordered = [...cuts].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 1; i < ordered.length; i++) {
    const [t0, t1] = [ordered[i - 1], ordered[i]];
    if (t1 - t0 < 1e-9) continue;
    const mid = (t0 + t1) / 2;
    const rule = scoped.find((r) => {
      const b = between(r);
      return !b || (mid >= b[0] && mid <= b[1]);
    });
    const value = String((rule ? rule.value : props.subclass) ?? '');
    if (!SIDEPATH_SUBCLASSES.has(value)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

function lines(feature: OvertureFeature): Position[][] {
  const g = feature.geometry;
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

// The part of a path from share t0 to t1 of its length.
function slice(path: Path, t0: number, t1: number): Path {
  if (t0 <= 0 && t1 >= 1) return path;
  const total = pathLength(path);
  const at = (t: number): [number, Point] => {
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      const length = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      if (walked + length >= t * total) {
        const f = length > 0 ? (t * total - walked) / length : 0;
        return [i, [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f]];
      }
      walked += length;
    }
    return [path.length - 1, path[path.length - 1]];
  };
  const [i0, p0] = at(t0);
  const [i1, p1] = at(t1);
  return [p0, ...path.slice(i0, i1), p1];
}

/** Overture's sidewalks and crossings on the canvas, in mm. */
export function projectSidepaths(features: readonly OvertureFeature[], transform: MapTransform): Path[] {
  const out: Path[] = [];
  for (const feature of features) {
    const parts = sidepathParts(feature.props);
    if (!parts.length) continue;
    for (const line of lines(feature)) {
      if (line.length < 2) continue;
      const path = line.map(([lon, lat]) => transform.toCanvas(...lonLatToWorld(lon, lat, transform.zoom)));
      for (const [t0, t1] of parts) {
        const piece = slice(path, t0, t1);
        if (piece.length >= 2) out.push(piece);
      }
    }
  }
  return out;
}

/** How close a tile path has to be to a sidewalk to be taken for it, in mm. */
export function sidepathTolerance(transform: Pick<MapTransform, 'metresPerMm' | 'zoom'>): number {
  return (TOLERANCE_M * 2 ** Math.max(0, 14 - transform.zoom)) / transform.metresPerMm;
}

/**
 * The lines with every stretch of path lying along a sidewalk or crossing
 * taken out. A path that's only partly one is cut, and what's left of it
 * stays. Lines of other layers come back as they are.
 */
export function leaveOutSidepaths(lines: readonly PreparedLine[], sidepaths: readonly Path[], tolerance: number): { lines: PreparedLine[]; removedMm: number } {
  if (!sidepaths.length) return { lines: [...lines], removedMm: 0 };
  const grid = new SegmentGrid(sidepaths, tolerance);
  const toleranceSq = tolerance * tolerance;
  const cosLimit = Math.cos((MAX_ANGLE_DEG * Math.PI) / 180);
  const step = tolerance / 2;
  // Pieces left over at the end of a sidewalk, where it turns a corner.
  const minPiece = tolerance * 1.5;
  const out: PreparedLine[] = [];
  let removedMm = 0;
  for (const line of lines) {
    if (line.layer !== 'paths') {
      out.push(line);
      continue;
    }
    const kept: Path[] = [];
    // The stretch kept so far: the original corners and the cut ends, not
    // every short piece it was tested in.
    let run: Path | null = null;
    let runEnd: Point | null = null;
    const close = () => {
      if (run && runEnd && run[run.length - 1] !== runEnd) run.push(runEnd);
      if (run) kept.push(run);
      run = null;
    };
    let removed = 0;
    const path = line.path;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dir = unit(a, b);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(length / step));
      for (let k = 0; k < n; k++) {
        const p0: Point = k === 0 ? a : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const p1: Point = k === n - 1 ? b : [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        const mid: Point = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const along =
          dir !== null &&
          grid.someNear(mid, (sa, sb, sdir) => Math.abs(dir[0] * sdir[0] + dir[1] * sdir[1]) >= cosLimit && pointSegmentDistanceSq(mid, sa, sb) <= toleranceSq);
        if (along) {
          removed += length / n;
          close();
          continue;
        }
        run ??= [p0];
        runEnd = p1;
        if (k === n - 1) run.push(b);
      }
    }
    close();
    if (removed === 0) {
      out.push(line);
      continue;
    }
    removedMm += removed;
    for (const piece of kept) {
      if (piece.length >= 2 && pathLength(piece) >= minPiece) out.push({ ...line, path: piece });
    }
  }
  return { lines: out, removedMm };
}
