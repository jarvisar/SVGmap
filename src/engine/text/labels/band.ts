// A strip across the top or bottom of the piece, like a poster. The map stops
// the same distance from the divider as it does from the border on the other
// sides, so the map and the title each sit in their own panel.
import type { Path } from '../../lines/geometry.ts';
import type { Layout } from '../../layout/layout.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import { rowsSpan } from '../place.ts';
import { type LabelArtwork, LabelError, NO_TEXT, artwork, diamond, mergeGeometry, moved, rect, scaled, sized } from './common.ts';

type Row = { kind: 'text'; g: TextGeometry; w: number; h: number } | { kind: 'ornament'; w: number; h: number };

// Rows the fit tries. A 20 mm band gets them 0.1 mm apart.
const BAND_ROWS = 200;

export function layoutBandLabel(layout: Layout, s: LabelSettings, title: TextGeometry, subtitle: TextGeometry | null): LabelArtwork {
  const anchor = layout.bandAnchor;
  if (!(s.bandHeight >= 5 && s.bandHeight <= 50)) throw new LabelError('Band height must be between 5 and 50%.');
  const height = (anchor.h * s.bandHeight) / 100;
  const atTop = s.bandPosition === 'top';
  const top = atTop ? anchor.y : anchor.y + anchor.h - height;
  const dividerY = atTop ? top + height : top;
  const mapGap = s.divider ? layout.innerGap : 0;
  const edge = Math.max(layout.thinLine ? layout.thinWidth : 0, s.divider ? s.dividerWidth : 0) / 2;
  const padX = s.bandPaddingX + edge;
  const padY = s.bandPaddingY + edge;
  const k = s.size / 100;
  const availableH = height - 2 * padY;
  if (availableH <= 0) throw new LabelError('The title band has no room for text. Make it taller or reduce padding.');

  const titleRow = sized(title, s.titleHeight * k);
  const rows: Row[] = [{ kind: 'text', ...titleRow }];
  if (s.ornament) {
    // A short rule with a diamond in the middle, as wide as about a third of
    // the title. Sized off the title so it stays in proportion when the title
    // shrinks to fit.
    const h = titleRow.h * 0.2;
    rows.push({ kind: 'ornament', w: Math.max(h * 8, titleRow.w * 0.34), h });
  }
  if (subtitle) rows.push({ kind: 'text', ...sized(subtitle, s.subtitleHeight * k) });
  // Everything scales with the fit, the gaps between rows too.
  const gap = rows.length > 1 ? s.subtitleGap * k : 0;
  const naturalH = rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1);
  const naturalW = Math.max(...rows.map((r) => r.w));
  const align = s.bandAlign === 'left' ? 0 : s.bandAlign === 'right' ? 1 : 0.5;
  const inner = insetShape(anchor, edge);
  const rowsFrom = top + padY;
  const rowsTo = top + height - padY;

  // The range the block's left edge can take with it at fit and its top at y,
  // or null when a row doesn't fit. Each row is held to its own part of the
  // band, so on a round piece a title isn't held to the narrower rows under
  // its subtitle.
  const slot = (fit: number, y: number): [number, number] | null => {
    const w = naturalW * fit;
    let lo = -Infinity;
    let hi = Infinity;
    let cursor = y;
    for (const r of rows) {
      const lw = r.w * fit;
      const lh = r.h * fit;
      const span = rowsSpan(inner, cursor, cursor + lh);
      if (!span) return null;
      const from = span[0] + padX;
      const to = span[1] - padX;
      if (lw > ((to - from) * s.bandMaxWidth) / 100 + 1e-9) return null;
      const shift = align * (w - lw);
      lo = Math.max(lo, from - shift);
      hi = Math.min(hi, to - lw - shift);
      cursor += lh + gap * fit;
    }
    if (cursor - gap * fit > rowsTo + 1e-9 || lo > hi + 1e-9) return null;
    return [lo, Math.max(lo, hi)];
  };
  // First and last top the block fits at, or null.
  const tops = (fit: number): [number, number] | null => {
    const last = rowsTo - naturalH * fit;
    if (last < rowsFrom - 1e-9) return null;
    const at = (i: number) => rowsFrom + ((last - rowsFrom) * i) / BAND_ROWS;
    let first = -1;
    let end = -1;
    for (let i = 0; i <= BAND_ROWS; i++) {
      if (!slot(fit, at(i))) continue;
      if (first < 0) first = i;
      end = i;
    }
    if (first < 0) return null;
    const edgeOf = (inside: number, outside: number) => {
      let a = at(inside);
      let b = at(outside);
      for (let i = 0; i < 20; i++) {
        const m = (a + b) / 2;
        if (slot(fit, m)) a = m;
        else b = m;
      }
      return a;
    };
    return [first > 0 ? edgeOf(first, first - 1) : at(first), end < BAND_ROWS ? edgeOf(end, end + 1) : at(end)];
  };

  // The largest text, up to the set heights, that fits somewhere in the band.
  // On a round piece that's by the band's straight edge, where it's widest.
  // Autofit lets it grow past them to fill the band.
  const widest = inner.w - 2 * padX;
  let fit = Math.min(s.autofit ? Infinity : 1, availableH / naturalH, (widest * s.bandMaxWidth) / 100 / naturalW);
  if (!(fit > 0)) throw new LabelError('The title band is too narrow here for any text.');
  if (!tops(fit)) {
    let lo = 0;
    let hi = fit;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (tops(m)) lo = m;
      else hi = m;
    }
    fit = lo;
  }
  const range = fit > 1e-6 ? tops(fit) : null;
  if (!range) throw new LabelError('The title band is too narrow here for any text.');

  // Centred in the rows it fits in, then aligned across them.
  const w = naturalW * fit;
  const baseY = (range[0] + range[1]) / 2;
  const [lo, hi] = slot(fit, baseY) ?? slot(fit, range[0])!;
  const middle = inner.x + inner.w / 2 - w / 2;
  const baseX = align === 0 ? lo : align === 1 ? hi : Math.min(Math.max(middle, lo), hi);
  let x = baseX;
  let y = baseY;
  if (s.bandOffsetX !== 0 || s.bandOffsetY !== 0) {
    // The nearest spot to where it was dragged that it still fits.
    const tx = baseX + s.bandOffsetX * anchor.w;
    const ty = baseY + s.bandOffsetY * height;
    const clampedY = Math.min(Math.max(ty, range[0]), range[1]);
    let best = Infinity;
    for (let i = -1; i <= BAND_ROWS; i++) {
      const ry = i < 0 ? clampedY : range[0] + ((range[1] - range[0]) * i) / BAND_ROWS;
      const span = slot(fit, ry);
      if (!span) continue;
      const rx = Math.min(Math.max(tx, span[0]), span[1]);
      const d = (rx - tx) ** 2 + (ry - ty) ** 2;
      if (d < best - 1e-12) {
        best = d;
        x = rx;
        y = ry;
      }
    }
  }

  let lettering: TextGeometry = NO_TEXT;
  const frame: Path[] = [];
  const solid: Path[] = [];
  let cursor = y;
  for (const row of rows) {
    const rw = row.w * fit;
    const h = row.h * fit;
    const rx = x + align * (w - rw);
    if (row.kind === 'text') {
      lettering = mergeGeometry(lettering, moved(scaled(row.g, fit), rx, cursor));
    } else {
      const cx = rx + rw / 2;
      const cy = cursor + h / 2;
      const space = h * 1.4;
      frame.push(
        [
          [rx, cy],
          [cx - space, cy],
        ],
        [
          [cx + space, cy],
          [rx + rw, cy],
        ],
      );
      solid.push(diamond(cx, cy, h * 1.3, h));
    }
    cursor += h + gap * fit;
  }

  if (s.divider) {
    const span = rowsSpan(anchor, dividerY, dividerY);
    const x0 = Math.max(anchor.x, span ? span[0] : anchor.x) + s.dividerInset;
    const x1 = Math.min(anchor.x + anchor.w, span ? span[1] : anchor.x + anchor.w) - s.dividerInset;
    if (x1 > x0) {
      frame.push([
        [x0, dividerY],
        [x1, dividerY],
      ]);
    }
  }
  const knockout: [number, number, number, number] = [anchor.x, atTop ? top : top - mapGap, anchor.w, height + mapGap];
  return artwork({
    knockout,
    clear: [rect(...knockout)],
    text: lettering,
    solid,
    frame,
    frameWidth: s.dividerWidth,
    frameLabel: 'Title divider',
    offset: [(x - baseX) / anchor.w, (y - baseY) / height],
    scale: fit,
  });
}
