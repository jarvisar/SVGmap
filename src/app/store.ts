import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AreaSpec } from '../engine/geo/transform.ts';
import { type BorderSettings, type ProductSettings, computeLayout } from '../engine/layout/layout.ts';
import type { CleanupSettings } from '../engine/lines/cleanup.ts';
import { PLACE_PRESETS, PRODUCT_PRESETS, subtitleForPlace } from '../engine/presets.ts';
import {
  LASER_PALETTES,
  type ModeStyle,
  type OutputMode,
  PRINT_THEMES,
  type PlotterSettings,
  type RouteData,
  type RouteSettings,
  printStyle,
} from '../engine/settings.ts';
import type { LabelSettings } from '../engine/text/label.ts';
import { fontFingerprint } from '../engine/text/fonts.ts';
import type { CustomFont } from '../engine/text/loadFont.ts';
import type { FeatureFilters } from '../engine/tiles/schema.ts';
import {
  type CleanupPreset,
  type LaserPalette,
  type Settings,
  cleanupForPreset,
  defaultSettings,
  mergeSettings,
  migrateSettings,
  packPicks,
  unpackPicks,
} from './settings.ts';

export type View = 'map' | 'preview';
export type PreviewLook = 'material' | 'colors';

// Width of the map window in mm, which the 1:n scale is measured against.
export function windowWidth(product: ProductSettings, border: BorderSettings): number {
  try {
    return computeLayout(product, border).window.w;
  } catch {
    return product.width;
  }
}

export const scaleOf = (s: Pick<Settings, 'area' | 'product' | 'border'>) => (s.area.widthM / windowWidth(s.product, s.border)) * 1000;

// With the scale locked, a new product or border resizes the map area instead
// of changing the scale.
function keepScale(s: AppState, product: ProductSettings, border: BorderSettings): Partial<AppState> {
  if (!s.scaleLocked) return {};
  const ratio = windowWidth(product, border) / windowWidth(s.product, s.border);
  return { area: { ...s.area, widthM: s.area.widthM * ratio } };
}

interface Actions {
  set: (patch: Partial<Settings>) => void;
  // Ignores widthM while the scale is locked.
  setArea: (patch: Partial<AreaSpec>) => void;
  setScale: (scale: number) => void;
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
  setRoutes: (patch: Partial<Omit<RouteSettings, 'items'>>) => void;
  addRoutes: (items: RouteData[]) => void;
  updateRoute: (id: string, patch: Partial<Omit<RouteData, 'id'>>) => void;
  removeRoute: (id: string) => void;
  // Everything except the place, the title and subtitle text, the routes and the picked roads.
  reset: () => void;
}

export interface AppState extends Settings, Actions {
  view: View;
  setView: (view: View) => void;
  previewLook: PreviewLook;
  setPreviewLook: (look: PreviewLook) => void;
  customFontName: string | null;
  // Fingerprint of the loaded font, so a new version with the same name still re-renders.
  customFontId: string | null;
  setCustomFont: (font: CustomFont | null) => void;
  scaleLocked: boolean;
  setScaleLocked: (locked: boolean) => void;
}

// Set when the settings couldn't be saved, so SaveNotice can say so. Cleared by
// the next save that works. hidden is the notice being closed for this failure.
export const useSaveFailed = create<{ failed: boolean; hidden: boolean }>(() => ({ failed: false, hidden: false }));

