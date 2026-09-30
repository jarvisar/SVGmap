import { useEffect, useState } from 'react';
import { download } from '../../engine/download.ts';
import type { Layout } from '../../engine/layout/layout.ts';
import { type LabelArtwork, type LabelSettings, buildLabel } from '../../engine/text/label.ts';
import type { FontLoader } from '../../engine/text/loadFont.ts';
import { getCustomFont } from '../customFont.ts';

let loader: Promise<FontLoader> | null = null;

// opentype.js is loaded on demand so it isn't part of the first page load.
// Same idle limit as the render worker's fonts: a font that never finishes
// would otherwise hold the title overlay, and every later load of it.
function fontLoader(): Promise<FontLoader> {
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

export interface LabelPreview {
  artwork: LabelArtwork | null;
  // Why the title can't be drawn, like not fitting inside the border.
  error: string | null;
}

// Lays out the title on the main thread for the map overlay.
export function useLabelArtwork(layout: Layout | null, label: LabelSettings, customFontId: string | null): LabelPreview {
  const [preview, setPreview] = useState<LabelPreview>({ artwork: null, error: null });
  useEffect(() => {
    let active = true;
    if (!layout || !label.enabled || !label.text.trim()) {
      setPreview({ artwork: null, error: null });
      return;
    }
    const custom = getCustomFont();
    const subtitleId = label.subtitleFont || label.font;
    fontLoader()
      .then((fonts) => Promise.all([fonts.load(label.font, custom), fonts.load(subtitleId, custom)]))
      .then(([title, subtitle]) => {
        if (active) setPreview(buildLabel(layout, label, title, subtitle));
      })
      .catch((error: unknown) => {
        if (active) setPreview({ artwork: null, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, [layout, label, customFontId]);
  return preview;
}
