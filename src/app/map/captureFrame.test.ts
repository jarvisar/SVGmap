import { describe, expect, it } from 'vitest';
import { defaultRenderSettings } from '../../engine/defaults.ts';
import { makeTransform } from '../../engine/geo/transform.ts';
import { computeLayout } from '../../engine/layout/layout.ts';
import { shapeCentre } from '../../engine/layout/shapes.ts';
import { type ResizeGrip, captureHandles, dragCapture, frameForView, resizePiece, toPiece, toScreen, turnCapture } from './captureFrame.ts';

const settings = defaultRenderSettings();
const layout = computeLayout(settings.product, settings.border);
const area = { ...settings.area, bearing: 37 };

describe('capture frame on the map', () => {
  it('keeps the capture centre on its projected location while the view changes', () => {
    for (const [zoom, bearing] of [[12, 0], [14, 37], [16, 90]]) {
      const frame = frameForView(layout, area, [320, 240], zoom, bearing);
      const [x, y] = toScreen(frame, shapeCentre(layout.window));
      expect(x).toBeCloseTo(320, 9);
      expect(y).toBeCloseTo(240, 9);
      const point: [number, number] = [61, 23];
      const restored = toPiece(frame, toScreen(frame, point));
      expect(restored[0]).toBeCloseTo(point[0], 9);
      expect(restored[1]).toBeCloseTo(point[1], 9);
    }
  });

  it('magnifies the frame with view zoom while keeping its ground width', () => {
    const wide = frameForView(layout, area, [320, 240], 12, 37);
    const close = frameForView(layout, area, [320, 240], 14, 37);
    expect(close.scale / wide.scale).toBeCloseTo(4, 9);
    expect(area.widthM).toBe(settings.area.widthM);
  });

  it('moves the capture without changing its width or bearing', () => {
    const next = dragCapture(layout, area, 'move', 15, -10);
    const transform = makeTransform(area, 14, shapeCentre(layout.window), layout.window.w);
    const moved = makeTransform(next, 14, shapeCentre(layout.window), layout.window.w);
    const [x, y] = transform.toCanvas(moved.cx, moved.cy);
    const [cx, cy] = shapeCentre(layout.window);
    expect(x - cx).toBeCloseTo(15, 7);
    expect(y - cy).toBeCloseTo(-10, 7);
    expect(next.widthM).toBe(area.widthM);
    expect(next.bearing).toBe(area.bearing);
  });

  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeGrip[])('resizes from %s with the opposite handle fixed', (grip) => {
    const spot = captureHandles(layout).find((spot) => spot.id === grip)!;
    const { x, y, w, h } = layout.canvas;
    const fixed: [number, number] = [2 * x + w - spot.point[0], 2 * y + h - spot.point[1]];
    const next = dragCapture(layout, area, grip, (spot.point[0] - fixed[0]) / 2, (spot.point[1] - fixed[1]) / 2);
    const before = makeTransform(area, 14, shapeCentre(layout.window), layout.window.w);
    const after = makeTransform(next, 14, shapeCentre(layout.window), layout.window.w);
    const [wx, wy] = before.toWorld(...fixed);
    const at = after.toCanvas(wx, wy);
    expect(at[0]).toBeCloseTo(fixed[0], 7);
    expect(at[1]).toBeCloseTo(fixed[1], 7);
    expect(before.mmPerUnit / after.mmPerUnit).toBeCloseTo(1.5, 7);
    expect(next.bearing).toBe(area.bearing);
  });

  it('preserves the opposite edge with uneven margins', () => {
    const uneven = computeLayout({ ...settings.product, margins: { top: 5, bottom: 15, left: 10, right: 20 } }, settings.border);
    const next = dragCapture(uneven, area, 'e', uneven.canvas.w / 2, 0);
    const before = makeTransform(area, 14, shapeCentre(uneven.window), uneven.window.w);
    const after = makeTransform(next, 14, shapeCentre(uneven.window), uneven.window.w);
    const anchor: [number, number] = [uneven.canvas.x, uneven.canvas.y + uneven.canvas.h / 2];
    const fixed = before.toWorld(...anchor);
    const at = after.toCanvas(...fixed);
    expect(at[0]).toBeCloseTo(anchor[0], 7);
    expect(at[1]).toBeCloseTo(anchor[1], 7);
  });

  it('clamps extreme resizes to the same scale range as the Location inputs', () => {
    for (const dx of [-1e6, 1e6]) {
      const next = dragCapture(layout, area, 'e', dx, 0);
      const scale = next.widthM / layout.window.w * 1000;
      expect(scale).toBeGreaterThanOrEqual(100);
      expect(scale).toBeLessThanOrEqual(2_000_000);
      expect(Number.isFinite(next.lon + next.lat)).toBe(true);
      expect(Math.abs(next.lat)).toBeLessThanOrEqual(85);
    }
  });

  it('wraps a moved capture across the dateline', () => {
    const next = dragCapture(layout, { ...area, lon: 179.999, lat: 0, bearing: 0 }, 'move', 100, 0);
    expect(next.lon).toBeLessThan(-179);
    expect(next.lon).toBeGreaterThanOrEqual(-180);
  });
});

