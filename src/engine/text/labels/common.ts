// Pieces shared by the title styles.
import type { Path, Point } from '../../lines/geometry.ts';
import { type Shape, shapeCentre } from '../../layout/shapes.ts';
import { type TextGeometry, geometryBounds } from '../outline.ts';
import { boxCentres, nearestIn, regionSlice } from '../place.ts';

export class LabelError extends Error {}

// Scale and bearing of the map, for the scale bar and the north arrows.
export interface MapInfo {
  metresPerMm: number;
  // Degrees clockwise from north that point up.
  bearing: number;
}

export interface LabelArtwork {
  // Bounding box of the title, [x, y, w, h]. Routes are fitted around it.
  knockout: [number, number, number, number];
  // The map is left out inside these rings and within clearGap of them. A box
  // or a band is a single rectangle.
  clear: Path[];
  // Open lines the map also keeps clearGap away from, like single-line letters.
  clearLines: Path[];
  clearGap: number;
  // Only for the map inside the letters: the map is kept inside these rings
  // and left out everywhere else.
  keep: Path[] | null;
  text: TextGeometry;
  // The subtitle's letters, kept apart so they can be a layer of their own.
  subtitle: TextGeometry;
  // Engraved areas drawn with the lettering, like a ribbon's folds or the
  // scale bar. With reversed set, the lettering is cut out of them instead.
  solid: Path[];
  reversed: boolean;
  // Box outline, divider and other line work.
  frame: Path[];
  frameWidth: number;
  frameLabel: string;
  // The border lines are left out inside these convex shapes.
  borderBreaks: Path[];
  // The offset it ended up at once kept inside the border. A drag stores
  // this, so what's saved is what's drawn.
  offset: [number, number];
  // How far it was scaled from its set size to fit: the whole title when it
  // was too big for the piece, the text in a band. 1 when it fit as set.
  scale: number;
}

export const NO_TEXT: TextGeometry = { rings: [], strokes: [] };

export function artwork(parts: Partial<LabelArtwork> & Pick<LabelArtwork, 'knockout'>): LabelArtwork {
  return {
    clear: [],
    clearLines: [],
    clearGap: 0,
    keep: null,
    text: NO_TEXT,
    subtitle: NO_TEXT,
    solid: [],
    reversed: false,
    frame: [],
    frameWidth: 0.25,
    frameLabel: 'Title lines',
    borderBreaks: [],
    offset: [0, 0],
    scale: 1,
    ...parts,
  };
}

export function place(g: TextGeometry, transform: (p: Point) => Point): TextGeometry {
  return {
    rings: g.rings.map((r) => r.map(transform)),
    strokes: g.strokes.map((s) => s.map(transform)),
  };
}

/** The title's letters and the subtitle's together, for sizing them up. */
export const allLettering = (a: LabelArtwork): TextGeometry => mergeGeometry(a.text, a.subtitle);

export function mergeGeometry(a: TextGeometry, b: TextGeometry | null): TextGeometry {
  if (!b) return a;
  return { rings: [...a.rings, ...b.rings], strokes: [...a.strokes, ...b.strokes] };
}

// Text moved so its bounding box starts at 0, 0 and scaled to the height.
export function sized(g: TextGeometry, height: number): { g: TextGeometry; w: number; h: number } {
  const b = geometryBounds(g);
  if (!b) throw new LabelError('The title font has no visible letters for this text.');
  const scale = height / (b[3] - b[1]);
  return {
    g: place(g, ([x, y]) => [(x - b[0]) * scale, (y - b[1]) * scale]),
    w: (b[2] - b[0]) * scale,
    h: height,
  };
}

export const moved = (g: TextGeometry, dx: number, dy: number): TextGeometry => place(g, ([x, y]) => [x + dx, y + dy]);
export const scaled = (g: TextGeometry, f: number): TextGeometry => place(g, ([x, y]) => [x * f, y * f]);

