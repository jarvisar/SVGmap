// A map key in a corner: the title, the subtitle, a rule, then a scale bar
// and a north arrow. The box is the same size at any scale, the bar picks a
// round distance that fits it.
import type { Path, Point } from '../../lines/geometry.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { Layout } from '../../layout/layout.ts';
import { type TextGeometry, geometryBounds } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import {
  type LabelArtwork,
  LabelError,
  type MapInfo,
  NO_TEXT,
  artwork,
  fitScale,
  mergeGeometry,
  moved,
  openRing,
  place,
  placeBlock,
  rect,
  rotate,
  sized,
} from './common.ts';

const FOOT = 0.3048;
const MILE = 1609.344;

interface Distance {
  metres: number;
  half: string;
  full: string;
}

const trim = (n: number) => String(Number(n.toFixed(3)));

function distances(units: LabelSettings['legendUnits']): Distance[] {
  const out: Distance[] = [];
  if (units === 'imperial') {
    for (const ft of [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000]) out.push({ metres: ft * FOOT, half: trim(ft / 2), full: `${ft} ft` });
    for (const mi of [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) out.push({ metres: mi * MILE, half: trim(mi / 2), full: `${mi} mi` });
    return out;
  }
  // From 1 m, for the closest scale the app goes to, 1:100.
  for (let exp = 0; exp <= 6; exp++) {
    for (const m of [1, 2, 2.5, 5]) {
      const metres = m * 10 ** exp;
      const km = metres >= 1000;
      out.push({ metres, half: trim(km ? metres / 2000 : metres / 2), full: km ? `${trim(metres / 1000)} km` : `${metres} m` });
    }
  }
  return out;
}

export function layoutLegendLabel(
  layout: Layout,
  s: LabelSettings,
  title: TextGeometry,
  subtitle: TextGeometry | null,
  typeset: (text: string) => TextGeometry,
  map: MapInfo | null,
): LabelArtwork {
  const k = s.size / 100;
  const border = s.boxBorder ? s.borderWidth * k : 0;
  const lineWidth = s.borderWidth * k;
  const showScale = s.legendScale;
  const showNorth = s.legendNorth;
  const hasKey = showScale || showNorth;

  // Everything but the lines scales with fit, so a long title shrinks the
  // whole legend. The scale bar is worked out after, at the final size.
  const measure = (fit: number) => {
    const T = s.textHeight * k * fit * 0.72;
    const S = T * 0.36;
    const L = T * 0.3;
    const padX = s.paddingX * k * fit * 1.3;
    const padY = s.paddingY * k * fit * 1.3;
    const titleRow = sized(title, T);
    const subRow = subtitle ? sized(subtitle, S) : null;
    const barH = T * 0.26;
    const rowH = L * 1.5 + barH;
    const arrowSlot = rowH * 1.15;
    const arrowSpace = showNorth ? arrowSlot + T * 0.6 : 0;
    const contentW = Math.max(titleRow.w, subRow?.w ?? 0, hasKey ? (showScale ? T * 7 : 0) + arrowSpace : 0);
    const gapSub = T * 0.32;
    const gapRule = T * 0.5;
    const contentH = T + (subRow ? gapSub + S : 0) + (hasKey ? 2 * gapRule + rowH : 0);
    const boxW = contentW + 2 * (padX + border);
    const boxH = contentH + 2 * (padY + border);
    return { T, S, L, padX, padY, titleRow, subRow, barH, rowH, arrowSlot, arrowSpace, contentW, gapSub, gapRule, boxW, boxH };
  };
  const limit = insetShape(layout.labelAnchor, s.gap);
  const fit = fitScale(limit, (f) => {
    const m = measure(f);
    return [m.boxW, m.boxH];
  });
  const { T, S, L, padX, padY, titleRow, subRow, barH, rowH, arrowSlot, arrowSpace, contentW, gapSub, gapRule, boxW, boxH } = measure(fit);
  const placed = fit > 0 ? placeBlock(limit, layout.labelAnchor, s, boxW, boxH) : null;
  if (!placed) throw new LabelError('The legend does not fit inside the border. Make it smaller or shorten the text.');
  const [left, top] = placed.at;
  const x0 = left + border + padX;
  let y = top + border + padY;

  let lettering = moved(titleRow.g, x0, y);
  let subLettering: TextGeometry = NO_TEXT;
  y += T;
  if (subRow) {
    y += gapSub;
    subLettering = moved(subRow.g, x0, y);
    y += S;
  }
  const frame: Path[] = [];
  const solid: Path[] = [];
  if (hasKey) {
    y += gapRule;
    frame.push([
      [x0, y],
      [x0 + contentW, y],
    ]);
    y += gapRule;
  }

  // Labels share one scale so the digits match, bottoms on the line.
  const zero = geometryBounds(typeset('0'));
  const labelScale = zero ? L / (zero[3] - zero[1]) : 1;
  const label = (text: string, x: number, baseline: number, anchor: 'start' | 'middle') => {
    const g = typeset(text);
    const b = geometryBounds(g);
    if (!b) return { g: NO_TEXT, w: 0 };
    const w = (b[2] - b[0]) * labelScale;
    const dx = anchor === 'middle' ? x - w / 2 : x;
    return { g: place(g, ([px, py]) => [dx + (px - b[0]) * labelScale, baseline - (b[3] - py) * labelScale]), w };
  };

  const slot = contentW - arrowSpace;
  const mpm = map?.metresPerMm ?? 10;
  const width = (text: string) => label(text, 0, 0, 'start').w;
  const start = x0 + width('0') / 2;
  let pick: Distance | null = null;
  if (showScale) {
    for (const d of distances(s.legendUnits)) if (start + d.metres / mpm + width(d.full) / 2 <= x0 + slot) pick = d;
  }
  // The bar is left out when even the shortest one would run out of the box.
  if (pick) {
    const length = pick.metres / mpm;
    const baseline = y + L;
    const barTop = y + L * 1.5;
    // The middle label is left out when it would run into the others.
    const showHalf = length / 2 >= width(pick.half) / 2 + Math.max(width('0'), width(pick.full)) / 2 + L * 0.8;
    const labels: [string, number][] = [
      ['0', start],
      ...(showHalf ? [[pick.half, start + length / 2] as [string, number]] : []),
      [pick.full, start + length],
    ];
    for (const [text, x] of labels) lettering = mergeGeometry(lettering, label(text, x, baseline, 'middle').g);
    // Four blocks, alternately engraved, then the bar outline.
    for (let i = 0; i < 4; i++) {
      const bx = start + (length * i) / 4;
      if (i % 2 === 0) solid.push(rect(bx, barTop, length / 4, barH));
      else
        frame.push([
          [bx, barTop],
          [bx, barTop + barH],
        ]);
    }
    frame.push(...openRing(rect(start, barTop, length, barH)));
  }

  if (showNorth) {
    const cx = x0 + contentW - arrowSlot / 2;
    const cy = y + rowH / 2;
    const A = arrowSlot;
    const turn = -(map?.bearing ?? 0);
    const at = (dx: number, dy: number): Point => rotate([cx + dx * A, cy + dy * A], [cx, cy], turn);
    const tip = at(0, -0.12);
    const notch = at(0, 0.3);
    const leftPoint = at(-0.17, 0.46);
    const rightPoint = at(0.17, 0.46);
    // Left half engraved, right half outlined.
    solid.push([tip, leftPoint, notch]);
    frame.push(...openRing([tip, rightPoint, notch, leftPoint]), [notch, tip]);
    const n = sized(typeset('N'), A * 0.24);
    const letter = place(n.g, ([px, py]) => rotate([cx + px - n.w / 2, cy - A * 0.5 + py], [cx, cy], turn));
    lettering = mergeGeometry(lettering, letter);
  }

  const x2 = left + boxW;
  const y2 = top + boxH;
  if (border) {
    frame.push(
      [
        [left, top],
        [x2, top],
      ],
      [
        [x2, top],
        [x2, y2],
      ],
      [
        [x2, y2],
        [left, y2],
      ],
      [
        [left, y2],
        [left, top],
      ],
    );
  }
  return artwork({
    knockout: [left, top, boxW, boxH],
    clear: [rect(left, top, boxW, boxH)],
    text: lettering,
    subtitle: subLettering,
    solid,
    frame,
    frameWidth: lineWidth,
    frameLabel: 'Legend',
    offset: placed.offset,
    scale: fit,
  });
}
