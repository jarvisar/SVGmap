import { describe, expect, it } from 'vitest';
import { toPath64 } from './fills.ts';
import type { Path } from './lines/geometry.ts';
import { contourLines, hatch, orderForPlotting, outlines } from './plotter.ts';

const square = toPath64([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

describe('hatching', () => {
  it('fills a square with evenly spaced lines inside it', () => {
    const lines = hatch([square], 1, 0);
    expect(lines).toHaveLength(10);
    for (const [a, b] of lines) {
      expect(Math.abs(b[0] - a[0])).toBeCloseTo(10, 9);
      expect(a[1]).toBeGreaterThan(0);
      expect(a[1]).toBeLessThan(10);
    }
  });

  it('skips holes', () => {
    const hole = toPath64([
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ]);
    const total = hatch([square, hole], 1, 0).reduce((sum, [a, b]) => sum + Math.abs(b[0] - a[0]), 0);
    // Ten lines of 10 mm, four of which cross the 4 mm hole.
    expect(total).toBeCloseTo(10 * 10 - 4 * 4, 6);
  });

  it('hatches at an angle', () => {
    for (const [a, b] of hatch([square], 1, 45)) {
      expect(Math.abs(Math.abs(b[0] - a[0]) - Math.abs(b[1] - a[1]))).toBeLessThan(1e-6);
    }
  });
});

describe('contours', () => {
  it('reach the middle of a big area without piling up points', () => {
    // 300 mm with a notch, whose inside corners get rounded on every pass.
    const notched = toPath64([
      [0, 0],
      [300, 0],
      [300, 300],
      [160, 300],
      [160, 280],
      [140, 280],
      [140, 300],
      [0, 300],
    ]);
    const rings = contourLines([notched], 0.1);
    // About 140 mm in at 0.1 mm a ring, more than the 1000 passes it used to stop at.
    expect(rings.length).toBeGreaterThan(1300);
    const points = rings.reduce((sum, r) => sum + r.length, 0);
    expect(points / rings.length).toBeLessThan(100);
  });
});

describe('plotter order', () => {
  it('closes outlines', () => {
    const [ring] = outlines([square]);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('cuts pen-up travel compared with the input order', () => {
    // A grid of short strokes listed in a scattered order.
    const strokes: Path[] = [];
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const x = ((i * 7) % 20) * 5;
        const y = ((j * 11) % 20) * 5;
        strokes.push([
          [x, y],
          [x + 3, y],
        ]);
      }
    }
    let naive = 0;
    let here: [number, number] = [0, 0];
    for (const s of strokes) {
      naive += Math.hypot(s[0][0] - here[0], s[0][1] - here[1]);
      here = s[1];
    }
    const ordered = orderForPlotting(strokes);
    expect(ordered.paths).toHaveLength(strokes.length);
    expect(ordered.travel).toBeLessThan(naive / 5);
  });
});
