// Everything the sidebar edits. Saved in localStorage and in share links, and
// turned into the engine's RenderSettings for each render.
import { defaultRenderSettings, defaultStyle } from '../engine/defaults.ts';
import { fitNumber } from '../engine/limits.ts';
import { DEFAULT_CLEANUP, type CleanupSettings } from '../engine/lines/cleanup.ts';
import { DEFAULT_PRODUCT } from '../engine/presets.ts';
import {
  LASER_PALETTES,
  type ModeStyle,
  type OutputMode,
  type RenderSettings,
  defaultLineSpacing,
} from '../engine/settings.ts';

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
  return true;
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
