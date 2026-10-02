// The values the {tokens} in the title, subtitle and pins get, worked out
// from the settings the same way a render does, so what's laid out here
// matches the file.
import { useMemo } from 'react';
import { type PlaceholderValues, placeholderValues } from '../engine/text/placeholders.ts';
import { type AppState, scaleOf, useApp } from './store.ts';

export function placeholdersOf(s: Pick<AppState, 'area' | 'product' | 'border' | 'routes' | 'label'>): PlaceholderValues {
  return placeholderValues({ lat: s.area.lat, lon: s.area.lon, scale: scaleOf(s), routes: s.routes.items, title: s.label.text });
}

/**
 * The values now. The map moves every frame while it's dragged, so the same
 * object comes back until a value actually changes, and titles and pins
 * aren't laid out again for nothing.
 */
export function usePlaceholderValues(): PlaceholderValues {
  const key = useApp((s) => JSON.stringify(placeholdersOf(s)));
  return useMemo(() => JSON.parse(key) as PlaceholderValues, [key]);
}
