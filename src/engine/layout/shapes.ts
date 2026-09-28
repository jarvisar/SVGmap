// Rectangle, rounded rectangle and circle. All convex, so lines clip to them
// exactly and "is this end on the crop edge" is a simple distance.
import type { Path, Point } from '../lines/geometry.ts';
import { fmt } from '../svg/format.ts';

export type ShapeKind = 'rect' | 'rounded' | 'circle';

export interface Shape {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  // Corner radius. Half the width for a circle.
  r: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const uniformInsets = (d: number): Insets => ({ top: d, right: d, bottom: d, left: d });

export function makeShape(kind: ShapeKind, x: number, y: number, w: number, h: number, radius = 0): Shape {
  if (kind === 'circle') {
    const d = Math.min(w, h);
    return { kind, x: x + (w - d) / 2, y: y + (h - d) / 2, w: d, h: d, r: d / 2 };
  }
  if (kind === 'rounded') {
    return { kind, x, y, w, h, r: Math.max(0, Math.min(radius, w / 2, h / 2)) };
  }
  return { kind: 'rect', x, y, w, h, r: 0 };
}

// Rounded corners shrink with the shape, like an offset curve.
export function insetShape(shape: Shape, insets: Insets | number): Shape {
  const i = typeof insets === 'number' ? uniformInsets(insets) : insets;
  if (shape.kind === 'circle') {
    const d = Math.max(i.top, i.right, i.bottom, i.left);
    const r = Math.max(0, shape.r - d);
    return { kind: 'circle', x: shape.x + shape.r - r, y: shape.y + shape.r - r, w: 2 * r, h: 2 * r, r };
  }
  const w = Math.max(0, shape.w - i.left - i.right);
  const h = Math.max(0, shape.h - i.top - i.bottom);
  const shrink = Math.min(i.top, i.right, i.bottom, i.left);
  const r = shape.kind === 'rounded' ? Math.max(0, Math.min(shape.r - shrink, w / 2, h / 2)) : 0;
  return { kind: shape.kind, x: shape.x + i.left, y: shape.y + i.top, w, h, r };
}

export function shapeCentre(shape: Shape): Point {
  return [shape.x + shape.w / 2, shape.y + shape.h / 2];
}

function arcSteps(radius: number, sweep: number, tolerance: number): number {
  if (radius <= tolerance) return 1;
  const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / radius));
  return Math.max(2, Math.ceil(sweep / step));
}

// Polygon for clipping, arcs within tolerance mm. The SVG output uses real arcs.
export function shapePolygon(shape: Shape, tolerance = 0.005): Path {
  const { x, y, w, h } = shape;
  if (shape.kind === 'rect' || shape.r <= 0) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  if (shape.kind === 'circle') {
    const [cx, cy] = shapeCentre(shape);
    const n = arcSteps(shape.r, 2 * Math.PI, tolerance);
    const out: Path = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push([cx + shape.r * Math.cos(a), cy + shape.r * Math.sin(a)]);
    }
    return out;
  }
  const r = shape.r;
  const n = arcSteps(r, Math.PI / 2, tolerance);
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ];
  const out: Path = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = start + ((Math.PI / 2) * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

// Clockwise on screen. reverse draws it the other way, for the inside of a band.
export function shapePathD(shape: Shape, offset: Point = [0, 0], reverse = false): string {
  const [ox, oy] = offset;
  const x = shape.x + ox;
  const y = shape.y + oy;
  const { w, h } = shape;
  const sweep = reverse ? 0 : 1;
  if (shape.kind === 'circle') {
    const r = shape.r;
    const cx = x + r;
    const cy = y + r;
    return `M${fmt(cx - r)},${fmt(cy)}A${fmt(r)},${fmt(r)} 0 1 ${sweep} ${fmt(cx + r)},${fmt(cy)}A${fmt(r)},${fmt(r)} 0 1 ${sweep} ${fmt(cx - r)},${fmt(cy)}Z`;
  }
  const r = shape.kind === 'rounded' ? shape.r : 0;
  if (r <= 0) {
    return reverse
      ? `M${fmt(x)},${fmt(y)}V${fmt(y + h)}H${fmt(x + w)}V${fmt(y)}Z`
      : `M${fmt(x)},${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
  }
  const a = (px: number, py: number) => `A${fmt(r)},${fmt(r)} 0 0 ${sweep} ${fmt(px)},${fmt(py)}`;
  if (!reverse) {
    return (
      `M${fmt(x + r)},${fmt(y)}H${fmt(x + w - r)}${a(x + w, y + r)}V${fmt(y + h - r)}${a(x + w - r, y + h)}` +
      `H${fmt(x + r)}${a(x, y + h - r)}V${fmt(y + r)}${a(x + r, y)}Z`
    );
  }
  return (
    `M${fmt(x + r)},${fmt(y)}${a(x, y + r)}V${fmt(y + h - r)}${a(x + r, y + h)}H${fmt(x + w - r)}` +
    `${a(x + w, y + h - r)}V${fmt(y + r)}${a(x + w - r, y)}Z`
  );
}

// One path that fills the same under either fill rule.
export function bandPathD(outer: Shape, inner: Shape, offset: Point = [0, 0]): string {
  return shapePathD(outer, offset) + shapePathD(inner, offset, true);
}

// For points inside the shape.
export function distanceToEdge(shape: Shape, p: Point): number {
  const [px, py] = p;
  if (shape.kind === 'circle') {
    const [cx, cy] = shapeCentre(shape);
    return Math.abs(shape.r - Math.hypot(px - cx, py - cy));
  }
  const r = shape.kind === 'rounded' ? shape.r : 0;
  const left = shape.x + r;
  const right = shape.x + shape.w - r;
  const top = shape.y + r;
  const bottom = shape.y + shape.h - r;
  if (r > 0 && (px < left || px > right) && (py < top || py > bottom)) {
    const cx = px < left ? left : right;
    const cy = py < top ? top : bottom;
    return Math.abs(r - Math.hypot(px - cx, py - cy));
  }
  return Math.min(
    Math.abs(px - shape.x),
    Math.abs(shape.x + shape.w - px),
    Math.abs(py - shape.y),
    Math.abs(shape.y + shape.h - py),
  );
}

export function shapeContains(shape: Shape, p: Point): boolean {
  const [px, py] = p;
  if (px < shape.x || px > shape.x + shape.w || py < shape.y || py > shape.y + shape.h) return false;
  if (shape.kind === 'circle') {
    const [cx, cy] = shapeCentre(shape);
    return Math.hypot(px - cx, py - cy) <= shape.r;
  }
  if (shape.kind === 'rounded' && shape.r > 0) {
    const r = shape.r;
    const cx = Math.min(Math.max(px, shape.x + r), shape.x + shape.w - r);
    const cy = Math.min(Math.max(py, shape.y + r), shape.y + shape.h - r);
    return Math.hypot(px - cx, py - cy) <= r;
  }
  return true;
}
