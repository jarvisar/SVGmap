// Everything the sidebar edits. Saved in localStorage and in share links, and
// turned into the engine's RenderSettings for each render.
import { defaultRenderSettings, defaultStyle } from '../engine/defaults.ts';
import { fitNumber } from '../engine/limits.ts';
import { DEFAULT_CLEANUP, type CleanupSettings } from '../engine/lines/cleanup.ts';
import { DEFAULT_PRODUCT } from '../engine/presets.ts';
import { MAX_ROUTE_LINES, MAX_ROUTE_POINTS, decodeRoute, encodeRoute } from '../engine/routes/route.ts';
import {
  LASER_PALETTES,
  LASER_STYLE,
  type ModeStyle,
  type OutputMode,
  PRINT_THEMES,
  ROUTE_DRAWS,
  type RenderSettings,
  type RouteData,
  defaultLineSpacing,
} from '../engine/settings.ts';
import { DEFAULT_LABEL, LABEL_CHOICES, type LabelSettings } from '../engine/text/label.ts';

export type CleanupPreset = 'off' | 'light' | 'standard' | 'strong' | 'custom';
export type LaserPalette = keyof typeof LASER_PALETTES;

export interface Settings extends Omit<RenderSettings, 'style' | 'title'> {
  productPreset: string;
  // Each mode keeps its own colours and fill styles.
  styles: Record<OutputMode, ModeStyle>;
  laserPalette: LaserPalette;
  printTheme: string;
  cleanupPreset: CleanupPreset;
}

const OUTPUT_MODES: string[] = ['laser', 'plotter', 'print'] satisfies OutputMode[];

export function defaultSettings(): Settings {
  const { style: _style, title: _title, ...shared } = defaultRenderSettings('laser');
  return {
    ...shared,
    productPreset: DEFAULT_PRODUCT.id,
    styles: { laser: defaultStyle('laser'), plotter: defaultStyle('plotter'), print: defaultStyle('print') },
    laserPalette: 'distinct',
    printTheme: 'classic',
    cleanupPreset: 'standard',
  };
}

// Presets scale the original defaults. Line spacing follows the output mode.
export function cleanupForPreset(preset: CleanupPreset, mode: OutputMode, penWidth: number, current: CleanupSettings): CleanupSettings {
  const spacing = defaultLineSpacing(mode, penWidth);
  const base: CleanupSettings = { ...DEFAULT_CLEANUP, lineSpacing: spacing };
  switch (preset) {
    case 'off':
      return { ...current, enabled: false };
    case 'light':
      return {
        ...base,
        lineSpacing: Math.round(spacing * 0.7 * 100) / 100,
        dense: false,
        aggressivePaths: false,
        pruneStubs: 0.4,
      };
    case 'strong':
      return {
        ...base,
        lineSpacing: Math.round(spacing * 1.4 * 100) / 100,
        denseLimit: 2.2,
        pruneStubs: 1.0,
        pathStubs: 1.8,
        tangleSpan: 8,
      };
    case 'custom':
      return { ...current, enabled: true };
    default:
      return base;
  }
}

export function toRenderSettings(s: Settings): RenderSettings {
  return {
    area: s.area,
    product: s.product,
    border: s.border,
    mode: s.mode,
    style: s.styles[s.mode],
    layers: s.layers,
    filters: s.filters,
    water: s.water,
    decks: s.decks,
    cleanup: s.cleanup,
    label: s.label,
    routes: s.routes,
    source: s.source,
    plotter: s.plotter,
    title: s.label.text.trim() || 'Map',
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// The only fields allowed to be null.
const NULLABLE = new Set(['background', 'customFontName', 'customFontId']);

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validString(path: string[], value: string): boolean {
  const key = path[path.length - 1];
  if (key === 'background' || path[path.length - 2] === 'colors') return HEX_COLOR.test(value);
  if (path.length === 1 && key === 'mode') return OUTPUT_MODES.includes(value);
  if (key === 'routeDraw') return (ROUTE_DRAWS as string[]).includes(value);
  if (path.length === 2 && path[0] === 'label') return LABEL_CHOICES[key as keyof LabelSettings]?.includes(value) ?? true;
  return true;
}

// Polyline characters only, so nothing else can ride along in a link.
const POLYLINE = /^[?-~]*$/;
const MAX_ROUTES = 50;

function fitRoutes(patch: unknown): RouteData[] | undefined {
  if (!Array.isArray(patch)) return undefined;
  const out: RouteData[] = [];
  for (const item of patch.slice(0, MAX_ROUTES)) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.lines)) continue;
    if (!item.lines.every((line) => typeof line === 'string' && POLYLINE.test(line))) continue;
    // Imports are already under the caps, but an edited link might not be.
    const lines = item.lines as string[];
    const decoded = decodeRoute({ lines });
    const points = decoded.reduce((sum, line) => sum + line.length, 0);
    const capped = lines.length > MAX_ROUTE_LINES || points > MAX_ROUTE_POINTS ? encodeRoute(decoded) : lines;
    out.push({ id: item.id.slice(0, 64), name: item.name.slice(0, 100), visible: item.visible !== false, lines: capped });
  }
  return out;
}

