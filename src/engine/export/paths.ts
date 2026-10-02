// The path data a render writes, read back for the other file formats. Only
// what the renderer writes is read: absolute M, L, H, V, A and Z.
import type { Path, Point } from '../lines/geometry.ts';
import { fmt } from '../svg/format.ts';

export interface ExportOptions {
  // Left to right, for engraving the back of clear acrylic or glass.
  mirror?: boolean;
}

export type Segment = { type: 'L'; to: Point } | { type: 'A'; rx: number; ry: number; rotation: number; large: boolean; sweep: boolean; to: Point };

export interface SubPath {
  start: Point;
  segments: Segment[];
  closed: boolean;
}

const TOKEN = /[MLHVAZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

export function parsePath(d: string): SubPath[] {
  const tokens = d.match(TOKEN) ?? [];
  const out: SubPath[] = [];
  let current: SubPath | null = null;
  let here: Point = [0, 0];
  let command = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++].toUpperCase();
    switch (command) {
      case 'M':
        here = [num(), num()];
        current = { start: here, segments: [], closed: false };
        out.push(current);
        // More pairs after an M are lines.
        command = 'L';
        break;
      case 'L':
        here = [num(), num()];
        current?.segments.push({ type: 'L', to: here });
        break;
      case 'H':
        here = [num(), here[1]];
        current?.segments.push({ type: 'L', to: here });
        break;
      case 'V':
        here = [here[0], num()];
        current?.segments.push({ type: 'L', to: here });
        break;
      case 'A': {
        const [rx, ry, rotation, large, sweep, x, y] = [num(), num(), num(), num(), num(), num(), num()];
        here = [x, y];
        current?.segments.push({ type: 'A', rx, ry, rotation, large: large !== 0, sweep: sweep !== 0, to: here });
        break;
      }
      case 'Z':
        if (current) {
          current.closed = true;
          here = current.start;
        }
        command = '';
        break;
      default:
        // Something this doesn't read. Skip it rather than loop.
        i++;
    }
  }
  return out;
}

// Points along an arc, from the SVG spec's endpoint-to-centre conversion.
function arcPoints(from: Point, seg: Extract<Segment, { type: 'A' }>, tolerance: number): Point[] {
  const [x1, y1] = from;
  const [x2, y2] = seg.to;
  let rx = Math.abs(seg.rx);
  let ry = Math.abs(seg.ry);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [seg.to];
  const phi = (seg.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (seg.large === seg.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!seg.sweep && delta > 0) delta -= 2 * Math.PI;
  if (seg.sweep && delta < 0) delta += 2 * Math.PI;
  // Enough steps to stay within tolerance of the curve.
  const r = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / r)));
  const n = Math.max(2, Math.ceil(Math.abs(delta) / Math.max(step, 1e-3)));
  const out: Point[] = [];
  for (let s = 1; s <= n; s++) {
    const t = start + (delta * s) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push(s === n ? seg.to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  return out;
}

/** A subpath as points, arcs followed to within tolerance mm. A closed one ends back at its start. */
export function flatten(sub: SubPath, tolerance = 0.01): Path {
  const out: Path = [sub.start];
  for (const seg of sub.segments) {
    const from = out[out.length - 1];
    if (seg.type === 'L') out.push(seg.to);
    else out.push(...arcPoints(from, seg, tolerance));
  }
  const [a, b] = [out[0], out[out.length - 1]];
  if (sub.closed && (a[0] !== b[0] || a[1] !== b[1])) out.push(a);
  return out;
}

/** Path data mirrored left to right across a piece `width` wide. Arcs stay arcs, turning the other way. */
export function mirrorPath(d: string, width: number): string {
  const flip = ([x, y]: Point): Point => [width - x, y];
  const pt = (p: Point) => `${fmt(p[0])},${fmt(p[1])}`;
  return parsePath(d)
    .map((sub) => {
      let out = `M${pt(flip(sub.start))}`;
      for (const seg of sub.segments) {
        if (seg.type === 'L') out += `L${pt(flip(seg.to))}`;
        else out += `A${fmt(seg.rx)},${fmt(seg.ry)} ${fmt(-seg.rotation)} ${seg.large ? 1 : 0} ${seg.sweep ? 0 : 1} ${pt(flip(seg.to))}`;
      }
      return sub.closed ? `${out}Z` : out;
    })
    .join('');
}
