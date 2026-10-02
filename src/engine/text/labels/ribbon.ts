// A banner with folded, notched tails, like the title on an old map. It can
// be bent into an arch. Normally the folds are engraved and the rest is
// outlined. Solid engraves the whole ribbon and leaves the letters bare.
import type { Path, Point } from '../../lines/geometry.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { Layout } from '../../layout/layout.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import { type LabelArtwork, LabelError, artwork, boundsOf, fitScale, moved, openRing, place, placeBlock, rect, sized, subdivide, warpText } from './common.ts';

export function layoutRibbonLabel(layout: Layout, s: LabelSettings, title: TextGeometry): LabelArtwork {
  const k = s.size / 100;
  const text = sized(title, s.textHeight * k * 0.8);
  // Front panel, then the tails' drop, length, notch and fold, all from its height.
  const H = text.h * 2;
  const W = text.w + 1.5 * H;
  const d = 0.38 * H;
  const T = 0.95 * H;
  const n = 0.32 * H;
  const f = 0.42 * H;
  const x0 = -W / 2;
  const y0 = -H / 2;
  const y1 = H / 2;

  const front = rect(x0, y0, W, H);
  const bodies: Path[] = [];
  const folds: Path[] = [];
  const lines: Path[] = [];
  for (const side of [1, -1]) {
    const m = (points: Point[]): Path => points.map(([x, y]) => [x * side, y]);
    const ends: Point[] = [
      [x0 - T, y0 + d],
      [x0 - T + n, d],
      [x0 - T, y1 + d],
    ];
    bodies.push(m([[x0, y0 + d], [x0, y1 + d], ends[2], ends[1], ends[0]]));
    folds.push(m([[x0, y1], [x0 + f, y1 + d], [x0, y1 + d]]));
    lines.push(
      m([[x0, y0 + d], ...ends, [x0 + f, y1 + d], [x0, y1]]),
      m([
        [x0, y1],
        [x0, y1 + d],
      ]),
    );
  }

  // Up to 60 degrees across the front at 100%.
  const bend = ((Math.min(100, Math.max(0, s.ribbonArch)) / 100) * Math.PI) / 3;
  const R = bend > 0 ? W / bend : Infinity;
  const warp = ([x, y]: Point): Point => {
    if (!Number.isFinite(R)) return [x, y];
    const r = R - y;
    const a = x / R;
    return [r * Math.sin(a), R - r * Math.cos(a)];
  };
  const step = Number.isFinite(R) ? 0.3 : Infinity;
  const ring = (p: Path) => (Number.isFinite(R) ? subdivide(p, step, true).map(warp) : p);
  const line = (p: Path) => (Number.isFinite(R) ? subdivide(p, step, false).map(warp) : p);

  const frontRing = ring(front);
  const bodyRings = bodies.map(ring);
  const foldRings = folds.map(ring);
  const frameLines = [...openRing(frontRing), ...lines.map(line)];
  const centred = moved(text.g, -text.w / 2, -text.h / 2);
  const letters = Number.isFinite(R) ? warpText(centred, warp, 0.1) : centred;

  const all = [frontRing, ...bodyRings, ...foldRings];
  const [bx, by, bw, bh] = boundsOf(all);
  const limit = insetShape(layout.labelAnchor, s.gap);
  // Long text shrinks the whole ribbon. The line width stays the same.
  const fit = fitScale(limit, s.position, (f) => [bw * f, bh * f]);
  const placed = fit > 0 ? placeBlock(limit, s.position, bw * fit, bh * fit) : null;
  if (!placed) throw new LabelError('The ribbon does not fit inside the border. Make it smaller or shorten the text.');
  const at = ([x, y]: Point): Point => [placed[0] + (x - bx) * fit, placed[1] + (y - by) * fit];
  const shift = (p: Path): Path => p.map(at);
  return artwork({
    knockout: [placed[0], placed[1], bw * fit, bh * fit],
    clear: all.map(shift),
    text: place(letters, at),
    solid: (s.solid ? [frontRing, ...bodyRings] : foldRings).map(shift),
    reversed: s.solid,
    frame: frameLines.map(shift),
    frameWidth: s.borderWidth * k,
    frameLabel: 'Ribbon',
  });
}