// The area isn't in the engine's limits, so it's checked here. Other numbers
// are clamped like the engine does, so a value typed past a slider's range
// comes back as what was rendered instead of the default.
function fitSetting(path: string[], value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  switch (path.join('.')) {
    case 'area.widthM':
      return value > 0 ? value : undefined;
    case 'area.lat':
      return Math.abs(value) <= 85 ? value : undefined;
    case 'area.lon':
      return Math.abs(value) <= 180 ? value : undefined;
    default:
      return path[0] === 'area' ? value : fitNumber(path, value);
  }
}

// Takes each value from patch only where base has a value of the same type.
// Saved settings and share links can come from an older build or be edited by
// hand, so anything that doesn't fit is dropped instead of breaking the app or
// ending up in the SVG. Colours have to be #RRGGBB, and numbers are brought
// into the range in engine/limits.ts.
export function mergeSettings<T>(base: T, patch: unknown, path: string[] = []): T {
  if (patch === undefined) return base;
  // The only list in the settings.
  if (Array.isArray(base)) return ((path.join('.') === 'routes.items' ? fitRoutes(patch) : undefined) ?? base) as T;
  if (isObject(base)) {
    if (!isObject(patch)) return base;
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(base)) {
      if (typeof value !== 'function') out[key] = mergeSettings(value, patch[key], [...path, key]);
    }
    return out as T;
  }
  const nullable = NULLABLE.has(path[path.length - 1]);
  if (patch === null) return (nullable ? null : base) as T;
  if (typeof patch === 'string') {
    const fits = typeof base === 'string' || (base === null && nullable);
    return (fits && validString(path, patch) ? patch : base) as T;
  }
  if (typeof patch === 'number') return ((typeof base === 'number' ? fitSetting(path, patch) : undefined) ?? base) as T;
  return (typeof patch === 'boolean' && typeof base === 'boolean' ? patch : base) as T;
}

// Label defaults that changed in version 2. Saved values still at the old
// default move to the new one, anything the user set is kept. The box came out
// too big, so it's 85% of what it was. Subtitle spacing used to be the band's
// spacing itself and is now on top of each style's own.
const LABEL_V1: Partial<Record<keyof LabelSettings, number>> = {
  textHeight: 7.776,
  maxWidth: 77.76,
  paddingX: 1.98,
  paddingY: 1.548,
  borderWidth: 0.25,
  subtitleSpacing: 1.2,
  dividerWidth: 0.1,
};

const ownEntry = <T>(table: Record<string, T>, key: unknown): T | undefined =>
  typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;

// Settings saved before routes, and links made then, got their route colour
// from the default palette. On the Minimal or LightBurn palette that's an extra
// process colour, so it comes from the user's own palette and print theme.
// A route colour still on the default palette's is taken to be one of those.
export function fillRouteColours(settings: unknown): unknown {
  if (!isObject(settings) || !isObject(settings.styles)) return settings;
  const styles: Record<string, unknown> = { ...settings.styles };
  const fill = (mode: OutputMode, own: string | undefined, fallback: string) => {
    const style = styles[mode];
    if (!own || !isObject(style) || !isObject(style.colors)) return;
    const route = style.colors.route;
    if (route === undefined || route === fallback) styles[mode] = { ...style, colors: { ...style.colors, route: own } };
  };
  fill('laser', ownEntry(LASER_PALETTES, settings.laserPalette)?.colors.route, LASER_STYLE.colors.route);
  fill('print', ownEntry(PRINT_THEMES, settings.printTheme)?.colors.route, PRINT_THEMES.classic.colors.route);
  return { ...settings, styles };
}

export function migrateSettings(persisted: unknown, version: number): unknown {
  if (!isObject(persisted)) return persisted;
  let out = persisted;
  if (version < 2 && isObject(out.label)) {
    const label: Record<string, unknown> = { ...out.label };
    for (const [key, old] of Object.entries(LABEL_V1)) {
      if (label[key] === old) label[key] = DEFAULT_LABEL[key as keyof LabelSettings];
    }
    out = { ...out, label };
  }
  return version < 3 ? fillRouteColours(out) : out;
}
