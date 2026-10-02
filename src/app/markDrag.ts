// Moving, resizing and turning pins and text by dragging them, in the preview
// and on the map. Everything is in piece millimetres. A mark resizes and turns
// around its spot (a pin's tip), so it never leaves the place it marks.
import type { Point } from '../engine/lines/geometry.ts';
import { MARK_RANGES, type MapMark, type MarkArtwork, fromMarkFrame, hasText, toMarkFrame, wrapDegrees } from '../engine/marks/marks.ts';

export type MarkGrip = 'move' | 'rotate' | 'nw' | 'ne' | 'se' | 'sw';

export interface MarkHandle {
  id: Exclude<MarkGrip, 'move'>;
  x: number;
  y: number;
  label: string;
}

export interface PlacedMark {
  mark: MapMark;
  art: MarkArtwork;
  // Its spot on the piece.
  at: Point;
}

// Room around a mark that still counts as on it, so a thin line of text can
// be grabbed. In screen pixels, turned into mm by the caller.
export const MARK_REACH_PX = 6;
// How far above the box the turning handle sits, in screen pixels.
export const ROTATE_OFFSET_PX = 22;

/** The corners of a mark's box on the piece, from the top left clockwise. */
export function markCorners(p: PlacedMark, pad = 0): Point[] {
  const [x0, y0, x1, y1] = p.art.box;
  const local: Point[] = [
    [x0 - pad, y0 - pad],
    [x1 + pad, y0 - pad],
    [x1 + pad, y1 + pad],
    [x0 - pad, y1 + pad],
  ];
  return local.map((q) => fromMarkFrame(q, p.at, p.art.rotation));
}

/** The resize corners and the turning handle. unit is mm per screen pixel. */
export function markHandles(p: PlacedMark, unit: number): MarkHandle[] {
  const [nw, ne, se, sw] = markCorners(p, 3 * unit);
  const [x0, y0, x1] = p.art.box;
  const top = fromMarkFrame([(x0 + x1) / 2, y0 - 3 * unit - ROTATE_OFFSET_PX * unit], p.at, p.art.rotation);
  return [
    { id: 'nw', x: nw[0], y: nw[1], label: 'Resize from the top left corner' },
    { id: 'ne', x: ne[0], y: ne[1], label: 'Resize from the top right corner' },
    { id: 'se', x: se[0], y: se[1], label: 'Resize from the bottom right corner' },
    { id: 'sw', x: sw[0], y: sw[1], label: 'Resize from the bottom left corner' },
    { id: 'rotate', x: top[0], y: top[1], label: 'Turn it' },
  ];
}

export function handleAt(handles: MarkHandle[], point: Point, reach: number): MarkHandle['id'] | null {
  let best: MarkHandle['id'] | null = null;
  let bestD = reach;
  for (const h of handles) {
    const d = Math.hypot(h.x - point[0], h.y - point[1]);
    if (d <= bestD) {
      bestD = d;
      best = h.id;
    }
  }
  return best;
}

/** The mark under a point, the one drawn last when they overlap. */
export function markAt(marks: PlacedMark[], point: Point, reach: number): string | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const p = marks[i];
    const [x, y] = toMarkFrame(point, p.at, p.art.rotation);
    const [x0, y0, x1, y1] = p.art.box;
    if (x >= x0 - reach && x <= x1 + reach && y >= y0 - reach && y <= y1 + reach) return p.mark.id;
  }
  return null;
}

export interface MarkDrag {
  grip: MarkGrip;
  start: Point;
  // The mark as it was grabbed.
  from: PlacedMark;
}

export interface MarkDragResult {
  // The new spot, for a move.
  at?: Point;
  patch: Partial<MapMark>;
}

// toFixed drops the float noise, like 7.000000000000001 for 70 steps of 0.1.
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(3));

// How much the size can change before either size leaves its range.
function scaleRange(mark: MapMark): [number, number] {
  let lo = 0;
  let hi = Infinity;
  if (mark.shape !== 'none') {
    lo = Math.max(lo, MARK_RANGES.size.min / mark.size);
    hi = Math.min(hi, MARK_RANGES.size.max / mark.size);
  }
  if (hasText(mark)) {
    lo = Math.max(lo, MARK_RANGES.textSize.min / mark.textSize);
    hi = Math.min(hi, MARK_RANGES.textSize.max / mark.textSize);
  }
  return [lo, hi];
}

/**
 * Where a drag has got to. snap is Shift: a move keeps to one axis and a turn
 * goes in 15° steps. Without it a turn still settles on square angles when
 * it's within 4° of one.
 */
export function dragMark(drag: MarkDrag, point: Point, snap = false): MarkDragResult {
  const { grip, start, from } = drag;
  const { mark, at } = from;
  if (grip === 'move') {
    let dx = point[0] - start[0];
    let dy = point[1] - start[1];
    if (snap) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    return { at: [at[0] + dx, at[1] + dy], patch: {} };
  }
  if (grip === 'rotate') {
    const turned = ((Math.atan2(point[1] - at[1], point[0] - at[0]) - Math.atan2(start[1] - at[1], start[0] - at[0])) * 180) / Math.PI;
    let rotation = wrapDegrees(mark.rotation + turned);
    if (snap) rotation = round(rotation, 15);
    else if (Math.abs(rotation - round(rotation, 90)) < 4) rotation = round(rotation, 90);
    return { patch: { rotation: wrapDegrees(Math.round(rotation * 10) / 10) } };
  }
  const before = Math.hypot(start[0] - at[0], start[1] - at[1]);
  const after = Math.hypot(point[0] - at[0], point[1] - at[1]);
  if (before < 1e-6) return { patch: {} };
  return { patch: scaleMark(mark, after / before) };
}

/** The shape and the text both k times the size, as far as their ranges let them go. */
export function scaleMark(mark: MapMark, k: number): Pick<MapMark, 'size' | 'textSize'> {
  const [lo, hi] = scaleRange(mark);
  const f = Math.min(hi, Math.max(lo, k));
  return { size: round(mark.size * f, 0.1), textSize: round(mark.textSize * f, 0.05) };
}

/** A resize cursor for a corner, turned with the mark. */
export function cornerCursor(grip: MarkGrip, rotation: number): string {
  if (grip === 'move') return 'move';
  if (grip === 'rotate') return 'grab';
  const base = grip === 'nw' || grip === 'se' ? 45 : 135;
  const angle = (((base + rotation) % 180) + 180) % 180;
  if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
  if (angle < 67.5) return 'nwse-resize';
  return angle < 112.5 ? 'ns-resize' : 'nesw-resize';
}
