import { useCallback, useEffect, useMemo, useState } from 'react';
import { type MapMark, type MarkArtwork, hasText, layoutMark, markFont } from '../../engine/marks/marks.ts';
import type { LoadedFont } from '../../engine/text/outline.ts';
import { getCustomFont } from '../customFont.ts';
import { fontLoader } from './useLabelArtwork.ts';

export interface LiveMarks {
  arts: Map<string, MarkArtwork>;
  // Lays out a mark with other settings straight away, for a drag.
  layoutWith: (mark: MapMark) => MarkArtwork;
}

// Laid out again only when the mark or its font changes, not when the map moves.
const laidOut = new WeakMap<MapMark, { font: LoadedFont | null; art: MarkArtwork }>();

function layoutCached(mark: MapMark, font: LoadedFont | null): MarkArtwork {
  const hit = laidOut.get(mark);
  if (hit && hit.font === font) return hit.art;
  const art = layoutMark(mark, font);
  laidOut.set(mark, { font, art });
  return art;
}

/**
 * The marks laid out on the main thread, for the map view and for dragging
 * them in the preview. Text shows once its font is in, shapes straight away.
 */
export function useMarkArtworks(marks: MapMark[], titleFont: string, customFontId: string | null): LiveMarks {
  const wanted = useMemo(() => [...new Set(marks.filter(hasText).map((m) => markFont(m, titleFont)))].sort(), [marks, titleFont]);
  const key = `${wanted.join('|')}|${customFontId ?? ''}`;
  const [fonts, setFonts] = useState<ReadonlyMap<string, LoadedFont>>(new Map());
  useEffect(() => {
    if (!wanted.length) return;
    let live = true;
    const custom = getCustomFont();
    void fontLoader().then((loader) =>
      Promise.all(
        wanted.map((id) =>
          loader.load(id, custom).then(
            (font) => [id, font] as const,
            // Drawn in the default font, as the render does.
            () => loader.load('montserrat', null).then((font) => [id, font] as const),
          ),
        ),
      ).then(
        (loaded) => {
          if (live) setFonts((current) => new Map([...current, ...loaded]));
        },
        () => {},
      ),
    );
    return () => {
      live = false;
    };
    // The key covers the fonts and the loaded file.
  }, [key]);

  const layoutWith = useCallback((mark: MapMark) => layoutCached(mark, hasText(mark) ? (fonts.get(markFont(mark, titleFont)) ?? null) : null), [fonts, titleFont]);
  const arts = useMemo(() => new Map(marks.map((m) => [m.id, layoutWith(m)])), [marks, layoutWith]);
  return { arts, layoutWith };
}
