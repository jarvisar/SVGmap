import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultStyle } from '../engine/defaults.ts';
import type { AreaSpec } from '../engine/geo/transform.ts';
import type { BorderSettings, ProductSettings } from '../engine/layout/layout.ts';
import { DEFAULT_CLEANUP, type CleanupSettings } from '../engine/lines/cleanup.ts';
import { DEFAULT_PLACE, DEFAULT_PRODUCT, PLACE_PRESETS, PRODUCT_PRESETS } from '../engine/presets.ts';
import {
  DEFAULTS,
  type DeckSettings,
  LASER_PALETTES,
  type LayerId,
  type ModeStyle,
  type OutputMode,
  PRINT_THEMES,
  type PlotterSettings,
  type RenderSettings,
  type SourceSettings,
  type WaterSettings,
  defaultLineSpacing,
  printStyle,
} from '../engine/settings.ts';
import type { LabelSettings } from '../engine/text/label.ts';
import type { FeatureFilters } from '../engine/tiles/schema.ts';

export type CleanupPreset = 'off' | 'light' | 'standard' | 'strong' | 'custom';
export type LaserPalette = keyof typeof LASER_PALETTES;
export type View = 'map' | 'preview';

export interface Settings {
  area: AreaSpec;
  productPreset: string;
  product: ProductSettings;
  border: BorderSettings;
  mode: OutputMode;
  styles: Record<OutputMode, ModeStyle>;
  laserPalette: LaserPalette;
  printTheme: string;
  layers: Record<LayerId, boolean>;
  filters: FeatureFilters;
  water: WaterSettings;
  decks: DeckSettings;
  cleanupPreset: CleanupPreset;
  cleanup: CleanupSettings;
  label: LabelSettings;
  source: SourceSettings;
  plotter: PlotterSettings;
}

