// A round seal. The title runs over the top of the ring and the subtitle along
// the bottom, with stars between them. The middle has a compass rose turned
// to true north, or shows the map through it.
import type { Path, Point } from '../../lines/geometry.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { Layout } from '../../layout/layout.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import {
  type LabelArtwork,
  LabelError,
  type MapInfo,
  artwork,
  bendText,
  circle,
  fitScale,
  mergeGeometry,
  openRing,
  place,
  placeBlock,
  rotate,
  scaled,
  sized,
  star,
} from './common.ts';

// Longest a line of text can run around the ring, leaving room for the stars at the sides.
const MAX_SWEEP = Math.PI - 0.7;

function compass(cx: number, cy: number, length: number, turn: number): { solid: Path[]; lines: Path[] } {
  const valley = length * 0.13;
  const at = (r: number, a: number): Point => rotate([cx + r * Math.cos(a), cy + r * Math.sin(a)], [cx, cy], turn);
  const solid: Path[] = [];
  const lines: Path[] = [];
  const outline: Path = [];
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const tip = at(i % 2 ? length * 0.58 : length, a);
    const right = at(valley, a + Math.PI / 8);
    // The right half of each point is engraved, like a printed compass rose.
    solid.push([[cx, cy], tip, right]);
    lines.push([[cx, cy], tip]);
    outline.push(tip, right);
  }
  lines.push(...openRing(outline));
  return { solid, lines };
}

// 72 ticks around the inside of the ring, longer at north, east, south and west.
function dial(cx: number, cy: number, r: number, turn: number): Path[] {
  const out: Path[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i * Math.PI) / 36;
    const length = r * (i % 18 === 0 ? 0.1 : i % 2 === 0 ? 0.06 : 0.035);
    const p = (radius: number) => rotate([cx + radius * Math.cos(a), cy + radius * Math.sin(a)], [cx, cy], turn);
    out.push([p(r), p(r - length)]);
  }
  return out;
}

export function layoutBadgeLabel(
  layout: Layout,
  s: LabelSettings,
  title: TextGeometry,
  subtitle: TextGeometry | null,
  north: TextGeometry | null,
  map: MapInfo | null,
): LabelArtwork {
  const k = s.size / 100;
  const limit = insetShape(layout.labelAnchor, s.gap);
  // Too big for the piece: the whole badge shrinks. The line width stays the same.
  const fit = fitScale(limit, (f) => [s.badgeDiameter * k * f, s.badgeDiameter * k * f]);
  const D = s.badgeDiameter * k * fit;
  const R = D / 2;
  const placed = fit > 0 ? placeBlock(limit, layout.labelAnchor, s, D, D) : null;
  if (!placed) throw new LabelError('The badge does not fit inside the border. Make it smaller.');
  const cx = placed.at[0] + R;
  const cy = placed.at[1] + R;

  // Outer line, second line, then the text band down to the inner line.
  const r2 = R * 0.93;
  const r3 = R * 0.62;
  const mid = (r2 + r3) / 2;
  const band = r2 - r3;
  const lineFit = (row: { w: number }, h: number) => Math.min(h, (h * MAX_SWEEP * mid) / row.w);

  let lettering: TextGeometry = { rings: [], strokes: [] };
  const titleRow = sized(title, band * 0.5);
  const titleH = lineFit(titleRow, titleRow.h);
  lettering = mergeGeometry(lettering, bendText(scaled(titleRow.g, titleH / titleRow.h), (titleRow.w * titleH) / titleRow.h, titleH, cx, cy, mid, true));
  if (subtitle) {
    const row = sized(subtitle, band * 0.36);
    const h = lineFit(row, row.h);
    lettering = mergeGeometry(lettering, bendText(scaled(row.g, h / row.h), (row.w * h) / row.h, h, cx, cy, mid, false));
  }
  // The stars count as lettering, so a solid ring leaves them bare too.
  const starR = band * 0.17;
  const stars: Path[] = [star(cx - mid, cy, starR), star(cx + mid, cy, starR)];
  if (!subtitle) {
    for (const [a, r] of [[0, starR * 1.2], [-0.24, starR * 0.8], [0.24, starR * 0.8]]) {
      stars.push(star(cx + mid * Math.cos(Math.PI / 2 + a), cy + mid * Math.sin(Math.PI / 2 + a), r));
    }
  }
  lettering = mergeGeometry(lettering, { rings: stars, strokes: [] });

  const width = s.borderWidth * k;
  const frame: Path[] = [circle(cx, cy, R - width / 2), circle(cx, cy, r2), circle(cx, cy, r3)].flatMap(openRing);
  const solid: Path[] = s.solid ? [circle(cx, cy, r2), circle(cx, cy, r3, true)] : [];
  const showMap = s.badgeCentre === 'map';
  if (!showMap) {
    const turn = -(map?.bearing ?? 0);
    const rose = compass(cx, cy, r3 * 0.62, turn);
    solid.push(...rose.solid);
    frame.push(...rose.lines, ...dial(cx, cy, r3, turn));
    if (north) {
      // Between the north point and the ticks.
      const n = sized(north, r3 * 0.12);
      const [nx, ny] = rotate([cx, cy - r3 * 0.75], [cx, cy], turn);
      const letter = place(n.g, ([x, y]) => rotate([nx + x - n.w / 2, ny + y - n.h / 2], [nx, ny], turn));
      lettering = mergeGeometry(lettering, letter);
    }
  }
  return artwork({
    knockout: [placed.at[0], placed.at[1], D, D],
    clear: showMap ? [circle(cx, cy, R), circle(cx, cy, r3, true)] : [circle(cx, cy, R)],
    text: lettering,
    solid,
    reversed: s.solid,
    frame,
    frameWidth: width,
    frameLabel: 'Badge',
    offset: placed.offset,
    scale: fit,
  });
}
