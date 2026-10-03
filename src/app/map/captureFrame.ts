import { metresPerPixel, metresPerUnit, worldToLonLat } from '../../engine/geo/mercator.ts';
import { type AreaSpec, makeTransform } from '../../engine/geo/transform.ts';
import { type BorderSettings, type Layout, type ProductSettings, computeLayout } from '../../engine/layout/layout.ts';
import { shapeCentre } from '../../engine/layout/shapes.ts';
import { fieldRange } from '../../engine/limits.ts';
import type { Point } from '../../engine/lines/geometry.ts';

export interface CaptureFrame {
  // Screen pixels per piece millimetre, with rotation in degrees.
  scale: number;
  ox: number;
  oy: number;
  angle: number;
}

export interface FrameView {
  updateFrame(frame: CaptureFrame): void;
}

export const frameTransform = (frame: CaptureFrame) => `translate(${frame.ox} ${frame.oy}) rotate(${frame.angle}) scale(${frame.scale})`;

export type ResizeGrip = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CaptureGrip = 'move' | 'rotate' | ResizeGrip;

// What a drag on the capture changes. The product only changes when the
// scale is locked and the capture is resized.
export interface CaptureChange {
  area: AreaSpec;
  product?: ProductSettings;
}

const GRIPS: Record<ResizeGrip, Point> = {
  nw: [0, 0],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
  n: [0.5, 0],
  e: [1, 0.5],
  s: [0.5, 1],
  w: [0, 0.5],
};
const GRIP_NAMES: Record<ResizeGrip, string> = {
  nw: 'top left corner', ne: 'top right corner', se: 'bottom right corner', sw: 'bottom left corner',
  n: 'top edge', e: 'right edge', s: 'bottom edge', w: 'left edge',
};

export function toScreen(frame: CaptureFrame, [x, y]: Point): Point {
  const radians = frame.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [frame.ox + frame.scale * (x * cos - y * sin), frame.oy + frame.scale * (x * sin + y * cos)];
}

export function toPiece(frame: CaptureFrame, [x, y]: Point): Point {
  const radians = frame.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = (x - frame.ox) / frame.scale;
  const dy = (y - frame.oy) / frame.scale;
  return [dx * cos + dy * sin, dy * cos - dx * sin];
}

// The capture stays on its geographic location as the camera pans, zooms or
// turns. Its map window, rather than its outer edge, is centred on area.
export function frameForView(layout: Layout, area: AreaSpec, centre: Point, zoom: number, bearing: number): CaptureFrame {
  const scale = area.widthM / (layout.window.w * metresPerPixel(area.lat, zoom));
  const frame = { scale, ox: 0, oy: 0, angle: area.bearing - bearing };
  const [x, y] = toScreen(frame, shapeCentre(layout.window));
  return { ...frame, ox: centre[0] - x, oy: centre[1] - y };
}

export function captureHandles(layout: Layout) {
  const { x, y, w, h } = layout.canvas;
  return (Object.entries(GRIPS) as [ResizeGrip, Point][]).map(([id, [fx, fy]]) => ({
    id,
    name: GRIP_NAMES[id],
    point: [x + fx * w, y + fy * h] as Point,
    direction: [fx - 0.5, fy - 0.5] as Point,
  }));
}

const wrap180 = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;
const PIECE_WIDTH = fieldRange('product.width');
const PIECE_HEIGHT = fieldRange('product.height');
const clamp = (v: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, v));
const tenth = (v: number) => Math.round(v * 10) / 10;

// Where a point on the piece is on the ground, for this area.
function locator(layout: Layout, area: AreaSpec) {
  const transform = makeTransform(area, 14, shapeCentre(layout.window), layout.window.w);
  return (point: Point) => {
    const [x, y] = transform.toWorld(...point);
    const next = worldToLonLat(x, y, 14);
    return { lon: wrap180(next.lon), lat: Math.max(-85, Math.min(85, next.lat)) };
  };
}