export function defaultSettings(): Settings {
  const place = DEFAULT_PLACE;
  const preset = DEFAULT_PRODUCT;
  return structuredClone({
    area: { lon: place.lon, lat: place.lat, bearing: 0, widthM: place.widthM },
    productPreset: preset.id,
    product: preset.product,
    border: { ...DEFAULTS.border, style: preset.border },
    mode: 'laser' as OutputMode,
    styles: { laser: defaultStyle('laser'), plotter: defaultStyle('plotter'), print: defaultStyle('print') },
    laserPalette: 'distinct' as LaserPalette,
    printTheme: 'classic',
    layers: DEFAULTS.layers,
    filters: DEFAULTS.filters,
    water: DEFAULTS.water,
    decks: DEFAULTS.decks,
    cleanupPreset: 'standard' as CleanupPreset,
    cleanup: DEFAULT_CLEANUP,
    label: { ...DEFAULTS.label, text: place.label, style: preset.labelStyle },
    source: DEFAULTS.source,
    plotter: DEFAULTS.plotter,
  });
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

interface Actions {
  set: (patch: Partial<Settings>) => void;
  setArea: (patch: Partial<AreaSpec>) => void;
  setProduct: (patch: Partial<ProductSettings>) => void;
  applyProductPreset: (id: string) => void;
  applyPlace: (id: string) => void;
  setBorder: (patch: Partial<BorderSettings>) => void;
  setMode: (mode: OutputMode) => void;
  setStyle: (patch: Partial<ModeStyle>) => void;
  setLaserPalette: (palette: LaserPalette) => void;
  setPrintTheme: (theme: string) => void;
  setLabel: (patch: Partial<LabelSettings>) => void;
  setCleanupPreset: (preset: CleanupPreset) => void;
  setCleanup: (patch: Partial<CleanupSettings>) => void;
  setFilters: (update: (filters: FeatureFilters) => FeatureFilters) => void;
  setPlotter: (patch: Partial<PlotterSettings>) => void;
  reset: () => void;
}

export interface AppState extends Settings, Actions {
  view: View;
  setView: (view: View) => void;
  customFontName: string | null;
  setCustomFontName: (name: string | null) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...defaultSettings(),
      view: 'map',
      customFontName: null,
      setView: (view) => set({ view }),
      setCustomFontName: (customFontName) => set({ customFontName }),
      set: (patch) => set(patch),
      setArea: (patch) => set((s) => ({ area: { ...s.area, ...patch } })),
      setProduct: (patch) =>
        set((s) => {
          const product = { ...s.product, ...patch };
          if (product.shape === 'circle') product.height = product.width;
          return { product, productPreset: 'custom' };
        }),
      applyProductPreset: (id) => {
        const preset = PRODUCT_PRESETS.find((p) => p.id === id);
        if (!preset) return set({ productPreset: 'custom' });
        const s = get();
        set({
          productPreset: id,
          product: structuredClone(preset.product),
          border: { ...s.border, style: preset.border },
          label: { ...s.label, style: preset.labelStyle },
        });
      },
      applyPlace: (id) => {
        const place = PLACE_PRESETS.find((p) => p.id === id);
        if (!place) return;
        set((s) => ({
          area: { lon: place.lon, lat: place.lat, bearing: 0, widthM: place.widthM },
          label: { ...s.label, text: place.label },
        }));
      },
      setBorder: (patch) => set((s) => ({ border: { ...s.border, ...patch } })),
      setMode: (mode) =>
        set((s) => ({
          mode,
          cleanup:
            s.cleanupPreset === 'custom' || s.cleanupPreset === 'off'
              ? s.cleanup
              : cleanupForPreset(s.cleanupPreset, mode, s.plotter.penWidth, s.cleanup),
        })),
      setStyle: (patch) => set((s) => ({ styles: { ...s.styles, [s.mode]: { ...s.styles[s.mode], ...patch } } })),
      setLaserPalette: (laserPalette) =>
        set((s) => ({
          laserPalette,
          styles: { ...s.styles, laser: { ...s.styles.laser, colors: { ...LASER_PALETTES[laserPalette].colors } } },
        })),
      setPrintTheme: (printTheme) =>
        set((s) => {
          const theme = printStyle(printTheme as keyof typeof PRINT_THEMES);
          return {
            printTheme,
            styles: { ...s.styles, print: { ...s.styles.print, colors: theme.colors, background: theme.background } },
          };
        }),
      setLabel: (patch) => set((s) => ({ label: { ...s.label, ...patch } })),
      setCleanupPreset: (preset) =>
        set((s) => ({ cleanupPreset: preset, cleanup: cleanupForPreset(preset, s.mode, s.plotter.penWidth, s.cleanup) })),
      setCleanup: (patch) => set((s) => ({ cleanup: { ...s.cleanup, ...patch, enabled: true }, cleanupPreset: 'custom' })),
      setFilters: (update) => set((s) => ({ filters: update(s.filters) })),
      setPlotter: (patch) =>
        set((s) => {
          const plotter = { ...s.plotter, ...patch };
          const followSpacing = s.mode === 'plotter' && s.cleanupPreset !== 'custom' && s.cleanupPreset !== 'off';
          return {
            plotter,
            cleanup: followSpacing ? cleanupForPreset(s.cleanupPreset, 'plotter', plotter.penWidth, s.cleanup) : s.cleanup,
          };
        }),
      reset: () => set({ ...defaultSettings() }),
    }),
    {
      name: 'svgmap-settings',
      version: 1,
      partialize: (s) => {
        const { view: _view, ...rest } = s;
        void _view;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as Partial<AppState>;
      },
      // Settings saved by an older build get any fields they are missing.
      merge: (persisted, current) => deepMerge(current, persisted as Partial<AppState>),
    },
  ),
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keeps default keys that an older saved copy doesn't have.
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as Record<string, unknown>)[key];
    if (typeof current === 'function') continue;
    out[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

export const selectSettings = (s: AppState): Settings => ({
  area: s.area,
  productPreset: s.productPreset,
  product: s.product,
  border: s.border,
  mode: s.mode,
  styles: s.styles,
  laserPalette: s.laserPalette,
  printTheme: s.printTheme,
  layers: s.layers,
  filters: s.filters,
  water: s.water,
  decks: s.decks,
  cleanupPreset: s.cleanupPreset,
  cleanup: s.cleanup,
  label: s.label,
  source: s.source,
  plotter: s.plotter,
});