describe('resizing the piece with the scale locked', () => {
  const product = settings.product;
  const border = settings.border;
  const flat = { ...area, bearing: 0 };
  const scale = (a: typeof area, l: typeof layout) => a.widthM / l.window.w;

  // Where a point on the old piece ends up on the new one.
  const carried = (next: NonNullable<ReturnType<typeof resizePiece>>, point: [number, number]) => {
    const placed = computeLayout(next.product, border);
    const before = makeTransform(flat, 14, shapeCentre(layout.window), layout.window.w);
    const after = makeTransform(next.area, 14, shapeCentre(placed.window), placed.window.w);
    return { placed, at: after.toCanvas(...before.toWorld(...point)) };
  };

  it('grows one side and keeps the other where it was', () => {
    const next = resizePiece(layout, product, border, flat, 'e', 30, 12)!;
    expect(next.product.width).toBeCloseTo(product.width + 30, 9);
    expect(next.product.height).toBe(product.height);
    const { placed, at } = carried(next, [layout.canvas.x, layout.canvas.y + layout.canvas.h / 2]);
    expect(at[0]).toBeCloseTo(placed.canvas.x, 6);
    expect(at[1]).toBeCloseTo(placed.canvas.y + placed.canvas.h / 2, 6);
    expect(scale(next.area, placed)).toBeCloseTo(scale(flat, layout), 9);
  });

  it('keeps the opposite corner when a corner is dragged', () => {
    const next = resizePiece(layout, product, border, flat, 'nw', -20, -10)!;
    expect(next.product.width).toBeCloseTo(product.width + 20, 9);
    expect(next.product.height).toBeCloseTo(product.height + 10, 9);
    const { x, y, w, h } = layout.canvas;
    const { placed, at } = carried(next, [x + w, y + h]);
    // The centre moves north, and the scale is kept in ground metres, so the
    // corner drifts by a micron or so on a Mercator map.
    expect(at[0]).toBeCloseTo(placed.canvas.x + placed.canvas.w, 2);
    expect(at[1]).toBeCloseTo(placed.canvas.y + placed.canvas.h, 2);
  });

  it('grows a circle evenly', () => {
    const circle = { ...product, shape: 'circle' as const, width: 150, height: 150 };
    const round = computeLayout(circle, border);
    const next = resizePiece(round, circle, border, flat, 'e', 30, 0)!;
    expect(next.product.width).toBeCloseTo(180, 9);
    expect(next.product.height).toBe(next.product.width);
  });

  it('stops at the smallest piece the margins and border leave room for', () => {
    expect(resizePiece(layout, product, border, flat, 'e', -1000, 0)).toBeNull();
    const next = resizePiece(layout, product, border, flat, 'e', 1e6, 0)!;
    expect(next.product.width).toBe(2000);
  });
});

describe('turning the capture', () => {
  it('turns clockwise on screen and wraps past 180 degrees', () => {
    expect(turnCapture({ ...area, bearing: 170 }, 0, Math.PI / 6, 1).bearing).toBeCloseTo(-160, 9);
    expect(turnCapture({ ...area, bearing: 0 }, Math.PI / 2, 0, 1).bearing).toBeCloseTo(-90, 9);
  });

  it('snaps to the step it is given', () => {
    expect(turnCapture({ ...area, bearing: 0 }, 0, (22 * Math.PI) / 180, 15).bearing).toBe(15);
    expect(turnCapture({ ...area, bearing: 3.4 }, 0, 0, 1).bearing).toBe(3);
  });
});
