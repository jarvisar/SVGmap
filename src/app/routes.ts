// Importing route files and framing the map around them. Files are read on the
// main thread, which takes well under a second even for a long ride.
import type { Feature, FeatureCollection } from 'geojson';
import { create } from 'zustand';
import { lonLatToWorld } from '../engine/geo/mercator.ts';
import { type AreaSpec, makeTransform } from '../engine/geo/transform.ts';
import { type Layout, computeLayout } from '../engine/layout/layout.ts';
import { shapeCentre, shapeContains } from '../engine/layout/shapes.ts';
import { fitArea } from '../engine/routes/fit.ts';
import { RouteFileError, parseRouteFile } from '../engine/routes/parse.ts';
import type { LonLat } from '../engine/routes/polyline.ts';
import { decodeRoute, encodeRoute } from '../engine/routes/route.ts';
import type { RouteData } from '../engine/settings.ts';
import { loadLabelArtwork } from './map/useLabelArtwork.ts';
import { useApp } from './store.ts';

export const ROUTE_ACCEPT = '.gpx,.kml,.kmz,.tcx,.geojson,.json';
const MAX_ROUTES = 50;

export interface ImportResult {
  added: string[];
  errors: string[];
}

const newId = () => Math.random().toString(36).slice(2, 10);

// Files dropped on the page can't report into the Routes section, which may be
// closed, so their problems show up as a notice at the bottom.
export const useImportNotice = create<{ errors: string[] }>(() => ({ errors: [] }));

// Adds every file it can read as a route, and frames the map around the routes.
export async function importRouteFiles(files: Iterable<File>): Promise<ImportResult> {
  const added: RouteData[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (useApp.getState().routes.items.length + added.length >= MAX_ROUTES) {
      errors.push(`${file.name}: there can be up to ${MAX_ROUTES} routes. Remove some first.`);
      continue;
    }
    try {
      const parsed = await parseRouteFile(file.name, await file.arrayBuffer());
      added.push({ id: newId(), name: parsed.name, visible: true, lines: encodeRoute(parsed.lines) });
    } catch (error) {
      if (!(error instanceof RouteFileError)) console.error(error);
      const reason = error instanceof RouteFileError ? error.message : "It couldn't be read.";
      errors.push(`${file.name}: ${reason}`);
    }
  }
  if (added.length > 0) {
    useApp.getState().addRoutes(added);
    await fitMapToRoutes(false);
  }
  return { added: added.map((r) => r.name), errors };
}

export function visibleRouteLines(items: readonly RouteData[]): LonLat[][] {
  return items.filter((r) => r.visible).flatMap((r) => decodeRoute(r));
}

// Centres the map on the visible routes and sizes it so they fill the window,
// beside the title if there's room. With the scale locked it only moves the map.
export async function fitMapToRoutes(rotate: boolean): Promise<boolean> {
  const s = useApp.getState();
  const lines = visibleRouteLines(s.routes.items);
  if (lines.length === 0) return false;
  let layout;
  try {
    layout = computeLayout(s.product, s.border);
  } catch {
    return false;
  }
  // Without the fonts the title's size is unknown, so it's fitted to the whole window.
  const label = await loadLabelArtwork(layout, s.label).catch(() => null);
  const { window } = layout;
  const reach = s.routes.markers ? Math.max(s.routes.markerSize * 0.6, s.routes.width / 2) : s.routes.width / 2;
  const area = fitArea(lines, {
    window,
    avoid: label?.artwork?.knockout ?? null,
    bearing: s.area.bearing,
    rotate,
    margin: Math.max(2, Math.min(window.w, window.h) * 0.04) + reach + s.routes.gap,
    widthM: s.scaleLocked ? s.area.widthM : undefined,
  });
  if (!area) return false;
  useApp.getState().setArea(area);
  return true;
}

// Share of the route points outside the map window, 0 to 1. Runs while the
// map is dragged, so long routes are sampled.
export function shareOutside(lines: readonly LonLat[][], area: AreaSpec, layout: Layout): number {
  const transform = makeTransform(area, 14, shapeCentre(layout.window), layout.window.w);
  let total = 0;
  let out = 0;
  for (const line of lines) {
    const step = Math.max(1, Math.floor(line.length / 500));
    for (let i = 0; i < line.length; i += step) {
      total++;
      if (!shapeContains(layout.window, transform.toCanvas(...lonLatToWorld(line[i][0], line[i][1], 14)))) out++;
    }
  }
  return total ? out / total : 0;
}

// For the map view. Start and finish points get their own features for the dots.
export function routesGeoJson(items: readonly RouteData[]): FeatureCollection {
  const features: Feature[] = [];
  for (const route of items) {
    if (!route.visible) continue;
    const lines = decodeRoute(route);
    if (lines.length === 0) continue;
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } });
    const last = lines[lines.length - 1];
    features.push(
      { type: 'Feature', properties: { end: 'start' }, geometry: { type: 'Point', coordinates: lines[0][0] } },
      { type: 'Feature', properties: { end: 'finish' }, geometry: { type: 'Point', coordinates: last[last.length - 1] } },
    );
  }
  return { type: 'FeatureCollection', features };
}
