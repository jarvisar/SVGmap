import { useEffect, useState } from 'react';
import type { Layout } from '../../engine/layout/layout.ts';
import { type LabelArtwork, type LabelSettings, buildLabel } from '../../engine/text/label.ts';
import { FontLoader } from '../../engine/text/loadFont.ts';
import { getCustomFont } from '../customFont.ts';

const fonts = new FontLoader(async (path) => {
  const response = await fetch(new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)));
  if (!response.ok) throw new Error(`Could not load ${path}.`);
  return response.arrayBuffer();
});

// Lays out the title on the main thread for the map overlay.
export function useLabelArtwork(layout: Layout | null, label: LabelSettings, customFontName: string | null) {
  const [artwork, setArtwork] = useState<LabelArtwork | null>(null);
  useEffect(() => {
    let active = true;
    if (!layout || !label.enabled || !label.text.trim()) {
      setArtwork(null);
      return;
    }
    const custom = getCustomFont();
    const subtitleId = label.subtitleFont || label.font;
    Promise.all([fonts.load(label.font, custom), fonts.load(subtitleId, custom)])
      .then(([title, subtitle]) => {
        if (active) setArtwork(buildLabel(layout, label, title, subtitle).artwork);
      })
      .catch(() => {
        if (active) setArtwork(null);
      });
    return () => {
      active = false;
    };
  }, [layout, label, customFontName]);
  return artwork;
}
