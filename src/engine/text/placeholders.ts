// {tokens} in the title, the subtitle and the pins' text, filled in from the
// map at render time. A subtitle of {coords} follows the map as it moves, and
// {km} follows the route. Typed in capitals, like {DATE}, the value is too.
import { formatCoordinates } from '../presets.ts';
import { decodeRoute, routeLengthM } from '../routes/route.ts';
import type { RouteData } from '../settings.ts';
import { type LabelSettings, SUBTITLED } from './label.ts';

export interface PlaceholderSource {
  lat: number;
  lon: number;
  // 1:scale
  scale: number;
  routes: readonly RouteData[];
  // The title as typed.
  title: string;
  now?: Date;
}

// null for a token with nothing to fill it with, like {km} without a route.
export type PlaceholderValues = Record<string, string | null>;

export const PLACEHOLDERS: { token: string; name: string }[] = [
  { token: 'coords', name: 'Coordinates' },
  { token: 'dms', name: 'Coordinates in degrees, minutes, seconds' },
  { token: 'lat', name: 'Latitude' },
  { token: 'lon', name: 'Longitude' },
  { token: 'scale', name: 'Scale' },
  { token: 'route', name: 'Route name' },
  { token: 'km', name: 'Route length in km' },
  { token: 'mi', name: 'Route length in miles' },
  { token: 'title', name: 'The title' },
  { token: 'date', name: "Today's date" },
  { token: 'year', name: 'This year' },
];

// What a token needs when it has nothing to fill it with.
const NEEDS: Record<string, string> = {
  route: 'a route. Import one under Routes',
  km: 'a route to measure. Import one under Routes',
  mi: 'a route to measure. Import one under Routes',
  title: 'a title',
};

const TOKEN = /\{(\w+)\}/g;

export const hasPlaceholders = (text: string) => /\{\w+\}/.test(text);

// Plain ' and " rather than the prime marks, which most of the bundled fonts
// don't have. Every Hershey font drew them as question marks.
function dms(value: number, positive: string, negative: string): string {
  const total = Math.round(Math.abs(value) * 3600);
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}" ${value >= 0 ? positive : negative}`;
}

function distance(metres: number, unit: number, name: string): string {
  const v = metres / unit;
  return `${v.toFixed(v < 10 ? 2 : 1)} ${name}`;
}

// Route lengths by route, since the values are worked out on every frame of a map drag.
const lengths = new WeakMap<RouteData, number>();
const lengthOf = (route: RouteData) => {
  let metres = lengths.get(route);
  if (metres === undefined) lengths.set(route, (metres = routeLengthM(decodeRoute(route))));
  return metres;
};

export function placeholderValues(src: PlaceholderSource): PlaceholderValues {
  const now = src.now ?? new Date();
  const visible = src.routes.filter((r) => r.visible);
  const metres = visible.reduce((sum, r) => sum + lengthOf(r), 0);
  const title = src.title.replace(TOKEN, '').replace(/\s+/g, ' ').trim();
  return {
    coords: formatCoordinates(src.lat, src.lon),
    dms: `${dms(src.lat, 'N', 'S')} ${dms(src.lon, 'E', 'W')}`,
    lat: `${Math.abs(src.lat).toFixed(4)}° ${src.lat >= 0 ? 'N' : 'S'}`,
    lon: `${Math.abs(src.lon).toFixed(4)}° ${src.lon >= 0 ? 'E' : 'W'}`,
    scale: `1:${Math.round(src.scale).toLocaleString()}`,
    route: visible.length ? visible.map((r) => r.name).join(', ') : null,
    km: visible.length ? distance(metres, 1000, 'km') : null,
    mi: visible.length ? distance(metres, 1609.344, 'mi') : null,
    title: title || null,
    date: now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    year: String(now.getFullYear()),
  };
}

/** Text with its tokens filled in. Tokens it doesn't know stay as typed. */
export function fillPlaceholders(text: string, values: PlaceholderValues, missing?: Set<string>): string {
  if (!text.includes('{')) return text;
  return text.replace(TOKEN, (whole, name: string) => {
    const key = name.toLowerCase();
    if (!Object.hasOwn(values, key)) return whole;
    const value = values[key];
    if (value === null) {
      missing?.add(key);
      return '';
    }
    return name !== key && name === name.toUpperCase() ? value.toUpperCase() : value;
  });
}

/** The title and the subtitle it shows, filled in. The same object back when there's nothing to fill. */
export function fillLabel(label: LabelSettings, values: PlaceholderValues, missing?: Set<string>): LabelSettings {
  if (!label.text.includes('{') && !label.subtitle.includes('{')) return label;
  const shown = label.enabled;
  return {
    ...label,
    text: shown ? fillPlaceholders(label.text, values, missing) : label.text,
    subtitle: shown && SUBTITLED.includes(label.style) ? fillPlaceholders(label.subtitle, values, missing) : label.subtitle,
  };
}

/** Warnings for tokens that had nothing to fill them with. */
export function missingWarnings(missing: Set<string>): string[] {
  return [...missing].map((key) => `{${key}} needs ${NEEDS[key] ?? "something this map doesn't have"}, or take it out.`);
}