export function rect(x: number, y: number, w: number, h: number): Path {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function circle(cx: number, cy: number, r: number, reverse = false): Path {
  const n = Math.min(360, Math.max(48, Math.ceil(r * 12)));
  const out: Path = [];
  for (let i = 0; i < n; i++) {
    const a = ((reverse ? -1 : 1) * 2 * Math.PI * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// A closed outline as open pieces. Some laser software treats a closed path
// as a shape to fill.
export function openRing(ring: Path): Path[] {
  if (ring.length < 3) return [];
  const half = Math.ceil(ring.length / 2);
  return [ring.slice(0, half + 1), [...ring.slice(half), ring[0]]];
}

export function boundsOf(paths: Path[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of paths) {
    for (const [x, y] of p) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

// Points no further apart than step, so a bend or a turn keeps its shape.
export function subdivide(path: Path, step: number, closed: boolean): Path {
  const out: Path = [];
  const n = closed ? path.length : path.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < parts; k++) out.push([a[0] + ((b[0] - a[0]) * k) / parts, a[1] + ((b[1] - a[1]) * k) / parts]);
  }
  if (!closed && path.length) out.push(path[path.length - 1]);
  return out;
}

export function warpText(g: TextGeometry, f: (p: Point) => Point, step: number): TextGeometry {
  return {
    rings: g.rings.map((r) => subdivide(r, step, true).map(f)),
    strokes: g.strokes.map((s) => subdivide(s, step, false).map(f)),
  };
}

// Text from sized() bent around (cx, cy), the middle of its letters on a circle
// of radius mid. It reads clockwise over the top or anticlockwise under the bottom.
export function bendText(g: TextGeometry, w: number, h: number, cx: number, cy: number, mid: number, top: boolean): TextGeometry {
  return warpText(
    g,
    ([x, y]) => {
      const along = (x - w / 2) / mid;
      const up = h / 2 - y;
      const a = top ? -Math.PI / 2 + along : Math.PI / 2 - along;
      const r = top ? mid + up : mid - up;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    },
    0.1,
  );
}

export function rotate(p: Point, centre: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const dx = p[0] - centre[0];
  const dy = p[1] - centre[1];
  return [centre[0] + dx * Math.cos(a) - dy * Math.sin(a), centre[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}

// Round and hexagonal pieces get narrower towards the edge.
export function availableWidthAt(shape: Shape, y0: number, y1: number): [number, number] {
  if (shape.kind !== 'circle' && shape.kind !== 'hexagon') return [shape.x, shape.x + shape.w];
  const [cx, cy] = shapeCentre(shape);
  const d = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy));
  let half: number;
  if (shape.kind === 'hexagon') half = Math.max(0, shape.r - d / Math.sqrt(3));
  else half = d >= shape.r ? 0 : Math.sqrt(shape.r * shape.r - d * d);
  return [cx - half, cx + half];
}

export type CornerPosition = 'lower_right' | 'lower_left' | 'upper_right' | 'upper_left' | 'lower_center' | 'upper_center' | 'center';

// Where a title in a corner is, and how far it was dragged from there as a
// share of the space inside the border. 0, 0 leaves it where the position
// puts it.
export interface Placement {
  position: CornerPosition;
  offsetX: number;
  offsetY: number;
}

// Top left corner of a w x h block inside limit, and the offset it ended up
// at, or null when it doesn't fit anywhere. anchor is what the offset is a
// share of.
export function placeBlock(limit: Shape, anchor: Shape, s: Placement, w: number, h: number): { at: [number, number]; offset: [number, number] } | null {
  const centres = boxCentres(limit, w, h);
  if (centres.length === 0) return null;
  const left = limit.x + w / 2;
  const top = limit.y + h / 2;
  const right = limit.x + limit.w - w / 2;
  const bottom = limit.y + limit.h - h / 2;
  const centreX = limit.x + limit.w / 2;
  const centreY = limit.y + limit.h / 2;
  const positions: Record<CornerPosition, Point> = {
    lower_right: [right, bottom],
    lower_left: [left, bottom],
    upper_right: [right, top],
    upper_left: [left, top],
    lower_center: [centreX, bottom],
    upper_center: [centreX, top],
    center: [centreX, centreY],
  };
  // A corner of the bounding box is off a round or hexagonal piece, so the
  // block goes to the nearest spot that fits. Walking it towards the centre,
  // as before, left boxes floating mid-map.
  const start = positions[s.position] ?? positions.lower_right;
  let base: Point;
  if (limit.kind === 'circle') {
    // No flat edge to sit on, so the block's corner lands on the rim about 45
    // degrees round. Kept flush to the top or bottom, the corner boxes all but
    // met in the middle.
    base = nearestIn(centres, start)!;
  } else {
    // Flush along its long side if it fits there anywhere, so a block sits on
    // a hexagon's flat bottom and slides out of a rounded corner. Otherwise
    // the nearest spot, counted in block widths and heights so it stays near
    // that edge.
    const axis = w >= h ? 1 : 0;
    const along = regionSlice(centres, axis, start[axis]);
    if (along) {
      const other = Math.min(Math.max(start[1 - axis], along[0]), along[1]);
      base = axis === 1 ? [other, start[1]] : [start[0], other];
    } else {
      base = nearestIn(centres, start, 1 / w, 1 / h)!;
    }
  }
  const moved = s.offsetX !== 0 || s.offsetY !== 0;
  const [cx, cy] = moved ? nearestIn(centres, [base[0] + s.offsetX * anchor.w, base[1] + s.offsetY * anchor.h])! : base;
  return {
    at: [cx - w / 2, cy - h / 2],
    offset: moved ? [(cx - base[0]) / anchor.w, (cy - base[1]) / anchor.h] : [0, 0],
  };
}

// The biggest scale up to 1 a block fits inside limit at, so a title too big
// for the piece shrinks instead of failing. size gives the block's width and
// height at a scale. 0 when nothing fits.
export function fitScale(limit: Shape, size: (scale: number) => [number, number]): number {
  const fits = (scale: number) => boxCentres(limit, ...size(scale)).length > 0;
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// A five-pointed star, point up.
export function star(cx: number, cy: number, r: number): Path {
  const out: Path = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const radius = i % 2 ? r * 0.42 : r;
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

export function diamond(cx: number, cy: number, w: number, h: number): Path {
  return [
    [cx, cy - h / 2],
    [cx + w / 2, cy],
    [cx, cy + h / 2],
    [cx - w / 2, cy],
  ];
}
