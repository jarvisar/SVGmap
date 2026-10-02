import { useCallback, useEffect, useMemo, useState } from 'react';
import { download } from '../../engine/download.ts';
import type { Layout } from '../../engine/layout/layout.ts';
import { type LabelArtwork, type LabelSettings, type MapInfo, buildLabel, usesSubtitleFont } from '../../engine/text/label.ts';
import type { FontLoader } from '../../engine/text/loadFont.ts';
import type { LoadedFont } from '../../engine/text/outline.ts';
import { type PlaceholderValues, fillLabel } from '../../engine/text/placeholders.ts';
import { getCustomFont } from '../customFont.ts';

let loader: Promise<FontLoader> | null = null;

// opentype.js is loaded on demand so it isn't part of the first page load.
// Same idle limit as the render worker's fonts: a font that never finishes
// would otherwise hold the title overlay, and every later load of it.
export function fontLoader(): Promise<FontLoader> {
  loader ??= import('../../engine/text/loadFont.ts').then(
    ({ FontLoader }) =>
      new FontLoader(async (path) => {
        const url = new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
        const { status, bytes } = await download(url, 30_000);
        if (!bytes) throw new Error(`Could not load ${path} (${status}).`);
        return bytes;
      }),
    (error: unknown) => {
      // Try the chunk again next time, it may have been a dropped connection.
      loader = null;
      throw error;
    },
  );
  return loader;
}

// The title's font, and the subtitle's when the title uses it.
async function loadFonts(label: LabelSettings): Promise<[LoadedFont, LoadedFont]> {
  const custom = getCustomFont();
  const fonts = await fontLoader();
  const subtitleId = label.subtitleFont || label.font;
  const title = await fonts.load(label.font, custom);
  return [title, subtitleId === label.font || !usesSubtitleFont(label) ? title : await fonts.load(subtitleId, custom)];
}

export interface LabelPreview {
  artwork: LabelArtwork | null;
  // Why the title can't be drawn, like not fitting inside the border.
  error: string | null;
}

// Lays out the title once, for fitting the map to a route.
export async function loadLabelArtwork(layout: Layout, label: LabelSettings, values: PlaceholderValues, map: MapInfo | null = null): Promise<LabelPreview> {
  const shown = fillLabel(label, values);
  if (!shown.enabled || !shown.text.trim()) return { artwork: null, error: null };
  const [title, subtitle] = await loadFonts(shown);
  return buildLabel(layout, shown, title, subtitle, map);
}

export interface LiveLabel extends LabelPreview {
  // Lays the title out with other settings straight away, for a drag. Null
  // until the fonts are in.
  layoutWith: ((label: LabelSettings) => LabelArtwork | null) | null;
}

interface Fonts {
  key: string;
  title: LoadedFont | null;
  subtitle: LoadedFont | null;
  error: string | null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Lays out the title on the main thread, for the map overlay and dragging it
// in the preview. Nothing is loaded while `active` is false. The {tokens} in
// it are filled in from values, as a render does.
export function useLabelArtwork(
  active: boolean,
  layout: Layout | null,
  label: LabelSettings,
  customFontId: string | null,
  values: PlaceholderValues,
  map: MapInfo | null = null,
): LiveLabel {
  const wanted = active && label.enabled && label.text.trim() !== '';
  const subtitleId = usesSubtitleFont(label) ? label.subtitleFont || label.font : label.font;
  const key = `${label.font}|${subtitleId}|${customFontId ?? ''}`;
  // The last fonts loaded stay in use while others load, so the title doesn't
  // blink out when the font changes.
  const [fonts, setFonts] = useState<Fonts | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const custom = getCustomFont();
    fontLoader()
      .then((loaded) => Promise.all([loaded.load(label.font, custom), subtitleId === label.font ? null : loaded.load(subtitleId, custom)]))
      .then(([title, subtitle]) => {
        if (live) setFonts({ key, title, subtitle: subtitle ?? title, error: null });
      })
      .catch((error: unknown) => {
        if (live) setFonts({ key, title: null, subtitle: null, error: message(error) });
      });
    return () => {
      live = false;
    };
    // The key covers both fonts and the loaded file.
  }, [wanted, key]);

  // The values change on every frame of a map drag, since the coordinates are
  // in them. Only what this title fills in to matters, so one without
  // {coords} isn't laid out again all through the drag.
  const filled = fillLabel(label, values);
  const fillKey = `${filled.text}\n${filled.subtitle}`;
  const used = useMemo(() => values, [fillKey]);
  const build = useCallback(
    (l: LabelSettings): LabelPreview => {
      if (!layout || !fonts?.title) return { artwork: null, error: null };
      try {
        const { artwork, error } = buildLabel(layout, fillLabel(l, used), fonts.title, fonts.subtitle, map);
        return { artwork, error };
      } catch (error) {
        return { artwork: null, error: message(error) };
      }
    },
    [layout, fonts, map, used],
  );
  return useMemo(() => {
    if (!wanted) return { artwork: null, error: null, layoutWith: null };
    if (fonts?.error && fonts.key === key) return { artwork: null, error: fonts.error, layoutWith: null };
    return { ...build(label), layoutWith: fonts?.title && layout ? (l: LabelSettings) => build(l).artwork : null };
  }, [wanted, fonts, key, build, label, layout]);
}