/** A drag in the original piece coordinates. Resizing keeps the opposite handle fixed and changes the scale. */
export function dragCapture(layout: Layout, area: AreaSpec, grip: 'move' | ResizeGrip, dx: number, dy: number): AreaSpec {
  const centre = shapeCentre(layout.window);
  const at = locator(layout, area);
  if (grip === 'move') return { ...area, ...at([centre[0] + dx, centre[1] + dy]) };

  const [fx, fy] = GRIPS[grip];
  const { x, y, w, h } = layout.canvas;
  const anchor: Point = [x + (1 - fx) * w, y + (1 - fy) * h];
  const vx = (2 * fx - 1) * w;
  const vy = (2 * fy - 1) * h;
  let factor = Math.max(1e-9, 1 + (dx * vx + dy * vy) / (vx * vx + vy * vy));
  const min = layout.window.w * 100 / 1000;
  const max = layout.window.w * 2_000_000 / 1000;
  let next = area;
  for (let i = 0; i < 8; i++) {
    const location = at([anchor[0] + factor * (centre[0] - anchor[0]), anchor[1] + factor * (centre[1] - anchor[1])]);
    // Ground metres per world unit change when the centre moves north or south.
    const widthM = area.widthM * factor * metresPerUnit(location.lat, 14) / metresPerUnit(area.lat, 14);
    const bounded = Math.max(min, Math.min(max, widthM));
    next = { ...area, ...location, widthM: bounded };
    if (bounded === widthM) break;
    factor *= bounded / widthM;
  }
  return next;
}

// With the scale locked, resizing changes the piece instead, and the map
// shows more or less ground at the same scale. Sides move on their own so a
// rectangle can change shape. Circles and hexagons grow evenly. Sizes are
// kept to a tenth of a millimetre, like the Size fields. Null when the
// margins and border would leave no room for the map.
export function resizePiece(
  layout: Layout,
  product: ProductSettings,
  border: BorderSettings,
  area: AreaSpec,
  grip: ResizeGrip,
  dx: number,
  dy: number,
): Required<CaptureChange> | null {
  const [fx, fy] = GRIPS[grip];
  const { x, y, w, h } = layout.canvas;
  let next: ProductSettings;
  if (product.shape === 'circle' || product.shape === 'hexagon') {
    const vx = (2 * fx - 1) * w;
    const vy = (2 * fy - 1) * h;
    const width = clamp(tenth(product.width * (1 + (dx * vx + dy * vy) / (vx * vx + vy * vy))), PIECE_WIDTH);
    // Same rules as setProduct.
    next = { ...product, width, height: product.shape === 'circle' ? width : (width * Math.sqrt(3)) / 2 };
  } else {
    const grow = (f: number, d: number) => (f === 1 ? d : f === 0 ? -d : 0);
    next = {
      ...product,
      width: clamp(tenth(product.width + grow(fx, dx)), PIECE_WIDTH),
      height: clamp(tenth(product.height + grow(fy, dy)), PIECE_HEIGHT),
    };
  }
  let placed: Layout;
  try {
    placed = computeLayout(next, border);
  } catch {
    return null;
  }
  // The new canvas on the old piece, with the opposite handle where it was.
  const c = placed.canvas;
  const left = x + (1 - fx) * (w - c.w);
  const top = y + (1 - fy) * (h - c.h);
  const [wx, wy] = shapeCentre(placed.window);
  const location = locator(layout, area)([left + wx - c.x, top + wy - c.y]);
  return { product: next, area: { ...area, ...location, widthM: area.widthM * placed.window.w / layout.window.w } };
}

/**
 * The bearing after turning the capture by the angle between two pointer
 * directions, in radians on screen. Clockwise on screen turns it clockwise.
 */
export function turnCapture(area: AreaSpec, from: number, to: number, snap: number): AreaSpec {
  const bearing = area.bearing + (to - from) * 180 / Math.PI;
  return { ...area, bearing: wrap180(Math.round(bearing / snap) * snap) };
}
