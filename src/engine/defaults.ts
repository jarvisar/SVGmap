import { DEFAULT_PLACE, DEFAULT_PRODUCT } from './presets.ts';
import {
  DEFAULTS,
  defaultLineSpacing,
  LASER_STYLE,
  type ModeStyle,
  type OutputMode,
  PLOTTER_STYLE,
  type RenderSettings,
  printStyle,
} from './settings.ts';

export function defaultStyle(mode: OutputMode): ModeStyle {
  const style = mode === 'laser' ? LASER_STYLE : mode === 'plotter' ? PLOTTER_STYLE : printStyle('classic');
  return structuredClone(style);
}

export function defaultRenderSettings(mode: OutputMode = 'laser'): RenderSettings {
  const place = DEFAULT_PLACE;
  const product = DEFAULT_PRODUCT;
  return structuredClone({
    area: { lon: place.lon, lat: place.lat, bearing: 0, widthM: place.widthM },
    product: product.product,
    border: { ...DEFAULTS.border, style: product.border },
    mode,
    style: defaultStyle(mode),
    layers: DEFAULTS.layers,
    filters: DEFAULTS.filters,
    water: DEFAULTS.water,
    decks: DEFAULTS.decks,
    cleanup: { ...DEFAULTS.cleanup, lineSpacing: defaultLineSpacing(mode, DEFAULTS.plotter.penWidth) },
    label: { ...DEFAULTS.label, text: place.label, style: product.labelStyle },
    source: DEFAULTS.source,
    plotter: DEFAULTS.plotter,
    title: place.name,
  });
}