// Settings are saved on every change. A full or blocked localStorage throws,
// and the error would come out of whatever action made the change, after the
// screen already shows it. The change is kept in memory instead.
const settingsStorage = createJSONStorage(() => {
  const local = window.localStorage;
  return {
    getItem: (name: string) => local.getItem(name),
    setItem: (name: string, value: string) => {
      try {
        local.setItem(name, value);
        if (useSaveFailed.getState().failed) useSaveFailed.setState({ failed: false, hidden: false });
      } catch (error) {
        if (!useSaveFailed.getState().failed) {
          console.error(error);
          useSaveFailed.setState({ failed: true });
        }
      }
    },
    removeItem: (name: string) => local.removeItem(name),
  };
});

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...defaultSettings(),
      view: 'map',
      setView: (view) => set({ view }),
      previewLook: 'material',
      setPreviewLook: (previewLook) => set({ previewLook }),
      customFontName: null,
      customFontId: null,
      setCustomFont: (font) => set({ customFontName: font?.name ?? null, customFontId: font ? fontFingerprint(font.data) : null }),
      scaleLocked: false,
      setScaleLocked: (scaleLocked) => set({ scaleLocked }),
      set: (patch) => set(patch),
      setArea: (patch) =>
        set((s) => ({ area: { ...s.area, ...patch, widthM: s.scaleLocked ? s.area.widthM : (patch.widthM ?? s.area.widthM) } })),
      setScale: (scale) => set((s) => ({ area: { ...s.area, widthM: (scale * windowWidth(s.product, s.border)) / 1000 } })),
      setProduct: (patch) =>
        set((s) => {
          const product = { ...s.product, ...patch };
          if (product.shape === 'circle') product.height = product.width;
          // Width is corner to corner, height is between the flat sides.
          if (product.shape === 'hexagon') product.height = (product.width * Math.sqrt(3)) / 2;
          return { product, productPreset: 'custom', ...keepScale(s, product, s.border) };
        }),
      applyProductPreset: (id) => {
        const preset = PRODUCT_PRESETS.find((p) => p.id === id);
        if (!preset) return set({ productPreset: 'custom' });
        const s = get();
        const product = structuredClone(preset.product);
        const border = { ...s.border, style: preset.border };
        set({
          productPreset: id,
          product,
          border,
          label: { ...s.label, style: preset.labelStyle },
          ...keepScale(s, product, border),
        });
      },
      applyPlace: (id) => {
        const place = PLACE_PRESETS.find((p) => p.id === id);
        if (!place) return;
        set((s) => ({
          area: { lon: place.lon, lat: place.lat, bearing: 0, widthM: s.scaleLocked ? s.area.widthM : place.widthM },
          label: { ...s.label, text: place.label, subtitle: subtitleForPlace(s.label.subtitle, place.lat, place.lon) },
        }));
      },
      setBorder: (patch) =>
        set((s) => {
          const border = { ...s.border, ...patch };
          return { border, ...keepScale(s, s.product, border) };
        }),
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
      setRoutes: (patch) => set((s) => ({ routes: { ...s.routes, ...patch } })),
      addRoutes: (items) => set((s) => ({ routes: { ...s.routes, items: [...s.routes.items, ...items] } })),
      updateRoute: (id, patch) =>
        set((s) => ({ routes: { ...s.routes, items: s.routes.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })),
      removeRoute: (id) => set((s) => ({ routes: { ...s.routes, items: s.routes.items.filter((r) => r.id !== id) } })),
      reset: () =>
        set((s) => {
          const defaults = defaultSettings();
          return {
            ...defaults,
            area: s.area,
            label: { ...defaults.label, text: s.label.text, subtitle: s.label.subtitle },
            routes: { ...defaults.routes, items: s.routes.items },
            roadRoutes: s.roadRoutes,
            hiddenLines: s.hiddenLines,
            ...keepScale(s, defaults.product, defaults.border),
          };
        }),
    }),
    {
      name: 'svgmap-settings',
      storage: settingsStorage,
      version: 3,
      migrate: (persisted, version) => migrateSettings(persisted, version) as AppState,
      partialize: (s) => {
        const { view: _view, ...rest } = s;
        void _view;
        const saved = Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'));
        return packPicks({ ...saved, roadRoutes: s.roadRoutes, hiddenLines: s.hiddenLines }) as Partial<AppState>;
      },
      merge: (persisted, current) => mergeSettings(current, unpackPicks(persisted)),
    },
  ),
);

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
  routes: s.routes,
  source: s.source,
  plotter: s.plotter,
  roadRoutes: s.roadRoutes,
  hiddenLines: s.hiddenLines,
});
