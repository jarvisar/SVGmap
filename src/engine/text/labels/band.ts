// A strip across the top or bottom of the piece, like a poster. The map stops
// the same distance from the divider as it does from the border on the other
// sides, so the map and the title each sit in their own panel.
import type { Path } from '../../lines/geometry.ts';
import type { Layout } from '../../layout/layout.ts';
import { insetShape } from '../../layout/shapes.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import { type LabelArtwork, LabelError, NO_TEXT, artwork, availableWidthAt, diamond, mergeGeometry, moved, rect, scaled, sized } from './common.ts';

type Row = { kind: 'text'; g: TextGeometry; w: number; h: number } | { kind: 'ornament'; h: number };

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
  // The rule is sized off the title so it stays in proportion when the title shrinks to fit.
  if (s.ornament) rows.push({ kind: 'ornament', h: titleRow.h * 0.2 });
  if (subtitle) rows.push({ kind: 'text', ...sized(subtitle, s.subtitleHeight * k) });
  const gap = rows.length > 1 ? s.subtitleGap * k : 0;
  const naturalH = rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1);

  const inner = insetShape(anchor, edge);
  const fitWidth = (a: number, b: number) => ((b - a - 2 * padX) * s.bandMaxWidth) / 100;
  const widest = Math.max(...rows.map((r) => (r.kind === 'text' ? r.w : 0)));
  // place is 0 for centred and 1 for against the divider. Shrinking the text
  // moves it, which changes the width available on a round piece, so fit a few times.
  const fitAt = (place: number) => {
    let fit = Math.min(1, availableH / naturalH);
    let blockTop = 0;
    let left = 0;
    let right = 0;
    for (let pass = 0; pass < 3; pass++) {
      const h = naturalH * fit;
      const centred = top + (height - h) / 2;
      const against = atTop ? top + height - padY - h : top + padY;
      blockTop = centred + (against - centred) * place;
      [left, right] = availableWidthAt(inner, blockTop, blockTop + h);
      const limit = fitWidth(left, right);
      if (limit <= 0) return null;
      fit = Math.min(fit, limit / widest);
    }
    return { fit, blockTop, left, right };
  };
  // A band on a round piece is widest at the divider, so the text moves
  // towards it when that lets it be bigger.
  let best = fitAt(0);
  for (const place of [0.5, 1]) {
    const next = fitAt(place);
    if (next && (!best || next.fit > best.fit * 1.02)) best = next;
  }
  if (!best) throw new LabelError('The title band is too narrow here for any text.');
  const { fit, blockTop, left, right } = best;

  let lettering: TextGeometry = NO_TEXT;
  const frame: Path[] = [];
  const solid: Path[] = [];
  const titleW = titleRow.w * fit;
  const alignX = (w: number) =>
    s.bandAlign === 'left' ? left + padX : s.bandAlign === 'right' ? right - padX - w : (left + right - w) / 2;
  let cursor = blockTop;
  for (const row of rows) {
    const h = row.h * fit;
    if (row.kind === 'text') {
      const w = row.w * fit;
      lettering = mergeGeometry(lettering, moved(scaled(row.g, fit), alignX(w), cursor));
    } else {
      // A short rule with a diamond in the middle, as wide as about a third of the title.
      const length = Math.max(h * 8, titleW * 0.34);
      const x0 = s.bandAlign === 'left' ? alignX(titleW) : s.bandAlign === 'right' ? alignX(titleW) + titleW - length : alignX(length);
      const cx = x0 + length / 2;
      const cy = cursor + h / 2;
      const space = h * 1.4;
      frame.push(
        [
          [x0, cy],
          [cx - space, cy],
        ],
        [
          [cx + space, cy],
          [x0 + length, cy],
        ],
      );
      solid.push(diamond(cx, cy, h * 1.3, h));
    }
    cursor += h + gap * fit;
  }

  if (s.divider) {
    const [a, b] = availableWidthAt(anchor, dividerY, dividerY);
    const x0 = Math.max(anchor.x, a) + s.dividerInset;
    const x1 = Math.min(anchor.x + anchor.w, b) - s.dividerInset;
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
  });
}
