// The title in huge letters across the map. Either the map is cut away around
// the letters, or it only shows inside them and the rest of the window is blank.
import type { Layout } from '../../layout/layout.ts';
import type { TextGeometry } from '../outline.ts';
import type { LabelSettings } from '../label.ts';
import { type LabelArtwork, LabelError, artwork, availableWidthAt, boundsOf, moved, openRing, scaled, sized } from './common.ts';

export function layoutLettersLabel(layout: Layout, s: LabelSettings, title: TextGeometry): LabelArtwork {
  const win = layout.window;
  const k = s.size / 100;
  const unit = sized(title, 1);
  const margin = Math.min(win.w, win.h) * 0.06;
  // 86% of the window's width at 100%, but never taller than 70% of it.
  let h = Math.min((win.w * 0.86 * k) / unit.w, win.h * 0.7);
  let top = 0;
  let left = win.x;
  let right = win.x + win.w;
  // On a round piece the room depends on how high the letters sit, which
  // depends on their height, so fit a few times.
  for (let pass = 0; pass < 4; pass++) {
    top = s.lettersAlign === 'top' ? win.y + margin : s.lettersAlign === 'bottom' ? win.y + win.h - margin - h : win.y + (win.h - h) / 2;
    [left, right] = availableWidthAt(win, top, top + h);
    const room = right - left - 2 * margin;
    if (room <= 0) throw new LabelError('There is no room for the letters here. Try another position.');
    h = Math.min(h, room / unit.w);
  }
  const w = unit.w * h;
  const x = (left + right - w) / 2;
  const letters = moved(scaled(unit.g, h), x, top);
  const knockout: [number, number, number, number] = [x, top, w, h];

  if (s.lettersMode === 'window') {
    if (letters.rings.length === 0) throw new LabelError('The map only shows inside an outline font. Pick a font that is not single-line.');
    return artwork({
      knockout: boundsOf(letters.rings),
      keep: letters.rings,
      frame: letters.rings.flatMap(openRing),
      frameWidth: s.borderWidth * k,
      frameLabel: 'Letter outlines',
    });
  }
  return artwork({
    knockout,
    clear: letters.rings,
    clearLines: letters.strokes,
    clearGap: s.lettersGap,
    text: letters,
  });
}
